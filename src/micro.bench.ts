import { bench, describe } from 'vitest'

let sink = 0
const invoke = (l: () => void) => l()
const mk = () => () => { if (++sink === -1) throw new Error('unreachable') }

// ---------------------------------------------------------------------------
// notify iteration: how to walk the listeners of one key
// ---------------------------------------------------------------------------
describe('notify N=1', () => {
  const one = [mk()]
  const set1 = new Set(one)
  const arr1 = one.slice()
  bench('Set.forEach(invoke)', () => { set1.forEach(invoke) })
  bench('Set for-of', () => { for (const l of set1) l() })
  bench('Array for-i', () => { for (let i = 0; i < arr1.length; i++) arr1[i]() })
})

describe('notify N=4', () => {
  const four = [mk(), mk(), mk(), mk()]
  const set4 = new Set(four)
  const arr4 = four.slice()
  bench('Set.forEach(invoke)', () => { set4.forEach(invoke) })
  bench('Set for-of', () => { for (const l of set4) l() })
  bench('Array for-i', () => { for (let i = 0; i < arr4.length; i++) arr4[i]() })
})

// ---------------------------------------------------------------------------
// keyed container lookup: keyListeners[key] (null-proto object) vs Map
// ---------------------------------------------------------------------------
describe('keyed lookup (10 keys)', () => {
  const keys = Array.from({ length: 10 }, (_, i) => 'k' + i)
  const obj: Record<string, Set<() => void>> = Object.create(null)
  const map = new Map<string, Set<() => void>>()
  for (const k of keys) { obj[k] = new Set([mk()]); map.set(k, new Set([mk()])) }
  let i = 0
  bench('obj[key]', () => { const s = obj[keys[(i = (i + 1) % 10)]]; if (s) sink += s.size })
  let j = 0
  bench('map.get(key)', () => { const s = map.get(keys[(j = (j + 1) % 10)]); if (s) sink += s.size })
})

// ---------------------------------------------------------------------------
// update iteration in applyUpdate: for-in vs Object.keys
// ---------------------------------------------------------------------------
describe('update iteration (1 key)', () => {
  const one: Record<string, number> = { k0: 1 }
  bench('for-in', () => { for (const k in one) sink += one[k] })
  bench('Object.keys for-of', () => { for (const k of Object.keys(one)) sink += one[k] })
})

describe('update iteration (5 keys)', () => {
  const five: Record<string, number> = { k0: 1, k1: 1, k2: 1, k3: 1, k4: 1 }
  bench('for-in', () => { for (const k in five) sink += five[k] })
  bench('Object.keys for-of', () => { for (const k of Object.keys(five)) sink += five[k] })
})

// ---------------------------------------------------------------------------
// subscribe + unsubscribe churn: Set add/delete vs Array push/splice
// ---------------------------------------------------------------------------
describe('sub/unsub churn (key with 8 existing listeners)', () => {
  const base = Array.from({ length: 8 }, mk)
  const set = new Set(base)
  const arr = base.slice()
  const fn = mk()
  bench('Set add+delete', () => { set.add(fn); set.delete(fn) })
  bench('Array push+splice', () => { arr.push(fn); arr.splice(arr.indexOf(fn), 1) })
})
