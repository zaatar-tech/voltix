// Writes a real HTML file for every route, so a crawler that does not run JS gets
// the page's actual content and each docs page has its own indexable URL. The
// client still boots normally and takes over from there.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { render } from '../dist-ssr/entry-server.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://voltix.pages.dev';

const DOCS = [
  ['getting-started', 'Getting started', 'Install Voltix, create a store, and read keys in components.'],
  ['walkthrough', 'Walkthrough', 'One app built step by step, from a single store to a composed tree.'],
  ['core-concepts', 'Core concepts', 'Per-key subscriptions, identity-stable state, equality, and batching.'],
  ['composition', 'Composition', 'Nested stores, a store per id with lookups, and navigating with select and at.'],
  ['api-reference', 'API reference', 'Every export and every store method.'],
  ['guides', 'Guides', 'Actions, schema contracts, derived keys, middleware, persistence, and SSR.'],
  ['patterns', 'Patterns', 'Requests, fetching by parameter, optimistic updates, polling, and live tables.'],
  ['comparison', 'Comparison', 'Where Voltix fits, and how it benchmarks against other React stores.'],
];

const template = await readFile(`${root}dist/index.html`, 'utf8');

// Each route gets its own title, description and canonical. Without this every
// page would compete in search results as the same document.
function page(path, title, description) {
  const html = render(path);
  return template
    .replace('<title>Voltix</title>', `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${description}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${description}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${title}`)
    .replace(/(<meta name="twitter:title" content=")[^"]*/, `$1${title}`)
    .replace(/(<link rel="canonical" href=")[^"]*/, `$1${SITE}${path}`)
    .replace(/(<meta property="og:url" content=")[^"]*/, `$1${SITE}${path}`)
    .replace('<div id="root"></div>', `<div id="root">${html}</div>`);
}

const routes = [['/', 'Voltix', null], ...DOCS.map(([id, t, d]) => [`/docs/${id}`, `${t} — Voltix`, d])];

for (const [path, title, description] of routes) {
  const desc = description ?? template.match(/<meta name="description" content="([^"]*)/)[1];
  const html = page(path, title, desc);
  // A flat `docs/x.html` rather than `docs/x/index.html`: Pages serves the former
  // at /docs/x directly, where the latter 308s to /docs/x/ and makes every
  // canonical and sitemap entry a redirect.
  const file = path === '/' ? `${root}dist/index.html` : `${root}dist${path}.html`;
  await mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true });
  await writeFile(file, html);
}

// Without this, Pages answers any unmatched path with index.html and a 200, so
// every mistyped URL looks like a real page to a crawler.
const notFound = template
  .replace('<title>Voltix</title>', '<title>Not found — Voltix</title>')
  .replace(/<link rel="canonical"[^>]*>\n?\s*/, '')
  .replace('<div id="root"></div>', `<div id="root"><nav class="nav"><a class="brand" href="/">Voltix</a></nav>
    <main><div class="wrap"><div class="docs"><article class="content">
      <h1>Not found</h1>
      <p>That page does not exist. Try the <a href="/docs/getting-started">documentation</a> or the <a href="/">home page</a>.</p>
    </article></div></div></main></div>`);
await writeFile(`${root}dist/404.html`, notFound);

console.log(`prerendered ${routes.length} routes + 404`);
