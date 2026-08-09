# Getting started

Voltix is a fine-grained state manager for React. You create a store that holds a flat object of keys, and components subscribe to the individual keys they read. Writing one key re-renders only the components reading that key.

- [Walkthrough](./walkthrough.md)
- [Core concepts](./core-concepts.md)
- [Composition](./composition.md)
- [API reference](./api-reference.md)
- [Guides](./guides.md)
- [Patterns](./patterns.md)
- [Comparison](./comparison.md)

## Install

```bash
npm i @zaatar-tech/voltix
```

`react` is the only peer dependency. The package is about 4.4 KB gzipped and ships its own types.

## Your first store

Create a store once, at module scope, from an initial state object. It lives outside React: any module can read or write it, and there is no provider to set up.

```tsx
import { createStore } from '@zaatar-tech/voltix';

export const store = createStore({
  count: 0,
  step: 1,
});
```

Every key in the initial object becomes part of the store's typed shape. Reading or writing a key that does not exist is a compile error.

## Read one key with `useStoreKey`

`useStoreKey` subscribes to one key and returns its value. The component re-renders only when that key changes.

```tsx
import { useStoreKey } from '@zaatar-tech/voltix';
import { store } from './store';

function Count() {
  const count = useStoreKey(store, 'count');
  return <span>{count}</span>;
}
```

## Read several keys with `useStoreSelector`

For more than one key, `useStoreSelector` takes an array of keys and returns just those keys. The component re-renders when any of them changes.

```tsx
import { useStoreSelector } from '@zaatar-tech/voltix';
import { store } from './store';

function Status() {
  const { count, step } = useStoreSelector(store, ['count', 'step']);
  return <span>{count} (step {step})</span>;
}
```

The selector is always an array: key strings, plus `{ key: compareFn }` entries when a key needs its own comparison. See [`useStoreSelector`](./api-reference.md#usestoreselector).

## Pre-bind a hook with `createStoreHook`

`createStoreHook` binds the store into a hook once, so components stop passing it around. Types are inferred from the store.

```tsx
import { createStoreHook } from '@zaatar-tech/voltix';
import { store } from './store';

export const useCounter = createStoreHook(store);

function Controls() {
  const { count, step } = useCounter(['count', 'step']);
  return <span>{count} / {step}</span>;
}
```

## A complete counter

```tsx
import { createStore, useStoreKey } from '@zaatar-tech/voltix';

const store = createStore({ count: 0 });

function Counter() {
  const count = useStoreKey(store, 'count');
  return (
    <div>
      <button onClick={() => store.increment('count', -1)}>-</button>
      <span>{count}</span>
      <button onClick={() => store.increment('count')}>+</button>
    </div>
  );
}
```

`increment` adds to a numeric key (default amount is `1`). The type system allows it only on keys whose value is a number. Writing to the store from an event handler, an effect, or any module updates every subscribed component.

## Next steps

- [Walkthrough](./walkthrough.md) builds one app end to end, from a single store to a composed tree.
- [Core concepts](./core-concepts.md) explains per-key subscriptions, identity-stable state, equality, and batching.
- [Composition](./composition.md) covers nesting stores and lookups (a store per id), navigated with `select` and `at`.
- [Guides](./guides.md) covers actions, contracts, derived keys, middleware, persistence, and reacting outside React.
- [Patterns](./patterns.md) shows real-world recipes: sending requests, polled live updates, and a live table.
- [API reference](./api-reference.md) documents every export and every store method.
