import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import gettingStarted from '../content/getting-started.md?raw';
import walkthrough from '../content/walkthrough.md?raw';
import coreConcepts from '../content/core-concepts.md?raw';
import composition from '../content/composition.md?raw';
import apiReference from '../content/api-reference.md?raw';
import guides from '../content/guides.md?raw';
import patterns from '../content/patterns.md?raw';
import comparison from '../content/comparison.md?raw';

// ```tsx / ```ts / ```jsx fences reuse highlight.js's typescript/javascript grammars.
const highlight: Parameters<typeof rehypeHighlight>[0] = {
  aliases: { typescript: ['tsx', 'ts'], javascript: ['jsx'] },
};

// GitHub-style heading slug: lowercase, drop punctuation, spaces→hyphens (no
// collapsing), so heading ids match the `#anchor` links and the sub-nav.
function slugText(text: string): string {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s/g, '-');
}

function nodeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (typeof node === 'object' && 'props' in node) {
    return nodeText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return '';
}

const slugify = (node: ReactNode) => slugText(nodeText(node));

// Pull the `## ` headings out of a doc (skipping fenced code) for the sub-nav.
function extractSections(md: string): { title: string; slug: string }[] {
  const out: { title: string; slug: string }[] = [];
  let inFence = false;
  for (const line of md.split('\n')) {
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) out.push({ title: m[1].replace(/`/g, ''), slug: slugText(m[1]) });
  }
  return out;
}

const DOCS = [
  { id: 'getting-started', title: 'Getting Started', md: gettingStarted },
  { id: 'walkthrough', title: 'Walkthrough', md: walkthrough },
  { id: 'core-concepts', title: 'Core Concepts', md: coreConcepts },
  { id: 'composition', title: 'Composition', md: composition },
  { id: 'api-reference', title: 'API Reference', md: apiReference },
  { id: 'guides', title: 'Guides', md: guides },
  { id: 'patterns', title: 'Patterns', md: patterns },
  { id: 'comparison', title: 'Comparison', md: comparison },
].map((d) => ({ ...d, sections: extractSections(d.md) }));

/** True for an ordinary left click, i.e. one we're allowed to handle ourselves. */
function isPlainClick(event: MouseEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0;
}

/**
 * A heading counts as "being read" once it crosses the middle of the viewport,
 * which tracks the section actually on screen. Waiting for it to reach the
 * sticky nav instead leaves the highlight a section behind while scrolling.
 */
const readingLine = () => Math.max(96, window.innerHeight * 0.5);

// Markdown link/heading renderers, bound to the doc currently in view so that a
// bare `#section` link stays inside `#/docs/<page>` instead of nuking the route.
// Same-page section links scroll directly rather than round-tripping the router.
function makeComponents(page: string, goToSection: (slug: string) => boolean): Components {
  return {
    a({ href = '', children, node, ...rest }) {
      let to = href;
      const md = href.match(/^\.?\/?([\w-]+)\.md(#[\w-]+)?$/);
      if (md) {
        to = `#/docs/${md[1]}${md[2] || ''}`;
      } else if (href.startsWith('#') && !href.startsWith('#/')) {
        to = `#/docs/${page}${href}`;
      }
      const external = /^https?:/.test(to);
      const samePage = to.match(/^#\/docs\/([\w-]+)#([\w-]+)$/);
      return (
        <a
          href={to}
          {...(external ? { target: '_blank', rel: 'noopener' } : {})}
          onClick={(event) => {
            if (!samePage || samePage[1] !== page || !isPlainClick(event)) return;
            if (goToSection(samePage[2])) event.preventDefault();
          }}
          {...rest}
        >
          {children}
        </a>
      );
    },
    table: ({ node, ...rest }) => <div className="table-wrap"><table {...rest} /></div>,
    h1: ({ children, node, ...rest }) => <h1 id={slugify(children)} {...rest}>{children}</h1>,
    h2: ({ children, node, ...rest }) => <h2 id={slugify(children)} {...rest}>{children}</h2>,
    h3: ({ children, node, ...rest }) => <h3 id={slugify(children)} {...rest}>{children}</h3>,
    h4: ({ children, node, ...rest }) => <h4 id={slugify(children)} {...rest}>{children}</h4>,
  };
}

export default function Docs({ page, section }: { page: string; section?: string }) {
  const found = DOCS.findIndex((d) => d.id === page);
  const idx = found < 0 ? 0 : found;
  const doc = DOCS[idx];
  const prev = idx > 0 ? DOCS[idx - 1] : null;
  const next = idx < DOCS.length - 1 ? DOCS[idx + 1] : null;

  const [activeSection, setActiveSection] = useState<string | undefined>(section);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // The exact hash this component last wrote itself (scroll spy or a section click).
  // The hash router reads location.hash back on later renders and re-delivers it as
  // a prop; recognizing our own writes is what keeps that echo from being treated as
  // a navigation (which would scrollIntoView and yank the page mid-read).
  const selfWrittenHash = useRef<string | null>(null);

  // A deliberately chosen section (link click or deep link) holds against the spy
  // until the reader scrolls away. Without this, a target near the page bottom can
  // never reach the reading line, and the bottom-of-page rule would immediately
  // re-mark the last section — overriding the click that just happened.
  const pinned = useRef<{ slug: string; y: number } | null>(null);

  const writeUrl = useCallback((slug: string | undefined) => {
    const url = slug ? `#/docs/${doc.id}#${slug}` : `#/docs/${doc.id}`;
    if (window.location.hash === url) return;
    selfWrittenHash.current = url;
    // replaceState: section changes while reading must not pile up in history —
    // back should leave the page, and it never fires hashchange, so the router
    // only ever sees this URL passively.
    history.replaceState(null, '', url);
  }, [doc.id]);

  // Navigation (initial load, a link to another page, back/forward): scroll to the
  // deep-linked section or the top, and seed the highlight. Runs for REAL navigations
  // only — if the hash is one we wrote ourselves, the page is already where the
  // reader put it, and doing nothing is the correct move.
  useEffect(() => {
    if (window.location.hash === selfWrittenHash.current) return;
    selfWrittenHash.current = null;
    setActiveSection(section);
    pinned.current = null;
    // Instant on purpose: a bare scrollIntoView() inherits CSS `scroll-behavior:
    // smooth`, whose animation gets canceled by the surrounding route re-render.
    if (section) {
      const el = document.getElementById(section);
      if (el) {
        el.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
        pinned.current = { slug: section, y: window.scrollY };
        return;
      }
    }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [page, section]);

  /** Jump to a section directly — no router round-trip, no history entry. */
  const goToSection = useCallback((slug: string): boolean => {
    const el = document.getElementById(slug);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
    pinned.current = { slug, y: window.scrollY };
    setActiveSection(slug);
    writeUrl(slug);
    return true;
  }, [writeUrl]);

  // Scroll spy: the current section is the last heading that crossed the reading
  // line, and at the very bottom, the last heading on screen (a short final section
  // never reaches the line). Reflected in the sub-nav highlight and the URL.
  useEffect(() => {
    let headings = Array.from(document.querySelectorAll<HTMLElement>('.content h2[id]'));

    const sync = () => {
      if (headings.length === 0) {
        headings = Array.from(document.querySelectorAll<HTMLElement>('.content h2[id]'));
        if (headings.length === 0) return;
      }
      const line = readingLine();
      let reached: string | undefined;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top > line) break;
        reached = heading.id;
      }
      const root = document.documentElement;
      if (root.scrollHeight > window.innerHeight &&
          window.scrollY + window.innerHeight >= root.scrollHeight - 4) {
        for (let i = headings.length - 1; i >= 0; i--) {
          if (headings[i].getBoundingClientRect().top < window.innerHeight) {
            reached = headings[i].id;
            break;
          }
        }
      }
      const pin = pinned.current;
      if (pin) {
        // Release once the spy agrees with the choice, or once the reader has
        // actually moved; until then the chosen section stands.
        if (reached === pin.slug || Math.abs(window.scrollY - pin.y) > 8) {
          pinned.current = null;
        } else {
          return;
        }
      }
      // setState and writeUrl both no-op on unchanged values, so no dedupe here —
      // a local shadow of "current" drifts out of sync when a click sets the
      // section directly, and a stale shadow makes the spy skip real updates.
      setActiveSection(reached);
      writeUrl(reached);
    };

    sync();
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [doc.id, writeUrl]);

  // Keep the highlighted entry visible inside the sidebar's own scroll box. Scoped
  // to the sidebar element, so it cannot move the page.
  useEffect(() => {
    const inner = sidebarRef.current;
    if (!activeSection || !inner || inner.scrollHeight <= inner.clientHeight) return;
    const link = inner.querySelector<HTMLElement>(`.subnav a[data-slug="${activeSection}"]`);
    if (!link) return;
    const top = link.offsetTop - inner.offsetTop;
    const bottom = top + link.offsetHeight;
    if (top < inner.scrollTop) inner.scrollTop = top - 8;
    else if (bottom > inner.scrollTop + inner.clientHeight) {
      inner.scrollTop = bottom - inner.clientHeight + 8;
    }
  }, [activeSection]);

  const components = useMemo(() => makeComponents(doc.id, goToSection), [doc.id, goToSection]);

  return (
    <div className="wrap">
      <div className="docs">
        <aside className="sidebar">
          <div className="sidebar-inner" ref={sidebarRef}>
            <div className="slabel">Documentation</div>
            {DOCS.map((d) => (
              <div className="nav-item" key={d.id}>
                <a className={d.id === doc.id ? 'active' : ''} href={`#/docs/${d.id}`}>
                  {d.title}
                </a>
                {d.id === doc.id && d.sections.length > 0 && (
                  <div className="subnav">
                    {d.sections.map((s) => (
                      <a
                        key={s.slug}
                        data-slug={s.slug}
                        className={activeSection === s.slug ? 'active' : ''}
                        href={`#/docs/${d.id}#${s.slug}`}
                        onClick={(event) => {
                          if (!isPlainClick(event)) return;
                          if (goToSection(s.slug)) event.preventDefault();
                        }}
                      >
                        {s.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="slabel llm-label">For LLMs</div>
            <div className="nav-item">
              <a className="llm-link" href="/llms.txt" target="_blank" rel="noopener">llms.txt</a>
            </div>
          </div>
        </aside>
        <article className="content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[[rehypeHighlight, highlight]]}
            components={components}
          >
            {doc.md}
          </ReactMarkdown>
          <div className="doc-nav">
            {prev ? (
              <a href={`#/docs/${prev.id}`}><small>Previous</small>{prev.title}</a>
            ) : <span />}
            {next ? (
              <a className="next" href={`#/docs/${next.id}`}><small>Next</small>{next.title}</a>
            ) : <span />}
          </div>
        </article>
      </div>
    </div>
  );
}
