import { useEffect, useRef, useState } from 'react';
import { createStore } from '@zaatar-tech/voltix';
import { createStore as zCreate } from 'zustand/vanilla';
import { atom as jAtom, createStore as jCreate } from 'jotai/vanilla';
import { proxy, subscribe as vSubscribe } from 'valtio/vanilla';
import { atom as nAtom } from 'nanostores';
import { hl } from '../hl';

type Runner = { key: string; run: (deadline: number, batch: number) => number; sink: () => number };

// Each runner drives its own store's update path (with a subscriber attached) as
// fast as it can for a fixed time slice. The count is real updates completed.
function makeRunners(): Runner[] {
  // Goal: every write stays observed. A JIT is free to delete one that isn't,
  // and the simplest write path is the easiest to delete, which would flatter
  // the wrong libraries. `seen` is read after each run.
  let seen = 0;
  const tally = () => { seen++; };

  const vs = createStore({ n: 0 }); vs.subscribe(['n'], tally); let vx = 0;
  const zs = zCreate<{ n: number }>(() => ({ n: 0 })); zs.subscribe(tally); let zx = 0;
  const js = jCreate(); const ja = jAtom(0); js.sub(ja, tally); let jx = 0;
  const vp = proxy({ n: 0 }); vSubscribe(vp, tally); let px = 0;
  const na = nAtom(0); na.listen(tally); let nx = 0;

  // Goal: the clock check costs every library the same share of its slice. The
  // caller sizes the batch by time (see TARGET_S) rather than op count, since a
  // fixed count is ~2µs of work for the fastest store and ~100µs for the slowest.
  // It comes from the measured rate because timing a batch here would read 0 on
  // Safari's 1ms clock.
  const slice = (fn: () => void) => (deadline: number, batch: number) => {
    let c = 0;
    do { for (let k = 0; k < batch; k++) fn(); c += batch; } while (performance.now() < deadline);
    return c;
  };

  return [
    { key: 'Voltix', run: slice(() => vs.setKey('n', ++vx)), sink: () => seen + vs.getKey('n') },
    { key: 'Zustand', run: slice(() => zs.setState({ n: ++zx })), sink: () => seen + zs.getState().n },
    { key: 'Jotai', run: slice(() => js.set(ja, ++jx)), sink: () => seen + js.get(ja) },
    { key: 'Valtio', run: slice(() => { vp.n = ++px; }), sink: () => seen + vp.n },
    { key: 'nanostores', run: slice(() => na.set(++nx)), sink: () => seen + na.get() },
  ];
}

const SOURCE = `import { createStore } from '@zaatar-tech/voltix';
import { createStore as zustand } from 'zustand/vanilla';
import { atom, createStore as jotai } from 'jotai/vanilla';
import { proxy } from 'valtio/vanilla';
import { atom as nano } from 'nanostores';

// Goal: every write has to be observed. A JIT is free to delete one
// that isn't, and the simplest write path is the easiest to delete.
let seen = 0;
const tally = () => { seen++; };

// one store per library, each with a subscriber attached
const v = createStore({ n: 0 }); v.subscribe(['n'], tally);
const z = zustand(() => ({ n: 0 })); z.subscribe(tally);
const j = jotai(); const a = atom(0); j.sub(a, tally);
const p = proxy({ n: 0 });
const s = nano(0); s.listen(tally);

let i = 0;
const update = {
  voltix:     () => v.setKey('n', ++i),
  zustand:    () => z.setState({ n: ++i }),
  jotai:      () => j.set(a, ++i),
  valtio:     () => { p.n = ++i; },
  nanostores: () => s.set(++i),
};

function measure(run, ms, batch) {
  const t0 = performance.now();
  let ops = 0;
  do { for (let k = 0; k < batch; k++) run(); ops += batch; }
  while (performance.now() < t0 + ms);
  // the loop overruns ms by up to one batch, so report real elapsed
  return { ops, elapsed: performance.now() - t0 };
}

// Goal: one clock check per ~120us of work, so it costs every
// library the same share of its slice. The size comes from the last
// measured rate; timing a batch directly reads 0 on Safari's 1ms clock.
let batch = 256;
function tick(run) {
  const { ops, elapsed } = measure(run, 1.2, batch);
  const rate = ops / (elapsed / 1000); // updates per second
  batch = Math.max(64, Math.round(rate * 120e-6));
  return rate;
}`;

// Magnitude and unit split into their own columns so decimals and the M/s·K/s
// suffixes line up instead of staggering with each row's string length.
const fmtParts = (n: number): [string, string] =>
  n >= 1e6 ? [(n / 1e6).toFixed(1), 'M/s']
  : n >= 1e3 ? [(n / 1e3).toFixed(0), 'K/s']
  : [String(Math.round(n)), '/s'];

export default function LiveRace() {
  const runnersRef = useRef<Runner[] | null>(null);
  if (!runnersRef.current) runnersRef.current = makeRunners();
  const runners = runnersRef.current;
  // Smooth ops and elapsed separately, then divide: a rate is a ratio of sums, so
  // one noisy slice can't spike it.
  const opsRef = useRef<number[]>(runners.map(() => 0));
  const timeRef = useRef<number[]>(runners.map(() => 0));
  const batchRef = useRef<number[]>(runners.map(() => 256));
  const warmedRef = useRef(false);

  const sinkRef = useRef(0);
  const [rows, setRows] = useState(() => runners.map((r) => ({ key: r.key, ops: 0 })));
  const [running, setRunning] = useState(true);
  const [tab, setTab] = useState<'demo' | 'source'>('demo');

  useEffect(() => {
    if (!running || tab !== 'demo') return;
    let raf = 0;
    const SLICE = 1.2;         // ms per library per frame
    const TAU = 1500;          // ms; sliding-rate window. Per-slice noise is ~±10%
                               // whatever the harness does, so the window is what
                               // decides how much the shown number jumps: 500ms
                               // reads ±13%, 1500ms ±4%, and wider than that starts
                               // dragging in stale samples.
    const REJECT = SLICE * 3;  // >3.6ms means the OS stole the thread mid-slice; drop
                               // it. The 3x margin clears 1ms timer coarsening.
    const ops = opsRef.current;
    const time = timeRef.current;
    const batch = batchRef.current;
    const TARGET_S = 120e-6; // work per batch, in seconds

    // Warm to steady-state JIT once, so the first number is optimized code rather
    // than a cold-compile ramp. Same budget each.
    if (!warmedRef.current) {
      for (let i = 0; i < runners.length; i++) runners[i].run(performance.now() + 50, batch[i]);
      warmedRef.current = true;
    }

    let last = performance.now();
    const loop = () => {
      // Decay by real elapsed time, so the window stays ~0.5s at any frame rate.
      // Read the clock here, not the rAF timestamp: a different time origin would
      // make dt negative and poison the accumulators. Clamp dt >= 0.
      const now = performance.now();
      const dt = Math.max(0, now - last);
      last = now;
      const decay = Math.exp(-dt / TAU);
      for (let i = 0; i < runners.length; i++) {
        const t0 = performance.now();
        const c = runners[i].run(t0 + SLICE, batch[i]);
        const el = performance.now() - t0;
        sinkRef.current += runners[i].sink();
        // Clean slices only; `time === 0` primes the first sample so a slow start
        // can't leave the row at zero.
        if (el > 0 && (el <= REJECT || time[i] === 0)) {
          ops[i] = ops[i] * decay + c;
          time[i] = time[i] * decay + el;
          const rate = ops[i] / (time[i] / 1000);
          batch[i] = Math.max(64, Math.min(1 << 20, Math.round(rate * TARGET_S)));
        }
      }
      setRows(runners.map((r, i) => ({ key: r.key, ops: time[i] > 0 ? ops[i] / (time[i] / 1000) : 0 })));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, tab, runners]);

  const max = Math.max(...rows.map((r) => r.ops), 1);
  const leaderKey = rows.reduce((a, b) => (b.ops > a.ops ? b : a), rows[0]).key;

  return (
    <div className="race">
      <div className="race-head">
        <span className="rt">Live update throughput</span>
        <div className="race-controls">
          {tab === 'demo' && (
            <button className="pausebtn" onClick={() => setRunning((r) => !r)}>
              {running ? 'Pause' : 'Run'}
            </button>
          )}
          <div className="race-tabs">
            <button className={tab === 'demo' ? 'active' : ''} onClick={() => setTab('demo')}>Demo</button>
            <button className={tab === 'source' ? 'active' : ''} onClick={() => setTab('source')}>
              <span className="gl">{'</>'}</span> Source
            </button>
          </div>
        </div>
      </div>

      {tab === 'demo' ? (
        <>
          {rows.map((r) => {
            const [num, unit] = fmtParts(r.ops);
            return (
              <div className={'row' + (r.key === leaderKey ? ' leader' : '')} key={r.key}>
                <span className="lib"><span className="dot" />{r.key}</span>
                <span className="bar"><span style={{ width: ((r.ops / max) * 100).toFixed(1) + '%' }} /></span>
                <span className="val"><span className="num">{num}</span><span className="unit">{unit}</span></span>
              </div>
            );
          })}
          <p className="note">
            Same increment, 1.2&nbsp;ms per store per frame, counted as updates per second.
          </p>
        </>
      ) : (
        <div className="race-source">
          <pre><code dangerouslySetInnerHTML={{ __html: hl(SOURCE) }} /></pre>
        </div>
      )}
    </div>
  );
}
