import { Suspense, lazy, useState } from 'react';
import Logo from '../Logo';
// Loaded on demand: it carries Zustand, Jotai, Valtio and nanostores, which no
// other page needs. Prerendering emits the fallback and the client swaps it in.
const LiveRace = lazy(() => import('../components/LiveRace'));
import { hl } from '../hl';

const COUNTER = `import { createStore, useStoreKey } from '@zaatar-tech/voltix';

const store = createStore({ count: 0 });
const inc = () => store.increment('count');

function Counter() {
  const count = useStoreKey(store, 'count');
  return (
    <div>
      <p>{count}</p>
      <button onClick={inc}>+1</button>
    </div>
  );
}`;

function Install() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={'install' + (copied ? ' copied' : '')}
      aria-label={copied ? 'Copied' : 'Copy install command'}
      onClick={() => {
        navigator.clipboard?.writeText('npm i @zaatar-tech/voltix').catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1300);
      }}
    >
      <span className="p">$</span>
      <span>npm i @zaatar-tech/voltix</span>
      <span className="c" aria-hidden>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {copied ? (
            <polyline points="20 6 9 17 4 12" />
          ) : (
            <>
              <rect x="9" y="9" width="12" height="12" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </>
          )}
        </svg>
      </span>
    </button>
  );
}


export default function Home() {
  return (
    <>
      <header className="hero">
        <Logo size={68} />
        <h1>
          <span className="l1 g">Fastest</span>
          <span className="l2">React state library</span>
        </h1>
        <Install />
        <div className="cta">
          <a className="btn primary" href="/docs/getting-started">Get started</a>
          <a className="btn ghost" href="https://github.com/zaatar-tech/voltix" target="_blank" rel="noopener">GitHub</a>
        </div>
      </header>

      <div className="wrap">
        <section className="section example">
          <pre><code dangerouslySetInnerHTML={{ __html: hl(COUNTER) }} /></pre>
        </section>

        <section className="section">
          <h2>Live throughput</h2>
          <p className="lead">Five stores, same increment, running right now in your browser. Voltix leads because its update path mutates one field and notifies one key.</p>
          <Suspense fallback={<div className="race" />}>
            <LiveRace />
          </Suspense>
        </section>
      </div>

      <footer className="foot">
        <p>MIT licensed. <a href="https://github.com/zaatar-tech/voltix" target="_blank" rel="noopener">Source on GitHub</a>.</p>
      </footer>
    </>
  );
}
