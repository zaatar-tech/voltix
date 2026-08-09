# Walkthrough

A task board, built step by step: one store first, then actions, contracts, a store per task, and server loading. Each step adds one idea and the code keeps working between steps.

- [1. A store and a component](#1-a-store-and-a-component)
- [2. Several keys, independent re-renders](#2-several-keys-independent-re-renders)
- [3. Put the writes in actions](#3-put-the-writes-in-actions)
- [4. A task that owns itself](#4-a-task-that-owns-itself)
- [5. A store per id](#5-a-store-per-id)
- [6. Compose the app](#6-compose-the-app)
- [7. Derived keys and counters](#7-derived-keys-and-counters)
- [8. Render it](#8-render-it)
- [9. Load from a server](#9-load-from-a-server)
- [10. Persist what should outlive a reload](#10-persist-what-should-outlive-a-reload)
- [The finished shape](#the-finished-shape)

## 1. A store and a component

A store is a flat object of keys, created once at module scope. No provider, no context.

```tsx
// ui.ts
import { createStore } from 'voltix';

export type Filter = 'all' | 'open' | 'done';

export const ui = createStore({
  filter: 'all' as Filter,
  search: '',
});
```

Read one key with `useStoreKey`. It returns the value itself.

```tsx
import { useStoreKey } from 'voltix';
import { ui } from './ui';

function SearchBox() {
  const search = useStoreKey(ui, 'search');
  return <input value={search} onChange={(event) => ui.setKey('search', event.target.value)} />;
}
```

## 2. Several keys, independent re-renders

`useStoreSelector` takes an array of keys and returns just those keys.

```tsx
function Toolbar() {
  const { filter, search } = useStoreSelector(ui, ['filter', 'search']);
  return <span>{filter} · {search}</span>;
}
```

Subscriptions are per key: writing `filter` never wakes a component that only reads `search`.

```ts
ui.subscribe(['filter'], () => console.log('filter'));
ui.subscribe(['search'], () => console.log('search'));

ui.setKey('filter', 'open');   // logs 'filter'
ui.setKey('search', 'milk');   // logs 'search'
ui.setKey('filter', 'open');   // logs nothing — same value, no write
```

## 3. Put the writes in actions

`createActions` collects a store's writes in one place and returns them as a plain object. The store itself is untouched.

```tsx
// ui.ts
import { createStore, createActions } from 'voltix';

export const ui = createStore({ filter: 'all' as Filter, search: '' });

export const uiActions = createActions(ui, (store) => ({
  setFilter: (filter: Filter) => store.setKey('filter', filter),
  setSearch: (query: string) => store.setKey('search', query),
  clear: () => store.reset(),
}));

uiActions.setFilter('open');
ui.setKey('search', 'milk');   // the store is still just a store
```

Actions are plain functions in a plain object: import them where needed, and combine sets with object spread.

## 4. A task that owns itself

A task has rules (the title), behaviour, and a place to record a rejected write. Build it as a complete store before it joins any collection.

```tsx
// task.ts
import { z } from 'zod';
import { createStore } from 'voltix';

export function makeTask(id: string) {
  const task = createStore(
    { title: '', done: false, error: '' },
    { schema: { title: z.string().trim().min(1).max(80) } }   // its contract
  );

  task.onSchemaError((error) => task.setKey('error', error.issues[0].message)); // its failure policy

  return task;
}
```

Every task now behaves like this, wherever it ends up:

```ts
const task = makeTask('t1');

task.set({ title: '   ', error: '' });   // rejected by the contract
task.getKey('title');                    // '' — the write never landed
task.getKey('error');                    // 'Too small: expected string to have >=1 characters'

task.set({ title: '  Buy milk  ', error: '' });
task.getKey('title');                    // 'Buy milk' — the schema trimmed it on the way in
task.getKey('error');                    // '' — cleared by the same write
```

The contract runs on every write, and the error handler runs after the write settles. That is why `set({ title, error: '' })` can clear an old error without erasing the message a rejection just wrote.

## 5. A store per id

`createLookup` makes a **lookup**: a store per id. `at(id)` creates the store on first use and returns the same one after. The factory returns a finished store, so every task comes with its contract and error handling attached. Task actions go over the lookup, id first:

```ts
// tasks.ts
import { createLookup, createActions } from 'voltix';
import { makeTask } from './task';

export const tasks = createLookup(makeTask);

export const taskActions = createActions(tasks, (lookup) => ({
  rename: (id: string, title: string) => lookup.at(id).set({ title, error: '' }),
  toggle: (id: string) => lookup.at(id).toggle('done'),
}));

taskActions.rename('t1', 'Buy milk');
taskActions.toggle('t1');
tasks.at('t1') === tasks.at('t1');   // true — memoized, the exact node makeTask built
```

`at(id)` is how you reach the store for an id. `has`, `keys`, `size`, `remove`, and `clear` handle the lifecycle.

## 6. Compose the app

Bind the finished stores under one root. A key holding a store is a child; the other keys stay plain data.

```ts
// app.ts
import { createStore, createActions } from 'voltix';
import { ui } from './ui';
import { tasks, taskActions } from './tasks';

export const app = createStore({
  ids: new Set<string>(),   // membership is the semantic — a Set can't hold a duplicate row
  count: 0,
  open: 0,
  loading: false,
  ui,        // child store
  tasks,     // child lookup
});

export const appActions = createActions(app, (store) => ({
  add(id: string, title: string) {
    if (store.getKey('ids').has(id)) return;            // idempotent — a double add is a no-op
    taskActions.rename(id, title);
    store.update('ids', (ids) => new Set(ids).add(id)); // fresh Set, so subscribers notify
    store.increment('open');
  },
  remove(id: string) {
    if (!store.getKey('ids').has(id)) return;
    if (!store.select('tasks').at(id).getKey('done')) store.increment('open', -1);
    store.update('ids', (ids) => {
      const next = new Set(ids);
      next.delete(id);
      return next;
    });
    store.select('tasks').remove(id);
  },
  toggle(id: string) {
    taskActions.toggle(id);
    store.increment('open', store.select('tasks').at(id).getKey('done') ? -1 : 1);
  },
}));
```

`ids` is a `Set`: duplicates are impossible and `has` is O(1). The guards make `add` and `remove` safe to call twice, so a double-click can't duplicate a row or corrupt the counters. Writes always build a **fresh** `Set`, because Voltix compares by reference and mutating the current one changes data without notifying anyone.

Children stay out of the parent's state, and binding changes nothing about them:

```ts
app.get();                    // { ids: Set(0), count: 0, open: 0, loading: false }
app.children();               // ['ui', 'tasks']
app.select('ui') === ui;                         // true
app.select('tasks').at('t1') === tasks.at('t1');  // true
```

Both ways of reaching a child are the same call; use whichever reads better. `ui.setKey('filter', 'open')` does the same as `app.select('ui').setKey('filter', 'open')`. `at` is for dynamic ids, like `app.select('tasks').at(someId)`. Note that `appActions` calls `taskActions` directly: actions are plain functions, so app behaviour is built out of task behaviour with ordinary calls.

## 7. Derived keys and counters

`derive` computes a key from other keys in the same store, inside the write that changes an input:

```ts
app.derive('count', ['ids'], ({ ids }) => ids.size);

appActions.add('t1', 'Buy milk');
app.getKey('count');   // 1, already committed
```

`open` depends on state spread across the lookup's stores, which `derive` cannot see. Update it from the actions that change it (`add`, `remove`, `toggle` above): O(1) per change instead of re-scanning every task.

## 8. Render it

Each component subscribes to exactly what it reads.

```tsx
import { useStoreKey, useStoreSelector } from 'voltix';
import { app, appActions } from './app';
import { tasks } from './tasks';

function Header() {
  const { count, open } = useStoreSelector(app, ['count', 'open']);
  return <h1>{open} open / {count} total</h1>;
}

function Row({ id }: { id: string }) {
  const { title, done, error } = useStoreSelector(tasks.at(id), ['title', 'done', 'error']);
  return (
    <li>
      <input type="checkbox" checked={done} onChange={() => appActions.toggle(id)} />
      {title}
      {error && <em>{error}</em>}
      <button onClick={() => appActions.remove(id)}>×</button>
    </li>
  );
}

function Board() {
  const ids = useStoreKey(app, 'ids');
  return (
    <>
      <Header />
      <ul>{[...ids].map((id) => <Row key={id} id={id} />)}</ul>
    </>
  );
}
```

Toggling one task re-renders **that `Row` only**. `Header` re-renders when `count` or `open` actually changed. Adding a task changes `ids` and `count`, so the list and `Header` update.

## 9. Load from a server

Async work goes in an action:

```ts
export async function loadBoard() {
  app.setKey('loading', true);
  try {
    const res = await fetch('/api/tasks');
    const rows: { id: string; title: string; done: boolean }[] = await res.json();

    tasks.clear();
    for (const r of rows) tasks.at(r.id).set({ title: r.title, done: r.done });

    app.set({
      ids: new Set(rows.map((r) => r.id)),
      open: rows.filter((r) => !r.done).length,
      loading: false,
    });
  } catch {
    app.setKey('loading', false);
  }
}
```

Server data is written straight into the task stores with `set`. It still passes each task's contract, so a malformed row is rejected per key instead of landing on the board.

Call it once where the data is first needed:

```tsx
useEffect(() => { loadBoard(); }, []);
```

## 10. Persist what should outlive a reload

Persist preferences; server data reloads from the server. Seed the initial state from storage, then attach `persist`.

```ts
import { createStore, persist, loadPersistedState } from 'voltix';

type UiState = { filter: Filter; search: string };

const persisted = loadPersistedState<UiState>(localStorage, 'board', ['filter']);

export const ui = createStore<UiState>(
  { filter: 'all', search: '', ...persisted },
  { schema: { filter: z.enum(['all', 'open', 'done']).catch('all') } }
);

persist<UiState>(ui, localStorage, 'board', ['filter']);
```

`.catch('all')` handles junk in storage (users edit it, old deploys leave old shapes behind): a bad value becomes `'all'` at construction instead of an impossible filter in your UI.

## The finished shape

```
app                      leaves: ids, count, open, loading
├── ui                   filter, search        (+ actions, persisted, contract)
└── tasks                lookup
    └── <id>             title, done, error    (+ actions, contract, error handler)
```

Reading back what each piece did:

| Step | Idea |
|---|---|
| 1–2 | One store, per-key subscriptions |
| 3 | `createActions` co-locates writes, the store stays clean |
| 4 | A child owns its contract, actions, and failure policy |
| 5 | A lookup is that store, once per id |
| 6 | Binding children into a root changes nothing about them |
| 7 | `derive` for same-store values, write-through for cross-store counts |
| 8 | Components subscribe to keys, so one row's write re-renders one row |
| 9 | Async in actions |
| 10 | Persist preferences, and let a contract repair corrupt storage |

Next: [Patterns](./patterns.md) for polling and live tables, [Composition](./composition.md) for deeper trees, [API reference](./api-reference.md) for the full surface.
