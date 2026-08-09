# Core concepts

How Voltix decides what re-renders: subscriptions are per key, the state object keeps one identity, writes that change nothing are skipped, and writes can be grouped.

- [Getting started](./getting-started.md)
- [Composition](./composition.md)
- [API reference](./api-reference.md)
- [Guides](./guides.md)
- [Patterns](./patterns.md)

## The vocabulary

The words the docs use, in plain terms:

**Store.** An object of keys, created with `createStore`. It lives outside React, so any module can import it and read or write it. No provider.

**Key.** One named value in a store. Components subscribe to keys. Writing a key re-renders only the components reading that key.

**Leaf.** A key holding data: a number, string, boolean, object, or array. Read it with `getKey`, write it with `setKey`.

**Child.** A key holding another store or a lookup. The child keeps its own state; you reach it with `select(key)`.

**Node.** A store or a lookup. Both bind under a key, and both work with `createActions`.

**Lookup.** A store per id, made with `createLookup`. `at(id)` returns the store for that id, creating it on first use. Use it for lists where each row should update on its own.

**Action.** A function that writes to a store. `createActions` groups a store's actions in one place and returns them as a plain object.

**Contract.** A schema (zod, valibot, arktype) attached to a key with `options.schema`. Every write to that key is validated and a bad write is rejected. Use it on data that comes from outside your code: fetch responses, storage, forms.

**Derived key.** A key computed from other keys with `derive`. It updates inside the same write that changed its inputs.

## Fine-grained by key

Every key has its own listeners. A write notifies the listeners of the keys that changed and nobody else.

```tsx
const store = createStore({ theme: 'dark', unread: 3 });

function Unread() {
  const unread = useStoreKey(store, 'unread');
  return <span>{unread}</span>;
}

function Theme() {
  const theme = useStoreKey(store, 'theme');
  return <span>{theme}</span>;
}

store.setKey('theme', 'light'); // only <Theme /> re-renders
store.increment('unread');       // only <Unread /> re-renders
```

`useStoreSelector` works the same way: it re-renders for its selected keys and ignores every other write. When one `set` changes several keys a component reads, the component re-renders once.

## Identity-stable state

`get()` always returns the same object. Writes change the values inside it.

```tsx
const before = store.get();
store.setKey('unread', 5);
const after = store.get();
before === after; // true, always the same reference
```

What that means for you:

- Reading is free. `getKey` and `get` return live values, no copies.
- Comparing snapshots of `get()` tells you nothing, because the reference never changes. Subscribe to keys instead.
- To change an object value, assign a new object. Mutating the current one changes data without telling anyone:

```tsx
const store = createStore({ user: { name: 'Ada', role: 'admin' } });

store.get().user.name = 'Bob';                 // mutates in place, no notification
store.mergeSet('user', { name: 'Bob' });       // new object for `user`, listeners notified
store.setKey('user', { name: 'Bob', role: 'admin' }); // also notifies
```

`mergeSet` spreads your patch onto the current value and writes the result, so you skip building the new object yourself. See [`mergeSet`](./api-reference.md#mergeset); to merge without writing, use the [`merge` helper](./api-reference.md#merge-helper).

## Leaves and children

What you put under a key decides what the key is. Data makes a **leaf**: normal state you read and write. A store (or a [lookup](./composition.md#lookups-a-store-per-id)) makes a **child**: it keeps its own state, and you reach it with `select(key)`.

```tsx
const settings = createStore({ theme: 'dark', fontSize: 14 });

const workspace = createStore({
  name: 'Personal',   // leaf — data
  settings,           // child — a store
});

workspace.get();                                      // { name: 'Personal' } — the workspace's own state
workspace.select('settings').setKey('fontSize', 16);  // the settings data lives in `settings`
```

This is how one store grows into a tree. See [Composition](./composition.md).

## Equality

A write only counts when the value actually changed (`Object.is`). Writing the same value again does nothing: no write, no re-render.

Some values are new objects that mean the same thing, like a re-fetched user. Give that key its own equality check at creation and those writes are skipped too:

```tsx
const store = createStore(
  { user: { id: 1, name: 'Ada' } },
  { equals: { user: (prev, next) => prev.id === next.id } }
);
```

### The compare-by-`.id` pattern

A fetch or a form often produces a fresh object for the same entity. Compare by id and the noise disappears:

```tsx
const store = createStore(
  { user: { id: 1, name: 'Ada' } },
  { equals: { user: (prev, next) => prev.id === next.id } }
);

store.setKey('user', { id: 1, name: 'Ada' });          // renders
store.setKey('user', { id: 1, name: 'Ada Lovelace' }); // same id, skipped
```

This runs at write time, so the skipped value never lands and nobody re-renders. To guard one component instead of the store, pass a compare function inside its [`useStoreSelector`](./api-reference.md#usestoreselector) selector.

## Batching

`batch` groups several writes into one notification. Listeners fire once, after the callback ends.

```tsx
store.batch(() => {
  store.setKey('count', 10);
  store.increment('count', 5);
  store.setKey('label', 'moved');
});
// a component reading count and label re-renders once, not three times
```

Use `batch` for a loop of writes, or when calling several functions that each write on their own. If you already know the keys, `set({ count: 15, label: 'moved' })` is one update and needs no batch. Nested `batch` calls flush once, at the end of the outermost one.

Derived keys commit in the same update as their inputs, so their subscribers wake in the same round. See [derived keys](./guides.md#derived-keys).
