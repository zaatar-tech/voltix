# API reference

Every export from `@zaatar-tech/voltix`, plus every method on a store. Types are shown as they appear in the source. `T` is your state shape.

- [Getting started](./getting-started.md)
- [Core concepts](./core-concepts.md)
- [Composition](./composition.md)
- [Guides](./guides.md)
- [Patterns](./patterns.md)

Contents:

- [`createStore`](#createstore) and [`StoreOptions`](#storeoptions)
- [`createLookup`](#createlookup) and [`Lookup`](#lookup) — `at` · `has` · `remove` · `keys` · `size` · `clear`
- [`Store`](#store) — [`select`](#storeselect) · [`children`](#storechildren)
- [`createActions`](#createactions)
- [Schema contracts](#schema-contracts) — [initial state](#initial-state) · [`onSchemaError`](#onschemaerror)
- Store methods: [`get`](#get) · [`getKey`](#getkey) · [`set`](#set) · [`setKey`](#setkey) · [`update`](#update) · [`increment`](#increment) · [`toggle`](#toggle) · [`mergeSet`](#mergeset) · [`reset`](#reset) · [`batch`](#batch) · [`subscribe`](#subscribe) · [`pick`](#pick) · [`intercept`](#intercept) · [`onChange`](#onchange) · [`derive`](#derive) · [`onSchemaError`](#onschemaerror)
- [`useStoreKey`](#usestorekey)
- [`useStoreSelector`](#usestoreselector)
- [`createStoreHook`](#createstorehook)
- [Helpers](#helpers): [`merge`](#merge-helper) · [`persist`](#persist) · [`loadPersistedState`](#loadpersistedstate)
- [Storage interfaces](#storage-interfaces)
- [ESLint plugin](#eslint-plugin-zaatar-techvoltixeslint)

---

## `createStore`

```ts
function createStore<T extends object>(
  shape: T,
  options?: StoreOptions<LeafState<T>>
): Store<T>;
```

Creates a [`Store`](#store) from a state object. A key holding a store or [`Lookup`](#lookup) becomes a child (see [Composition](./composition.md)); every other key is a leaf. Passing a store *as* the shape, or passing a function, is a `TypeError`: stores go under a key, factories go to [`createLookup`](#createlookup).

```tsx
import { createStore } from '@zaatar-tech/voltix';

const store = createStore({ count: 0, name: 'Ada' });
```

Call it once at module scope and share the reference.

### `StoreOptions`

```ts
interface StoreOptions<T extends object> {
  equals?: { [K in keyof T]?: (prev: T[K], next: T[K]) => boolean };
  schema?: { [K in keyof T]?: StandardSchemaV1<any, T[K]> };
}
```

`equals` registers a per-key equality function, fixed at creation. On a write, the function runs with `(prev, next)`; returning `true` treats the values as equal and skips the write. For a lookup, options apply to every store it builds.

```tsx
const store = createStore(
  { user: { id: 1, name: 'Ada' } },
  { equals: { user: (prev, next) => prev.id === next.id } }
);
```

`schema` registers a per-key write contract — see [Schema contracts](#schema-contracts).

`LeafState<T>` is `T` with its child-store keys removed, so options and every store method see only the reactive leaves.

---

## `createLookup`

```ts
function createLookup<Id extends PropertyKey, N extends NodeBrand>(
  factory: (id: Id) => N
): Lookup<Id, N>;
function createLookup<Id extends PropertyKey, C extends object>(
  factory: (id: Id) => C,
  options?: StoreOptions<LeafState<C>>
): Lookup<Id, Store<C>>;
```

Creates a [`Lookup`](#lookup): a store per id. The first `at(id)` runs `factory` and keeps the result. A factory that returns a built store is kept exactly as returned; a factory that returns a plain shape gets a store built for it, with `options` applied to each one.

```tsx
import { createLookup } from '@zaatar-tech/voltix';

const documents = createLookup((id: string) => ({ title: 'Untitled', body: '' }));
documents.at('readme').setKey('title', 'README');
```

## `Lookup`

```ts
interface Lookup<Id extends PropertyKey, S extends object> {
  at(id: Id): S;
  has(id: Id): boolean;
  remove(id: Id): boolean;
  keys(): Id[];
  size(): number;
  clear(): void;
}
```

`S` is the store type: exactly what the factory returns when it builds stores itself, or `Store<C>` when it returns a shape. Each store in the lookup has its own per-key subscriptions, so updating one item re-renders only that item. See [lookups](./composition.md#lookups-a-store-per-id).

`at(id)` returns the store at `id`, created on first access and reused after. It takes one id; to walk into that store's own children, continue with [`select`](#storeselect): `documents.at('readme').select('comments').at('c1')`.

```tsx
documents.at('readme').setKey('title', 'README');

function DocumentRow({ id }: { id: string }) {
  const title = useStoreKey(documents.at(id), 'title'); // only this row re-renders
  return <li>{title}</li>;
}
```

`has(id)` reports whether a store exists for `id`; `remove(id)` drops one (a later `at` starts fresh); `keys()` lists live ids in insertion order; `size()` counts them; `clear()` drops all.

```tsx
documents.has('readme');    // true
documents.keys();           // ['readme']
documents.size();           // 1
documents.remove('readme'); // true
documents.clear();
```

When a store needs behaviour, the factory builds it complete:

```tsx
const todos = createLookup((id: string) => {
  const todo = createStore(
    { text: `todo ${id}`, done: false, error: '' },
    { schema: { text: z.string().min(1) } }
  );
  todo.onSchemaError((error) => todo.setKey('error', error.issues[0].message));
  return todo;
});

todos.at('t1'); // the store is exactly what the factory built — contract and handler included
```

For plain per-id data, a shape factory plus a second argument of [`StoreOptions`](#storeoptions) applies [`equals`](#storeoptions) and [`schema`](#schema-contracts) to every store the lookup builds:

```tsx
const presence = createLookup(
  (userId: string) => ({ online: false, lastSeen: 0 }),
  { schema: { lastSeen: z.number().int().min(0) } }
);
```

Options apply to shape factories only; a factory that returns a built store configures it itself, and lookup options are ignored for it (with a dev warning).

---

## `Store`

```ts
interface Store<T extends object> extends StoreType<LeafState<T>> {
  select<K extends ChildKey<T>>(key: K): T[K];
  children(): ChildKey<T>[];
}
```

The value returned by `createStore(shape)`. It carries every [store method](#get) below (typed to the leaf keys), plus navigation for its child nodes.

### `Store.select`

```ts
select(key): childNode
```

One structural step: returns the child node (a nested `Store` or `Lookup`) bound at `key`. Takes exactly one key, always a child key, and chains for depth. Navigating to a key that is not a child throws a `RangeError` (and is a compile error first).

```tsx
const workspace = createStore({
  name: 'Personal',
  settings: createStore({ theme: 'dark', fontSize: 14 }),
  documents: createLookup((id: string) => ({ title: 'Untitled', body: '' })),
});

workspace.select('settings').setKey('fontSize', 16);
workspace.select('documents').at('readme').setKey('title', 'README');
```

### `Store.children`

```ts
children(): ChildKey<T>[]
```

The names of this store's child keys (the keys holding a nested store or lookup).

```tsx
workspace.children(); // ['settings', 'documents']
```

---

## `createActions`

```ts
function createActions<S extends object, A extends object>(
  store: S,
  define: (store: S) => A
): A
```

Defines actions for a store (or lookup) and returns them as a **standalone object**. The store is untouched. `define` receives the node fully typed, and actions can reach across a [composed](./composition.md) tree with `select(key)` / `at(id)`.

```tsx
const counter = createStore({ count: 0 });

const counterActions = createActions(counter, (store) => ({
  increment: () => store.increment('count'),
  add: (amount: number) => store.increment('count', amount),
  reset: () => store.reset(['count']),
}));

counterActions.increment();
counter.setKey('count', 5); // the store is still just a store
```

Actions over a lookup take the id first:

```tsx
const todos = createLookup((id: string) => ({ text: '', done: false }));

const todoActions = createActions(todos, (lookup) => ({
  add: (id: string, text: string) => lookup.at(id).set({ text }),
  toggle: (id: string) => lookup.at(id).toggle('done'),
}));

todoActions.add('t1', 'Ship it');
```

Actions are plain functions in a plain object: export them beside the store, combine sets with object spread (`{ ...baseActions, ...adminActions }`), and call one from another like any function.

---

## Schema contracts

`options.schema` puts a per-key write contract on a store. A write runs the key's schema first: if it reports issues the write for that key is **vetoed** (the stored value is untouched and no subscriber is notified), and if the schema transforms, the parsed output is what gets stored.

Schemas are [Standard Schemas](https://standardschema.dev), the shared interface implemented by zod (≥3.24), valibot (≥1.0), and arktype (≥2.0). Voltix vendors only the *types*, so bring whichever library you like and Voltix stays dependency-free.

```tsx
import { z } from 'zod';
import { createStore } from '@zaatar-tech/voltix';

const account = createStore(
  { balance: 0, email: '' },
  {
    schema: {
      balance: z.number().min(0),
      email: z.string().trim().toLowerCase(),
    },
  }
);

account.setKey('balance', -20);        // vetoed; balance stays 0
account.setKey('email', '  A@B.CO ');  // stored as 'a@b.co'
```

A schema's output type must match the key's type, so a mismatch is a compile error:

```tsx
createStore({ count: 0 }, { schema: { count: z.string() } }); // ✗ output is string, key is number
```

Rules worth knowing:

- **Every write path is covered.** `set`, `setKey`, `update`, `increment`, `toggle`, `mergeSet`, and `reset` all validate. Inside a multi-key `set`, a vetoed key is dropped while the rest of the update commits.
- **Initial state is validated too.** See [below](#initial-state).
- **Order is schema → equality → notify.** Equality (`options.equals`) compares the *parsed* value, so a write that transforms into the current value is correctly skipped.
- **Validation must be synchronous.** An async schema is vetoed with an explanatory error; validate async input before writing it.
- **Rejections go to `console.error`** unless a handler is registered with [`onSchemaError`](#onschemaerror). In development the message names the key and vendor and lists each issue with its path; production builds log a terse line. A schema that throws vetoes the write.
- **Cost.** A store with no `schema` skips validation entirely. Once a store has one, a validated write costs roughly 30–75ns depending on the schema, and writes to its other keys carry a small fixed overhead (~11ns). Put contracts on boundary keys (server payloads, forms, storage) rather than on keys written every animation frame.

For a lookup, schemas passed in the second argument apply to every store it builds.

```tsx
const presence = createStore(
  (userId: string) => ({ online: false, lastSeen: 0 }),
  { schema: { lastSeen: z.number().int().min(0) } }
);
```

Schemas are locked at creation; there is no runtime add or remove.

### Initial state

Starting values are checked at construction, so a bad one is caught immediately. Transforms apply to them too, and `reset()` restores the transformed value.

```tsx
const store = createStore(
  { email: '  ADA@Example.COM ' },
  { schema: { email: z.string().trim().toLowerCase() } }
);
store.getKey('email'); // 'ada@example.com' — normalized before the first write
```

A bad starting value is logged to the console and kept as-is; construction never throws (a store seeded from corrupt `localStorage` should not crash the app at import). Handlers don't exist yet at construction, so these always go to the console. Stores built by a lookup are checked the same way as each is created.

### `onSchemaError`

```ts
onSchemaError(handler: (error: SchemaError<T>) => void): () => void

interface SchemaError<T> {
  key: keyof T;                             // the key whose write was vetoed
  issues: ReadonlyArray<StandardSchemaIssue>;
  value: unknown;                            // the rejected value
  store: StoreType<T>;                       // the node that rejected it
}
```

Registers a handler for rejected writes and returns a disposer. It registers after construction, so it can use the finished store and any [`createActions`](#createactions) defined beside it.

```tsx
const account = createStore(
  { email: 'ada@lovelace.dev', emailError: '' },
  { schema: { email: z.string().email() } }
);
const accountActions = createActions(account, (store) => ({
  flagEmail: (message: string) => store.setKey('emailError', message),
}));

account.onSchemaError((error) => accountActions.flagEmail(error.issues[0].message));

account.setKey('email', 'not-an-email');
account.getKey('email');      // 'ada@lovelace.dev' — still vetoed
account.getKey('emailError'); // 'Invalid email address'
```

While any handler is registered the console logging is off; disposing the last one turns it back on. The write stays vetoed either way. Handlers run synchronously, so keep them cheap; one that throws is logged and the rest still run. A handler that itself writes a rejected value does not re-enter; that second rejection goes to the console.

Registration is per store. In a lookup, register the handler inside the factory so every store gets one:

```tsx
const todos = createLookup((id: string) => {
  const todo = createStore({ text: '', error: '' }, { schema: { text: z.string().min(1) } });
  todo.onSchemaError((error) => todo.setKey('error', error.issues[0].message));
  return todo;
});
```

---

## Store methods

A `Store` implements `StoreType<LeafState<T>>`. Every method operates on the reactive leaf keys.

### `get`

```ts
get(): T
```

Returns the whole leaf state object. The reference is stable across writes (see [identity-stable state](./core-concepts.md#identity-stable-state)). Child stores are not included.

```tsx
const { count } = store.get();
```

### `getKey`

```ts
getKey<K extends keyof T>(key: K): T[K]
```

Returns one key's current value.

```tsx
const count = store.getKey('count');
```

### `set`

```ts
set(update: Partial<T>): void
```

Writes several keys in one update. Only the keys whose value actually changed notify.

```tsx
store.set({ count: 5, name: 'Bob' });
```

**Only the keys you pass are written.** A key absent from the partial is left alone, so spreading a patch cannot blank out state it doesn't mention. A key you do pass is written, including when its value is `undefined`.

```tsx
store.set({ name: 'Bob' });            // count untouched, name written
store.set({ count: undefined });       // count written as undefined, and notifies
store.set({ ...maybeEmpty });          // absent keys stay absent
```

### `setKey`

```ts
setKey<K extends keyof T>(key: K, value: T[K]): void
```

Sets a single key. Equivalent to `set({ [key]: value })` for one key, on a faster path. `undefined` is a value like any other here: it commits and notifies.

```tsx
store.setKey('count', 5);
```

### `update`

```ts
update<K extends keyof T>(key: K, updater: (prev: T[K]) => T[K]): void
```

Sets a key from its current value.

```tsx
store.update('count', (c) => c + 1);
store.update('tags', (tags) => [...tags, 'new']);
```

### `increment`

```ts
increment(key: NumericKeys<T>, amount?: number): void
```

Adds `amount` (default `1`) to a numeric key. The type system allows this only on keys whose value is a number. Pass a negative amount to subtract.

```tsx
store.increment('count');      // + 1
store.increment('count', 10);  // + 10
store.increment('count', -1);  // - 1
```

### `toggle`

```ts
toggle(key: BooleanKeys<T>): void
```

Flips a boolean key. Allowed only on keys whose value is a boolean.

```tsx
store.toggle('isOpen');
```

### `mergeSet`

```ts
mergeSet<K extends keyof T>(key: K, value: T[K] extends object ? Partial<T[K]> : never): void
```

Merges a partial into an object key and writes the result. The key gets a new object reference, so its subscribers are notified. For a pure computed merge with no write, use the [`merge` helper](#merge-helper).

```tsx
store.mergeSet('user', { name: 'Bob' }); // keeps other fields of user, updates name
```

### `reset`

```ts
reset(keys?: (keyof T)[]): void
```

Resets keys to the initial state passed at creation. With no argument, resets every key. With an array, resets only those keys. When a key has a transforming [schema](#schema-contracts), the initial state was committed post-transform, and `reset` restores that value.

```tsx
store.reset();          // all keys back to initial
store.reset(['count']); // only count
```

`reset` covers this store's own leaves. Children are independent stores and keep their state — reset them directly, and clear lookups with `clear()`. A full logout looks like:

```tsx
app.reset();
app.select('profile').reset();
app.select('todos').clear();
```

### `batch`

```ts
batch(fn: () => void): void
```

Runs `fn`, coalescing every write inside it into one notification round. Each affected listener is called once after `fn` returns. Nested `batch` calls join the outer batch. See [batching](./core-concepts.md#batching).

```tsx
store.batch(() => {
  store.setKey('count', 10);
  store.increment('count', 5);
});
```

### `subscribe`

```ts
subscribe(keys: (keyof T)[], listener: () => void): () => void
```

Registers a listener for a set of keys and returns an unsubscribe function. The listener runs when any of those keys changes. It receives no arguments; read current values with `getKey` or `get`. For change detection with old and new values, see [`onChange`](#onchange).

```tsx
const off = store.subscribe(['count'], () => {
  console.log('count is now', store.getKey('count'));
});

store.setKey('count', 1);   // logs: count is now 1

off();                      // listener removed
store.setKey('count', 2);   // logs nothing
```

### `pick`

```ts
pick<K extends keyof T>(keys: K[]): Pick<T, K>
```

Returns a snapshot object with the requested keys. Imperative, synchronous, and does not subscribe. (Navigation into child nodes is [`Store.select`](#storeselect), a different method.)

```tsx
const { count, name } = store.pick(['count', 'name']);
```

### `intercept`

```ts
intercept(fn: Interceptor<T>, keys?: (keyof T)[]): () => void

type Interceptor<T> = (update: Partial<T>, state: T) => Partial<T> | false | void
```

Intercepts writes before they commit. The function receives the pending update and the pre-update state, and answers with its return value: a partial **replaces** the update, `false` **vetoes** it, and returning nothing passes it through unchanged. With `keys`, it runs only when the update touches one of them. Interceptors run in registration order, a replacement flows into the next one, and a thrown error blocks the write and is logged. Returns a function that removes the interceptor.

```tsx
// Clamp count into range on every write that includes it
const remove = store.intercept((update) => {
  if (typeof update.count === 'number') {
    return { ...update, count: Math.max(0, Math.min(100, update.count)) };
  }
}, ['count']);

// Veto deletes while a sync is running
store.intercept((update, state) => {
  if (state.syncing && update.items) return false;
}, ['items']);
```

Writes made through `setKey`, `update`, `increment`, `toggle`, `mergeSet`, and `reset` all run through your interceptors once any is registered. See the [middleware guide](./guides.md#middleware).

### `onChange`

```ts
onChange<K extends keyof T>(
  keys: K[],
  callback: (values: Pick<T, K>, prev: Pick<T, K>) => void
): () => void
```

Reacts to key changes outside React, with both the new and previous values. Synchronous writes in the same tick are coalesced and the callback fires once on a microtask with the final values. Returns an unsubscribe function. See [reacting outside React](./guides.md#reacting-outside-react).

```tsx
const off = store.onChange(['count'], (values, prev) => {
  console.log(prev.count, '->', values.count);
});
```

### `derive`

```ts
derive<K extends keyof T, I extends keyof T>(
  outKey: K,
  inputs: I[],
  compute: (values: Pick<T, I>) => T[K]
): () => void
```

Derives `outKey` from `inputs`. `compute` runs once immediately to set the initial value, then runs synchronously inside any write that changes an input and commits its result in the same update. Subscribers to `outKey` wake only when the computed value actually changes. Returns a disposer that stops deriving. See [derived keys](./guides.md#derived-keys).

`compute` always receives the current values of all declared inputs, including the ones a write didn't touch. It runs on every write that touches an input, so keep it cheap.

```tsx
const store = createStore({ first: 'Ada', last: 'Lovelace', full: '' });
store.derive('full', ['first', 'last'], ({ first, last }) => `${first} ${last}`);

store.setKey('first', 'Grace'); // full becomes 'Grace Lovelace' in the same update
```

---

## `useStoreKey`

```ts
function useStoreKey<T extends object, K extends keyof T>(
  store: StoreType<T>,
  key: K
): T[K]
```

Subscribes to one key and returns its value. The component re-renders only when that key changes (`Object.is`, plus any [`options.equals`](#storeoptions)). Works on any store, including one from a lookup: `useStoreKey(lookup.at(id), 'title')`.

```tsx
const count = useStoreKey(store, 'count');
```

---

## `useStoreSelector`

```ts
function useStoreSelector<T extends object, S extends SelectorInput<T>>(
  store: StoreType<T>,
  selector: S
): Picked<T, S>

type SelectorInput<T> = ReadonlyArray<keyof T | { [K in keyof T]?: (prev: T[K], next: T[K]) => boolean }>
```

Subscribes to several keys and returns just those keys. The selector is always an array; each element is a key string or a `{ key: compareFn }` object. The component re-renders when a selected key changes. A compare function makes that call for its key: return `true` to treat two values as equal and skip the re-render. Store-level [`options.equals`](#storeoptions) applies when no per-key compare is given.

```tsx
// Keys
const { count, name } = useStoreSelector(store, ['count', 'name']);

// Custom compare for one key
const { tasks } = useStoreSelector(store, [
  { tasks: (prev, next) => prev.length === next.length },
]);

// Mixed
const { count, tasks } = useStoreSelector(store, [
  'count',
  { tasks: (prev, next) => prev.length === next.length },
]);
```

Key-string selectors can be inline array literals; they are matched by value. A selector containing a compare function is matched by identity, so define it outside render (or memoize it) to avoid re-subscribing every render.

---

## `createStoreHook`

```ts
function createStoreHook<T extends object>(
  store: StoreType<T>
): <S extends SelectorInput<T>>(selector: S) => Picked<T, S>
```

Returns a hook bound to a store, with the same selector API as `useStoreSelector`. Types are inferred from the store.

```tsx
const useMyStore = createStoreHook(myStore);

function View() {
  const { count, name } = useMyStore(['count', 'name']);
  return <span>{count} {name}</span>;
}
```

---

## Helpers

Standalone functions, imported from `@zaatar-tech/voltix`.

### `merge` (helper)

```ts
function merge<T extends object>(base: T, patch: Partial<T>): T
```

Shallow-merge on plain data: `{ ...base, ...patch }`, typed so the patch can only carry keys of the base. Pair it with a write when the result should be stored, or use [`mergeSet`](#mergeset), which merges and writes in one call.

```tsx
const preview = merge(store.getKey('user'), { name: 'Bob' }); // computed, nothing written
```

### `persist`

```ts
function persist<T extends object>(
  store: StoreType<T>,
  storage: Storage | StorageSupportingInterface | AsyncStorageSupportingInterface,
  persistKey: string,
  keys: (keyof T)[],
  parser?: PersistParser
): () => void
```

Persists the given keys: each one is written to storage as it changes, under `` `${persistKey}:${keyName}` ``. Works with synchronous storage (`localStorage`, `sessionStorage`) and asynchronous storage (React Native `AsyncStorage`); async writes are fire-and-forget, so a slow write never blocks the state update. Returns an unsubscribe that stops persisting. See [persistence](./guides.md#persistence).

The default format is JSON plus `Date`, `Map`, `Set`, and non-finite numbers, which all survive the round-trip. To store other types, pass a [`parser`](#storage-interfaces) — the same one to `loadPersistedState`.

```tsx
persist(store, localStorage, 'myapp', ['theme', 'isLoggedIn']);
```

### `loadPersistedState`

```ts
function loadPersistedState<T extends object>(
  storage: Storage | StorageSupportingInterface,
  persistKey: string,
  keys: (keyof T)[],
  parser?: PersistParser
): Partial<T>
function loadPersistedState<T extends object>(
  storage: AsyncStorageSupportingInterface,
  persistKey: string,
  keys: (keyof T)[],
  parser?: PersistParser
): Promise<Partial<T>>
```

Reads keys written by [`persist`](#persist) and returns them as a partial state. Returns synchronously for sync storage and a `Promise` for async storage. Use it to seed the initial state at creation, or to hydrate a store after creation. Pass the same `parser` given to `persist`, if any.

```tsx
// Sync
const persisted = loadPersistedState(localStorage, 'myapp', ['theme']);
const store = createStore({ theme: 'light', ...persisted });

// Async
const persisted = await loadPersistedState(AsyncStorage, 'myapp', ['theme']);
const store = createStore({ theme: 'light', ...persisted });
```

---

## Storage interfaces

```ts
interface StorageSupportingInterface {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface AsyncStorageSupportingInterface {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

interface PersistParser {
  stringify(value: any): string;
  parse(text: string): any;
}
```

The persistence functions accept the DOM `Storage` type, any object matching `StorageSupportingInterface` (sync), or any object matching `AsyncStorageSupportingInterface` (async, such as React Native `AsyncStorage`).

A `PersistParser` controls how values become strings. The default handles JSON plus `Date`, `Map`, `Set`, and non-finite numbers. Anything with `stringify`/`parse` fits: `JSON` gives you raw behaviour, [superjson](https://github.com/flightcontrolhq/superjson) covers BigInt, RegExp, and registered classes. Use one parser consistently per prefix.

---

## ESLint plugin (`@zaatar-tech/voltix/eslint`)

Voltix ships an ESLint plugin at the `@zaatar-tech/voltix/eslint` subpath with one rule, `voltix/no-unused-selector-keys`. Every key in a selector is a subscription, so a selected-but-unused key means re-renders for data the component never reads. The rule warns on exactly that:

```tsx
const { count } = useStoreSelector(store, ['count', 'name']);
//                                                  ^ 'name' is selected but never destructured
```

It works with zero configuration. `useStoreSelector(store, [...])` calls are recognized by name; a hook made with `createStoreHook` is recognized by how it's used — any `use*`-named call taking a selector array whose result is destructured, in any file. Both forms include `{ key: compareFn }` custom-compare entries. Requires ESLint 9+ (flat config).

```js
// eslint.config.js
import voltix from '@zaatar-tech/voltix/eslint';

export default [
  {
    plugins: { voltix },
    rules: { 'voltix/no-unused-selector-keys': 'warn' },
  },
];
```

The recommended preset is also available for spreading:

```js
import voltix from '@zaatar-tech/voltix/eslint';

export default [voltix.configs.recommended];
```

The rule warns only when it can prove a key is unused; anything unclear is skipped:

- The result must be destructured inline. A `...rest` element covers the remaining keys only when the rest variable is read somewhere — a rest nobody touches proves nothing, and the other keys are still checked.
- For a hook recognized by usage (anything other than a literal `useStoreSelector` call), at least one selected key must appear in the destructuring — that overlap is what marks it as a selector call, so an unrelated hook that happens to take a string array is left alone.

```tsx
const { items } = useCart(['items', 'total']);          // provably unused 'total' — warns
const slice = useCart(['items', 'total']);              // not destructured — skipped
const { items, ...rest } = useCart(['items', 'total']);
render(rest);                                           // rest is read — skipped
const { items, ...rest } = useCart(['items', 'total']); // rest never read — 'total' warns
const { data } = useQueries(['users', 'posts']);        // no overlap — not a selector call, skipped
```
