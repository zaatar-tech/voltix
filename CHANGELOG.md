# Changelog

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
