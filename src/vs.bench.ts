import { bench, describe } from 'vitest'
import { createStore } from './index'
import { createStore as zCreate } from 'zustand/vanilla'
import { subscribeWithSelector } from 'zustand/middleware'
import { atom as jAtom, createStore as jCreate } from 'jotai/vanilla'
import { proxy } from 'valtio/vanilla'
import { subscribeKey } from 'valtio/utils'
import { atom as nAtom } from 'nanostores'

let sink = 0
const listener = () => { if (++sink === -1) throw new Error('unreachable') }
const N = 1000

// ---------------------------------------------------------------------------
// Scenario A — shared store with N independently-subscribed keys, update ONE.
// This is what a fine-grained store is for. Modeled idiomatically per library.
// ---------------------------------------------------------------------------
const ms = (() => {
  const init: Record<string, number> = {}
  for (let i = 0; i < N; i++) init['k' + i] = 0
  const s = createStore(init)
  for (let i = 0; i < N; i++) s.subscribe(['k' + i], listener)
  return s
})()

const zsOne = (() => {
  const init: Record<string, number> = {}
  for (let i = 0; i < N; i++) init['k' + i] = 0
  const s = zCreate(subscribeWithSelector(() => ({ ...init })))
  for (let i = 0; i < N; i++) { const k = 'k' + i; s.subscribe((st: Record<string, number>) => st[k], listener) }
  return s
})()

const zsMany = (() => {
  const stores = Array.from({ length: N }, () => zCreate(() => ({ v: 0 })))
  for (const s of stores) s.subscribe(listener)
  return stores
})()

const jt = (() => {
  const store = jCreate()
  const atoms = Array.from({ length: N }, () => jAtom(0))
  for (const a of atoms) store.sub(a, listener)
  return { store, atoms }
})()

const ns = (() => {
  const atoms = Array.from({ length: N }, () => nAtom(0))
  for (const a of atoms) a.subscribe(listener)
  return atoms
})()

const vt = (() => {
  const init: Record<string, number> = {}
  for (let i = 0; i < N; i++) init['k' + i] = 0
  const p = proxy(init)
  for (let i = 0; i < N; i++) subscribeKey(p, 'k' + i, listener)
  return p
})()

describe(`update 1 of ${N} (shared store, per-key subscriber)`, () => {
  let a = 0; bench('voltix', () => { ms.setKey('k500', a++) })
  let b = 0; bench('zustand (1 store + selectors)', () => { zsOne.setState({ k500: b++ }) })
  let c = 0; bench('zustand (1000 stores)', () => { zsMany[500].setState({ v: c++ }) })
  let d = 0; bench('jotai (1000 atoms)', () => { jt.store.set(jt.atoms[500], d++) })
  let e = 0; bench('nanostores (1000 atoms)', () => { ns[500].set(e++) })
  let f = 0; bench('valtio (proxy; notify is async/batched)', () => { (vt as Record<string, number>).k500 = f++ })
})

// ---------------------------------------------------------------------------
// Scenario B — single value, update + notify one subscriber (raw per-op speed)
// ---------------------------------------------------------------------------
const ms1 = (() => { const s = createStore({ v: 0 }); s.subscribe(['v'], listener); return s })()
const zs1 = (() => { const s = zCreate(() => ({ v: 0 })); s.subscribe(listener); return s })()
const jt1 = (() => { const store = jCreate(); const a = jAtom(0); store.sub(a, listener); return { store, a } })()
const ns1 = (() => { const a = nAtom(0); a.subscribe(listener); return a })()
const vt1 = (() => { const p = proxy({ v: 0 }); subscribeKey(p, 'v', listener); return p })()

describe('single value update + notify', () => {
  let a = 0; bench('voltix', () => { ms1.setKey('v', a++) })
  let b = 0; bench('zustand', () => { zs1.setState({ v: b++ }) })
  let c = 0; bench('jotai', () => { jt1.store.set(jt1.a, c++) })
  let d = 0; bench('nanostores', () => { ns1.set(d++) })
  let e = 0; bench('valtio (notify async)', () => { (vt1 as { v: number }).v = e++ })
})

// ---------------------------------------------------------------------------
// Scenario C — create 1000 independent units (dynamic list / store-in-store)
// ---------------------------------------------------------------------------
describe(`create ${N} independent units (one-key each, like-for-like)`, () => {
  bench('voltix (1000 stores)', () => {
    for (let i = 0; i < N; i++) createStore({ v: 0 })
  })
  bench('zustand (1000 stores)', () => {
    for (let i = 0; i < N; i++) zCreate(() => ({ v: 0 }))
  })
  bench('jotai (1000 atoms)', () => {
    for (let i = 0; i < N; i++) jAtom(0)
  })
  bench('nanostores (1000 atoms)', () => {
    for (let i = 0; i < N; i++) nAtom(0)
  })
  bench('valtio (1000 proxies)', () => {
    for (let i = 0; i < N; i++) proxy({ v: 0 })
  })
})

// ---------------------------------------------------------------------------
// Scenario D — fan-out: ONE value with 1000 distinct subscribers, update once
// ---------------------------------------------------------------------------
const fo = Array.from({ length: 1000 }, () => () => { if (++sink === -1) throw new Error('x') })
const msFo = (() => { const s = createStore({ v: 0 }); for (const l of fo) s.subscribe(['v'], l); return s })()
const zsFo = (() => { const s = zCreate(() => ({ v: 0 })); for (const l of fo) s.subscribe(l); return s })()
const jtFo = (() => { const store = jCreate(); const a = jAtom(0); for (const l of fo) store.sub(a, l); return { store, a } })()
const nsFo = (() => { const a = nAtom(0); for (const l of fo) a.listen(l); return a })()

describe('fan-out: 1 value, 1000 subscribers, update once', () => {
  let a = 0; bench('voltix', () => { msFo.setKey('v', a++) })
  let b = 0; bench('zustand', () => { zsFo.setState({ v: b++ }) })
  let c = 0; bench('jotai', () => { jtFo.store.set(jtFo.a, c++) })
  let d = 0; bench('nanostores', () => { nsFo.set(d++) })
})

// ---------------------------------------------------------------------------
// Scenario E — subscribe + unsubscribe churn (component mount/unmount)
// ---------------------------------------------------------------------------
describe('subscribe + unsubscribe churn', () => {
  const l = () => { if (++sink === -1) throw new Error('x') }
  const msC = createStore({ v: 0 })
  bench('voltix', () => { msC.subscribe(['v'], l)() })
  const zsC = zCreate(() => ({ v: 0 }))
  bench('zustand', () => { zsC.subscribe(l)() })
  const jtC = jCreate(); const jaC = jAtom(0)
  bench('jotai', () => { jtC.sub(jaC, l)() })
  const nsC = nAtom(0)
  bench('nanostores', () => { nsC.listen(l)() })
})

// ---------------------------------------------------------------------------
// Scenario F — update 50 keys as one logical transaction
// ---------------------------------------------------------------------------
const K = 50
const msT = (() => { const init: Record<string, number> = {}; for (let i = 0; i < K; i++) init['k' + i] = 0; const s = createStore(init); for (let i = 0; i < K; i++) s.subscribe(['k' + i], listener); return s })()
const zsT = (() => { const init: Record<string, number> = {}; for (let i = 0; i < K; i++) init['k' + i] = 0; const s = zCreate(subscribeWithSelector(() => ({ ...init }))); for (let i = 0; i < K; i++) { const k = 'k' + i; s.subscribe((st: Record<string, number>) => st[k], listener) } return s })()
const jtT = (() => { const store = jCreate(); const atoms = Array.from({ length: K }, () => jAtom(0)); for (const at of atoms) store.sub(at, listener); return { store, atoms } })()
const nsT = (() => { const atoms = Array.from({ length: K }, () => nAtom(0)); for (const at of atoms) at.listen(listener); return atoms })()

describe(`update ${K} keys as one transaction`, () => {
  let a = 0; bench('voltix (batch)', () => { a++; msT.batch(() => { for (let i = 0; i < K; i++) msT.setKey('k' + i, a) }) })
  let b = 0; bench('zustand (setState K keys)', () => { b++; const u: Record<string, number> = {}; for (let i = 0; i < K; i++) u['k' + i] = b; zsT.setState(u) })
  let c = 0; bench('jotai (K atom sets)', () => { c++; for (let i = 0; i < K; i++) jtT.store.set(jtT.atoms[i], c) })
  let d = 0; bench('nanostores (K atom sets)', () => { d++; for (let i = 0; i < K; i++) nsT[i].set(d) })
})

// ---------------------------------------------------------------------------
// Scenario G — functional update: read current value, compute next, write
// (voltix .update, zustand setState(fn), jotai updater atom, ns/valtio r+w)
// ---------------------------------------------------------------------------
const msU = (() => { const s = createStore({ v: 0 }); s.subscribe(['v'], listener); return s })()
const zsU = (() => { const s = zCreate(() => ({ v: 0 })); s.subscribe(listener); return s })()
const jtU = (() => { const store = jCreate(); const a = jAtom(0); store.sub(a, listener); return { store, a } })()
const nsU = (() => { const a = nAtom(0); a.subscribe(listener); return a })()
const vtU = (() => { const p = proxy({ v: 0 }); subscribeKey(p, 'v', listener); return p })()

describe('functional update (read + compute + write)', () => {
  bench('voltix', () => { msU.update('v', (x) => x + 1) })
  bench('zustand', () => { zsU.setState((s) => ({ v: s.v + 1 })) })
  bench('jotai', () => { jtU.store.set(jtU.a, (x) => x + 1) })
  bench('nanostores', () => { nsU.set(nsU.get() + 1) })
  bench('valtio (notify async)', () => { const p = vtU as { v: number }; p.v = p.v + 1 })
})
