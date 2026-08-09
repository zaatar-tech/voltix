// Per-update wall time here scales with the number of MOUNTED subscribers, not
// with what changed: exactly one component re-renders, but React's synchronous
// commit under act() is O(mounted components) — a plain useState tree scales the
// same. This measures the React + test-harness integration cost, not the store's
// notify, which is O(1) (see the fine-grained case in store.bench.ts).
import React from 'react'
import { bench, describe } from 'vitest'
import { render, act } from '@testing-library/react'
import { createStore, useStoreKey, useStoreSelector } from './index'

function makeStore(n: number) {
  const init: Record<string, number> = {}
  for (let i = 0; i < n; i++) init['k' + i] = 0
  return createStore(init)
}

function KeyRow({ store, k }: { store: ReturnType<typeof makeStore>; k: string }) {
  const v = useStoreKey(store, k)
  return <span>{v}</span>
}

function SelRow({ store, k }: { store: ReturnType<typeof makeStore>; k: string }) {
  const { [k]: v } = useStoreSelector(store, [k]) as Record<string, number>
  return <span>{v}</span>
}

// Mount once per store size; each bench iteration updates a single key, so only
// one row re-renders — measures per-update cost as a function of subscriber count.
function mountList(n: number, Row: React.ComponentType<{ store: any; k: string }>) {
  const store = makeStore(n)
  const keys = Object.keys(store.get())
  render(<>{keys.map(k => <Row key={k} store={store} k={k} />)}</>)
  return store
}

describe('react: update 1 key with useStoreKey', () => {
  const s100 = mountList(100, KeyRow)
  let a = 0
  bench('N=100 subscribers', () => { act(() => { s100.setKey('k50', ++a) }) })

  const s2000 = mountList(2000, KeyRow)
  let b = 0
  bench('N=2000 subscribers', () => { act(() => { s2000.setKey('k1000', ++b) }) })
})

describe('react: update 1 key with useStoreSelector', () => {
  const s2000 = mountList(2000, SelRow)
  let a = 0
  bench('N=2000 subscribers', () => { act(() => { s2000.setKey('k1000', ++a) }) })
})
