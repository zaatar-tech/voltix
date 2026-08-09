import { useEffect, useRef, useState } from 'react';
import { createStore } from '@zaatar-tech/voltix';
import { createStore as zCreate } from 'zustand/vanilla';
import { atom as jAtom, createStore as jCreate } from 'jotai/vanilla';
import { proxy, subscribe as vSubscribe } from 'valtio/vanilla';
import { atom as nAtom } from 'nanostores';
import { hl } from '../hl';

type Runner = { key: string; run: (deadline: number) => number };

// Each runner drives its own store's update path (with a subscriber attached) as
// fast as it can for a fixed time slice. The count is real updates completed.
function makeRunners(): Runner[] {
  const noop = () => {};

  const vs = createStore({ n: 0 }); vs.subscribe(['n'], noop); let vx = 0;
  const zs = zCreate<{ n: number }>(() => ({ n: 0 })); zs.subscribe(noop); let zx = 0;
  const js = jCreate(); const ja = jAtom(0); js.sub(ja, noop); let jx = 0;
  const vp = proxy({ n: 0 }); vSubscribe(vp, noop); let px = 0;
  const na = nAtom(0); na.listen(noop); let nx = 0;

  const slice = (fn: () => void) => (deadline: number) => {
    let c = 0;
    do { for (let k = 0; k < 256; k++) fn(); c += 256; } while (performance.now() < deadline);
    return c;
  };

  return [
    { key: 'Voltix', run: slice(() => vs.setKey('n', ++vx)) },
    { key: 'Zustand', run: slice(() => zs.setState({ n: ++zx })) },
    { key: 'Jotai', run: slice(() => js.set(ja, ++jx)) },
    { key: 'Valtio', run: slice(() => { vp.n = ++px; }) },
    { key: 'nanostores', run: slice(() => na.set(++nx)) },
  ];
}

const SOURCE = `import { createStore } from '@zaatar-tech/voltix';
import { createStore as zustand } from 'zustand/vanilla';
import { atom, createStore as jotai } from 'jotai/vanilla';
import { proxy } from 'valtio/vanilla';
import { atom as nano } from 'nanostores';

const noop = () => {};

// one store per library, each with a subscriber attached
const v = createStore({ n: 0 }); v.subscribe(['n'], noop);
const z = zustand(() => ({ n: 0 }));  z.subscribe(noop);
const j = jotai(); const a = atom(0); j.sub(a, noop);
const p = proxy({ n: 0 });
const s = nano(0);                    s.listen(noop);

let i = 0;
const update = {
  voltix:     () => v.setKey('n', ++i),
  zustand:    () => z.setState({ n: ++i }),
  jotai:      () => j.set(a, ++i),
  valtio:     () => { p.n = ++i; },
  nanostores: () => s.set(++i),
};

// run one store's update for a fixed slice, count the ops
function measure(run, ms) {
  const end = performance.now() + ms;
  let ops = 0;
  do { for (let k = 0; k < 256; k++) run(); ops += 256; }
  while (performance.now() < end);
  return ops / (ms / 1000); // updates per second
}`;

// Split magnitude from unit so they align in their own columns — a right-aligned
// number next to a left-aligned unit, so decimals and the M/s·K/s suffixes line up
// down the column instead of staggering with each row's string length.
const fmtParts = (n: number): [string, string] =>
  n >= 1e6 ? [(n / 1e6).toFixed(1), 'M/s']
  : n >= 1e3 ? [(n / 1e3).toFixed(0), 'K/s']
  : [String(Math.round(n)), '/s'];

export default function LiveRace() {
  const runnersRef = useRef<Runner[] | null>(null);
  if (!runnersRef.current) runnersRef.current = makeRunners();
  const runners = runnersRef.current;
  // Smooth the op count and the elapsed time separately, then divide — a rate is
  // a ratio of sums, not a smoothed ratio, so one noisy slice can't spike it.
  const opsRef = useRef<number[]>(runners.map(() => 0));
  const timeRef = useRef<number[]>(runners.map(() => 0));
  const warmedRef = useRef(false);

  const [rows, setRows] = useState(() => runners.map((r) => ({ key: r.key, ops: 0 })));
  const [running, setRunning] = useState(true);
  const [tab, setTab] = useState<'demo' | 'source'>('demo');

  useEffect(() => {
    if (!running || tab !== 'demo') return;
    let raf = 0;
    const SLICE = 1.2;         // ms per library per frame
    const TAU = 500;           // ms; time-constant of the sliding-rate window
    const REJECT = SLICE * 3;  // a slice that measured >3.6ms means the OS stole the
                               // thread mid-run — that sample is corrupt, drop it. The
                               // 3x margin clears timer coarsening (1ms on FF/Safari)
                               // so genuine slices are never mistaken for stalls.
    const ops = opsRef.current;
    const time = timeRef.current;

    // Warm every library to steady-state JIT once, up front, so the first number
    // shown reflects optimized code rather than a cold-compile ramp. Same budget
    // for each, so no library is measured at an advantage.
    if (!warmedRef.current) {
      for (let i = 0; i < runners.length; i++) runners[i].run(performance.now() + 50);
      warmedRef.current = true;
    }

    let last = performance.now();
    const loop = () => {
      // Decay by real elapsed time, so the smoothing window is a fixed ~0.5s
      // regardless of frame rate (or a dropped/backgrounded frame). Read the clock
      // here rather than from the rAF timestamp: a different time origin would make
      // dt hugely negative, exp() overflow to Infinity, and 0*Infinity poison every
      // accumulator to NaN. Clamp dt >= 0 so decay stays in (0, 1] no matter what.
      const now = performance.now();
      const dt = Math.max(0, now - last);
      last = now;
      const decay = Math.exp(-dt / TAU);
      for (let i = 0; i < runners.length; i++) {
        const t0 = performance.now();
        const c = runners[i].run(t0 + SLICE);
        const el = performance.now() - t0;
        // Accept clean slices only; the `time === 0` clause always primes the very
        // first sample so a slow cold start can never leave the row stuck at zero.
        if (el > 0 && (el <= REJECT || time[i] === 0)) {
          ops[i] = ops[i] * decay + c;
          time[i] = time[i] * decay + el;
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
            Every store runs the same increment for a 1.2&nbsp;ms slice each frame; the bar is real updates completed per second. This is the store engine, not React re-renders. Valtio batches notifications, so its writes skip a synchronous notify.
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
