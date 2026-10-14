# Comparison

Where Voltix fits, and how it performs. If you already know you want per-key subscriptions in a single store, skip to [Getting started](./getting-started.md).

- [Getting started](./getting-started.md)
- [Core concepts](./core-concepts.md)
- [Composition](./composition.md)
- [Patterns](./patterns.md)

## The model

Voltix is one store of keys with listeners per key. A component names the keys it reads, and a write re-renders the readers of the keys that changed.

```tsx
// Voltix — subscribe to a key
const name = useStoreKey(user, 'name');

// Zustand — subscribe with a selector function
const name = useUserStore((state) => state.name);
```

For a single field the two behave the same. The difference shows as reads widen: several keys in Voltix is still an array — `useStoreSelector(user, ['name', 'plan'])` — while a selector that returns an object needs an equality strategy (`useShallow`, memoized selectors) to avoid re-rendering on every write.

| Library | Subscription unit |
|---|---|
| **Voltix** | A key in a shared store |
| Zustand | A selector function over one store |
| Jotai | An atom in a dependency graph |
| Valtio | Properties touched on a proxy |
| nanostores | An individual atom or map |
| Preact Signals | A signal read inside an effect |
| Solid | A signal read inside a computation |
| Legend-State | A node of an observable tree |

## Performance

Store-engine microbenchmarks (vanilla stores, no React), in operations per second, higher is faster. Each case runs in its own process and reports the median of 40 runs of about 10 ms each (Node 25, Apple M4 Pro). Reproduce with `npm run bench` ([`bench/vs.ts`](https://github.com/zaatar-tech/voltix/blob/main/bench/vs.ts)).

| operation | **Voltix** | Preact Signals | Zustand | nanostores | Solid | Valtio | Jotai | Legend-State |
|---|---|---|---|---|---|---|---|---|
| update a value + notify | **187.8M** | 47.4M | 39.1M | 31.0M | 13.1M | 6.7M | 2.7M | 2.7M |
| functional update (`x => x + 1`) | **192.0M** | 49.4M | 37.8M | 30.3M | 13.7M | 6.5M | 2.3M | 2.7M |
| fine-grained update (1 of 1000) | **184.2M** | 47.9M | 39.1M † | 30.4M | 12.5M | 161K ‡ | 2.6M | 1.1M |
| notify 1000 subscribers | **563K** | 35K | 232K | 111K | 24K | — | 64K | 35K |
| update 50 keys as one transaction | 617K | **820K** | 530K | 516K | 279K | — | 51K | 26K |
| subscribe + unsubscribe | **44.4M** | 29.1M | 31.4M | 41.7M | 8.9M | 15.5M | 3.1M | 26.5M |
| create 1,000 units | 42K | **199K** | 39K | 6K | 86K | 388 | 44K | 15K |

<sub>† Zustand's fine-grained row uses separate stores; its single-store selector pattern is O(N) in the number of subscribers. ‡ Valtio batches notifications asynchronously and its per-key subscribe is O(N). The transaction row uses each library's batch where it has one and Voltix's `set`; a signal is a smaller unit than a keyed store, which is what the creation row shows.</sub>

Every library here re-renders only the components whose data changed. The throughput gap shows up under a high rate of writes: drags, streaming data, animation, large grids of independently updating cells.

## Where Voltix fits

Pick Voltix for views made of many independent values where each write should re-render only its readers: grids and tables with per-row state, editors with many fields, dashboards with live numbers, anything written at high frequency. Stores [compose](./composition.md) into a tree (nested stores with `select(key)`, a store per id with `at(id)`), so a large app stays one tree. The [Patterns](./patterns.md) page shows the request, polling, and live-table shapes end to end.

Cases where another shape fits better:

- Deep mutation of one big nested object: a proxy store (Valtio) tracks nested writes for you; Voltix updates by key.
- State as an async dependency graph, where values derive from other async values: an atom library (Jotai).
- One store shared across frameworks: nanostores.
- Caching server data (queries, retries, invalidation): a fetching layer such as React Query owns that; Voltix holds the app state beside it.

See [Getting started](./getting-started.md) to try it, or the [API reference](./api-reference.md) for the full surface.
