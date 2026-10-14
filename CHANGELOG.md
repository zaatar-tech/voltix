# Changelog

## 2.1.0

Faster store engine. Measured in a tight loop against 2.0.1 on V8 (Node 25), JavaScriptCore (macOS 26) and Hermes 0.12; each ratio below is 2.0.1 time over 2.1.0 time, in that engine order.

- Single-key writes (`setKey`, `update`, `increment`, `toggle`, `mergeSet`) check one flag before touching state instead of the interceptor list, the schema registry, the equality registry and the batch state in turn. 1.1x, 2.6x, 1.5x.
- Multi-key writes (`set`, `batch`, `reset`) skip the listener dedup Set unless some subscription spans more than one key. A five-key `set` with a subscriber per key: 1.3x, 1.3x, 1.0x.
- `batch` records each written key once by tagging the key's listener array with the batch's number, instead of hashing keys into a Set, and its flush walks that list. A fifty-key batch: 1.4x, 3.0x, 1.06x. A hundred-key batch: 1.6x, 3.6x, 1.25x.
- Creating a store copies the shape once instead of twice: the live state is the copy, and `reset` reads the initial values from the object passed to `createStore`. A store with child nodes, or a schema that may rewrite values, keeps a copy of its own. `createStore` of five keys: 1.3x, 1.6x, 1.2x. Mutating the object you passed after creation now shows in `reset`.
- Subscribe and unsubscribe cost the same at any listener count. A key's listeners are appended and swap-removed in place, and the array is copied only while a notify is running, so a notify never sees it change. 2.0.1 copied the array on every subscribe and unsubscribe, so mounting N components that read one key cost O(N²): 5,000 of them took 49 ms, now 175 µs (Zustand 321 µs, nanostores 2.6 ms on the same machine). One subscribe plus unsubscribe on a key with 8 other listeners: 8x, 6x, 1.9x.
- Composed stores. `createStore` copies the leaf keys into a fresh object instead of deleting the child keys out of a clone, which V8 punished by keeping the state object in dictionary mode for the life of the store. `createStore({ ..., child })`: 6.3x on V8.
- Interceptor key filters loop instead of allocating a closure per write. Writes to a `derive` input: 1.2x, 1.5x, 1.1x.
- Fix: `useStoreSelector` read voltix's private equality registry off the store, so on a store from another library that implements the interface (a warp row) it threw on the first change to a selected key. It now treats a missing registry as no store-level equality.
- Multi-key notification deduplication counts subscriptions independently, including when the same callback is reused across single-key and multi-key subscriptions.
- The comparison benchmark behind the README table is now `bench/vs.ts` (`npm run bench`): one process per case, the loop timed at its own call site, the median of 40 runs. The vitest harness it replaces spent about 17 ns per call on its own timer and shared JIT feedback between cases, which hid most of the differences above; the table is regenerated from the new script, now against Preact Signals, Solid and Legend-State as well, and `npm run bench:vitest` still runs the remaining micro benchmarks.

Behavior: subscriptions are counted per `subscribe` call. A function subscribed to two keys through two separate calls runs once per subscription when both keys change in one `set` or `batch`, and subscribing the same function to the same key twice registers it twice, where 2.0.1 ignored the second call. A single `subscribe(['a', 'b'], fn)` still runs `fn` once per write, as before.

Release builds clean stale output before packaging, publish explicitly as public, and verify the release tag matches the package version. The docs prerender uses production React to prevent development stacks from exposing local filesystem paths.

5.0 KB gzipped.

## 2.0.1

Published from GitHub Actions through npm trusted publishing, so npm lists the release workflow as the publisher. No code changes since 2.0.0.

## 2.0.0

**Breaking: `undefined` is a value like any other.**

Writes of `undefined` used to be dropped on every path. The key kept its previous value, no subscriber ran, and nothing was thrown or logged. `setKey`, `set`, `update`, `mergeSet`, `reset`, and `batch` now commit `undefined` and notify.

- `reset` restores a key whose initial value is `undefined`. It previously could not, so `reset` silently did nothing on optional keys.
- Partial patches are unchanged. `set({ ...patch })` still writes only the keys present in the object, so a spread that omits a key leaves it alone. Presence is decided by the key being there, not by its value.
- `undefined` round-trips through `persist` / `loadPersistedState`. Previously it could not be written at all; storing it naively would have saved the string `"undefined"` and thrown on the next load.
- Removed the development warning about an `undefined` initial value.

No measurable change in throughput, and the bundle is 59 bytes smaller.

**Migration.** If you relied on `setKey(key, maybeUndefined)` leaving the key alone, guard at the call site, which is where the intent lives:

```ts
if (next !== undefined) store.setKey('key', next);
```

A key restored from storage as `undefined` now overrides the default it is spread over, rather than falling back to it. See [persistence](./docs/guides.md#persistence) for the one-line guard.

## 1.1.1

Static gzip badge, since bundlephobia rate-limits shields.io. The documented bundle size is now verified in CI and before publish.

## 1.1.0

Faster notify path. Listeners are stored as arrays rather than Sets, removing an iterator allocation on every write — roughly 3x on Safari and iOS, where JavaScriptCore does not optimize that allocation away, and ~7% on V8. Add and remove rebuild the array, so a notify already in progress iterates a stable snapshot. SameValue is inlined on the single-key write path.

## 1.0.1

`homepage` points at the site rather than the repository.

## 1.0.0

First release.
