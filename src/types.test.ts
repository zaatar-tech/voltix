/**
 * Compile-time type tests. Run with: tsc --noEmit
 * Every @ts-expect-error MUST produce an error — if it doesn't, tsc fails.
 * Every other line MUST compile cleanly.
 */

import {
  createStore,
  createLookup,
  createStoreHook,
  merge,
  useStoreSelector,
  type StoreType,
} from './index'

// ── Test store ──────────────────────────────────────────────────────────────
const store = createStore({
  count: 0,
  name: '',
  user: { firstName: '', lastName: '', age: 0 },
  tags: [] as string[],
  nested: { a: { b: 1 } },
})

// ── get ─────────────────────────────────────────────────────────────────────
const state = store.get()
state.count satisfies number
state.name satisfies string
state.user satisfies { firstName: string; lastName: string; age: number }

// ── getKey ──────────────────────────────────────────────────────────────────
store.getKey('count') satisfies number
store.getKey('name') satisfies string
store.getKey('user') satisfies { firstName: string; lastName: string; age: number }

// @ts-expect-error — 'nonexistent' is not a key
store.getKey('nonexistent')

// @ts-expect-error — getKey('count') returns number, not string
store.getKey('count') satisfies string

// ── setKey ──────────────────────────────────────────────────────────────────
store.setKey('count', 42)
store.setKey('name', 'hello')
store.setKey('user', { firstName: 'A', lastName: 'B', age: 1 })

// @ts-expect-error — wrong value type for 'count'
store.setKey('count', 'not a number')

// @ts-expect-error — wrong value type for 'name'
store.setKey('name', 123)

// @ts-expect-error — missing required property 'age'
store.setKey('user', { firstName: 'A', lastName: 'B' })

// ── set ─────────────────────────────────────────────────────────────────────
store.set({ count: 1 })
store.set({ count: 1, name: 'test' })

// @ts-expect-error — wrong type in partial
store.set({ count: 'oops' })

// ── merge (exported helper, plain data in → plain data out) ────────────────
merge(state.user, { age: 31 }) satisfies { firstName: string; lastName: string; age: number }
merge(state.nested, { a: { b: 2 } }) satisfies { a: { b: number } }

// Verify partial — only some keys required
merge(state.user, { firstName: 'Alice' })
merge(state.user, {})

// @ts-expect-error — wrong property type inside partial
merge(state.user, { age: 'not a number' })

// @ts-expect-error — property doesn't exist on user
merge(state.user, { nonexistent: true })

// ── mergeSet ────────────────────────────────────────────────────────────────
store.mergeSet('user', { age: 25 })
store.mergeSet('user', { firstName: 'Bob' })

// @ts-expect-error — primitive key
store.mergeSet('count', 5)

// @ts-expect-error — wrong property type
store.mergeSet('user', { age: 'wrong' })

// ── reset ───────────────────────────────────────────────────────────────────
store.reset()
store.reset(['count', 'name'])

// @ts-expect-error — invalid key
store.reset(['nonexistent'])

// ── batch ───────────────────────────────────────────────────────────────────
store.batch(() => {
  store.setKey('count', 10)
  store.mergeSet('user', { age: 5 })
})

// ── subscribe ───────────────────────────────────────────────────────────────
store.subscribe(['count', 'name'], () => {}) satisfies () => void

// @ts-expect-error — invalid key in subscribe
store.subscribe(['nonexistent'], () => {})

// ── select ──────────────────────────────────────────────────────────────────
const picked = store.pick(['count', 'name'])
picked.count satisfies number
picked.name satisfies string

// @ts-expect-error — 'user' not in selection
picked.user

// ── onChange ────────────────────────────────────────────────────────────────
store.onChange(['count', 'user'], (values, prev) => {
  values.count satisfies number
  values.user satisfies { firstName: string; lastName: string; age: number }
  prev.count satisfies number
  prev.user satisfies { firstName: string; lastName: string; age: number }
})

// ── createStoreHook ──────────────────────────────────────────────────────
const useStore = createStoreHook(store)

function TestComponent() {
  const s1 = useStore(['count', 'name'])
  s1.count satisfies number
  s1.name satisfies string

  const s2 = useStore(['user'])
  s2.user satisfies { firstName: string; lastName: string; age: number }
}

// ── intercept ────────────────────────────────────────────────────────────────
store.intercept((update, currentState) => {
  currentState.count satisfies number
  update satisfies Partial<typeof state>
})

store.intercept((_update, currentState) => ({ count: currentState.count + 1 }))

store.intercept(() => false, ['count'])

// ── options.equals (typed per key) ──────────────────────────────────────────
createStore(
  { user: { firstName: '', age: 0 }, count: 0, tags: [] as string[] },
  {
    equals: {
      user: (prev, next) => prev.firstName === next.firstName && prev.age === next.age,
      count: (prev, next) => prev + 1 === next + 1,
      tags: (prev, next) => prev.length === next.length && prev.every((t, i) => t === next[i]),
    },
  }
)

createStore(
  { count: 0 },
  {
    equals: {
      // @ts-expect-error — wrong prev/next type in callback
      count: (prev: string, next: string) => prev === next,
    },
  }
)

createStore(
  { count: 0 },
  {
    equals: {
      // @ts-expect-error — key doesn't exist on the state
      nonexistent: () => true,
    },
  }
)

// ── StoreType export ──────────────────────────────────────────────────────
const typedStore: StoreType<{ count: number }> = createStore({ count: 0 })
typedStore.getKey('count') satisfies number

// _eqReg is internal — not on the public StoreType
// @ts-expect-error — internal field is hidden from StoreType<T>
typedStore._eqReg

// ── options.equals ────────────────────────────────────────────────────────
createStore({ n: 0, label: '' }, { equals: { n: (prev, next) => prev === next } })

// @ts-expect-error — equals key must exist on state
createStore({ n: 0 }, { equals: { nope: () => true } })

// @ts-expect-error — compare args are typed to the key's value (number, not string)
createStore({ n: 0 }, { equals: { n: (prev: string, next: string) => prev === next } })


// ── update / increment / toggle ───────────────────────────────────────────
const mix = createStore({ count: 0, label: '', open: false })

mix.increment('count')
mix.increment('count', 5)
// @ts-expect-error — increment only accepts numeric keys
mix.increment('label')
// @ts-expect-error — increment only accepts numeric keys
mix.increment('open')

mix.toggle('open')
// @ts-expect-error — toggle only accepts boolean keys
mix.toggle('count')

mix.update('count', (c) => c + 1)
mix.update('label', (s) => s.toUpperCase())
// @ts-expect-error — updater must return the key's type
mix.update('count', () => 'nope')

// ── createLookup ────────────────────────────────────────────────────
const lookup = createLookup((id: string) => ({ selected: false, label: id }))
const rowStore: StoreType<{ selected: boolean; label: string }> = lookup.at('a')
rowStore.getKey('selected') satisfies boolean
lookup.keys() satisfies string[]
lookup.size() satisfies number
lookup.has('a') satisfies boolean
lookup.remove('a') satisfies boolean

// @ts-expect-error — id type is string, not number
lookup.at(123)

const numLookup = createLookup((id: number) => ({ x: id }))
numLookup.at(1).getKey('x') satisfies number
void numLookup
