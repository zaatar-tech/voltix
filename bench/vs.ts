// node bench/vs.ts [scenario] [library]
// Store-engine throughput against the latest Zustand, Jotai, Valtio and nanostores. Every case runs
// in its own process so no two share JIT feedback, times its loop at its own call site, and reports
// the median of 40 runs of about 10 ms each. The README's benchmark table is this script's output.
import { execFileSync } from 'node:child_process';
import { cpus, loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';

import { batch as lBatch, observable } from '@legendapp/state';
import { batch as pBatch, effect, signal } from '@preact/signals-core';
import { atom as jAtom, createStore as jCreate } from 'jotai/vanilla';
import { atom as nAtom } from 'nanostores';
import * as solid from 'solid-js/dist/solid.js';
import { subscribeKey } from 'valtio/utils';
import { proxy } from 'valtio/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import { createStore as zCreate } from 'zustand/vanilla';

import { createStore } from '../src/index.ts';

// Solid's computations need an owner; the root lives for the case and its `createComputed` runs
// synchronously on every write, which is the counterpart of the other libraries' listeners.
const solidRoot = <T>(body: (dispose: () => void) => T): T => solid.createRoot((dispose) => body(dispose));

const N = 1000;
const K = 50;
let sink = 0;
const listener = () => {
  if (++sink === -1) throw new Error('unreachable');
};
const fresh = () => () => {
  if (++sink === -1) throw new Error('unreachable');
};

/** Median time of one operation, in ns. `run(n)` performs it n times in a loop at its own call site. */
function measure(run: (n: number) => void): number {
  const time = (n: number) => {
    const started = performance.now();
    run(n);
    return (performance.now() - started) * 1e6;
  };
  let n = 1000;
  let ns = time(n);
  while (ns < 5e6) {
    n *= 4;
    ns = time(n);
  }
  const perRun = Math.max(100, Math.round((n * 1e7) / ns));
  const runs = 40;
  const samples: number[] = [];
  for (let r = 0; r < runs; r++) samples.push(time(perRun) / perRun);
  const kept = samples.slice(runs / 4).sort((a, b) => a - b);
  return kept[kept.length >> 1];
}

const numbered = () => {
  const init: Record<string, number> = {};
  for (let i = 0; i < N; i++) init['k' + i] = 0;
  return init;
};

type Case = () => number;
type Scenario = Record<string, Case>;

const scenarios: Record<string, Scenario> = {
  'update a value + notify': {
    voltix() {
      const s = createStore({ v: 0 });
      s.subscribe(['v'], listener);
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) s.setKey('v', a++);
      });
    },
    zustand() {
      const s = zCreate(() => ({ v: 0 }));
      s.subscribe(listener);
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) s.setState({ v: a++ });
      });
    },
    nanostores() {
      const a = nAtom(0);
      a.subscribe(listener);
      let x = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) a.set(x++);
      });
    },
    'valtio (notify async)'() {
      const p = proxy({ v: 0 });
      subscribeKey(p, 'v', listener);
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) p.v = a++;
      });
    },
    jotai() {
      const store = jCreate();
      const a = jAtom(0);
      store.sub(a, listener);
      let x = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) store.set(a, x++);
      });
    },
    'preact signals'() {
      const s = signal(0);
      effect(() => {
        s.value;
        listener();
      });
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) s.value = a++;
      });
    },
    'solid signals'() {
      return solidRoot(() => {
        const [x, setX] = solid.createSignal(0);
        solid.createComputed(() => {
          x();
          listener();
        });
        let a = 0;
        return measure((n) => {
          for (let i = 0; i < n; i++) setX(a++);
        });
      });
    },
    'legend-state'() {
      const o = observable(0);
      o.onChange(listener);
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) o.set(a++);
      });
    },
  },

  'functional update (x => x + 1)': {
    voltix() {
      const s = createStore({ v: 0 });
      s.subscribe(['v'], listener);
      const inc = (x: number) => x + 1;
      return measure((n) => {
        for (let i = 0; i < n; i++) s.update('v', inc);
      });
    },
    zustand() {
      const s = zCreate(() => ({ v: 0 }));
      s.subscribe(listener);
      const inc = (st: { v: number }) => ({ v: st.v + 1 });
      return measure((n) => {
        for (let i = 0; i < n; i++) s.setState(inc);
      });
    },
    nanostores() {
      const a = nAtom(0);
      a.subscribe(listener);
      return measure((n) => {
        for (let i = 0; i < n; i++) a.set(a.get() + 1);
      });
    },
    'valtio (notify async)'() {
      const p = proxy({ v: 0 });
      subscribeKey(p, 'v', listener);
      return measure((n) => {
        for (let i = 0; i < n; i++) p.v = p.v + 1;
      });
    },
    jotai() {
      const store = jCreate();
      const a = jAtom(0);
      store.sub(a, listener);
      const inc = (x: number) => x + 1;
      return measure((n) => {
        for (let i = 0; i < n; i++) store.set(a, inc);
      });
    },
    'preact signals'() {
      const s = signal(0);
      effect(() => {
        s.value;
        listener();
      });
      return measure((n) => {
        for (let i = 0; i < n; i++) s.value = s.value + 1;
      });
    },
    'solid signals'() {
      return solidRoot(() => {
        const [x, setX] = solid.createSignal(0);
        solid.createComputed(() => {
          x();
          listener();
        });
        const inc = (v: number) => v + 1;
        return measure((n) => {
          for (let i = 0; i < n; i++) setX(inc);
        });
      });
    },
    'legend-state'() {
      const o = observable(0);
      o.onChange(listener);
      const inc = (v: number) => v + 1;
      return measure((n) => {
        for (let i = 0; i < n; i++) o.set(inc);
      });
    },
  },

  'fine-grained update (1 of 1000)': {
    voltix() {
      const s = createStore(numbered());
      for (let i = 0; i < N; i++) s.subscribe(['k' + i], listener);
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) s.setKey('k500', a++);
      });
    },
    'zustand (1000 stores)'() {
      const stores = Array.from({ length: N }, () => zCreate(() => ({ v: 0 })));
      for (const s of stores) s.subscribe(listener);
      const s = stores[500];
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) s.setState({ v: a++ });
      });
    },
    'zustand (1 store + selectors)'() {
      const init = numbered();
      const s = zCreate(subscribeWithSelector(() => ({ ...init })));
      for (let i = 0; i < N; i++) {
        const k = 'k' + i;
        s.subscribe((st: Record<string, number>) => st[k], listener);
      }
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) s.setState({ k500: a++ });
      });
    },
    nanostores() {
      const atoms = Array.from({ length: N }, () => nAtom(0));
      for (const a of atoms) a.subscribe(listener);
      const a = atoms[500];
      let x = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) a.set(x++);
      });
    },
    'valtio (per-key subscribe is O(N))'() {
      const p = proxy(numbered());
      for (let i = 0; i < N; i++) subscribeKey(p, 'k' + i, listener);
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) p.k500 = a++;
      });
    },
    jotai() {
      const store = jCreate();
      const atoms = Array.from({ length: N }, () => jAtom(0));
      for (const a of atoms) store.sub(a, listener);
      const a = atoms[500];
      let x = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) store.set(a, x++);
      });
    },
    'preact signals (1000 signals)'() {
      const signals = Array.from({ length: N }, () => signal(0));
      for (const s of signals) {
        effect(() => {
          s.value;
          listener();
        });
      }
      const s = signals[500];
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) s.value = a++;
      });
    },
    'solid signals (1000 signals)'() {
      return solidRoot(() => {
        const setters: Array<(v: number) => void> = [];
        for (let i = 0; i < N; i++) {
          const [x, setX] = solid.createSignal(0);
          solid.createComputed(() => {
            x();
            listener();
          });
          setters.push(setX);
        }
        const set = setters[500];
        let a = 0;
        return measure((n) => {
          for (let i = 0; i < n; i++) set(a++);
        });
      });
    },
    'legend-state (1000 keys)'() {
      const o = observable(numbered());
      for (let i = 0; i < N; i++) o['k' + i].onChange(listener);
      const k500 = o.k500;
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) k500.set(a++);
      });
    },
  },

  'notify 1000 subscribers': {
    voltix() {
      const s = createStore({ v: 0 });
      for (let i = 0; i < N; i++) s.subscribe(['v'], fresh());
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) s.setKey('v', a++);
      });
    },
    zustand() {
      const s = zCreate(() => ({ v: 0 }));
      for (let i = 0; i < N; i++) s.subscribe(fresh());
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) s.setState({ v: a++ });
      });
    },
    nanostores() {
      const a = nAtom(0);
      for (let i = 0; i < N; i++) a.listen(fresh());
      let x = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) a.set(x++);
      });
    },
    jotai() {
      const store = jCreate();
      const a = jAtom(0);
      for (let i = 0; i < N; i++) store.sub(a, fresh());
      let x = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) store.set(a, x++);
      });
    },
    'preact signals'() {
      const s = signal(0);
      for (let i = 0; i < N; i++) {
        const l = fresh();
        effect(() => {
          s.value;
          l();
        });
      }
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) s.value = a++;
      });
    },
    'solid signals'() {
      return solidRoot(() => {
        const [x, setX] = solid.createSignal(0);
        for (let i = 0; i < N; i++) {
          const l = fresh();
          solid.createComputed(() => {
            x();
            l();
          });
        }
        let a = 0;
        return measure((n) => {
          for (let i = 0; i < n; i++) setX(a++);
        });
      });
    },
    'legend-state'() {
      const o = observable(0);
      for (let i = 0; i < N; i++) o.onChange(fresh());
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) o.set(a++);
      });
    },
  },

  'subscribe + unsubscribe': {
    voltix() {
      const s = createStore({ v: 0 });
      return measure((n) => {
        for (let i = 0; i < n; i++) s.subscribe(['v'], listener)();
      });
    },
    zustand() {
      const s = zCreate(() => ({ v: 0 }));
      return measure((n) => {
        for (let i = 0; i < n; i++) s.subscribe(listener)();
      });
    },
    nanostores() {
      const a = nAtom(0);
      return measure((n) => {
        for (let i = 0; i < n; i++) a.listen(listener)();
      });
    },
    'valtio (subscribeKey)'() {
      const p = proxy({ v: 0 });
      return measure((n) => {
        for (let i = 0; i < n; i++) subscribeKey(p, 'v', listener)();
      });
    },
    jotai() {
      const store = jCreate();
      const a = jAtom(0);
      return measure((n) => {
        for (let i = 0; i < n; i++) store.sub(a, listener)();
      });
    },
    'preact signals (effect)'() {
      const s = signal(0);
      return measure((n) => {
        for (let i = 0; i < n; i++) {
          effect(() => {
            s.value;
          })();
        }
      });
    },
    'solid signals (root + computed)'() {
      const [x] = solid.createSignal(0);
      return measure((n) => {
        for (let i = 0; i < n; i++) {
          solid.createRoot((dispose) => {
            solid.createComputed(() => {
              x();
            });
            return dispose;
          })();
        }
      });
    },
    'legend-state'() {
      const o = observable(0);
      return measure((n) => {
        for (let i = 0; i < n; i++) o.onChange(listener)();
      });
    },
  },

  'update 50 keys as one transaction': {
    'voltix (set)'() {
      const init: Record<string, number> = {};
      for (let i = 0; i < K; i++) init['k' + i] = 0;
      const s = createStore(init);
      for (let i = 0; i < K; i++) s.subscribe(['k' + i], listener);
      const keys = Object.keys(init);
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) {
          a++;
          const u: Record<string, number> = {};
          for (let k = 0; k < K; k++) u[keys[k]] = a;
          s.set(u);
        }
      });
    },
    'voltix (batch)'() {
      const init: Record<string, number> = {};
      for (let i = 0; i < K; i++) init['k' + i] = 0;
      const s = createStore(init);
      for (let i = 0; i < K; i++) s.subscribe(['k' + i], listener);
      const keys = Object.keys(init);
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) {
          a++;
          s.batch(() => {
            for (let k = 0; k < K; k++) s.setKey(keys[k], a);
          });
        }
      });
    },
    'zustand (setState K keys)'() {
      const init: Record<string, number> = {};
      for (let i = 0; i < K; i++) init['k' + i] = 0;
      const s = zCreate(subscribeWithSelector(() => ({ ...init })));
      for (let i = 0; i < K; i++) {
        const k = 'k' + i;
        s.subscribe((st: Record<string, number>) => st[k], listener);
      }
      const keys = Object.keys(init);
      let a = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) {
          a++;
          const u: Record<string, number> = {};
          for (let k = 0; k < K; k++) u[keys[k]] = a;
          s.setState(u);
        }
      });
    },
    'nanostores (K atom sets)'() {
      const atoms = Array.from({ length: K }, () => nAtom(0));
      for (const a of atoms) a.listen(listener);
      let x = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) {
          x++;
          for (let k = 0; k < K; k++) atoms[k].set(x);
        }
      });
    },
    'jotai (K atom sets)'() {
      const store = jCreate();
      const atoms = Array.from({ length: K }, () => jAtom(0));
      for (const a of atoms) store.sub(a, listener);
      let x = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) {
          x++;
          for (let k = 0; k < K; k++) store.set(atoms[k], x);
        }
      });
    },
    'preact signals (batch)'() {
      const signals = Array.from({ length: K }, () => signal(0));
      for (const s of signals) {
        effect(() => {
          s.value;
          listener();
        });
      }
      let x = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) {
          x++;
          pBatch(() => {
            for (let k = 0; k < K; k++) signals[k].value = x;
          });
        }
      });
    },
    'solid signals (batch)'() {
      return solidRoot(() => {
        const setters: Array<(v: number) => void> = [];
        for (let i = 0; i < K; i++) {
          const [g, set] = solid.createSignal(0);
          solid.createComputed(() => {
            g();
            listener();
          });
          setters.push(set);
        }
        let x = 0;
        return measure((n) => {
          for (let i = 0; i < n; i++) {
            x++;
            solid.batch(() => {
              for (let k = 0; k < K; k++) setters[k](x);
            });
          }
        });
      });
    },
    'legend-state (batch)'() {
      const init: Record<string, number> = {};
      for (let i = 0; i < K; i++) init['k' + i] = 0;
      const o = observable(init);
      const nodes = Object.keys(init).map((k) => o[k]);
      for (const node of nodes) node.onChange(listener);
      let x = 0;
      return measure((n) => {
        for (let i = 0; i < n; i++) {
          x++;
          lBatch(() => {
            for (let k = 0; k < K; k++) nodes[k].set(x);
          });
        }
      });
    },
  },

  // Each unit is kept in an array so an engine cannot drop an allocation nobody reads.
  'create 1000 stores': {
    voltix() {
      const keep = new Array<unknown>(N);
      return measure((n) => {
        for (let i = 0; i < n; i++) for (let j = 0; j < N; j++) keep[j] = createStore({ v: 0 });
      });
    },
    zustand() {
      const keep = new Array<unknown>(N);
      return measure((n) => {
        for (let i = 0; i < n; i++) for (let j = 0; j < N; j++) keep[j] = zCreate(() => ({ v: 0 }));
      });
    },
    'nanostores (atoms)'() {
      const keep = new Array<unknown>(N);
      return measure((n) => {
        for (let i = 0; i < n; i++) for (let j = 0; j < N; j++) keep[j] = nAtom(0);
      });
    },
    'valtio (proxies)'() {
      const keep = new Array<unknown>(N);
      return measure((n) => {
        for (let i = 0; i < n; i++) for (let j = 0; j < N; j++) keep[j] = proxy({ v: 0 });
      });
    },
    'jotai (atoms)'() {
      const keep = new Array<unknown>(N);
      return measure((n) => {
        for (let i = 0; i < n; i++) for (let j = 0; j < N; j++) keep[j] = jAtom(0);
      });
    },
    'preact signals'() {
      const keep = new Array<unknown>(N);
      return measure((n) => {
        for (let i = 0; i < n; i++) for (let j = 0; j < N; j++) keep[j] = signal(0);
      });
    },
    'solid signals'() {
      const keep = new Array<unknown>(N);
      return measure((n) => {
        for (let i = 0; i < n; i++) for (let j = 0; j < N; j++) keep[j] = solid.createSignal(0);
      });
    },
    'legend-state (observables)'() {
      const keep = new Array<unknown>(N);
      return measure((n) => {
        for (let i = 0; i < n; i++) for (let j = 0; j < N; j++) keep[j] = observable(0);
      });
    },
  },
};

const ops = (ns: number): string => {
  const perSecond = 1e9 / ns;
  if (perSecond >= 1e6) return (perSecond / 1e6).toFixed(1) + 'M';
  if (perSecond >= 1e3) return Math.round(perSecond / 1e3) + 'K';
  return Math.round(perSecond).toString();
};

const [scenarioArg, libraryArg] = process.argv.slice(2);
if (scenarioArg && libraryArg) {
  const ns = scenarios[scenarioArg][libraryArg]();
  process.stdout.write(String(ns));
  process.exit(0);
}

const self = fileURLToPath(import.meta.url);
console.log(`Node ${process.versions.node}, ${cpus()[0]?.model ?? 'unknown CPU'}, load ${loadavg()[0].toFixed(1)}`);
console.log('ops/sec (higher is faster), ns per operation in parentheses; one process per case, median of 40 runs\n');
for (const [scenario, cases] of Object.entries(scenarios)) {
  if (scenarioArg && scenario !== scenarioArg) continue;
  console.log(scenario);
  for (const library of Object.keys(cases)) {
    const out = execFileSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', self, scenario, library], { encoding: 'utf8' });
    const ns = Number(out.trim());
    console.log(`  ${library.padEnd(36)} ${ops(ns).padStart(7)}   (${ns.toFixed(1)} ns)`);
  }
  console.log();
}
if (sink === -1) console.log('unreachable');
