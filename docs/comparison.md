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

## Performance

Store-engine microbenchmarks (vanilla stores, no React), in operations per second, higher is faster. Reproduce with `npm run bench` against [`src/vs.bench.ts`](https://github.com/zaatar-tech/voltix/blob/main/src/vs.bench.ts).

| operation | **Voltix** | Zustand | nanostores | Valtio | Jotai |
|---|---|---|---|---|---|
| update a value + notify | **43.8M** | 20.1M | 18.8M | 5.3M | 2.5M |
| functional update (`x => x + 1`) | **41.1M** | 20.1M | 17.1M | 5.1M | 2.1M |
| fine-grained update (1 of 1000) | **41.6M** | 21.6M † | 18.7M | 56K ‡ | 2.3M |
| notify 1000 subscribers | **297K** | 164K | 81K | — | 53K |

<sub>† Zustand's fine-grained row uses separate stores; its single-store selector pattern is O(N) in the number of subscribers. ‡ Valtio batches notifications asynchronously and its per-key subscribe is O(N).</sub>

Every library here re-renders only the components whose data changed. The throughput gap shows up under a high rate of writes: drags, streaming data, animation, large grids of independently updating cells.

## Where Voltix fits

Pick Voltix for views made of many independent values where each write should re-render only its readers: grids and tables with per-row state, editors with many fields, dashboards with live numbers, anything written at high frequency. Stores [compose](./composition.md) into a tree (nested stores with `select(key)`, a store per id with `at(id)`), so a large app stays one tree. The [Patterns](./patterns.md) page shows the request, polling, and live-table shapes end to end.

Cases where another shape fits better:

- Deep mutation of one big nested object: a proxy store (Valtio) tracks nested writes for you; Voltix updates by key.
- State as an async dependency graph, where values derive from other async values: an atom library (Jotai).
- One store shared across frameworks: nanostores.
- Caching server data (queries, retries, invalidation): a fetching layer such as React Query owns that; Voltix holds the app state beside it.

See [Getting started](./getting-started.md) to try it, or the [API reference](./api-reference.md) for the full surface.
