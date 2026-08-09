import { useLayoutEffect, useSyncExternalStore } from 'react';
import type { MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { createStore, useStoreKey } from '@zaatar-tech/voltix';
import Home from './pages/Home';
import Docs from './pages/Docs';
import Logo from './Logo';

// The site's own UI state runs on Voltix (dogfooding).
function initialTheme(): 'light' | 'dark' {
  try {
    const s = localStorage.getItem('voltix-theme');
    if (s === 'light' || s === 'dark') return s;
  } catch { /* ignore */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
const ui = createStore({ theme: initialTheme() as 'light' | 'dark' });

type DocumentVT = Document & {
  startViewTransition?: (cb: () => void) => { ready: Promise<void> };
};

// Flip the theme, growing the incoming theme in through a clip-path circle anchored to the
// toggle button. The swap runs under flushSync so the data-theme layout effect applies before
// the transition snapshots the new state. No View Transitions API or reduced motion → instant swap.
function toggleTheme(current: 'light' | 'dark', event: MouseEvent<HTMLButtonElement>): void {
  const next = current === 'dark' ? 'light' : 'dark';
  const doc = document as DocumentVT;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof doc.startViewTransition !== 'function' || reduce) {
    ui.setKey('theme', next);
    return;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const transition = doc.startViewTransition(() => flushSync(() => ui.setKey('theme', next)));
  // A fast second toggle supersedes this one; its ready promise rejects (aborted) — ignore it.
  void transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 480, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    })
    .catch(() => {});
}

function useHashRoute(): string {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    () => window.location.hash || '#/',
    () => '#/'
  );
}

export default function App() {
  const theme = useStoreKey(ui, 'theme');
  const route = useHashRoute();

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('voltix-theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const m = route.match(/^#\/docs(?:\/([\w-]+))?(?:#([\w-]+))?/);

  return (
    <>
      <nav className="nav">
        <a className="brand" href="#/"><Logo size={24} /> <span className="brand-name">Voltix</span></a>
        <div className="nav-links">
          <a href="#/docs/getting-started">Docs</a>
          <a href="https://github.com/zaatar-tech/voltix" target="_blank" rel="noopener">GitHub</a>
          <a href="https://www.npmjs.com/package/@zaatar-tech/voltix" target="_blank" rel="noopener">npm</a>
          <button
            className="toggle"
            onClick={(e) => toggleTheme(theme, e)}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </nav>
      <main>{m ? <Docs page={m[1] || 'getting-started'} section={m[2]} /> : <Home />}</main>
    </>
  );
}
