import { useMemo, useRef, useSyncExternalStore } from 'react'

type StoreListener = () => void;

/**
 * A write interceptor. Runs before an update commits: return a partial to replace
 * the update, `false` to veto it, or nothing to pass it through unchanged.
 */
type Interceptor<T extends object> = (
  update: Partial<T>,
  state: T
) => Partial<T> | false | void;

// Replaced with a literal by consumer bundlers in production builds. Declared locally
// so the check needs no @types/node and never leaks into the emitted declarations.
declare const process: { env: Record<string, string | undefined> } | undefined;
const __DEV__ = typeof process === 'undefined' || process.env.NODE_ENV !== 'production';

/** One validation failure reported by a Standard Schema. */
export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

/** A successful Standard Schema validation: the (possibly transformed) value to use. */
export interface StandardSchemaSuccess<Output> {
  readonly value: Output;
  readonly issues?: undefined;
}

/** A failed Standard Schema validation. */
export interface StandardSchemaFailure {
  readonly issues: ReadonlyArray<StandardSchemaIssue>;
}

/**
 * The Standard Schema interface (standardschema.dev) — the common contract implemented
 * by zod (>=3.24), valibot (>=1.0), arktype (>=2.0), and others. Vendored as types only,
 * so any conforming library plugs into {@link StoreOptions.schema} with no dependency here.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown
    ) => StandardSchemaSuccess<Output> | StandardSchemaFailure | Promise<unknown>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

type SchemaProps = StandardSchemaV1<any, any>['~standard'];

function formatIssuePath(path: StandardSchemaIssue['path']): string {
  if (!path || path.length === 0) return '';
  return path.map((p) => (typeof p === 'object' && p !== null ? String(p.key) : String(p))).join('.');
}

/** A rejected write, handed to handlers registered with {@link StoreType.onSchemaError}. */
export interface SchemaError<T extends object = any> {
  /** The key whose write was vetoed. */
  readonly key: keyof T;
  /** What the schema objected to. */
  readonly issues: ReadonlyArray<StandardSchemaIssue>;
  /** The value that was rejected. */
  readonly value: unknown;
  /** The node that rejected it — for a lookup, the store at that id, not its parent. */
  readonly store: StoreType<T>;
}

// Runs a key's schema against an incoming value. Returns the (possibly transformed)
// value to commit, or VETO to drop the write for that key. Reporting is delegated to
// the owning store so a registered handler can take over from the console default.
const VETO = Symbol('veto');
function runSchema<V>(std: SchemaProps, key: string, value: V, owner: SchemaReporter): V | typeof VETO {
  let result;
  try {
    result = std.validate(value);
  } catch (error) {
    console.error(`[voltix] schema for "${key}" threw; write vetoed.`, error);
    return VETO;
  }
  if (isThenable(result)) {
    console.error(`[voltix] schema for "${key}" is async; write vetoed. Store schemas must validate synchronously.`);
    return VETO;
  }
  if (result.issues) {
    owner._reportSchemaError(key, result.issues, value, std.vendor);
    return VETO;
  }
  return result.value;
}

/** The slice of a store that {@link runSchema} needs in order to report a rejection. */
interface SchemaReporter {
  _reportSchemaError(
    key: string,
    issues: ReadonlyArray<StandardSchemaIssue>,
    value: unknown,
    vendor: string
  ): void;
}

/** A rejection queued during a write, dispatched once that write has settled. */
interface PendingSchemaError {
  key: string;
  issues: ReadonlyArray<StandardSchemaIssue>;
  value: unknown;
  vendor: string;
}

function logSchemaError(
  key: string,
  issues: ReadonlyArray<StandardSchemaIssue>,
  value: unknown,
  vendor: string,
  what: string
): void {
  if (__DEV__) {
    const lines = issues
      .map((i) => `  • ${formatIssuePath(i.path) ? formatIssuePath(i.path) + ': ' : ''}${i.message}`)
      .join('\n');
    console.error(`[voltix] ${what} "${key}" rejected by schema (${vendor}):\n${lines}\n  received:`, value);
  } else {
    console.error(`[voltix] invalid value for "${key}"`);
  }
}

/** Options for {@link createStore} / {@link createStore}. */
export interface StoreOptions<T extends object> {
  /**
   * Per-key equality, fixed at creation. When a write would change a key, its
   * function runs with (prev, next); returning `true` treats the values as equal
   * and skips the update for that key.
   */
  equals?: { [K in keyof T]?: (prev: T[K], next: T[K]) => boolean };
  /**
   * Per-key write contracts, as Standard Schemas (zod, valibot, arktype, …). A write
   * to a key runs its schema first: issues veto that key's write (with readable
   * errors in dev), and a transforming schema commits its parsed output. A schema's
   * output type must match the key's type. Keys without a schema are untouched;
   * stores without schemas skip validation entirely. Schemas are locked at creation.
   */
  schema?: { [K in keyof T]?: StandardSchemaV1<any, T[K]> };
}

/** Keys of `T` whose value is a `number`. */
type NumericKeys<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];
/** Keys of `T` whose value is a `boolean`. */
type BooleanKeys<T> = { [K in keyof T]: T[K] extends boolean ? K : never }[keyof T];

/**
 * A reactive store. The value returned by {@link createStore}. Hold it as
 * a field to compose stores (`{ store: StoreType<CartState> }`), or pass it to
 * {@link useStoreSelector} / {@link createStoreHook} to subscribe in React.
 */
export interface StoreType<T extends object> {
  /** Read the whole state (identity-stable until a `set` changes a key). */
  get(): T;
  /** Read one key. */
  getKey<K extends keyof T>(key: K): T[K];
  /** Shallow-merge a partial into state; notifies only the keys that changed. */
  set(update: Partial<T>): void;
  /** Set one key. */
  setKey<K extends keyof T>(key: K, value: T[K]): void;
  /** Set one key from its current value: `setKey(key, updater(prev))`. */
  update<K extends keyof T>(key: K, updater: (prev: T[K]) => T[K]): void;
  /** Add `amount` (default 1) to a numeric key. */
  increment(key: NumericKeys<T>, amount?: number): void;
  /** Flip a boolean key. */
  toggle(key: BooleanKeys<T>): void;
  /** Merge a partial into an object key and write the result. */
  mergeSet<K extends keyof T>(key: K, value: T[K] extends object ? Partial<T[K]> : never): void;
  /** Reset all keys (or the given keys) to the initial state. */
  reset(keys?: (keyof T)[]): void;
  /** Coalesce many sets inside `fn` into a single notification per listener. */
  batch(fn: () => void): void;
  /** Subscribe to specific keys. Returns an unsubscribe. */
  subscribe(keys: (keyof T)[], listener: () => void): () => void;
  /** Imperative snapshot of specific keys. */
  pick<K extends keyof T>(keys: K[]): Pick<T, K>;
  /**
   * Intercept writes before they commit. `fn` returns a partial to replace the
   * update, `false` to veto it, or nothing to pass through. With `keys`, it runs
   * only when the update touches one of them. Returns an unsubscribe.
   */
  intercept(fn: Interceptor<T>, keys?: (keyof T)[]): () => void;
  /** React to key changes outside React, with the new and previous values. */
  onChange<K extends keyof T>(
    keys: K[],
    callback: (values: Pick<T, K>, prev: Pick<T, K>) => void
  ): () => void;
  /**
   * Derive `outKey` from `inputs`: `compute` runs inside any `set` that changes an
   * input and commits its result in the same update, so subscribers to `outKey`
   * wake only when the derived value changes. Returns a disposer.
   */
  derive<K extends keyof T, I extends keyof T>(
    outKey: K,
    inputs: I[],
    compute: (values: Pick<T, I>) => T[K]
  ): () => void;
  /**
   * React to a write rejected by a key's schema. Registered after construction, so the
   * handler can reach the finished store and its actions. Returns an unsubscribe.
   * Handlers replace the default console reporting; the write stays vetoed either way.
   */
  onSchemaError(handler: (error: SchemaError<T>) => void): () => void;
}

/** Internal view of the store that exposes the equality registry to the hook. */
type InternalStore<T extends object> = StoreType<T> & {
  _eqReg: Record<string, ((prev: any, next: any) => boolean) | undefined> | null;
};

// Store implementation. Methods live on the prototype, shared across all instances,
// so an item store carries only its data (cheaper to create) and a call site that
// runs across many stores (a lookup) stays monomorphic rather than megamorphic.
class Voltix<T extends object> implements StoreType<T> {
  private state: T;
  private readonly _initialState: T;
  private readonly keyListeners: Record<string, Set<StoreListener> | undefined>;
  private equalityRegistry: Record<string, ((prev: any, next: any) => boolean) | undefined> | null;
  private schemaRegistry: Record<string, SchemaProps | undefined> | null;
  private schemaErrorHandlers: Set<(error: SchemaError<T>) => void> | null;
  private pendingSchemaErrors: PendingSchemaError[] | null;
  private reportingSchemaError: boolean;
  private middleware: Array<{ callback: Interceptor<T>; keys: (keyof T)[] | null }> | null;
  private batchedKeys: Set<keyof T> | null;
  /** @internal — a real constructor field (not bolted on later) so every store keeps one hidden class. */
  _children: Map<PropertyKey, AnyNode> | null;

  constructor(initialState: T, options?: StoreOptions<T>) {
    this._initialState = { ...initialState };
    this.state = { ...initialState };
    this.keyListeners = Object.create(null);
    this.equalityRegistry = null;
    this.schemaRegistry = null;
    this.schemaErrorHandlers = null;
    this.pendingSchemaErrors = null;
    this.reportingSchemaError = false;
    this.middleware = null;
    this.batchedKeys = null;
    this._children = null;

    if (options?.equals) {
      const reg: Record<string, ((prev: any, next: any) => boolean) | undefined> = Object.create(null);
      for (const key in options.equals) {
        const fn = options.equals[key as keyof T];
        if (fn) reg[key] = fn as (prev: any, next: any) => boolean;
      }
      this.equalityRegistry = reg;
    }

    if (options?.schema) {
      // The loose view sidesteps instantiating StandardSchemaV1<any, T[keyof T]>,
      // which crashes tsc 5.9 (Debug Failure in checkAssertion).
      const src = options.schema as unknown as Record<string, StandardSchemaV1 | undefined>;
      const reg: Record<string, SchemaProps | undefined> = Object.create(null);
      for (const key in src) {
        const sch = src[key];
        if (sch) reg[key] = sch['~standard'];
      }
      this.schemaRegistry = reg;

      // A contract that only holds from the second write isn't a contract: check the
      // starting values too, committing transforms so t=0 matches what a write produces.
      // No handler can exist yet, so rejections go to the console and the raw value
      // stands — a module-scope store fed by corrupt storage must not crash on import.
      const state = this.state as Record<string, unknown>;
      const initial = this._initialState as Record<string, unknown>;
      for (const key in reg) {
        const std = reg[key];
        if (!std || !(key in state)) continue;
        const value = state[key];
        let result;
        try {
          result = std.validate(value);
        } catch (error) {
          console.error(`[voltix] schema for "${key}" threw on the initial value.`, error);
          continue;
        }
        if (isThenable(result)) {
          console.error(`[voltix] schema for "${key}" is async; the initial value was not checked.`);
          continue;
        }
        if (result.issues) {
          logSchemaError(key, result.issues, value, std.vendor, 'initial value for');
          continue;
        }
        state[key] = result.value;
        initial[key] = result.value;
      }
    }

    if (__DEV__) {
      for (const key in initialState) {
        if (initialState[key] === undefined) {
          console.warn(`[voltix] initial value for "${key}" is undefined — undefined is never stored; use null to model absence.`);
        }
      }
    }
  }

  /** @internal — exposes the equality registry to the selector hook. */
  get _eqReg(): Record<string, ((prev: any, next: any) => boolean) | undefined> | null {
    return this.equalityRegistry;
  }

  get(): T {
    return this.state;
  }

  getKey<K extends keyof T>(key: K): T[K] {
    return this.state[key];
  }

  private notifyKey(key: keyof T): void {
    if (this.batchedKeys) {
      this.batchedKeys.add(key);
      return;
    }
    const listeners = this.keyListeners[key as string];
    if (listeners) for (const listener of listeners) listener();
  }

  private applySingleKey<K extends keyof T>(key: K, value: T[K]): void {
    if (value === undefined) return; // undefined is never stored — model absence with null
    const schemaReg = this.schemaRegistry;
    if (schemaReg !== null) {
      const std = schemaReg[key as string];
      if (std) {
        const out = runSchema(std, key as string, value, this);
        if (out === VETO) {
          this.flushSchemaErrors();
          return;
        }
        value = out;
      }
    }
    const prev = this.state[key];
    if (Object.is(prev, value)) return;
    const eqReg = this.equalityRegistry;
    if (eqReg !== null) {
      const eq = eqReg[key as string];
      if (eq && eq(prev, value)) return;
    }
    this.state[key] = value;
    this.notifyKey(key);
  }

  setKey<K extends keyof T>(key: K, value: T[K]): void {
    if (this.middleware === null || this.middleware.length === 0) {
      this.applySingleKey(key, value);
      return;
    }
    const partial = {} as Partial<T>;
    partial[key] = value;
    this.set(partial);
  }

  update<K extends keyof T>(key: K, updater: (prev: T[K]) => T[K]): void {
    this.setKey(key, updater(this.state[key]));
  }

  increment(key: NumericKeys<T>, amount = 1): void {
    const next = ((this.state[key] as number) + amount) as T[NumericKeys<T>];
    this.setKey(key, next);
  }

  toggle(key: BooleanKeys<T>): void {
    this.setKey(key, (!this.state[key]) as T[BooleanKeys<T>]);
  }

  mergeSet<K extends keyof T>(key: K, value: T[K] extends object ? Partial<T[K]> : never): void {
    if (this.middleware === null || this.middleware.length === 0) {
      this.applySingleKey(key, { ...this.state[key], ...value } as T[K]);
      return;
    }
    const partial = {} as Partial<T>;
    partial[key] = { ...this.state[key], ...value } as T[K];
    this.set(partial);
  }

  reset(keys?: (keyof T)[]): void {
    if (!keys) {
      this.set({ ...this._initialState });
    } else {
      const partial = {} as Partial<T>;
      for (const key of keys) {
        partial[key] = this._initialState[key];
      }
      this.set(partial);
    }
  }

  batch(fn: () => void): void {
    if (this.batchedKeys) {
      fn();
      return;
    }
    this.batchedKeys = new Set();
    try {
      fn();
    } finally {
      const keys = this.batchedKeys;
      this.batchedKeys = null;
      const notified = new Set<StoreListener>();
      for (const key of keys) {
        const listeners = this.keyListeners[key as string];
        if (!listeners) continue;
        for (const listener of listeners) {
          if (!notified.has(listener)) {
            notified.add(listener);
            listener();
          }
        }
      }
    }
  }

  set(update: Partial<T>): void {
    if (!update) return;

    const mw = this.middleware;
    if (mw === null || mw.length === 0) {
      this.applyUpdate(update);
      return;
    }

    const state = this.state;
    let currentUpdate = update;

    for (let i = 0; i < mw.length; i++) {
      const entry = mw[i];
      if (entry.keys && !entry.keys.some((key) => key in currentUpdate)) continue;
      let out: Partial<T> | false | void;
      try {
        out = entry.callback(currentUpdate, state);
      } catch (error) {
        console.error('[voltix] interceptor threw; write blocked.', error);
        return;
      }
      if (out === false) return;           // vetoed
      if (out !== undefined) currentUpdate = out; // replaced
    }

    this.applyUpdate(currentUpdate);
  }

  private applyUpdate(processedUpdate: Partial<T>): void {
    const state = this.state;
    const equalityRegistry = this.equalityRegistry;
    const schemaRegistry = this.schemaRegistry;

    // Track the first changed key inline; allocate the array only once a second
    // key actually changes, so the common single-key set stays allocation-free.
    let firstKey: string | null = null;
    let changedKeys: string[] | null = null;

    for (const key in processedUpdate) {
      const typedKey = key as keyof T;
      const prevValue = state[typedKey];
      let nextValue = processedUpdate[typedKey];
      if (nextValue === undefined) continue; // undefined is never stored — use null
      if (schemaRegistry !== null) {
        const std = schemaRegistry[key];
        if (std) {
          const out = runSchema(std, key, nextValue, this);
          if (out === VETO) continue; // this key is vetoed; the rest of the update proceeds
          nextValue = out;
        }
      }
      if (Object.is(prevValue, nextValue)) continue;
      if (equalityRegistry !== null) {
        const eq = equalityRegistry[key];
        if (eq && eq(prevValue, nextValue)) continue;
      }
      state[typedKey] = nextValue!;
      if (firstKey === null) {
        firstKey = key;
      } else {
        if (!changedKeys) changedKeys = [firstKey];
        changedKeys.push(key);
      }
    }

    // Single exit: any rejection queued above is dispatched only once this update has
    // fully applied and notified, so a handler's own writes can't be overwritten by the
    // remaining keys of the same update.
    if (firstKey !== null) {
      if (this.batchedKeys) {
        if (changedKeys) {
          for (const key of changedKeys) this.batchedKeys.add(key as keyof T);
        } else {
          this.batchedKeys.add(firstKey as keyof T);
        }
      } else {
        const keyListeners = this.keyListeners;
        if (!changedKeys) {
          const listeners = keyListeners[firstKey];
          if (listeners) for (const listener of listeners) listener();
        } else {
          const notified = new Set<StoreListener>();
          for (const key of changedKeys) {
            const listeners = keyListeners[key];
            if (!listeners) continue;
            for (const listener of listeners) {
              if (!notified.has(listener)) {
                notified.add(listener);
                listener();
              }
            }
          }
        }
      }
    }

    if (schemaRegistry !== null && this.pendingSchemaErrors !== null) this.flushSchemaErrors();
  }

  intercept(fn: Interceptor<T>, keys?: (keyof T)[]): () => void {
    const entry = { callback: fn, keys: keys ?? null };
    if (!this.middleware) this.middleware = [];
    this.middleware.push(entry);

    return () => {
      if (!this.middleware) return;
      const index = this.middleware.indexOf(entry);
      if (index > -1) {
        this.middleware.splice(index, 1);
      }
    };
  }

  subscribe(keys: (keyof T)[], listener: StoreListener): () => void {
    const keyListeners = this.keyListeners;
    for (const key of keys) {
      const k = key as string;
      if (!keyListeners[k]) keyListeners[k] = new Set();
      keyListeners[k]!.add(listener);
    }

    return () => {
      for (const key of keys) {
        keyListeners[key as string]?.delete(listener);
      }
    };
  }

  pick<K extends keyof T>(keys: K[]): Pick<T, K> {
    const result = {} as Pick<T, K>;
    const state = this.state;
    for (const key of keys) {
      result[key] = state[key];
    }
    return result;
  }

  onChange<K extends keyof T>(
    keys: K[],
    callback: (values: Pick<T, K>, prev: Pick<T, K>) => void
  ): () => void {
    const state = this.state;
    let prev = {} as Pick<T, K>;
    for (const key of keys) {
      prev[key] = state[key];
    }

    let scheduled = false;

    const listener = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        let hasChanges = false;
        for (const key of keys) {
          if (!Object.is(state[key], prev[key])) {
            hasChanges = true;
            break;
          }
        }
        if (!hasChanges) return;
        const next = {} as Pick<T, K>;
        for (const key of keys) {
          next[key] = state[key];
        }
        const snapshot = prev;
        prev = next;
        callback(next, snapshot);
      });
    };

    return this.subscribe(keys, listener);
  }

  derive<K extends keyof T, I extends keyof T>(
    outKey: K,
    inputs: I[],
    compute: (values: Pick<T, I>) => T[K]
  ): () => void {
    const state = this.state;
    const readInputs = (update?: Partial<T>): Pick<T, I> => {
      const values = {} as Pick<T, I>;
      for (const key of inputs) {
        values[key] = update && key in update ? (update[key] as T[I]) : state[key];
      }
      return values;
    };

    this.applySingleKey(outKey, compute(readInputs()));

    return this.intercept(
      (update) => ({ ...update, [outKey]: compute(readInputs(update)) }),
      inputs as (keyof T)[]
    );
  }

  onSchemaError(handler: (error: SchemaError<T>) => void): () => void {
    let handlers = this.schemaErrorHandlers;
    if (handlers === null) {
      handlers = new Set();
      this.schemaErrorHandlers = handlers;
    }
    handlers.add(handler);
    return () => {
      handlers!.delete(handler);
    };
  }

  /**
   * @internal — called by the schema runner when a key's write is vetoed. The rejection is
   * queued rather than dispatched: a handler that writes to the store must not be clobbered
   * by the remaining keys of the very update that rejected it.
   */
  _reportSchemaError(
    key: string,
    issues: ReadonlyArray<StandardSchemaIssue>,
    value: unknown,
    vendor: string
  ): void {
    const entry: PendingSchemaError = { key, issues, value, vendor };
    if (this.pendingSchemaErrors === null) this.pendingSchemaErrors = [entry];
    else this.pendingSchemaErrors.push(entry);
  }

  /** Dispatch queued rejections. Called once the triggering write has fully settled. */
  private flushSchemaErrors(): void {
    const pending = this.pendingSchemaErrors;
    if (pending === null) return;
    this.pendingSchemaErrors = null;

    const handlers = this.schemaErrorHandlers;
    // A handler that writes another rejected value would re-enter here forever; while one
    // is running, fall back to the console instead of dispatching again.
    if (handlers === null || handlers.size === 0 || this.reportingSchemaError) {
      for (const e of pending) logSchemaError(e.key, e.issues, e.value, e.vendor, 'write to');
      return;
    }
    this.reportingSchemaError = true;
    try {
      for (const e of pending) {
        const error: SchemaError<T> = {
          key: e.key as keyof T,
          issues: e.issues,
          value: e.value,
          store: this,
        };
        for (const handler of handlers) {
          try {
            handler(error);
          } catch (thrown) {
            console.error('[voltix] onSchemaError handler threw:', thrown);
          }
        }
      }
    } finally {
      this.reportingSchemaError = false;
    }
  }
}

/**
 * Brand marking a value as a navigable node — a {@link Store} or a {@link Lookup} — so a
 * parent `createStore` can tell a nested store from ordinary object state.
 */
const NODE = Symbol('voltix.node');

/** Type-level brand: any value that is a store or a lookup. */
type NodeBrand = { readonly [NODE]: 'store' | 'lookup' };
/** Runtime node: the brand plus one navigation step. */
interface AnyNode extends NodeBrand {
  _step(key: PropertyKey): AnyNode;
}

const isNode = (v: unknown): v is AnyNode =>
  typeof v === 'object' && v !== null && (v as { [NODE]?: unknown })[NODE] !== undefined;

/** Keys of `T` whose value is a nested store or lookup. */
type ChildKey<T> = { [K in keyof T]-?: NonNullable<T[K]> extends NodeBrand ? K : never }[keyof T];
/** Keys of `T` that hold ordinary reactive state. */
type LeafKey<T> = Exclude<keyof T, ChildKey<T>>;
/** The flat reactive state of a composed store (its non-node keys). */
type LeafState<T> = { [K in LeafKey<T>]: T[K] };

/**
 * A store that may hold other nodes. Ordinary keys are reactive leaves driven by the fast
 * mutate-in-place engine; a key whose value is another {@link Store} or {@link Lookup} is a
 * child, reached with {@link Store.select}. Build one with {@link createStore}.
 */
export interface Store<T extends object> extends StoreType<LeafState<T>> {
  readonly [NODE]: 'store';
  /** One structural step: the child node bound at `key` (a nested store or lookup). */
  select<K extends ChildKey<T>>(key: K): T[K];
  /** Names of this store's child keys. */
  children(): ChildKey<T>[];
}

/**
 * A map from id to store, populated lazily: the first {@link Lookup.at} for an id builds the
 * store via the factory passed to {@link createLookup} and memoizes it. `S` is that store's
 * type — exactly what the factory returns when it builds the store itself, or `Store<C>`
 * when it returns a plain state shape.
 */
export interface Lookup<Id extends PropertyKey, S extends object> {
  readonly [NODE]: 'lookup';
  /** The store at `id`, created on first access and memoized. Takes exactly one id. */
  at(id: Id): S;
  /** Whether a store for `id` currently exists. */
  has(id: Id): boolean;
  /** Drop the store at `id`. Returns whether it existed. */
  remove(id: Id): boolean;
  /** Live ids (insertion order). */
  keys(): Id[];
  /** Number of live stores. */
  size(): number;
  /** Drop every store. */
  clear(): void;
}

// Navigation lives on the store prototype so every store shares it at zero per-instance cost,
// and the leaf read/write path is left exactly as it was.
interface NavStore {
  [NODE]: 'store';
  _children: Map<PropertyKey, AnyNode> | null;
  _step(key: PropertyKey): AnyNode;
  select(key: PropertyKey): AnyNode;
  children(): PropertyKey[];
}
const storeProto = Voltix.prototype as unknown as NavStore;
storeProto[NODE] = 'store';
storeProto._step = function (this: NavStore, key: PropertyKey): AnyNode {
  const child = this._children ? this._children.get(key) : undefined;
  if (child === undefined) throw new RangeError(`no child "${String(key)}"`);
  return child;
};
storeProto.select = function (this: NavStore, key: PropertyKey): AnyNode {
  return this._step(key);
};
storeProto.children = function (this: NavStore): PropertyKey[] {
  return this._children ? [...this._children.keys()] : [];
};

class StoreLookupImpl<Id extends PropertyKey, C extends object> {
  readonly [NODE] = 'lookup' as const;
  private readonly stores = new Map<PropertyKey, AnyNode>();
  private warnedNodeOptions = false;
  constructor(
    private readonly factory: (id: Id) => C,
    private readonly options?: StoreOptions<any>
  ) {}
  _step(key: PropertyKey): AnyNode {
    let store = this.stores.get(key);
    if (store === undefined) {
      // A factory may build the store itself (schema, actions, handlers decided
      // bottom-up); the lookup then memoizes that exact node. Only a plain shape
      // is wrapped in a new store here.
      const produced: unknown = this.factory(key as Id);
      if (isNode(produced)) {
        if (__DEV__ && this.options !== undefined && !this.warnedNodeOptions) {
          this.warnedNodeOptions = true;
          console.warn(
            '[voltix] lookup factory returned a built store; lookup options are ignored for it — configure the store inside the factory.'
          );
        }
        store = produced;
      } else {
        store = createStore(produced as object, this.options) as unknown as AnyNode;
      }
      this.stores.set(key, store);
    }
    return store;
  }
  at(id: Id): AnyNode {
    return this._step(id);
  }
  has(id: Id): boolean {
    return this.stores.has(id);
  }
  remove(id: Id): boolean {
    return this.stores.delete(id);
  }
  keys(): Id[] {
    return [...this.stores.keys()] as Id[];
  }
  size(): number {
    return this.stores.size;
  }
  clear(): void {
    this.stores.clear();
  }
}

/**
 * Create a store from a state object. Ordinary keys are fast reactive leaves; a key whose
 * value is another store or {@link Lookup} becomes a child, reached with `.select(key)`.
 * The tree is wired once at creation; leaf reads and writes never traverse it, so update
 * and notify throughput are unchanged.
 *
 * @example
 * ```ts
 * const settings = createStore({ theme: 'dark', fontSize: 14 });
 * const workspace = createStore({ name: 'Personal', settings });
 * workspace.setKey('name', 'Team');
 * workspace.select('settings').setKey('fontSize', 16);
 * ```
 */
export function createStore<T extends object>(
  shape: T & { readonly [NODE]?: never },
  options?: StoreOptions<LeafState<T>>
): Store<T>;
export function createStore(
  shape: object,
  options?: object
): unknown {
  if (typeof shape === 'function') {
    throw new TypeError(
      '[voltix] createStore() was given a function. For a store per id, pass the factory to createLookup().'
    );
  }

  if (isNode(shape)) {
    throw new TypeError(
      '[voltix] createStore() was given a store or lookup as the shape. Pass a plain state object, or bind the node under a key: createStore({ child: node }).'
    );
  }

  const source = shape as Record<string, unknown>;
  let leaves: Record<string, unknown> = source;
  let children: Map<PropertyKey, AnyNode> | null = null;
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (isNode(value)) {
      if (children === null) {
        children = new Map();
        leaves = { ...source };
      }
      children.set(key, value);
      delete leaves[key];
    }
  }

  const store = new Voltix(leaves, options as StoreOptions<Record<string, unknown>> | undefined) as unknown as NavStore;
  store._children = children;
  return store;
}

/**
 * Create a {@link Lookup}: a map from id to store, populated lazily by `factory`.
 *
 * - `createLookup((id) => makeDocument(id))` — the factory builds each store itself
 *   (schema, actions, error handlers already attached); the lookup memoizes exactly
 *   that node.
 * - `createLookup((id) => ({ ... }), options?)` — the factory returns a plain state
 *   shape; the lookup builds a store per id, applying `options` to each one.
 *
 * @example
 * ```ts
 * const documents = createLookup((id: string) => ({ title: 'Untitled', body: '' }));
 * documents.at('readme').setKey('title', 'README');
 * documents.keys(); // ['readme']
 * ```
 */
export function createLookup<Id extends PropertyKey, N extends NodeBrand>(
  factory: (id: Id) => N
): Lookup<Id, N>;
export function createLookup<Id extends PropertyKey, C extends object>(
  factory: (id: Id) => C & { readonly [NODE]?: never },
  options?: StoreOptions<LeafState<C>>
): Lookup<Id, Store<C>>;
export function createLookup(
  factory: (id: PropertyKey) => object,
  options?: object
): unknown {
  return new StoreLookupImpl(factory, options as StoreOptions<any> | undefined);
}

/**
 * Define a set of actions for a store (or any node) and get them back as a plain,
 * standalone object — the store itself is not modified. `define` receives the node,
 * so actions close over it with full inference; since it takes any node, actions can
 * reach across a composed tree with `select(key)` / `at(id)`.
 *
 * Actions are ordinary functions: export them beside the store, and combine sets
 * with object spread when you want them split across files.
 *
 * @example
 * ```ts
 * const counter = createStore({ count: 0 });
 * const counterActions = createActions(counter, (store) => ({
 *   increment: () => store.increment('count'),
 *   reset: () => store.reset(['count']),
 * }));
 * counterActions.increment();
 * ```
 */
export function createActions<S extends object, A extends object>(
  store: S,
  define: (store: S) => A
): A {
  return define(store);
}

type PrimitiveKey<T extends object> = keyof T;
type CompareFn<V> = (prev: V, next: V) => boolean;

type KeySelector<T extends object> = PrimitiveKey<T>;
type CustomSelector<T extends object> = { [K in keyof T]?: CompareFn<T[K]> };
type SelectorInput<T extends object> = ReadonlyArray<KeySelector<T> | CustomSelector<T>>;

type ExtractSelectorKeys<T extends object, S extends SelectorInput<T>> = {
  [K in S[number] extends infer Item
  ? Item extends keyof T
  ? Item
  : keyof Item
  : never]: T[K];
};

type Picked<T extends object, S extends SelectorInput<T>> = ExtractSelectorKeys<T, S>;

type NormalizedSelector<T extends object> = {
  key: keyof T;
  compare?: CompareFn<T[keyof T]>;
};

function shallowEqualSelector<T extends object>(
  a: SelectorInput<T>,
  b: SelectorInput<T>
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * React hook that subscribes to specific keys in a store with fine-grained re-renders.
 * Only re-renders when the selected keys actually change (using Object.is comparison).
 * 
 * @param store - The store created with createStore
 * @param selector - Array of keys to subscribe to, or objects with custom compare functions
 * @returns Selected state values from the store
 * 
 * @example
 * ```ts
 * // Subscribe to specific keys
 * const { count, name } = useStoreSelector(store, ['count', 'name']);
 * 
 * // Custom comparison for complex objects
 * const { tasks } = useStoreSelector(store, [
 *   { tasks: (prev, next) => prev.length === next.length }
 * ]);
 * ```
 */
export function useStoreSelector<T extends object, S extends SelectorInput<T>>(
  store: StoreType<T>,
  selector: S
): Picked<T, S> {
  const ref = useRef({
    store,
    lastSelected: {} as Partial<T>,
    prevSelector: null as SelectorInput<T> | null,
    normalized: null as NormalizedSelector<T>[] | null,
    keys: null as (keyof T)[] | null,
    isFirstRun: true,
    lastValues: {} as Partial<T>,
    subscribe: null as ((onStoreChange: () => void) => () => void) | null,
    getSnapshot: null as (() => Picked<T, S>) | null,
    serverValue: null as Picked<T, S> | null,
    getServerSnapshot: null as (() => Picked<T, S>) | null,
  });

  const r = ref.current;
  const storeChanged = r.store !== store;
  if (storeChanged) {
    r.store = store;
    r.lastSelected = {};
    r.prevSelector = null;
    r.normalized = null;
    r.keys = null;
    r.isFirstRun = true;
    r.lastValues = {};
    r.subscribe = null;
    r.getSnapshot = null;
    r.serverValue = null;
    r.getServerSnapshot = null;
  }

  // Normalize keys/compares once per selector identity.
  if (!r.prevSelector || !shallowEqualSelector(r.prevSelector, selector)) {
    const normalized: NormalizedSelector<T>[] = [];
    const keys: (keyof T)[] = [];

    for (const item of selector) {
      if (typeof item === 'string') {
        const key = item as keyof T;
        normalized.push({ key });
        keys.push(key);
      } else {
        const customSelector = item as CustomSelector<T>;
        for (const key in customSelector) {
          const compare = customSelector[key as keyof typeof customSelector];
          const typedKey = key as keyof T;
          normalized.push({ key: typedKey, compare: compare as CompareFn<T[keyof T]> });
          keys.push(typedKey);
        }
      }
    }

    r.normalized = normalized;
    r.keys = keys;
    r.prevSelector = selector;
    r.subscribe = null;
    r.serverValue = null;
  }

  // Build subscribe/getSnapshot once per store — stable identity across renders.
  if (!r.subscribe) {
    r.subscribe = (onStoreChange: () => void) => store.subscribe(r.keys!, onStoreChange);
  }
  if (!r.getSnapshot) {
    const eqReg = (store as InternalStore<T>)._eqReg;
    r.getSnapshot = (): Picked<T, S> => {
      const normalized = r.normalized!;
      const current = store.get();

      if (r.isFirstRun) {
        r.isFirstRun = false;
        const result = {} as Partial<T>;
        for (const { key } of normalized) {
          const value = current[key];
          r.lastValues[key] = value;
          result[key] = value;
        }
        r.lastSelected = result;
        return result as Picked<T, S>;
      }

      // Single pass — lazy allocation on first change
      let result: Partial<T> | null = null;
      for (let i = 0; i < normalized.length; i++) {
        const { key, compare } = normalized[i];
        const prevVal = r.lastValues[key]!;
        const nextVal = current[key];
        if (!Object.is(prevVal, nextVal)) {
          const cmp = compare || (eqReg !== null ? eqReg[key as string] : undefined);
          if (!cmp || !cmp(prevVal, nextVal)) {
            if (!result) {
              result = {} as Partial<T>;
              for (let j = 0; j < i; j++) result[normalized[j].key] = r.lastValues[normalized[j].key];
            }
            r.lastValues[key] = nextVal;
            result[key] = nextVal;
            continue;
          }
        }
        if (result) result[key] = prevVal;
      }

      if (!result) return r.lastSelected as Picked<T, S>;

      r.lastSelected = result;
      return result as Picked<T, S>;
    };
  }

  // Server snapshot: a cached value (must be referentially stable across calls),
  // rebuilt only when the selected keys or the store change.
  if (!r.serverValue) {
    const current = store.get();
    const result = {} as Partial<T>;
    for (const key of r.keys ?? []) {
      result[key] = current[key];
    }
    r.serverValue = result as Picked<T, S>;
  }
  if (!r.getServerSnapshot) {
    r.getServerSnapshot = () => r.serverValue!;
  }

  return useSyncExternalStore(r.subscribe, r.getSnapshot, r.getServerSnapshot);
}

/**
 * React hook that subscribes to a single key and returns its value directly —
 * the lean path for the common one-key case. Re-renders only when that key
 * changes (Object.is, plus any store-level equality from options.equals).
 * No wrapper object is allocated.
 *
 * @example
 * ```ts
 * const count = useStoreKey(store, 'count');
 * ```
 */
export function useStoreKey<T extends object, K extends keyof T>(
  store: StoreType<T>,
  key: K
): T[K] {
  const [subscribe, getSnapshot] = useMemo(() => {
    const sub = (onStoreChange: () => void) => store.subscribe([key], onStoreChange);
    const get = () => store.getKey(key);
    return [sub, get] as const;
  }, [store, key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Creates a pre-bound selector hook for a specific store instance.
 * Infers the state type from the store — no manual generics needed.
 * 
 * @param store - The store created with createStore
 * @returns A React hook with the same API as useStoreSelector, but with the store already bound
 * 
 * @example
 * ```ts
 * const useWorkspace = createStoreHook(workspace);
 * 
 * // In a component:
 * const { name, syncing } = useWorkspace(['name', 'syncing']);
 * ```
 */
export function createStoreHook<T extends object>(store: StoreType<T>) {
  return function useStore<S extends SelectorInput<T>>(selector: S): Picked<T, S> {
    return useStoreSelector(store, selector);
  };
}

/**
 * Shallow-merge helper: `{ ...base, ...patch }`, typed so the patch can only
 * carry keys of the base. A plain function on plain data — pair it with a write
 * when you want the result stored: `store.setKey('user', merge(user, patch))`,
 * or reach for {@link StoreType.mergeSet} which does both in one call.
 */
export function merge<T extends object>(base: T, patch: Partial<T>): T {
  return { ...base, ...patch };
}

/**
 * Interface for synchronous storage (localStorage, sessionStorage, etc.).
 */
export interface StorageSupportingInterface {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Interface for asynchronous storage (React Native AsyncStorage, etc.).
 */
export interface AsyncStorageSupportingInterface {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

type AnyStorage = Storage | StorageSupportingInterface | AsyncStorageSupportingInterface;

function isThenable(value: unknown): value is Promise<unknown> {
  return value != null && typeof (value as any).then === 'function';
}

// Persisted values are wrapped in a tagged form so types JSON can't represent
// (Date, Map, Set, non-finite numbers) survive the round-trip. Plain untagged
// JSON still decodes as itself, so hand-written entries are read fine.
const PERSIST_TAG = '$$voltix';

function encodePersistedValue(value: unknown): unknown {
  if (value instanceof Date) return { [PERSIST_TAG]: 'date', v: value.getTime() };
  if (value instanceof Map) {
    return { [PERSIST_TAG]: 'map', v: Array.from(value, ([k, v]) => [encodePersistedValue(k), encodePersistedValue(v)]) };
  }
  if (value instanceof Set) return { [PERSIST_TAG]: 'set', v: Array.from(value, encodePersistedValue) };
  if (typeof value === 'number' && !Number.isFinite(value)) return { [PERSIST_TAG]: 'num', v: String(value) };
  if (Array.isArray(value)) return value.map(encodePersistedValue);
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value)) {
        const entry = (value as Record<string, unknown>)[key];
        if (entry !== undefined) out[key] = encodePersistedValue(entry);
      }
      // a user object that happens to carry the tag key is escaped, not revived
      return PERSIST_TAG in (value as object) ? { [PERSIST_TAG]: 'obj', v: out } : out;
    }
  }
  return value;
}

function decodePersistedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodePersistedValue);
  if (value !== null && typeof value === 'object') {
    const tag = (value as Record<string, unknown>)[PERSIST_TAG];
    if (typeof tag === 'string') {
      const v = (value as Record<string, unknown>).v;
      switch (tag) {
        case 'date': return new Date(v as number);
        case 'map': return new Map((v as [unknown, unknown][]).map(([k, val]) => [decodePersistedValue(k), decodePersistedValue(val)]));
        case 'set': return new Set((v as unknown[]).map(decodePersistedValue));
        case 'num': return Number(v);
        case 'obj': return decodePersistedValue(v);
      }
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      out[key] = decodePersistedValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Serialization used by {@link persist} and {@link loadPersistedState}.
 * Any object with `stringify`/`parse` fits — `JSON` and superjson both do.
 * Use the same parser on both sides.
 */
export interface PersistParser {
  stringify(value: any): string;
  parse(text: string): any;
}

const defaultPersistParser: PersistParser = {
  stringify: (value) => JSON.stringify(encodePersistedValue(value)),
  parse: (text) => decodePersistedValue(JSON.parse(text)),
};

/**
 * Persist selected keys of a store: each key is written to storage as it changes,
 * under `${persistKey}:${keyName}`. Works with synchronous storage (localStorage,
 * sessionStorage) and asynchronous storage (React Native AsyncStorage) — async
 * writes are fire-and-forget, so a slow write never blocks the state update.
 * Returns an unsubscribe that stops persisting.
 *
 * Seed the initial state with {@link loadPersistedState}, which reads the same keys.
 *
 * @example
 * ```ts
 * const persisted = loadPersistedState<State>(localStorage, 'myapp', ['theme']);
 * const store = createStore<State>({ theme: 'light', ...persisted });
 * persist(store, localStorage, 'myapp', ['theme']);
 * ```
 */
export function persist<T extends object>(
  store: StoreType<T>,
  storage: AnyStorage,
  persistKey: string,
  keys: (keyof T)[],
  parser: PersistParser = defaultPersistParser
): () => void {
  return store.intercept((update) => {
    for (const key of keys) {
      if (!(key in update)) continue;
      try {
        const storageKey = `${persistKey}:${String(key)}`;
        const result = storage.setItem(storageKey, parser.stringify(update[key]));
        if (isThenable(result)) {
          result.catch((error) => {
            console.warn(`Failed to persist key ${String(key)}:`, error);
          });
        }
      } catch (error) {
        console.warn(`Failed to persist key ${String(key)}:`, error);
      }
    }
  }, keys);
}

/**
 * Loads persisted state from individual key storage during store initialization.
 * Reads keys saved by {@link persist} and returns them as partial state.
 * 
 * Returns synchronously for sync storage and a Promise for async storage.
 * 
 * @param storage - Storage interface to read from (same as passed to persist)
 * @param persistKey - Base key prefix used for storage (same as passed to persist)
 * @param keys - Array of keys to restore (should match the persisted keys)
 * @returns Partial state object (sync) or Promise of partial state (async)
 * 
 * @example
 * ```ts
 * // Sync — localStorage
 * const persisted = loadPersistedState(localStorage, 'myapp', ['theme']);
 * const store = createStore({ theme: 'light', ...persisted });
 * 
 * // Async — React Native AsyncStorage
 * const persisted = await loadPersistedState(AsyncStorage, 'myapp', ['theme']);
 * const store = createStore({ theme: 'light', ...persisted });
 * ```
 */
export function loadPersistedState<T extends object>(
  storage: Storage | StorageSupportingInterface,
  persistKey: string,
  keys: (keyof T)[],
  parser?: PersistParser
): Partial<T>;
export function loadPersistedState<T extends object>(
  storage: AsyncStorageSupportingInterface,
  persistKey: string,
  keys: (keyof T)[],
  parser?: PersistParser
): Promise<Partial<T>>;
export function loadPersistedState<T extends object>(
  storage: AnyStorage,
  persistKey: string,
  keys: (keyof T)[],
  parser: PersistParser = defaultPersistParser
): Partial<T> | Promise<Partial<T>> {
  const result: Partial<T> = {};
  const pending: Promise<void>[] = [];

  for (const key of keys) {
    const storageKey = `${persistKey}:${String(key)}`;
    try {
      const stored = storage.getItem(storageKey);
      if (isThenable(stored)) {
        pending.push(
          stored.then(value => {
            if (value !== null) result[key] = parser.parse(value as string) as T[keyof T];
          }).catch(error => {
            console.warn(`Failed to load persisted key ${String(key)}:`, error);
          })
        );
      } else if (stored !== null) {
        result[key] = parser.parse(stored as string) as T[keyof T];
      }
    } catch (error) {
      console.warn(`Failed to load persisted key ${String(key)}:`, error);
    }
  }

  if (pending.length > 0) {
    return Promise.all(pending).then(() => result);
  }

  return result;
}