<div align="center">

# ⚡ Voltix

**Fastest React state library.**

[![CI](https://github.com/zaatar-tech/voltix/actions/workflows/ci.yml/badge.svg)](https://github.com/zaatar-tech/voltix/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@zaatar-tech/voltix?color=8b5cf6)](https://www.npmjs.com/package/@zaatar-tech/voltix)
[![gzip](https://img.shields.io/bundlephobia/minzip/@zaatar-tech/voltix?color=06b6d4&label=gzip)](https://bundlephobia.com/package/@zaatar-tech/voltix)
[![types](https://img.shields.io/npm/types/@zaatar-tech/voltix?color=3178c6)](https://www.npmjs.com/package/@zaatar-tech/voltix)
[![license](https://img.shields.io/badge/license-MIT-64748b)](./LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-22d3ee)](https://github.com/zaatar-tech/voltix/pulls)

[Website](https://voltix.pages.dev) · [npm](https://www.npmjs.com/package/@zaatar-tech/voltix) · [GitHub](https://github.com/zaatar-tech/voltix) · [Docs](./docs) · [Benchmarks](#benchmarks)

</div>

Voltix is a **~4.3 KB** global store for React with per-key subscriptions: set one field and only the components reading that field re-render. There is no provider to set up and there are no selector functions to write. Stores compose into a tree of nested stores and per-id lookups. Full TypeScript inference, zero dependencies, and the fastest update throughput of any React store we've measured.

```tsx
import { createStore, useStoreKey } from '@zaatar-tech/voltix';

const store = createStore({ count: 0 });

function Counter() {
  const count = useStoreKey(store, 'count');
  return <button onClick={() => store.increment('count')}>{count}</button>;
}
```

## Why Voltix

- **Surgical re-renders.** Subscriptions are per key. Updating `x` never touches a component reading `y`, even when they share a store.
- **Direct values.** `useStoreKey(store, 'count')` returns the value itself.
- **Composes into a tree.** A key can hold another store or a lookup (a store per id); step into children with `select(key)`, into lookups with `at(id)`. Composition adds no cost to reads or writes.
- **Identity-stable state.** `get()` returns the same object across writes, and the update path is the fastest of the group (see below).
- **Fully typed, inference-first.** Keys, values, selectors, and equality functions are all inferred from your store. Selecting a key that doesn't exist is a compile error.
- **Runtime contracts.** Put a zod (or valibot/arktype) schema on a key. Invalid writes are rejected, initial state included, and `onSchemaError` routes failures into your UI. Standard Schema keeps it dependency-free.
- **Batteries included.** Action helpers, derived keys, write interceptors, persistence (sync + async), and an ESLint rule ship in the box.
- **Tiny and dependency-free.** ~4.3 KB gzipped, tree-shakeable, `react` as the only peer.

## Benchmarks

Update throughput vs the latest Zustand, Jotai, Valtio, and nanostores (vanilla store engine, ops/sec, higher is faster):

| operation | **Voltix** | Zustand | nanostores | Valtio | Jotai |
|---|---|---|---|---|---|
| update a value + notify | **41.0M** | 21.1M | 18.6M | 5.3M | 2.5M |
| functional update (`x => x + 1`) | **40.6M** | 19.7M | 18.0M | 5.1M | 2.1M |
| fine-grained update (1 of 1000) | **40.5M** | 21.5M † | 18.5M | 53K ‡ | 2.3M |
| notify 1000 subscribers | **277K** | 170K | 82K | — | 52K |

Run `npm run bench` to reproduce ([`src/vs.bench.ts`](src/vs.bench.ts)). The gap matters under high write rates: drag interactions, streaming data, animation, and large grids of independently updating cells.

<sub>These are store-engine numbers; in React all five re-render only the components whose data changed. On store creation and subscribe/unsubscribe Voltix is mid-pack. † Zustand's fine-grained row uses separate stores; its single-store selector pattern is O(N). ‡ Valtio batches notifications asynchronously and its per-key subscribe is O(N).</sub>

## Install

```bash
npm i @zaatar-tech/voltix
```

## The idea: fine-grained by key

You subscribe to **keys**. A write to a key notifies exactly the components reading it, and leaves the rest untouched.

```tsx
const store = createStore({ user: { name: 'Ada' }, theme: 'dark', unread: 3 });

function Unread() {
  const unread = useStoreKey(store, 'unread'); // re-renders only when `unread` changes
  return <span>{unread}</span>;
}

store.setKey('theme', 'light'); // <Unread /> does not re-render
store.increment('unread');       // <Unread /> re-renders, nothing else does
```

Need several keys in one component? `useStoreSelector` subscribes to each and returns a slice:

```tsx
const { name, theme } = useStoreSelector(store, ['user', 'theme']);
```

## Composition: nesting and lookups

A key holding another store becomes a child, reached with `select(key)`. `createLookup(factory)` makes a **lookup**: a store per id, created on first use. Updating one store re-renders only its readers. The factory can return a fully built store (schema, actions, `onSchemaError` attached) and the lookup keeps exactly that store.

```tsx
const app = createStore({
  theme: 'dark',
  profile: createStore({ name: 'Ada', age: 30 }),                   // nested store
  todos: createLookup((id: string) => ({ text: '', done: false })), // lookup
});

app.setKey('theme', 'light');
app.select('profile').setKey('age', 31);
app.select('todos').at('t1').toggle('done');
app.select('todos').keys(); // ['t1']
```

`select` takes one child key, `at` takes one id, and they chain for depth. See [Composition](./docs/composition.md).

## Derived state

`derive` computes a key from other keys in the same update; subscribers wake only when the result changes:

```tsx
const store = createStore({ first: 'Ada', last: 'Lovelace', full: '' });
store.derive('full', ['first', 'last'], ({ first, last }) => `${first} ${last}`);
```

## API at a glance

| | |
|---|---|
| `createStore(shape, options?)` | Create a store |
| `createLookup(factory, options?)` | A map from id to store, populated lazily |
| `select(key)` · `at(id)` | Step into a child · step into a lookup by id |
| `createActions(store, define)` | Define a store's actions in one block, returned as a plain object |
| `options.schema` | Per-key runtime contracts (zod, valibot, arktype) |
| `onSchemaError(handler)` | React to a rejected write, with access to your actions |
| `useStoreKey(store, key)` | Subscribe to one key, get the value directly |
| `useStoreSelector(store, [keys])` | Subscribe to several keys, get a slice |
| `createStoreHook(store)` | Pre-bind a typed hook to a store |
| `set` · `setKey` · `update` · `increment` · `toggle` | Write helpers |
| `mergeSet` · `batch` · `reset` · `derive` · `pick` | Object updates, batching, reset, computed keys, snapshots |
| `subscribe` · `onChange` · `intercept` | Outside-React reactions and interception |
| `options.equals` | Per-key custom equality (compare by `.id`, etc.) |

Full reference in the [docs](./docs).

## ESLint rule

The package includes an ESLint rule (at `@zaatar-tech/voltix/eslint`) that flags selector keys you never use. Requires ESLint 9+ (flat config):

```js
// eslint.config.js
import voltix from '@zaatar-tech/voltix/eslint';

export default [{
  plugins: { voltix },
  rules: { 'voltix/no-unused-selector-keys': 'warn' },
}];
```

## Documentation

- [Getting started](./docs/getting-started.md)
- [Walkthrough](./docs/walkthrough.md) — one app, from a single store to a composed tree
- [Core concepts](./docs/core-concepts.md)
- [Composition](./docs/composition.md) — nesting stores and per-id lookups
- [API reference](./docs/api-reference.md)
- [Guides](./docs/guides.md) — actions, contracts, derived state, middleware, persistence
- [Patterns](./docs/patterns.md) — sending requests, polled live updates, live tables
- [Comparison](./docs/comparison.md)

## License

MIT © Ohad Baehr - Zaatar Tech
