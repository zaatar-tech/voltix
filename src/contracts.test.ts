import { describe, it, expect, vi, afterEach, expectTypeOf } from 'vitest';
import { z } from 'zod';
import { createStore, createLookup, createActions, type StandardSchemaV1, type StoreOptions, type SchemaError } from './index';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('schema contracts', () => {
  it('vetoes an invalid write, keeps the prior value, and does not notify', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore({ count: 0 }, { schema: { count: z.number().int().min(0) } });
    const listener = vi.fn();
    store.subscribe(['count'], listener);

    store.setKey('count', -5);
    expect(store.getKey('count')).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledOnce();

    store.setKey('count', 3);
    expect(store.getKey('count')).toBe(3);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('vetoes per key inside set(): the rest of the update commits', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore(
      { count: 0, name: 'a' },
      { schema: { count: z.number().int() } }
    );
    store.set({ count: 1.5, name: 'b' });
    expect(store.getKey('count')).toBe(0); // vetoed
    expect(store.getKey('name')).toBe('b'); // committed
  });

  it('commits a transforming schema’s parsed output, and equality runs post-transform', () => {
    const store = createStore(
      { email: 'a@b.c' },
      { schema: { email: z.string().trim().toLowerCase() } }
    );
    const listener = vi.fn();
    store.subscribe(['email'], listener);

    store.setKey('email', '  NEW@Mail.COM ');
    expect(store.getKey('email')).toBe('new@mail.com');
    expect(listener).toHaveBeenCalledTimes(1);

    store.setKey('email', ' new@mail.com  '); // transforms to the stored value
    expect(listener).toHaveBeenCalledTimes(1); // no second notify
  });

  it('applies to the convenience setters (increment through a min(0) contract)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore({ count: 2 }, { schema: { count: z.number().min(0) } });
    store.increment('count', -10); // would be -8
    expect(store.getKey('count')).toBe(2);
    store.increment('count', -2);
    expect(store.getKey('count')).toBe(0);
  });

  it('accepts any Standard Schema implementation, not just zod', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const evenNumber: StandardSchemaV1<any, number> = {
      '~standard': {
        version: 1,
        vendor: 'hand-rolled',
        validate: (v) =>
          typeof v === 'number' && v % 2 === 0
            ? { value: v }
            : { issues: [{ message: 'expected an even number' }] },
      },
    };
    const store = createStore({ n: 0 }, { schema: { n: evenNumber } });
    store.setKey('n', 3);
    expect(store.getKey('n')).toBe(0);
    store.setKey('n', 4);
    expect(store.getKey('n')).toBe(4);
  });

  it('vetoes async schemas with an explanatory error', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const asyncSchema: StandardSchemaV1<any, number> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async (v) => ({ value: v as number }),
      },
    };
    const store = createStore({ n: 1 }, { schema: { n: asyncSchema } });
    store.setKey('n', 2);
    expect(store.getKey('n')).toBe(1);
    expect(err.mock.calls[0][0]).toContain('async');
  });

  it('applies to every store the lookup builds', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const rows = createLookup(
      (id: string) => ({ qty: 0 }),
      { schema: { qty: z.number().int().min(0) } }
    );
    rows.at('a').setKey('qty', -1);
    expect(rows.at('a').getKey('qty')).toBe(0);
    rows.at('b').setKey('qty', 7);
    expect(rows.at('b').getKey('qty')).toBe(7);
  });

  it('rejects a schema whose output type does not match the key', () => {
    type CounterOptions = StoreOptions<{ count: number }>;
    const good: CounterOptions = { schema: { count: z.number() } };
    // @ts-expect-error z.string() output is string, key is number
    const bad: CounterOptions = { schema: { count: z.string() } };
    void good; void bad;
  });
});

describe('onSchemaError', () => {
  it('hands the handler the key, issues, value and failing store; write stays vetoed', () => {
    const store = createStore({ age: 1 }, { schema: { age: z.number().int().min(0) } });
    const seen: SchemaError<{ age: number }>[] = [];
    store.onSchemaError((e) => seen.push(e));

    store.setKey('age', -5);
    expect(store.getKey('age')).toBe(1); // still vetoed
    expect(seen).toHaveLength(1);
    expect(seen[0].key).toBe('age');
    expect(seen[0].value).toBe(-5);
    expect(seen[0].store).toBe(store);
    expect(seen[0].issues[0].message).toBeTruthy();
  });

  it('replaces the console default, and restores it once disposed', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore({ n: 0 }, { schema: { n: z.number().min(0) } });
    const handler = vi.fn();
    const off = store.onSchemaError(handler);

    store.setKey('n', -1);
    expect(handler).toHaveBeenCalledOnce();
    expect(err).not.toHaveBeenCalled(); // handler took over

    off();
    store.setKey('n', -2);
    expect(handler).toHaveBeenCalledOnce(); // no longer called
    expect(err).toHaveBeenCalledOnce();     // console default is back
  });

  it('can reach detached actions defined beside the store (the whole point)', () => {
    const store = createStore(
      { email: 'a@b.co', emailError: '' },
      { schema: { email: z.string().email() } }
    );
    const actions = createActions(store, (s) => ({
      flagEmail: (message: string) => s.setKey('emailError', message),
    }));
    store.onSchemaError((e) => actions.flagEmail(`${String(e.key)} is invalid`));

    store.setKey('email', 'nope');
    expect(store.getKey('email')).toBe('a@b.co');
    expect(store.getKey('emailError')).toBe('email is invalid');
  });

  it('a handler write is not clobbered by the rest of the update that rejected', () => {
    const store = createStore(
      { title: 'ok', error: '' },
      { schema: { title: z.string().min(1) } }
    );
    store.onSchemaError((e) => store.setKey('error', `bad ${String(e.key)}`));

    // the same update both rejects `title` and clears `error`
    store.set({ title: '', error: '' });

    expect(store.getKey('title')).toBe('ok');
    expect(store.getKey('error')).toBe('bad title'); // survives, dispatched after the write
  });

  it('dispatches one handler call per rejected key in a multi-key update', () => {
    const store = createStore(
      { a: 1, b: 1 },
      { schema: { a: z.number().min(0), b: z.number().min(0) } }
    );
    const seen: string[] = [];
    store.onSchemaError((e) => seen.push(String(e.key)));
    store.set({ a: -1, b: -2 });
    expect(seen).toEqual(['a', 'b']);
    expect(store.get()).toEqual({ a: 1, b: 1 });
  });

  it('does not recurse when a handler writes another rejected value', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore({ n: 0 }, { schema: { n: z.number().min(0) } });
    const handler = vi.fn(() => {
      store.setKey('n', -99); // also invalid — must not re-enter the handler
    });
    store.onSchemaError(handler);

    store.setKey('n', -1);
    expect(handler).toHaveBeenCalledOnce();
    expect(store.getKey('n')).toBe(0);
  });

  it('a throwing handler is contained and the others still run', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore({ n: 0 }, { schema: { n: z.number().min(0) } });
    const second = vi.fn();
    store.onSchemaError(() => { throw new Error('boom'); });
    store.onSchemaError(second);

    store.setKey('n', -1);
    expect(second).toHaveBeenCalledOnce();
    expect(err.mock.calls[0][0]).toContain('handler threw');
  });

  it('a store in a lookup reports itself, not the parent', () => {
    const rows = createLookup((id: string) => ({ qty: 0 }), { schema: { qty: z.number().min(0) } });
    const seen: unknown[] = [];
    rows.at('a').onSchemaError((e) => seen.push(e.store));
    rows.at('a').setKey('qty', -1);
    rows.at('b').setKey('qty', -1); // no handler here → console
    expect(seen).toEqual([rows.at('a')]);
  });
});

describe('initial state is validated', () => {
  it('reports a starting value that violates its own contract', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore({ age: -5 }, { schema: { age: z.number().min(0) } });
    expect(err).toHaveBeenCalledOnce();
    expect(err.mock.calls[0][0]).toContain('initial value');
    expect(store.getKey('age')).toBe(-5); // kept, so a bad payload can't crash on import
  });

  it('commits transforms at t=0, so the store starts normalized', () => {
    const store = createStore(
      { email: '  ADA@Example.COM ' },
      { schema: { email: z.string().trim().toLowerCase() } }
    );
    expect(store.getKey('email')).toBe('ada@example.com');
  });

  it('reset() restores the transformed initial value', () => {
    const store = createStore(
      { email: '  ADA@Example.COM ' },
      { schema: { email: z.string().trim().toLowerCase() } }
    );
    store.setKey('email', 'other@mail.com');
    store.reset();
    expect(store.getKey('email')).toBe('ada@example.com');
  });

  it('validates each looked-up store as it is created', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rows = createLookup((id: string) => ({ qty: -1 }), { schema: { qty: z.number().min(0) } });
    expect(err).not.toHaveBeenCalled(); // nothing created yet
    rows.at('a');
    expect(err).toHaveBeenCalledOnce();
  });

  it('leaves a store with no schema completely alone', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore({ age: -5 });
    expect(err).not.toHaveBeenCalled();
    expect(store.getKey('age')).toBe(-5);
  });
});

describe('undefined is a value like any other', () => {
  it('every write path moves a key to undefined and notifies once', () => {
    const paths: [string, (s: any) => void][] = [
      ['setKey', (s) => s.setKey('value', undefined)],
      ['set', (s) => s.set({ value: undefined })],
      ['update', (s) => s.update('value', () => undefined)],
      ['mergeSet-sibling', (s) => s.set({ value: undefined })],
      ['batch', (s) => s.batch(() => s.setKey('value', undefined))],
    ];
    for (const [label, apply] of paths) {
      const store = createStore({ value: 'seed' as string | undefined });
      const listener = vi.fn();
      store.subscribe(['value'], listener);
      apply(store);
      expect(store.getKey('value'), label).toBeUndefined();
      expect(listener, label).toHaveBeenCalledOnce();
    }
  });

  it('reset restores a key whose initial value is undefined', () => {
    const store = createStore({ value: undefined as string | undefined });
    store.setKey('value', 'typed');
    expect(store.getKey('value')).toBe('typed');
    store.reset(['value']);
    expect(store.getKey('value')).toBeUndefined();
  });

  it('a spread that omits a key leaves it untouched and notifies nobody', () => {
    const store = createStore({ a: 1, b: 2 });
    const listener = vi.fn();
    store.subscribe(['a'], listener);
    store.subscribe(['b'], listener);
    store.set({ ...{} });
    expect(store.get()).toEqual({ a: 1, b: 2 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('a key written literally as undefined is committed', () => {
    const store = createStore({ a: 1, name: 'a' as string | undefined });
    store.set({ name: undefined });
    expect(store.getKey('name')).toBeUndefined();
    expect(store.getKey('a')).toBe(1);
  });

  it('other falsy values still commit and notify', () => {
    for (const value of ['', 0, false, null]) {
      const store = createStore({ value: 'seed' as unknown });
      const listener = vi.fn();
      store.subscribe(['value'], listener);
      store.setKey('value', value);
      expect(store.getKey('value'), String(value)).toBe(value);
      expect(listener, String(value)).toHaveBeenCalledOnce();
    }
  });

  it('writing undefined twice notifies once', () => {
    const store = createStore({ value: 'seed' as string | undefined });
    const listener = vi.fn();
    store.subscribe(['value'], listener);
    store.setKey('value', undefined);
    store.setKey('value', undefined);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('a per-key equals receives undefined on either side', () => {
    const seen: unknown[][] = [];
    const store = createStore(
      { value: 'seed' as string | undefined },
      { equals: { value: (prev, next) => { seen.push([prev, next]); return false; } } }
    );
    store.setKey('value', undefined);
    store.setKey('value', 'back');
    expect(seen).toEqual([['seed', undefined], [undefined, 'back']]);
  });

  it('does not warn when an initial value is undefined', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createStore({ data: undefined as { id: number } | undefined });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

