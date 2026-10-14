import { describe, it, expect, vi } from 'vitest'
import {
  createStore,
  createLookup,
  merge,
  persist,
  loadPersistedState,
} from './index'

// ---------------------------------------------------------------------------
// createStore — core
// ---------------------------------------------------------------------------
describe('createStore', () => {
  // -- get ------------------------------------------------------------------
  describe('get', () => {
    it('returns the initial state', () => {
      const store = createStore({ count: 0, name: 'Alice' })
      expect(store.get()).toEqual({ count: 0, name: 'Alice' })
    })

    it('returns a reference to the live state object', () => {
      const store = createStore({ x: 1 })
      const a = store.get()
      store.set({ x: 2 })
      const b = store.get()
      expect(a).toBe(b) // same object, mutated in place
      expect(b.x).toBe(2)
    })
  })

  // -- set ------------------------------------------------------------------
  describe('set', () => {
    it('updates a single key', () => {
      const store = createStore({ a: 1, b: 2 })
      store.set({ a: 10 })
      expect(store.get().a).toBe(10)
      expect(store.get().b).toBe(2)
    })

    it('updates multiple keys at once', () => {
      const store = createStore({ a: 1, b: 2, c: 3 })
      store.set({ a: 10, c: 30 })
      expect(store.get()).toEqual({ a: 10, b: 2, c: 30 })
    })

    it('skips update when value is identical (Object.is)', () => {
      const listener = vi.fn()
      const store = createStore({ count: 0 })
      store.subscribe(['count'], listener)

      store.set({ count: 0 })
      expect(listener).not.toHaveBeenCalled()
    })

    it('detects NaN === NaN as no change', () => {
      const listener = vi.fn()
      const store = createStore({ value: NaN })
      store.subscribe(['value'], listener)

      store.set({ value: NaN })
      expect(listener).not.toHaveBeenCalled()
      expect(store.get().value).toBeNaN()
    })

    it('is a no-op when called with null-ish update', () => {
      const store = createStore({ a: 1 })
      store.set(null as any)
      store.set(undefined as any)
      expect(store.get().a).toBe(1)
    })
  })

  // -- getKey ---------------------------------------------------------------
  describe('getKey', () => {
    it('returns the value of a single key', () => {
      const store = createStore({ a: 1, b: 'hello' })
      expect(store.getKey('a')).toBe(1)
      expect(store.getKey('b')).toBe('hello')
    })

    it('reflects updates made via set()', () => {
      const store = createStore({ x: 0 })
      store.set({ x: 42 })
      expect(store.getKey('x')).toBe(42)
    })
  })

  // -- setKey ---------------------------------------------------------------
  describe('setKey', () => {
    it('updates a single key', () => {
      const store = createStore({ a: 1, b: 2 })
      store.setKey('a', 10)
      expect(store.get()).toEqual({ a: 10, b: 2 })
    })

    it('fires listeners for the changed key', () => {
      const store = createStore({ v: 0 })
      const listener = vi.fn()
      store.subscribe(['v'], listener)

      store.setKey('v', 5)
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('does not fire listeners when value is identical', () => {
      const store = createStore({ v: 0 })
      const listener = vi.fn()
      store.subscribe(['v'], listener)

      store.setKey('v', 0)
      expect(listener).not.toHaveBeenCalled()
    })

    it('passes through the interceptor chain', () => {
      const store = createStore({ name: '' })
      store.intercept((update) => {
        if (update.name) return { name: update.name.toUpperCase() }
      })

      store.setKey('name', 'alice')
      expect(store.getKey('name')).toBe('ALICE')
    })

  })

  // -- merge (exported helper, plain data) -----------------------------------
  describe('merge helper', () => {
    it('returns a merged object without touching any store', () => {
      const store = createStore({ user: { name: 'Alice', age: 30 } })
      const listener = vi.fn()
      store.subscribe(['user'], listener)

      const result = merge(store.getKey('user'), { age: 31 })
      expect(result).toEqual({ name: 'Alice', age: 31 })
      expect(store.get().user).toEqual({ name: 'Alice', age: 30 }) // untouched
      expect(listener).not.toHaveBeenCalled()
    })

    it('preserves existing properties not included in the patch', () => {
      const result = merge({ theme: 'dark', lang: 'en', debug: false }, { lang: 'fr' })
      expect(result).toEqual({ theme: 'dark', lang: 'fr', debug: false })
    })
  })

  // -- mergeSet -------------------------------------------------------------
  describe('mergeSet', () => {
    it('shallow-merges and writes to the store', () => {
      const store = createStore({ user: { name: 'Alice', age: 30 }, count: 0 })
      store.mergeSet('user', { age: 31 })
      expect(store.get().user).toEqual({ name: 'Alice', age: 31 })
    })

    it('fires listeners for the merged key', () => {
      const store = createStore({ obj: { a: 1, b: 2 } })
      const listener = vi.fn()
      store.subscribe(['obj'], listener)

      store.mergeSet('obj', { a: 10 })
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('goes through the interceptor chain', () => {
      const spy = vi.fn()
      const store = createStore({ data: { x: 1 } })
      store.intercept(() => { spy() })

      store.mergeSet('data', { x: 2 })
      expect(spy).toHaveBeenCalledTimes(1)
      expect(store.get().data).toEqual({ x: 2 })
    })

  })

  // -- reset ----------------------------------------------------------------
  describe('reset', () => {
    it('resets all keys to initial state', () => {
      const store = createStore({ a: 1, b: 'hello', c: true })
      store.set({ a: 99, b: 'world', c: false })
      store.reset()
      expect(store.get()).toEqual({ a: 1, b: 'hello', c: true })
    })

    it('resets specific keys to initial state', () => {
      const store = createStore({ a: 1, b: 2, c: 3 })
      store.set({ a: 10, b: 20, c: 30 })
      store.reset(['a', 'c'])
      expect(store.get()).toEqual({ a: 1, b: 20, c: 3 })
    })

    it('fires listeners for reset keys', () => {
      const store = createStore({ x: 0, y: 0 })
      const lx = vi.fn()
      const ly = vi.fn()
      store.subscribe(['x'], lx)
      store.subscribe(['y'], ly)

      store.set({ x: 5, y: 5 })
      lx.mockClear()
      ly.mockClear()

      store.reset(['x'])
      expect(lx).toHaveBeenCalledTimes(1)
      expect(ly).not.toHaveBeenCalled()
    })

    it('does not fire listeners when value is already at initial', () => {
      const store = createStore({ v: 0 })
      const listener = vi.fn()
      store.subscribe(['v'], listener)

      store.reset(['v']) // already at initial
      expect(listener).not.toHaveBeenCalled()
    })

    it('goes through the interceptor chain', () => {
      const spy = vi.fn()
      const store = createStore({ v: 0 })
      store.intercept(() => { spy() })

      store.set({ v: 5 })
      spy.mockClear()

      store.reset()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(store.get().v).toBe(0)
    })
  })

  // -- batch ----------------------------------------------------------------
  describe('batch', () => {
    it('defers all notifications until callback completes', () => {
      const store = createStore({ a: 0, b: 0 })
      const la = vi.fn()
      const lb = vi.fn()
      store.subscribe(['a'], la)
      store.subscribe(['b'], lb)

      store.batch(() => {
        store.set({ a: 1 })
        expect(la).not.toHaveBeenCalled() // not yet
        store.set({ b: 2 })
        expect(lb).not.toHaveBeenCalled() // not yet
      })

      expect(la).toHaveBeenCalledTimes(1)
      expect(lb).toHaveBeenCalledTimes(1)
    })

    it('state is updated during the batch (only notifications deferred)', () => {
      const store = createStore({ v: 0 })

      store.batch(() => {
        store.set({ v: 5 })
        expect(store.get().v).toBe(5) // state is live
      })
    })

    it('deduplicates notifications for the same key', () => {
      const store = createStore({ v: 0 })
      const listener = vi.fn()
      store.subscribe(['v'], listener)

      store.batch(() => {
        store.set({ v: 1 })
        store.set({ v: 2 })
        store.set({ v: 3 })
      })

      expect(listener).toHaveBeenCalledTimes(1) // one notification, not three
      expect(store.get().v).toBe(3)
    })

    it('nested batch calls are transparent (inner batch runs inline)', () => {
      const store = createStore({ a: 0, b: 0 })
      const listener = vi.fn()
      store.subscribe(['a'], listener)

      store.batch(() => {
        store.set({ a: 1 })
        store.batch(() => {
          store.set({ b: 2 })
        })
        expect(listener).not.toHaveBeenCalled() // still deferred
      })

      expect(listener).toHaveBeenCalledTimes(1) // outer batch fires it
    })

    it('fires notifications even if callback throws', () => {
      const store = createStore({ v: 0 })
      const listener = vi.fn()
      store.subscribe(['v'], listener)

      expect(() => {
        store.batch(() => {
          store.set({ v: 1 })
          throw new Error('oops')
        })
      }).toThrow('oops')

      expect(store.get().v).toBe(1)
      expect(listener).toHaveBeenCalledTimes(1) // finally block fired
    })

    it('works with mergeSet and setKey inside batch', () => {
      const store = createStore({ obj: { a: 1, b: 2 }, count: 0 })
      const lo = vi.fn()
      const lc = vi.fn()
      store.subscribe(['obj'], lo)
      store.subscribe(['count'], lc)

      store.batch(() => {
        store.mergeSet('obj', { a: 10 })
        store.setKey('count', 5)
      })

      expect(lo).toHaveBeenCalledTimes(1)
      expect(lc).toHaveBeenCalledTimes(1)
      expect(store.get().obj).toEqual({ a: 10, b: 2 })
      expect(store.get().count).toBe(5)
    })
  })

  // -- per-key equality (options.equals) --------------------------------------
  describe('per-key equality', () => {
    it('skips update when registered equality returns true', () => {
      const store = createStore({ user: { id: 1, name: 'Alice' } }, { equals: { user: (prev, next) => prev.id === next.id && prev.name === next.name } })

      const listener = vi.fn()
      store.subscribe(['user'], listener)

      store.set({ user: { id: 1, name: 'Alice' } }) // same content, new reference
      expect(listener).not.toHaveBeenCalled()
      expect(store.get().user).toEqual({ id: 1, name: 'Alice' })
    })

    it('applies update when registered equality returns false', () => {
      const store = createStore({ user: { id: 1, name: 'Alice' } }, { equals: { user: (prev, next) => prev.id === next.id && prev.name === next.name } })

      const listener = vi.fn()
      store.subscribe(['user'], listener)

      store.set({ user: { id: 1, name: 'Bob' } })
      expect(listener).toHaveBeenCalledTimes(1)
      expect(store.get().user).toEqual({ id: 1, name: 'Bob' })
    })

    it('Object.is still catches identical references before equality fn runs', () => {
      const eqFn = vi.fn(() => true)
      const store = createStore({ count: 0 }, { equals: { count: eqFn } })

      store.set({ count: 0 }) // same primitive — Object.is catches it
      expect(eqFn).not.toHaveBeenCalled()
    })

    it('mergeSet skips when equality says unchanged', () => {
      const store = createStore({ config: { theme: 'dark', lang: 'en' } }, { equals: { config: (prev, next) => prev.theme === next.theme && prev.lang === next.lang } })

      const listener = vi.fn()
      store.subscribe(['config'], listener)

      store.mergeSet('config', { theme: 'dark' }) // same content
      expect(listener).not.toHaveBeenCalled()
    })

    it('mergeSet applies when equality detects change', () => {
      const store = createStore({ config: { theme: 'dark', lang: 'en' } }, { equals: { config: (prev, next) => prev.theme === next.theme && prev.lang === next.lang } })

      const listener = vi.fn()
      store.subscribe(['config'], listener)

      store.mergeSet('config', { theme: 'light' })
      expect(listener).toHaveBeenCalledTimes(1)
      expect(store.get().config).toEqual({ theme: 'light', lang: 'en' })
    })

    it('only affects the registered key, not others', () => {
      const store = createStore({ a: { x: 1 }, b: { x: 1 } }, { equals: { a: (prev, next) => prev.x === next.x } })

      const la = vi.fn()
      const lb = vi.fn()
      store.subscribe(['a'], la)
      store.subscribe(['b'], lb)

      store.set({ a: { x: 1 }, b: { x: 1 } })
      expect(la).not.toHaveBeenCalled() // equality catches it
      expect(lb).toHaveBeenCalledTimes(1) // no equality — new reference triggers
    })

    it('equality fn receives prev and next values', () => {
      const eqFn = vi.fn((prev: number[], next: number[]) => prev.length === next.length)
      const store = createStore({ items: [1, 2, 3] }, { equals: { items: eqFn } })

      store.set({ items: [4, 5, 6] })
      expect(eqFn).toHaveBeenCalledWith([1, 2, 3], [4, 5, 6])
      expect(store.get().items).toEqual([1, 2, 3]) // same length, equality returned true
    })
  })

  // -- subscribe ------------------------------------------------------------
  describe('subscribe', () => {
    it('fires listener when subscribed key changes', () => {
      const store = createStore({ a: 1, b: 2 })
      const listener = vi.fn()
      store.subscribe(['a'], listener)

      store.set({ a: 10 })
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('does not fire listener for unrelated key changes', () => {
      const store = createStore({ a: 1, b: 2 })
      const listener = vi.fn()
      store.subscribe(['a'], listener)

      store.set({ b: 20 })
      expect(listener).not.toHaveBeenCalled()
    })

    it('deduplicates listener when multiple subscribed keys change', () => {
      const store = createStore({ a: 1, b: 2 })
      const listener = vi.fn()
      store.subscribe(['a', 'b'], listener)

      store.set({ a: 10, b: 20 })
      // listener subscribed to both keys but deduped — fires once
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it.each(['set', 'batch'] as const)('%s keeps separate single-key subscriptions when another subscription spans keys', (method) => {
      const store = createStore({ a: 0, b: 0, c: 0, d: 0 })
      const listener = vi.fn()
      store.subscribe(['a'], listener)
      store.subscribe(['a'], listener)
      store.subscribe(['b'], listener)
      const unrelated = vi.fn()
      store.subscribe(['c', 'd'], unrelated)

      if (method === 'set') store.set({ a: 1, b: 1 })
      else store.batch(() => {
        store.setKey('a', 1)
        store.setKey('b', 1)
      })

      expect(listener).toHaveBeenCalledTimes(3)
      expect(unrelated).not.toHaveBeenCalled()
    })

    it.each(['set', 'batch'] as const)('%s notifies each subscription when single- and multi-key subscriptions share a callback', (method) => {
      const store = createStore({ a: 0, b: 0, c: 0 })
      const listener = vi.fn()
      store.subscribe(['a'], listener)
      const off = store.subscribe(['a', 'b'], listener)
      store.subscribe(['b', 'c'], listener)
      const write = (value: number) => {
        if (method === 'set') store.set({ a: value, b: value, c: value })
        else store.batch(() => {
          store.setKey('a', value)
          store.setKey('b', value)
          store.setKey('c', value)
        })
      }

      write(1)
      expect(listener).toHaveBeenCalledTimes(3)

      listener.mockClear()
      off()
      write(2)
      expect(listener).toHaveBeenCalledTimes(2)
    })

    it('returns an unsubscribe function', () => {
      const store = createStore({ a: 1 })
      const listener = vi.fn()
      const unsub = store.subscribe(['a'], listener)

      store.set({ a: 2 })
      expect(listener).toHaveBeenCalledTimes(1)

      unsub()
      store.set({ a: 3 })
      expect(listener).toHaveBeenCalledTimes(1) // no additional calls
    })

    it('supports multiple listeners on the same key', () => {
      const store = createStore({ x: 0 })
      const l1 = vi.fn()
      const l2 = vi.fn()
      store.subscribe(['x'], l1)
      store.subscribe(['x'], l2)

      store.set({ x: 1 })
      expect(l1).toHaveBeenCalledTimes(1)
      expect(l2).toHaveBeenCalledTimes(1)
    })

    it('unsubscribing one listener does not affect others', () => {
      const store = createStore({ x: 0 })
      const l1 = vi.fn()
      const l2 = vi.fn()
      const unsub1 = store.subscribe(['x'], l1)
      store.subscribe(['x'], l2)

      unsub1()
      store.set({ x: 1 })
      expect(l1).not.toHaveBeenCalled()
      expect(l2).toHaveBeenCalledTimes(1)
    })

    it('keeps the others when the first of three unsubscribes', () => {
      const store = createStore({ x: 0 })
      const l1 = vi.fn()
      const l2 = vi.fn()
      const l3 = vi.fn()
      const unsub1 = store.subscribe(['x'], l1)
      store.subscribe(['x'], l2)
      store.subscribe(['x'], l3)

      unsub1()
      store.set({ x: 1 })
      expect(l1).not.toHaveBeenCalled()
      expect(l2).toHaveBeenCalledTimes(1)
      expect(l3).toHaveBeenCalledTimes(1)
    })

    it('unsubscribe is idempotent and never removes a later subscription', () => {
      const store = createStore({ x: 0 })
      const l1 = vi.fn()
      const l2 = vi.fn()
      const unsub1 = store.subscribe(['x'], l1)
      unsub1()
      store.subscribe(['x'], l2)
      unsub1()

      store.set({ x: 1 })
      expect(l1).not.toHaveBeenCalled()
      expect(l2).toHaveBeenCalledTimes(1)
    })

    it('a listener that unsubscribes itself mid-notify is not called again', () => {
      const store = createStore({ x: 0 })
      const calls: string[] = []
      const l2 = vi.fn()
      const unsub1 = store.subscribe(['x'], () => {
        calls.push('l1')
        unsub1()
      })
      store.subscribe(['x'], l2)

      store.set({ x: 1 })
      store.set({ x: 2 })
      expect(calls).toEqual(['l1'])
      expect(l2).toHaveBeenCalledTimes(2)
    })

    it('every listener runs when the first one unsubscribes itself mid-notify', () => {
      const store = createStore({ x: 0 })
      const seen: string[] = []
      const unsubA = store.subscribe(['x'], () => {
        seen.push('a')
        unsubA()
      })
      store.subscribe(['x'], () => seen.push('b'))
      store.subscribe(['x'], () => seen.push('c'))
      store.subscribe(['x'], () => seen.push('d'))

      store.set({ x: 1 })
      expect(seen).toEqual(['a', 'b', 'c', 'd'])

      seen.length = 0
      store.set({ x: 2 })
      expect(seen.sort()).toEqual(['b', 'c', 'd'])
    })

    it('a listener removed by another mid-notify still finishes that round, then stops', () => {
      const store = createStore({ x: 0 })
      const seen: string[] = []
      let unsubC: () => void = () => {}
      store.subscribe(['x'], () => {
        seen.push('a')
        unsubC()
      })
      store.subscribe(['x'], () => seen.push('b'))
      unsubC = store.subscribe(['x'], () => seen.push('c'))

      store.set({ x: 1 })
      expect(seen).toEqual(['a', 'b', 'c'])

      seen.length = 0
      store.set({ x: 2 })
      expect(seen).toEqual(['a', 'b'])
    })

    it('a listener subscribed during a notify runs from the next write', () => {
      for (const others of [0, 1]) {
        const store = createStore({ x: 0 })
        const late = vi.fn()
        let added = false
        for (let i = 0; i < others; i++) store.subscribe(['x'], () => {})
        store.subscribe(['x'], () => {
          if (!added) {
            added = true
            store.subscribe(['x'], late)
          }
        })

        store.set({ x: 1 })
        expect(late).not.toHaveBeenCalled()
        store.set({ x: 2 })
        expect(late).toHaveBeenCalledTimes(1)
      }
    })

    it('mounting and unmounting many subscribers on one key leaves it clean', () => {
      const store = createStore({ x: 0 })
      const l = vi.fn()
      const offs = Array.from({ length: 500 }, () => store.subscribe(['x'], l))
      store.set({ x: 1 })
      expect(l).toHaveBeenCalledTimes(500)

      for (let i = offs.length - 1; i >= 0; i--) offs[i]()
      store.set({ x: 2 })
      expect(l).toHaveBeenCalledTimes(500)

      const off = store.subscribe(['x'], l)
      store.set({ x: 3 })
      expect(l).toHaveBeenCalledTimes(501)
      off()
    })
  })

  // -- select ---------------------------------------------------------------
  describe('select', () => {
    it('picks requested keys from state', () => {
      const store = createStore({ a: 1, b: 2, c: 3 })
      expect(store.pick(['a', 'c'])).toEqual({ a: 1, c: 3 })
    })

    it('returns a new object each time', () => {
      const store = createStore({ a: 1 })
      const s1 = store.pick(['a'])
      const s2 = store.pick(['a'])
      expect(s1).not.toBe(s2)
      expect(s1).toEqual(s2)
    })
  })
})

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
describe('intercept', () => {
  it('passes updates through when the interceptor returns nothing', () => {
    const store = createStore({ count: 0 })
    store.intercept(() => {})

    store.set({ count: 5 })
    expect(store.get().count).toBe(5)
  })

  it('vetoes updates when the interceptor returns false', () => {
    const store = createStore({ count: 0 })
    store.intercept(() => false)

    store.set({ count: 5 })
    expect(store.get().count).toBe(0)
  })

  it('replaces the update when the interceptor returns a partial', () => {
    const store = createStore({ name: '' })
    store.intercept((update) => {
      if (update.name) return { name: update.name.toUpperCase() }
    })

    store.set({ name: 'alice' })
    expect(store.get().name).toBe('ALICE')
  })

  it('only runs for matching keys when keys are given', () => {
    const spy = vi.fn()
    const store = createStore({ a: 1, b: 2 })
    store.intercept(() => { spy() }, ['a'])

    store.set({ b: 20 }) // scoped out
    expect(spy).not.toHaveBeenCalled()

    store.set({ a: 10 })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('runs multiple interceptors in insertion order', () => {
    const order: number[] = []
    const store = createStore({ v: 0 })

    store.intercept(() => { order.push(1) })
    store.intercept(() => { order.push(2) })
    store.intercept(() => { order.push(3) })

    store.set({ v: 1 })
    expect(order).toEqual([1, 2, 3])
  })

  it('a veto stops the remaining interceptors', () => {
    const spy = vi.fn()
    const store = createStore({ v: 0 })

    store.intercept(() => false)
    store.intercept(() => { spy() })

    store.set({ v: 1 })
    expect(spy).not.toHaveBeenCalled()
    expect(store.get().v).toBe(0)
  })

  it('catches interceptor errors and blocks the update', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = createStore({ v: 0 })

    store.intercept(() => { throw new Error('boom') })

    store.set({ v: 1 })
    expect(store.get().v).toBe(0)
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('a replacement flows into the next interceptor', () => {
    const seen: string[] = []
    const store = createStore({ name: '' })
    store.intercept((update) => ({ name: (update.name ?? '').trim() }))
    store.intercept((update) => { seen.push(update.name ?? ''); return { name: update.name!.toUpperCase() } })

    store.set({ name: '  alice  ' })
    expect(seen).toEqual(['alice'])
    expect(store.get().name).toBe('ALICE')
  })

  it('can be removed via the returned cleanup function', () => {
    const spy = vi.fn()
    const store = createStore({ v: 0 })
    const remove = store.intercept(() => { spy() })

    store.set({ v: 1 })
    expect(spy).toHaveBeenCalledTimes(1)

    remove()
    store.set({ v: 2 })
    expect(spy).toHaveBeenCalledTimes(1) // not called again
    expect(store.get().v).toBe(2) // update still applied
  })

  it('receives the update first and the pre-update state second', () => {
    const store = createStore({ a: 1, b: 2 })
    let capturedState: any
    let capturedUpdate: any

    store.intercept((update, state) => {
      capturedState = { ...state }
      capturedUpdate = { ...update }
    })

    store.set({ a: 10 })
    expect(capturedState).toEqual({ a: 1, b: 2 }) // state before update
    expect(capturedUpdate).toEqual({ a: 10 })
  })
})

// ---------------------------------------------------------------------------
// onChange
// ---------------------------------------------------------------------------
describe('onChange', () => {
  it('fires callback with new and previous values', async () => {
    const store = createStore({ count: 0, name: 'a' })
    const cb = vi.fn()

    store.onChange(['count'], cb)
    store.set({ count: 5 })

    // onChange uses queueMicrotask, await a tick
    await Promise.resolve()

    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith({ count: 5 }, { count: 0 })
  })

  it('batches multiple key changes from a single set()', async () => {
    const store = createStore({ a: 1, b: 2 })
    const cb = vi.fn()

    store.onChange(['a', 'b'], cb)
    store.set({ a: 10, b: 20 })

    await Promise.resolve()

    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith({ a: 10, b: 20 }, { a: 1, b: 2 })
  })

  it('batches rapid sequential set() calls into one callback', async () => {
    const store = createStore({ x: 0 })
    const cb = vi.fn()

    store.onChange(['x'], cb)
    store.set({ x: 1 })
    store.set({ x: 2 })
    store.set({ x: 3 })

    await Promise.resolve()

    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith({ x: 3 }, { x: 0 })
  })

  it('does not fire when values do not actually change', async () => {
    const store = createStore({ a: 1 })
    const cb = vi.fn()

    store.onChange(['a'], cb)
    store.set({ a: 1 }) // same value

    await Promise.resolve()

    expect(cb).not.toHaveBeenCalled()
  })

  it('does not fire for unrelated key changes', async () => {
    const store = createStore({ a: 1, b: 2 })
    const cb = vi.fn()

    store.onChange(['a'], cb)
    store.set({ b: 20 })

    await Promise.resolve()

    expect(cb).not.toHaveBeenCalled()
  })

  it('returns an unsubscribe function', async () => {
    const store = createStore({ v: 0 })
    const cb = vi.fn()

    const unsub = store.onChange(['v'], cb)
    store.set({ v: 1 })
    await Promise.resolve()
    expect(cb).toHaveBeenCalledTimes(1)

    unsub()
    store.set({ v: 2 })
    await Promise.resolve()
    expect(cb).toHaveBeenCalledTimes(1) // no additional calls
  })

  it('tracks prev correctly across multiple change cycles', async () => {
    const store = createStore({ v: 0 })
    const cb = vi.fn()

    store.onChange(['v'], cb)

    store.set({ v: 1 })
    await Promise.resolve()
    expect(cb).toHaveBeenLastCalledWith({ v: 1 }, { v: 0 })

    store.set({ v: 2 })
    await Promise.resolve()
    expect(cb).toHaveBeenLastCalledWith({ v: 2 }, { v: 1 })

    store.set({ v: 3 })
    await Promise.resolve()
    expect(cb).toHaveBeenLastCalledWith({ v: 3 }, { v: 2 })
  })
})

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
describe('persistence', () => {
  function createMockStorage() {
    const data = new Map<string, string>()
    return {
      getItem: vi.fn((key: string) => data.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { data.set(key, value) }),
      data,
    }
  }

  describe('persist', () => {
    it('saves changed keys to storage on update', () => {
      const storage = createMockStorage()
      const store = createStore({ theme: 'light', count: 0 })
      persist<{ theme: string; count: number }>(store, storage, 'app', ['theme'])

      store.set({ theme: 'dark' })
      expect(storage.setItem).toHaveBeenCalledWith('app:theme', '"dark"')
      expect(store.get().theme).toBe('dark')
    })

    it('does not write untracked keys', () => {
      const storage = createMockStorage()
      const store = createStore({ theme: 'light', count: 0 })
      persist<{ theme: string; count: number }>(store, storage, 'app', ['theme'])

      store.set({ count: 5 })
      expect(storage.setItem).not.toHaveBeenCalled()
      expect(store.get().count).toBe(5)
    })

    it('uses per-key storage format', () => {
      const storage = createMockStorage()
      const store = createStore({ a: 1, b: 'x' })
      persist<{ a: number; b: string }>(store, storage, 'prefix', ['a', 'b'])

      store.set({ a: 2, b: 'y' })
      expect(storage.setItem).toHaveBeenCalledWith('prefix:a', '2')
      expect(storage.setItem).toHaveBeenCalledWith('prefix:b', '"y"')
    })

    it('handles storage errors gracefully', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const storage = {
        getItem: () => null,
        setItem: () => { throw new Error('quota exceeded') },
      }
      const store = createStore({ v: 0 })
      persist<{ v: number }>(store, storage, 'k', ['v'])

      store.set({ v: 1 })
      expect(store.get().v).toBe(1) // update still applied
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  describe('loadPersistedState', () => {
    it('loads saved keys from storage', () => {
      const storage = createMockStorage()
      storage.data.set('app:theme', '"dark"')
      storage.data.set('app:count', '42')

      const result = loadPersistedState<{ theme: string; count: number }>(
        storage, 'app', ['theme', 'count']
      )
      expect(result).toEqual({ theme: 'dark', count: 42 })
    })

    it('returns empty object when no keys are persisted', () => {
      const storage = createMockStorage()
      const result = loadPersistedState<{ theme: string }>(
        storage, 'app', ['theme']
      )
      expect(result).toEqual({})
    })

    it('skips keys that fail to parse', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const storage = createMockStorage()
      storage.data.set('app:a', 'not-json{{')
      storage.data.set('app:b', '"valid"')

      const result = loadPersistedState<{ a: string; b: string }>(
        storage, 'app', ['a', 'b']
      )
      expect(result).toEqual({ b: 'valid' })
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('integrates with persist round-trip', () => {
      const storage = createMockStorage()

      // Write
      const store1 = createStore({ theme: 'light', lang: 'en' })
      persist<{ theme: string; lang: string }>(store1, storage, 'rt', ['theme', 'lang'])
      store1.set({ theme: 'dark', lang: 'fr' })

      // Read
      const persisted = loadPersistedState<{ theme: string; lang: string }>(
        storage, 'rt', ['theme', 'lang']
      )
      expect(persisted).toEqual({ theme: 'dark', lang: 'fr' })
    })
  })

  // -- async storage --------------------------------------------------------
  function createMockAsyncStorage() {
    const data = new Map<string, string>()
    return {
      getItem: vi.fn((key: string) => Promise.resolve(data.get(key) ?? null)),
      setItem: vi.fn((key: string, value: string) => {
        data.set(key, value)
        return Promise.resolve()
      }),
      data,
    }
  }

  describe('persist (async)', () => {
    it('writes to async storage and still applies update synchronously', async () => {
      const storage = createMockAsyncStorage()
      const store = createStore({ theme: 'light' })
      persist<{ theme: string }>(store, storage, 'app', ['theme'])

      store.set({ theme: 'dark' })
      expect(store.get().theme).toBe('dark') // state updated synchronously
      await Promise.resolve() // let async setItem resolve
      expect(storage.setItem).toHaveBeenCalledWith('app:theme', '"dark"')
    })

    it('handles async storage write errors gracefully', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const storage = {
        getItem: () => Promise.resolve(null),
        setItem: () => Promise.reject(new Error('write failed')),
      }
      const store = createStore({ v: 0 })
      persist<{ v: number }>(store, storage, 'k', ['v'])

      store.set({ v: 1 })
      expect(store.get().v).toBe(1)
      await Promise.resolve() // let rejection handler run
      await Promise.resolve() // microtask for .catch
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  describe('loadPersistedState (async)', () => {
    it('returns a Promise that resolves to persisted state', async () => {
      const storage = createMockAsyncStorage()
      storage.data.set('app:theme', '"dark"')
      storage.data.set('app:count', '42')

      const result = loadPersistedState<{ theme: string; count: number }>(
        storage, 'app', ['theme', 'count']
      )
      expect(result).toBeInstanceOf(Promise)
      expect(await result).toEqual({ theme: 'dark', count: 42 })
    })

    it('returns empty object when async storage has no keys', async () => {
      const storage = createMockAsyncStorage()
      const result = await loadPersistedState<{ theme: string }>(
        storage, 'app', ['theme']
      )
      expect(result).toEqual({})
    })

    it('handles async getItem rejection gracefully', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const storage = {
        getItem: vi.fn((key: string) =>
          key === 'app:a' ? Promise.reject(new Error('read fail')) : Promise.resolve('"ok"')
        ),
        setItem: vi.fn(() => Promise.resolve()),
      }

      const result = await loadPersistedState<{ a: string; b: string }>(
        storage, 'app', ['a', 'b']
      )
      expect(result).toEqual({ b: 'ok' })
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('integrates with async persist round-trip', async () => {
      const storage = createMockAsyncStorage()

      const store = createStore({ theme: 'light', lang: 'en' })
      persist<{ theme: string; lang: string }>(store, storage, 'rt', ['theme', 'lang'])
      store.set({ theme: 'dark', lang: 'fr' })

      await Promise.resolve() // let async writes complete

      const persisted = await loadPersistedState<{ theme: string; lang: string }>(
        storage, 'rt', ['theme', 'lang']
      )
      expect(persisted).toEqual({ theme: 'dark', lang: 'fr' })
    })
  })

  describe('rich types (default parser)', () => {
    type Rich = {
      when: Date
      tags: Set<string>
      scores: Map<string, number>
      nested: { seen: Set<number>; at: Date }
      ratio: number
    }

    it('round-trips Date, Map, and Set', () => {
      const storage = createMockStorage()
      const store = createStore<Rich>({
        when: new Date(0),
        tags: new Set<string>(),
        scores: new Map<string, number>(),
        nested: { seen: new Set<number>(), at: new Date(0) },
        ratio: 0,
      })
      persist<Rich>(store, storage, 'rich', ['when', 'tags', 'scores', 'nested', 'ratio'])

      const when = new Date('2026-08-08T12:00:00Z')
      store.set({
        when,
        tags: new Set(['a', 'b']),
        scores: new Map([['ada', 10], ['grace', 20]]),
        nested: { seen: new Set([1, 2]), at: when },
        ratio: Infinity,
      })

      const out = loadPersistedState<Rich>(storage, 'rich', ['when', 'tags', 'scores', 'nested', 'ratio'])
      expect(out.when).toBeInstanceOf(Date)
      expect(out.when!.getTime()).toBe(when.getTime())
      expect(out.tags).toEqual(new Set(['a', 'b']))
      expect(out.scores).toEqual(new Map([['ada', 10], ['grace', 20]]))
      expect(out.nested!.seen).toEqual(new Set([1, 2]))
      expect(out.nested!.at).toBeInstanceOf(Date)
      expect(out.ratio).toBe(Infinity)
    })

    it('reads untagged values written before tagging existed', () => {
      const storage = createMockStorage()
      storage.data.set('old:theme', '"dark"')
      storage.data.set('old:filters', '{"open":true,"page":2}')

      const out = loadPersistedState<{ theme: string; filters: object }>(storage, 'old', ['theme', 'filters'])
      expect(out).toEqual({ theme: 'dark', filters: { open: true, page: 2 } })
    })

    it('round-trips a key written to undefined', () => {
      const storage = createMockStorage()
      const store = createStore({ value: 'seed' as string | undefined })
      persist<{ value: string | undefined }>(store, storage, 'u', ['value'])

      store.setKey('value', undefined)
      // JSON.stringify(undefined) is undefined, which setItem would store as the
      // string "undefined" and JSON.parse would then throw on.
      expect(storage.data.get('u:value')).not.toBe('undefined')

      const out = loadPersistedState<{ value: string | undefined }>(storage, 'u', ['value'])
      expect('value' in out).toBe(true)
      expect(out.value).toBeUndefined()
    })

    it('round-trips a user object that contains the tag key itself', () => {
      const storage = createMockStorage()
      const weird = { $$voltix: 'gotcha', ok: true }
      const store = createStore({ blob: {} as object })
      persist<{ blob: object }>(store, storage, 'w', ['blob'])

      store.setKey('blob', weird)
      const out = loadPersistedState<{ blob: object }>(storage, 'w', ['blob'])
      expect(out.blob).toEqual(weird)
    })
  })

  describe('custom parser', () => {
    it('uses the parser on both sides', () => {
      const storage = createMockStorage()
      const parser = {
        stringify: vi.fn((value: any) => 'X' + JSON.stringify(value)),
        parse: vi.fn((text: string) => JSON.parse(text.slice(1))),
      }
      const store = createStore({ n: 0 })
      persist<{ n: number }>(store, storage, 'p', ['n'], parser)

      store.setKey('n', 7)
      expect(storage.data.get('p:n')).toBe('X7')

      const out = loadPersistedState<{ n: number }>(storage, 'p', ['n'], parser)
      expect(out).toEqual({ n: 7 })
      expect(parser.stringify).toHaveBeenCalled()
      expect(parser.parse).toHaveBeenCalled()
    })

    it('plain JSON works as a parser', () => {
      const storage = createMockStorage()
      const store = createStore({ tags: new Set(['a']) })
      persist<{ tags: Set<string> }>(store, storage, 'raw', ['tags'], JSON)

      store.setKey('tags', new Set(['a', 'b']))
      expect(storage.data.get('raw:tags')).toBe('{}') // JSON can't see a Set — that's the point of the default
    })
  })
})

// ---------------------------------------------------------------------------
// options.equals — declarative per-key equality
// ---------------------------------------------------------------------------
describe('options.equals', () => {
  it('skips a set when the equality function returns true', () => {
    const store = createStore(
      { user: { id: 1, name: 'A' } },
      { equals: { user: (prev, next) => prev.id === next.id } },
    )
    const listener = vi.fn()
    store.subscribe(['user'], listener)

    store.set({ user: { id: 1, name: 'B' } }) // same id → skipped
    expect(listener).not.toHaveBeenCalled()
    expect(store.get().user).toEqual({ id: 1, name: 'A' })

    store.set({ user: { id: 2, name: 'C' } }) // different id → applied
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.get().user).toEqual({ id: 2, name: 'C' })
  })

  it('supports threshold-style equality', () => {
    const store = createStore({ n: 0 }, { equals: { n: (p, x) => Math.abs(p - x) < 2 } })

    store.set({ n: 1 }) // within threshold → skipped
    expect(store.get().n).toBe(0)

    store.set({ n: 5 })
    expect(store.get().n).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// createStore — keyed collection of stores ("stores in stores")
// ---------------------------------------------------------------------------
describe('createLookup', () => {
  it('creates a store lazily and memoizes it per id', () => {
    const created = vi.fn((id: string) => ({ selected: false, label: id }))
    const lookup = createLookup(created)

    expect(lookup.has('a')).toBe(false)
    const a1 = lookup.at('a')
    const a2 = lookup.at('a')

    expect(a1).toBe(a2) // memoized
    expect(created).toHaveBeenCalledTimes(1)
    expect(lookup.has('a')).toBe(true)
    expect(a1.get()).toEqual({ selected: false, label: 'a' })
  })

  it('gives each id its own independent store', () => {
    const lookup = createLookup((id: string) => ({ count: 0, id }))
    const a = lookup.at('a')
    const b = lookup.at('b')

    a.set({ count: 5 })
    expect(a.get().count).toBe(5)
    expect(b.get().count).toBe(0)
  })

  it('each item is a full store (lazy interceptors + reset work on it)', () => {
    const lookup = createLookup((id: string) => ({ count: 0, id }))
    const a = lookup.at('a')

    a.intercept((update) => {
      if (update.count !== undefined && update.count < 0) return false // veto negatives
    }, ['count'])

    a.set({ count: -1 })
    expect(a.get().count).toBe(0) // vetoed

    a.set({ count: 3 })
    expect(a.get().count).toBe(3)

    a.reset(['count'])
    expect(a.get().count).toBe(0)
  })

  it('keeps subscriptions isolated per sub-store', () => {
    const lookup = createLookup((id: string) => ({ v: 0, id }))
    const aListener = vi.fn()
    const bListener = vi.fn()
    lookup.at('a').subscribe(['v'], aListener)
    lookup.at('b').subscribe(['v'], bListener)

    lookup.at('a').set({ v: 1 })
    expect(aListener).toHaveBeenCalledTimes(1)
    expect(bListener).not.toHaveBeenCalled()
  })

  it('tracks keys and size, and removes/clears', () => {
    const lookup = createLookup((id: string) => ({ id }))
    lookup.at('a')
    lookup.at('b')
    lookup.at('c')

    expect(lookup.keys()).toEqual(['a', 'b', 'c'])
    expect(lookup.size()).toBe(3)

    expect(lookup.remove('b')).toBe(true)
    expect(lookup.remove('missing')).toBe(false)
    expect(lookup.keys()).toEqual(['a', 'c'])

    lookup.clear()
    expect(lookup.size()).toBe(0)
    expect(lookup.has('a')).toBe(false)
  })

  it('starts fresh after remove', () => {
    const lookup = createLookup((id: string) => ({ v: 0, id }))
    lookup.at('a').set({ v: 9 })
    expect(lookup.at('a').get().v).toBe(9)

    lookup.remove('a')
    expect(lookup.at('a').get().v).toBe(0) // brand-new store
  })

  it('applies options to every member store', () => {
    const lookup = createLookup(
      (id: string) => ({ items: [] as number[], id }),
      { equals: { items: (p: number[], n: number[]) => p.length === n.length } },
    )

    const aListener = vi.fn()
    lookup.at('a').subscribe(['items'], aListener)
    lookup.at('a').set({ items: [1, 2] }) // 0 -> 2 length change, applied
    lookup.at('a').set({ items: [3, 4] }) // same length, skipped
    expect(aListener).toHaveBeenCalledTimes(1)

    const bListener = vi.fn()
    lookup.at('b').subscribe(['items'], bListener)
    lookup.at('b').set({ items: [1] })
    lookup.at('b').set({ items: [2] }) // same length, skipped for this member too
    expect(bListener).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// derive — computed keys
// ---------------------------------------------------------------------------
describe('derive', () => {
  it('seeds the derived key from current inputs', () => {
    const store = createStore({ first: 'Ada', last: 'Lovelace', full: '' })
    store.derive('full', ['first', 'last'], ({ first, last }) => `${first} ${last}`)
    expect(store.getKey('full')).toBe('Ada Lovelace')
  })

  it('recomputes synchronously in the same set that changes an input', () => {
    const store = createStore({ first: 'Ada', last: 'Lovelace', full: '' })
    store.derive('full', ['first', 'last'], ({ first, last }) => `${first} ${last}`)

    const listener = vi.fn()
    store.subscribe(['full'], listener)

    store.set({ last: 'Byron' })
    expect(store.getKey('full')).toBe('Ada Byron')
    expect(listener).toHaveBeenCalledTimes(1) // woke in the same notify round
  })

  it('does not notify the derived key when the result is unchanged', () => {
    const store = createStore({ a: 1, b: 1, sum: 0 })
    store.derive('sum', ['a', 'b'], ({ a, b }) => a + b)

    const listener = vi.fn()
    store.subscribe(['sum'], listener)

    store.set({ a: 2, b: 0 }) // inputs change, sum stays 2
    expect(store.getKey('sum')).toBe(2)
    expect(listener).not.toHaveBeenCalled()
  })

  it('does not fire for a set that touches no input', () => {
    const store = createStore({ a: 1, other: 0, doubled: 0 })
    store.derive('doubled', ['a'], ({ a }) => a * 2)

    const listener = vi.fn()
    store.subscribe(['doubled'], listener)

    store.set({ other: 9 })
    expect(listener).not.toHaveBeenCalled()
    expect(store.getKey('doubled')).toBe(2)
  })

  it('stops recomputing after the disposer runs', () => {
    const store = createStore({ a: 1, doubled: 0 })
    const dispose = store.derive('doubled', ['a'], ({ a }) => a * 2)
    store.setKey('a', 3)
    expect(store.getKey('doubled')).toBe(6)

    dispose()
    store.setKey('a', 10)
    expect(store.getKey('doubled')).toBe(6) // no longer tracked
  })
})

// ---------------------------------------------------------------------------
// update / increment / toggle — convenience setters
// ---------------------------------------------------------------------------
describe('update / increment / toggle', () => {
  it('update sets a key from its current value', () => {
    const store = createStore({ count: 5 })
    store.update('count', (c) => c * 2)
    expect(store.getKey('count')).toBe(10)
  })

  it('increment adds 1 by default', () => {
    const store = createStore({ count: 0 })
    store.increment('count')
    expect(store.getKey('count')).toBe(1)
  })

  it('increment adds a custom amount, and decrements with a negative', () => {
    const store = createStore({ count: 10 })
    store.increment('count', 5)
    expect(store.getKey('count')).toBe(15)
    store.increment('count', -3)
    expect(store.getKey('count')).toBe(12)
  })

  it('toggle flips a boolean', () => {
    const store = createStore({ open: false })
    store.toggle('open')
    expect(store.getKey('open')).toBe(true)
    store.toggle('open')
    expect(store.getKey('open')).toBe(false)
  })

  it('notifies subscribers exactly like setKey', () => {
    const store = createStore({ count: 0, open: false })
    const countListener = vi.fn()
    const openListener = vi.fn()
    store.subscribe(['count'], countListener)
    store.subscribe(['open'], openListener)
    store.increment('count')
    store.toggle('open')
    expect(countListener).toHaveBeenCalledTimes(1)
    expect(openListener).toHaveBeenCalledTimes(1)
  })

  it('a no-op update does not notify', () => {
    const store = createStore({ count: 0 })
    const listener = vi.fn()
    store.subscribe(['count'], listener)
    store.update('count', (c) => c)
    expect(listener).not.toHaveBeenCalled()
  })
})
