import { describe, it, expect, vi, expectTypeOf } from 'vitest';
import { z } from 'zod';
import { createStore, createLookup, createActions, type Store, type Lookup } from './index';

describe('createStore — composition', () => {
  it('nests stores literally and navigates with select (chained, memoized)', () => {
    const root = createStore({
      a: 1,
      b: createStore({
        label: 'hi',
        c: createStore({ value: 0 }),
      }),
    });

    root.setKey('a', 2);
    expect(root.getKey('a')).toBe(2);

    root.select('b').setKey('label', 'yo');
    expect(root.select('b').getKey('label')).toBe('yo');

    root.select('b').select('c').setKey('value', 5);
    expect(root.select('b').select('c').getKey('value')).toBe(5);
    expect(root.select('b')).toBe(root.select('b')); // same memoized node every time
  });

  it('keeps child stores out of the parent leaf state', () => {
    const root = createStore({ a: 1, b: createStore({ x: 0 }) });
    expect(root.get()).toEqual({ a: 1 }); // no `b` in the reactive state
    expect(root.children()).toEqual(['b']);

    const fn = vi.fn();
    root.subscribe(['a'], fn);
    root.select('b').setKey('x', 9); // a child write never notifies the parent
    expect(fn).not.toHaveBeenCalled();
  });

  it('treats plain objects and arrays as leaves, not children', () => {
    const s = createStore({ pos: { x: 1, y: 2 }, tags: [1, 2, 3] });
    expect(s.get()).toEqual({ pos: { x: 1, y: 2 }, tags: [1, 2, 3] });
    expect(s.children()).toEqual([]);
    s.setKey('pos', { x: 9, y: 9 });
    expect(s.getKey('pos')).toEqual({ x: 9, y: 9 });
  });

  it('keeps fine-grained isolation across the tree', () => {
    const root = createStore({ b: createStore({ x: 0, y: 0 }) });
    const xf = vi.fn();
    const yf = vi.fn();
    root.select('b').subscribe(['x'], xf);
    root.select('b').subscribe(['y'], yf);
    root.select('b').setKey('x', 1);
    expect(xf).toHaveBeenCalledTimes(1);
    expect(yf).not.toHaveBeenCalled();
  });

  it('createLookup makes a store per id', () => {
    const created = vi.fn((id: string) => ({ done: false, id }));
    const todos = createLookup(created);

    expect(todos.has('t1')).toBe(false);
    expect(todos.at('t1')).toBe(todos.at('t1')); // memoized
    expect(created).toHaveBeenCalledTimes(1);

    todos.at('t2').toggle('done');
    expect(todos.at('t2').getKey('done')).toBe(true);
    expect(todos.keys()).toEqual(['t1', 't2']);
    expect(todos.size()).toBe(2);
    expect(todos.remove('t1')).toBe(true);
    expect(todos.has('t1')).toBe(false);
  });

  it('mixes fixed children and lookups in one store', () => {
    const app = createStore({
      theme: 'dark',
      profile: createStore({ name: 'ohad' }),
      todos: createLookup((id: string) => ({ text: '' })),
    });
    app.setKey('theme', 'light');
    app.select('profile').setKey('name', 'x');
    app.select('todos').at('t1').setKey('text', 'buy');

    expect(app.getKey('theme')).toBe('light');
    expect(app.select('profile').getKey('name')).toBe('x');
    expect(app.select('todos').at('t1').getKey('text')).toBe('buy');
  });

  it('nests lookups for depth (board → column → card)', () => {
    const board = createLookup((col: string) => ({
      title: '',
      cards: createLookup((card: string) => ({ text: '', done: false })),
    }));

    board.at('todo').setKey('title', 'To Do');
    board.at('todo').select('cards').at('c1').toggle('done');

    expect(board.at('todo').getKey('title')).toBe('To Do');
    expect(board.at('todo').select('cards').at('c1').getKey('done')).toBe(true);
    expect(board.at('todo').select('cards').at('c1')).toBe(board.at('todo').select('cards').at('c1'));
    expect(board.at('todo').select('cards').keys()).toEqual(['c1']);
  });

  it('throws on an unknown child key', () => {
    const root = createStore({ b: createStore({ x: 0 }) });
    // @ts-expect-error 'nope' is not a child key
    expect(() => root.select('nope')).toThrow(RangeError);
  });

  it('has the right static types', () => {
    const app = createStore({
      theme: 'dark',
      profile: createStore({ name: 'ohad' }),
      todos: createLookup((id: string) => ({ text: '' })),
    });
    expectTypeOf(app.get()).toEqualTypeOf<{ theme: string }>(); // leaves only
    expectTypeOf(app.select('profile')).toEqualTypeOf<Store<{ name: string }>>();
    expectTypeOf(app.select('todos')).toEqualTypeOf<Lookup<string, Store<{ text: string }>>>();
    expectTypeOf(app.select('todos').at('t1')).toEqualTypeOf<Store<{ text: string }>>();
    // @ts-expect-error 'profile' is a child, not a reactive leaf key
    app.setKey('profile', 0);
  });
});

describe('createActions', () => {
  it('returns a standalone actions object and leaves the store untouched', () => {
    const counter = createStore({ count: 0 });
    const actions = createActions(counter, (store) => ({
      increment: () => store.increment('count'),
      add: (amount: number) => store.increment('count', amount),
      reset: () => store.reset(['count']),
    }));

    actions.increment();
    actions.add(5);
    expect(counter.getKey('count')).toBe(6);
    expect('actions' in counter).toBe(false); // nothing bolted onto the store

    counter.setKey('count', 100); // full store API unaffected
    actions.reset();
    expect(counter.getKey('count')).toBe(0);
  });

  it('reaches across a composed tree via select and at', () => {
    const app = createStore({
      board: createLookup((col: string) => ({
        cards: createLookup((id: string) => ({ text: '' })),
      })),
    });
    const actions = createActions(app, (store) => ({
      addCard: (col: string, id: string, text: string) =>
        store.select('board').at(col).select('cards').at(id).setKey('text', text),
    }));

    actions.addCard('todo', 'c1', 'Ship it');
    expect(app.select('board').at('todo').select('cards').at('c1').getKey('text')).toBe('Ship it');
  });

  it('combines sets with plain object spread', () => {
    const counter = createStore({ count: 0 });
    const base = createActions(counter, (store) => ({ increment: () => store.increment('count') }));
    const extra = createActions(counter, (store) => ({ decrement: () => store.increment('count', -1) }));
    const all = { ...base, ...extra };

    all.increment();
    all.increment();
    all.decrement();
    expect(counter.getKey('count')).toBe(1);
  });

  it('is fully typed from the store and the returned object', () => {
    const counter = createStore({ count: 0 });
    const actions = createActions(counter, (store) => ({
      increment: () => store.increment('count'),
      add: (amount: number) => store.increment('count', amount),
    }));
    expectTypeOf(actions.increment).toEqualTypeOf<() => void>();
    expectTypeOf(actions.add).toEqualTypeOf<(amount: number) => void>();
    expectTypeOf(counter.getKey('count')).toEqualTypeOf<number>();
    // @ts-expect-error unknown action (compile-time only; not invoked)
    actions.ghost;
  });
});

describe('bottom-up lookups (factory returns a built store)', () => {
  const makeTodo = (id: string) => {
    const todo = createStore(
      { text: `todo ${id}`, done: false, error: '' },
      { schema: { text: z.string().min(1) } }
    );
    todo.onSchemaError((e) => todo.setKey('error', `${String(e.key)} rejected`));
    return todo;
  };

  it('memoizes exactly the node the factory built — schema and handler intact', () => {
    const todos = createLookup(makeTodo);
    const todoActions = createActions(todos, (lookup) => ({
      rename: (id: string, text: string) => lookup.at(id).setKey('text', text),
      toggle: (id: string) => lookup.at(id).toggle('done'),
    }));

    const t1 = todos.at('t1');
    expect(todos.at('t1')).toBe(t1); // memoized, not re-wrapped

    todoActions.rename('t1', '');                // contract veto
    expect(t1.getKey('text')).toBe('todo t1');   // write rejected
    expect(t1.getKey('error')).toBe('text rejected'); // its own handler ran

    todoActions.rename('t1', 'buy milk');
    expect(t1.getKey('text')).toBe('buy milk');
    todoActions.toggle('t1');
    expect(t1.getKey('done')).toBe(true);

    // a sibling store is independent and gets its own wiring
    expect(todos.at('t2').getKey('text')).toBe('todo t2');
    expect(todos.at('t2').getKey('error')).toBe('');
  });

  it('types the store at an id as the node itself, and lifecycle still works', () => {
    const todos = createLookup(makeTodo);
    expectTypeOf(todos.at('x').getKey('done')).toEqualTypeOf<boolean>();
    expectTypeOf(todos.at('x').getKey('error')).toEqualTypeOf<string>();

    expect(todos.keys()).toEqual(['x']);
    expect(todos.remove('x')).toBe(true);
    expect(todos.has('x')).toBe(false);
  });

  it('a shape factory still yields Store<C> and accepts options', () => {
    const rows = createLookup((id: string) => ({ qty: 1 }), {
      schema: { qty: z.number().min(0) },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rows.at('a').setKey('qty', -1);
    expect(rows.at('a').getKey('qty')).toBe(1);
    expectTypeOf(rows.at('a')).toEqualTypeOf<Store<{ qty: number }>>();
    vi.restoreAllMocks();
  });

  it('rejects createStore(store) at compile time and at runtime', () => {
    const child = createStore({ n: 0 });
    // @ts-expect-error a store is not a state shape — bind it under a key instead
    const bad = () => createStore(child);
    void bad;
    expect(() => createStore(child as unknown as { n: number })).toThrow(TypeError);
    expect(() => createStore(child as unknown as { n: number })).toThrow(/plain state object/);
  });

  it('a child store pairs with detached actions', () => {
    const profile = createStore({ name: 'ada' });
    const profileActions = createActions(profile, (store) => ({
      upper: () => store.setKey('name', store.getKey('name').toUpperCase()),
    }));
    const app = createStore({ theme: 'dark', profile });

    expect(app.get()).toEqual({ theme: 'dark' }); // child stays out of leaf state
    profileActions.upper();
    expect(profile.getKey('name')).toBe('ADA');
    expect(app.select('profile')).toBe(profile); // still the exact same node
  });

  it('warns once (dev) when lookup options are passed but the factory builds stores', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fam = createLookup(
      ((id: string) => createStore({ n: 0 })) as unknown as (id: string) => { n: number },
      { equals: {} }
    );
    fam.at('a');
    fam.at('b');
    expect(warn).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
