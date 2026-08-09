import { bench, describe } from 'vitest'
import { createStore, createLookup } from './index'

const wide = () => {
  const init: Record<string, number> = {}
  for (let i = 0; i < 20; i++) init['k' + i] = i
  return createStore(init)
}

// ---------------------------------------------------------------------------
// Write paths
// ---------------------------------------------------------------------------
describe('writes', () => {
  let n = 0
  const s1 = wide()
  bench('setKey (value changes)', () => { s1.setKey('k0', n++) })

  const s2 = wide()
  bench('setKey (Object.is skip)', () => { s2.setKey('k0', 0) })

  let n3 = 0
  const s3 = wide()
  bench('set({ one key })', () => { s3.set({ k0: n3++ }) })

  let n4 = 0
  const s4 = wide()
  bench('set({ five keys })', () => { s4.set({ k0: n4, k1: n4, k2: n4, k3: n4, k4: n4 }); n4++ })

  let n5 = 0
  const s5 = createStore({ v: 0 }, { equals: { v: () => true } })
  bench('setKey (equals -> skip)', () => { s5.setKey('v', n5++) })

  let n6 = 0
  const s6 = wide()
  s6.intercept((u) => u)
  bench('setKey through 1 interceptor', () => { s6.setKey('k0', n6++) })
})

// ---------------------------------------------------------------------------
// Notify fan-out — the fine-grained guarantee
// ---------------------------------------------------------------------------
describe('notify fan-out', () => {
  const N = 1000
  let hits = 0

  const initFG: Record<string, number> = {}
  for (let i = 0; i < N; i++) initFG['k' + i] = 0
  const fg = createStore(initFG)
  for (let i = 0; i < N; i++) fg.subscribe(['k' + i], () => { hits++ })
  let a = 0
  bench(`setKey wakes 1 of ${N} subscribers (fine-grained)`, () => { fg.setKey('k500', a++) })

  const sh = createStore({ v: 0 })
  for (let i = 0; i < N; i++) sh.subscribe(['v'], () => { hits++ })
  let b = 0
  bench(`setKey wakes ${N} of ${N} subscribers (shared key)`, () => { sh.setKey('v', b++) })

  const mk = createStore({ a: 0, b: 0, c: 0 })
  for (let i = 0; i < 100; i++) mk.subscribe(['a', 'b', 'c'], () => { hits++ })
  let c = 0
  bench('set 3 keys, 100 multi-key subscribers (dedup)', () => { mk.set({ a: c, b: c, c: c }); c++ })
})

// ---------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------
describe('batch', () => {
  const init: Record<string, number> = {}
  for (let i = 0; i < 100; i++) init['k' + i] = 0
  const s = createStore(init)
  for (let i = 0; i < 100; i++) s.subscribe(['k' + i], () => {})
  let n = 0
  bench('batch 100 setKeys (1 notify each)', () => {
    n++
    s.batch(() => { for (let i = 0; i < 100; i++) s.setKey('k' + i, n) })
  })
})

// ---------------------------------------------------------------------------
// derive overhead
// ---------------------------------------------------------------------------
describe('derive', () => {
  let n1 = 0
  const plain = createStore({ a: 0, b: 0, sum: 0 })
  bench('set input (no derive)', () => { plain.setKey('a', n1++) })

  let n2 = 0
  const derived = createStore({ a: 0, b: 0, sum: 0 })
  derived.derive('sum', ['a', 'b'], ({ a, b }) => a + b)
  bench('set input (with derive)', () => { derived.setKey('a', n2++) })
})

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------
describe('lookup', () => {
  const fam = createLookup((_: number) => ({ selected: false, label: '' }))
  for (let i = 0; i < 1000; i++) fam.at(i)
  let t = false
  bench('lookup.at(existing) + setKey', () => { t = !t; fam.at(500).setKey('selected', t) })

  let idc = 0
  bench('lookup.at(new store)', () => { fam.at(1_000_000 + idc++) })
})

// ---------------------------------------------------------------------------
// set({...}) vs batch — same 10 keys, same 10 subscribers, 1 notify each
// ---------------------------------------------------------------------------
describe('set vs batch (same work)', () => {
  const K = 10
  const mkStore = () => {
    const init: Record<string, number> = {}
    for (let i = 0; i < K; i++) init['k' + i] = 0
    const s = createStore(init)
    for (let i = 0; i < K; i++) s.subscribe(['k' + i], () => {})
    return s
  }

  const s1 = mkStore()
  const u: Record<string, number> = {}
  for (let i = 0; i < K; i++) u['k' + i] = 0
  let n1 = 0
  bench('set({ 10 keys })', () => {
    n1++
    for (let i = 0; i < K; i++) u['k' + i] = n1
    s1.set(u)
  })

  const s2 = mkStore()
  let n2 = 0
  bench('batch(10x setKey)', () => {
    n2++
    s2.batch(() => { for (let i = 0; i < K; i++) s2.setKey('k' + i, n2) })
  })
})

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
describe('reads', () => {
  const s = wide()
  bench('getKey', () => { s.getKey('k0') })
  bench('get', () => { s.get() })
  bench('select 3', () => { s.pick(['k0', 'k1', 'k2']) })
})
