import { bench, describe } from 'vitest'
import { createStore, createLookup } from './index'

const wide: Record<string, number> = {}
for (let i = 0; i < 50; i++) wide['k' + i] = i

// ---------------------------------------------------------------------------
// Store creation cost (the lookup's per-store price). Lookup create+remove keeps
// the Map bounded so we measure creation, not GC of an ever-growing collection.
// ---------------------------------------------------------------------------
describe('store creation', () => {
  bench('createStore (2 keys)', () => { createStore({ a: 0, b: 0 }) })
  bench('createStore (50 keys, copied)', () => { createStore({ ...wide }) })

  const lkNarrow = createLookup((_: number) => ({ a: 0, b: 0 }))
  let n1 = 0
  bench('lookup create+remove (2 keys)', () => { const id = n1++; lkNarrow.at(id); lkNarrow.remove(id) })

  const lkWide = createLookup((_: number) => ({ ...wide }))
  let n2 = 0
  bench('lookup create+remove (50 keys)', () => { const id = n2++; lkWide.at(id); lkWide.remove(id) })
})

// ---------------------------------------------------------------------------
// Lookup steady-state hot paths
// ---------------------------------------------------------------------------
describe('lookup hot paths', () => {
  const fam = createLookup((_: number) => ({ selected: false, label: '', x: 0, y: 0 }))
  for (let i = 0; i < 1000; i++) fam.at(i)

  bench('get(existing)', () => { fam.at(500) })

  let t = false
  bench('get(existing) + setKey', () => { t = !t; fam.at(500).setKey('selected', t) })

  bench('has()', () => { fam.has(500) })
  bench('size()', () => { fam.size() })
})

// ---------------------------------------------------------------------------
// Subscribe / unsubscribe on an item store (row mount / unmount)
// ---------------------------------------------------------------------------
describe('item subscribe/unsubscribe', () => {
  const fam = createLookup((_: number) => ({ selected: false }))
  const s = fam.at(1)
  const noop = () => {}
  bench('subscribe + unsubscribe', () => { s.subscribe(['selected'], noop)() })
})

// ---------------------------------------------------------------------------
// Realistic: 1000 item stores, update one item's key (fine-grained across items)
// ---------------------------------------------------------------------------
describe('1000-item collection', () => {
  const fam = createLookup((_: number) => ({ v: 0 }))
  let hits = 0
  for (let i = 0; i < 1000; i++) fam.at(i).subscribe(['v'], () => { hits++ })
  let n = 0
  bench('update 1 item of 1000 (only that item notifies)', () => { fam.at(500).setKey('v', n++) })
})
