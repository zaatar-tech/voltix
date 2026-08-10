// Prebuild: publish the raw docs at /docs/*.md and a single self-contained
// llms.txt — the README, which is the "how to use this" summary, with the badge
// header stripped and every relative link resolved to a real URL.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));

const PAGES = [
  'getting-started',
  'walkthrough',
  'core-concepts',
  'composition',
  'api-reference',
  'guides',
  'patterns',
  'comparison',
];

const REPO_BLOB = 'https://github.com/zaatar-tech/voltix/blob/main';
const DOCS_URL = 'https://voltix.pages.dev/docs';

// `../foo` in docs and `./src/foo` in the README point at repo files that aren't served.
const repoLinks = (md) =>
  md.replace(/\]\(\.\.\/([^)\s]+)\)/g, `](${REPO_BLOB}/$1)`)
    .replace(/\]\((?:\.\/)?(src\/[^)\s]+|LICENSE)\)/g, `](${REPO_BLOB}/$1)`);

await mkdir(`${root}public/docs`, { recursive: true });
for (const name of PAGES) {
  await writeFile(`${root}public/docs/${name}.md`, repoLinks(await readFile(`${repo}docs/${name}.md`, 'utf8')));
}

const llms = repoLinks(await readFile(`${repo}README.md`, 'utf8'))
  .replace(/<div align="center">\n*/, '')
  .replace(/\n*<\/div>\n/, '\n')
  .replace(/^\[!\[.*\n/gm, '')                                  // badge row
  .replace(/^# ⚡ Voltix$/m, '# Voltix')
  .replace(/\]\(\.\/docs\)/g, `](${DOCS_URL}/getting-started.md)`)
  .replace(/\]\(\.\/docs\/([\w-]+)\.md(#[\w-]+)?\)/g, `](${DOCS_URL}/$1.md$2)`)
  .replace(/\n{3,}/g, '\n\n');

await writeFile(`${root}public/llms.txt`, llms);
// Sitemap lives here so `lastmod` reflects the build rather than whenever the
// file was last hand-edited.
const stamp = new Date().toISOString().slice(0, 10);
const routes = ['https://voltix.pages.dev/', ...PAGES.map((p) => `https://voltix.pages.dev/docs/${p}`), 'https://voltix.pages.dev/llms.txt'];
await writeFile(`${root}public/sitemap.xml`,
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + routes.map((u) => `  <url><loc>${u}</loc><lastmod>${stamp}</lastmod></url>`).join('\n')
  + '\n</urlset>\n');

console.log(`public/docs (${PAGES.length} pages) + llms.txt + sitemap (${routes.length} urls) written`);
