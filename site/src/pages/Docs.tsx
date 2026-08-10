import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createLowlight } from 'lowlight';
import tsGrammar from 'highlight.js/lib/languages/typescript';
import jsGrammar from 'highlight.js/lib/languages/javascript';
import bashGrammar from 'highlight.js/lib/languages/bash';
import gettingStarted from '../content/getting-started.md?raw';
import walkthrough from '../content/walkthrough.md?raw';
import coreConcepts from '../content/core-concepts.md?raw';
import composition from '../content/composition.md?raw';
import apiReference from '../content/api-reference.md?raw';
import guides from '../content/guides.md?raw';
import patterns from '../content/patterns.md?raw';
import comparison from '../content/comparison.md?raw';

// rehype-highlight always bundles lowlight's `common`, which is every language it
// ships (166 KB). The docs only ever use three, so register those directly and walk
// the tree here instead.
const lowlight = createLowlight();
lowlight.register({ typescript: tsGrammar, javascript: jsGrammar, bash: bashGrammar });
lowlight.registerAlias({ typescript: ['tsx', 'ts'], javascript: ['jsx'] });

type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };

function rehypeHighlightMinimal() {
  return (tree: HastNode) => {
    const walk = (node: HastNode, parent: HastNode | null) => {
      if (node.tagName === 'code' && parent?.tagName === 'pre') {
        const classes = (node.properties?.className as string[] | undefined) ?? [];
        const marker = classes.find((c) => c.startsWith('language-'));
        const lang = marker?.slice('language-'.length);
        if (lang && lowlight.registered(lang)) {
          const source = (node.children ?? []).map((c) => c.value ?? '').join('');
          node.children = lowlight.highlight(lang, source).children as HastNode[];
          node.properties = { ...node.properties, className: [...classes, 'hljs'] };
        }
        return;
      }
      for (const child of node.children ?? []) walk(child, node);
    };
    walk(tree, null);
  };
}

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

// Markdown link renderer: a sibling `foo.md` is another docs route, and a bare
// `#section` stays a fragment on this page and scrolls without a router round trip.
function makeComponents(goToSection: (slug: string) => boolean): Components {
  return {
    a({ href = '', children, node, ...rest }) {
      let to = href;
      const md = href.match(/^\.?\/?([\w-]+)\.md(#[\w-]+)?$/);
      if (md) to = `/docs/${md[1]}${md[2] || ''}`;
      const external = /^https?:/.test(to);
      const samePageSection = to.startsWith('#') ? to.slice(1) : null;
      return (
        <a
          href={to}
          {...(external ? { target: '_blank', rel: 'noopener' } : {})}
          onClick={(event) => {
            if (!samePageSection || !isPlainClick(event)) return;
            if (goToSection(samePageSection)) event.preventDefault();
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

// The section lives in the fragment. Only real navigation (a link, back/forward)
// fires hashchange — the scroll spy writes with replaceState, so its own updates
// never come back round as a navigation.
function useSection(): string | undefined {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    () => window.location.hash.slice(1) || undefined,
    () => undefined
  );
}

export default function Docs({ page }: { page: string }) {
  const section = useSection();
  const found = DOCS.findIndex((d) => d.id === page);
  const idx = found < 0 ? 0 : found;
  const doc = DOCS[idx];
  const prev = idx > 0 ? DOCS[idx - 1] : null;
  const next = idx < DOCS.length - 1 ? DOCS[idx + 1] : null;

  const [activeSection, setActiveSection] = useState<string | undefined>(section);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // A deliberately chosen section (link click or deep link) holds against the spy
  // until the reader scrolls away. Without this, a target near the page bottom can
  // never reach the reading line, and the bottom-of-page rule would immediately
  // re-mark the last section — overriding the click that just happened.
  const pinned = useRef<{ slug: string; y: number } | null>(null);

  const writeUrl = useCallback((slug: string | undefined) => {
    const url = slug ? `#${slug}` : window.location.pathname;
    if (slug ? window.location.hash === url : !window.location.hash) return;
    // replaceState: sections passing by while reading must not pile up in history,
    // and it fires no hashchange, so the spy never re-enters as a navigation.
    history.replaceState(null, '', url);
  }, []);

  // Navigation (initial load, a link to another page, back/forward): scroll to the
  // deep-linked section or the top, and seed the highlight. Runs for REAL navigations
  // only — if the hash is one we wrote ourselves, the page is already where the
  // reader put it, and doing nothing is the correct move.
  useEffect(() => {
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

  const components = useMemo(() => makeComponents(goToSection), [goToSection]);

  return (
    <div className="wrap">
      <div className="docs">
        <aside className="sidebar">
          <div className="sidebar-inner" ref={sidebarRef}>
            <div className="slabel">Documentation</div>
            {DOCS.map((d) => (
              <div className="nav-item" key={d.id}>
                <a className={d.id === doc.id ? 'active' : ''} href={`/docs/${d.id}`}>
                  {d.title}
                </a>
                {d.id === doc.id && d.sections.length > 0 && (
                  <div className="subnav">
                    {d.sections.map((s) => (
                      <a
                        key={s.slug}
                        data-slug={s.slug}
                        className={activeSection === s.slug ? 'active' : ''}
                        href={`#${s.slug}`}
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
            rehypePlugins={[rehypeHighlightMinimal]}
            components={components}
          >
            {doc.md}
          </ReactMarkdown>
          <div className="doc-nav">
            {prev ? (
              <a href={`/docs/${prev.id}`}><small>Previous</small>{prev.title}</a>
            ) : <span />}
            {next ? (
              <a className="next" href={`/docs/${next.id}`}><small>Next</small>{next.title}</a>
            ) : <span />}
          </div>
        </article>
      </div>
    </div>
  );
}
