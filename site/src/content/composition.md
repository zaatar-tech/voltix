# Composition

A key can hold another store. That is the whole mechanism: build small stores, bind them under keys, and you get a tree.

Build the child first, bind it after. Binding changes nothing about the child, and a nested store is exactly as fast as a flat one.

- [The example](#the-example)
- [Nesting a store](#nesting-a-store)
- [Leaves and children](#leaves-and-children)
- [Lookups: a store per id](#lookups-a-store-per-id)
- [Navigating: `select` and `at`](#navigating-select-and-at)
- [Nested lookups](#nested-lookups)
- [What re-renders](#what-re-renders)

See also [Core concepts](./core-concepts.md) for the vocabulary and the [API reference](./api-reference.md) for signatures.

## The example

Everything below builds one thing: a **workspace** with user settings and a set of documents, where each document has its own comments.

```
workspace                leaves: name, syncing
├── settings             theme, fontSize              (a nested store)
└── documents            a lookup: one store per document id
    └── <docId>          title, body, dirty, error    (contract + actions + error policy)
        └── comments     a lookup: one store per comment id
            └── <id>     author, text, resolved
```

## Nesting a store

Build the child first. Settings is a normal store with its own actions. It works on its own and knows nothing about any workspace:

```tsx
import { createStore, createActions } from 'voltix';

export const settings = createStore({ theme: 'dark' as 'dark' | 'light', fontSize: 14 });

export const settingsActions = createActions(settings, (store) => ({
  toggleTheme: () => store.setKey('theme', store.getKey('theme') === 'dark' ? 'light' : 'dark'),
  setFontSize: (px: number) => store.setKey('fontSize', px),
}));
```

Then bind it under a key:

```tsx
export const workspace = createStore({
  name: 'Personal',
  syncing: false,
  settings,            // ← a finished store becomes a child
});

workspace.setKey('name', 'Team');           // a parent leaf
settingsActions.toggleTheme();               // the child's actions still work
workspace.select('settings') === settings;   // true — binding did not copy or rebuild it
```

Passing a store *as* the shape is a `TypeError`. A store goes under a key: write `createStore({ settings })`, never `createStore(settings)`.

## Leaves and children

What you put under a key decides what the key is:

- Data (numbers, strings, booleans, objects, arrays) makes a **leaf**: the store's own state. `get()` returns leaves, `setKey` writes them, components subscribe to them.
- A store or a lookup makes a **child**. The child keeps its own state; the parent just holds the reference. You read and write a child on the child itself.

The `workspace` from above has two leaves and one child:

```tsx
workspace.get();        // { name: 'Team', syncing: false } — the workspace's own state
workspace.children();   // ['settings'] — the settings data lives in `settings`, so `get()` has none of it

workspace.setKey('syncing', true);                    // leaf write
workspace.select('settings').setKey('fontSize', 16);  // child state is written on the child
```

`workspace.setKey('settings', …)` is a compile error: a child key holds no workspace state to write.

A plain object never becomes a child. `cursor: { line: 1, column: 1 }` is one leaf value: replace the whole object to update it, and subscribers to `cursor` hear one change. When the fields should update independently, use a store instead: `cursor: createStore({ line: 1, column: 1 })`.

## Lookups: a store per id

`createLookup(factory)` makes a **lookup**: a store per id. `at(id)` returns the store for that id — the first call runs your factory to create it, later calls return the same one. Use a lookup for per-item state: documents, rows, entities.

The factory builds each store completely, so every document comes with its contract and error handling attached. Actions go over the lookup, taking the id first:

```tsx
import { z } from 'zod';
import { createStore, createLookup, createActions } from 'voltix';

export function makeDocument(id: string) {
  const document = createStore(
    { title: 'Untitled', body: '', dirty: false, error: '' },
    { schema: { title: z.string().trim().min(1).max(120) } }
  );

  document.onSchemaError((error) => document.setKey('error', error.issues[0].message));

  return document;
}

export const documents = createLookup(makeDocument);

export const documentActions = createActions(documents, (lookup) => ({
  rename: (id: string, title: string) => lookup.at(id).set({ title, error: '' }),
  edit: (id: string, body: string) => lookup.at(id).set({ body, dirty: true }),
  markSaved: (id: string) => lookup.at(id).setKey('dirty', false),
}));
```

Each document checks its own writes and reports its own failures:

```tsx
documentActions.rename('spec', '   ');   // rejected by the contract
documents.at('spec').getKey('title');    // 'Untitled' — the write never landed
documents.at('spec').getKey('error');    // 'Too small: expected string to have >=1 characters'

documentActions.rename('spec', '  Design spec  ');
documents.at('spec').getKey('title');    // 'Design spec' — the contract trimmed it on the way in
```

When the per-item state is plain data with no behaviour, return a shape from the factory instead and the lookup builds the stores for you. A second argument applies [`StoreOptions`](./api-reference.md#storeoptions) to each one:

```tsx
const presence = createLookup(
  (userId: string) => ({ online: false, lastSeen: 0 }),
  { schema: { lastSeen: z.number().int().min(0) } }
);
```

Options apply to shape factories only. A factory that builds its own stores configures them itself, so lookup options are ignored there (with a dev warning).

A lookup has no keys of its own. Its surface is `at` plus lifecycle:

```tsx
documents.has('readme');    // true
documents.keys();           // ['readme', 'spec'] — live ids, insertion order
documents.size();           // 2
documents.remove('spec');   // true; a later at('spec') builds a fresh store
documents.clear();          // drop every store
```

`remove` and `clear` drop the store and its subscriptions. One thing they can't clean up: wiring to something **external** (a subscription on another store, a timer, a socket). Keep those disposers where you can reach them and call one before removing:

```tsx
const stopSync = new Map<string, () => void>();

function makePresence(userId: string) {
  const presence = createStore({ online: false });
  stopSync.set(userId, socket.onChange(['users'], () => presence.setKey('online', socket.has(userId))));
  return presence;
}

stopSync.get(userId)?.();
stopSync.delete(userId);
presence.remove(userId);
```

In React, a component subscribes to one store from the lookup, so editing one document re-renders one row:

```tsx
function DocumentRow({ id }: { id: string }) {
  const { title, dirty } = useStoreSelector(documents.at(id), ['title', 'dirty']);
  return <li>{title}{dirty && ' •'}</li>;
}
```

A lookup binds under a key exactly like a store. With both pieces built, the workspace takes its full shape from [the example](#the-example):

```tsx
export const workspace = createStore({
  name: 'Personal',
  syncing: false,
  settings,     // child — a store
  documents,    // child — a lookup
});
```

## Navigating: `select` and `at`

Two methods, one argument each:

- **`select(key)`** steps into a fixed child. The key is typed, autocompleted, and checked at compile time.
- **`at(id)`** steps into a lookup. The id is runtime data.

```tsx
documentActions.rename('readme', 'README');

workspace.select('documents').at('readme') === documents.at('readme');  // true — same store
```

Use `at` when the id comes from data, like `documents.at(currentDocId)`. For a fixed child you usually already have the reference, and `settings.setKey('fontSize', 16)` does the same thing as `workspace.select('settings').setKey('fontSize', 16)`, so use the shorter one.

`.children()` lists a store's child keys. Selecting a key that is not a child throws a `RangeError` (and is a compile error first).

## Nested lookups

Children and lookups mix freely and nest as deep as you need. Each document owns a lookup of comments:

```tsx
function makeDocument(id: string) {
  return createStore({
    title: 'Untitled',
    body: '',
    dirty: false,
    comments: createLookup((commentId: string) =>
      createStore({ author: '', text: '', resolved: false })
    ),                                       // a lookup inside each document
  });
}
```

The chain follows the tree: child, id, child, id.

```tsx
workspace.select('documents').at('readme').select('comments').at('c1').set({ author: 'ada', text: 'Looks good' });

workspace.select('documents').at('readme').select('comments').keys();  // ['c1']
documents.at('readme').select('comments').at('c1').getKey('text');     // 'Looks good'
```

## What re-renders

The tree is only for organizing state. Re-rendering works like it does in a flat store: writing a key re-renders the components reading that key, and nobody else. Take two small components:

```tsx
function Title({ id }: { id: string }) {
  const title = useStoreKey(documents.at(id), 'title');
  return <h2>{title}</h2>;
}

function Body({ id }: { id: string }) {
  const body = useStoreKey(documents.at(id), 'body');
  return <article>{body}</article>;
}
```

Now edit one document's body and walk through who re-renders:

```tsx
documentActions.edit('readme', '# Hello');   // writes `body` on the readme document

// <Body id="readme" />      re-renders — it reads that key on that document
// <Title id="readme" />     unchanged — same document, different key
// <Body id="changelog" />   unchanged — different document
// anything reading `workspace.name` etc. — unchanged; a write inside a child never touches the parent
```
