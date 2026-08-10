import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import type { MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { createStore, useStoreKey } from '@zaatar-tech/voltix';
import Home from './pages/Home';
import Docs from './pages/Docs';
import Logo from './Logo';

// The site's own UI state runs on Voltix (dogfooding).
function initialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
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

const NAV_EVENT = 'voltix:navigate';

// Prerendering has no location to read, so the build tells the app which route it
// is rendering. Unset in the browser, where the real URL is the source of truth.
let ssrPath: string | null = null;
export function setSsrPath(path: string): void { ssrPath = path; }

function usePath(): string {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('popstate', cb);
      window.addEventListener(NAV_EVENT, cb);
      return () => {
        window.removeEventListener('popstate', cb);
        window.removeEventListener(NAV_EVENT, cb);
      };
    },
    () => window.location.pathname,
    () => '/'
  );
}

/** True for a link this app should handle rather than let the browser load. */
function isInternalRoute(a: HTMLAnchorElement): boolean {
  const href = a.getAttribute('href');
  if (!href || !href.startsWith('/') || a.target === '_blank') return false;
  // /docs/x.md, /llms.txt, /og.png are real files, not routes
  return !/\.[a-z0-9]+$/i.test(href.split('#')[0]);
}

export default function App() {
  const theme = useStoreKey(ui, 'theme');
  const path = ssrPath ?? usePath();

  // Route internal links through pushState so navigation stays instant, while the
  // href remains a real URL that a crawler can follow and a server can answer.
  useEffect(() => {
    const onClick = (event: globalThis.MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest?.('a');
      if (!anchor || !isInternalRoute(anchor)) return;
      const href = anchor.getAttribute('href')!;
      if (href.split('#')[0] === window.location.pathname) return; // same page, let the hash work
      event.preventDefault();
      history.pushState(null, '', href);
      window.dispatchEvent(new Event(NAV_EVENT));
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('voltix-theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const m = path.match(/^\/docs(?:\/([\w-]+))?/);

  return (
    <>
      <nav className="nav">
        <a className="brand" href="/"><Logo size={24} /> <span className="brand-name">Voltix</span></a>
        <div className="nav-links">
          <a href="/docs/getting-started">Docs</a>
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
      <main>{m ? <Docs page={m[1] || 'getting-started'} /> : <Home />}</main>
    </>
  );
}
