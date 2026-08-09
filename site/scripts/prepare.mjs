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
console.log(`public/docs (${PAGES.length} pages) + llms.txt (${llms.length} bytes) written`);
