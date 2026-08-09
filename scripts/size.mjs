// Measures the gzipped size of the ESM entry graph and checks it against every
// place the docs quote it. `--write` updates them instead of failing.
//
//   npm run size          verify (CI runs this; a stale number fails the build)
//   npm run size:write    rewrite the docs to match reality
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist/`;

if (!existsSync(`${dist}index.mjs`)) {
  console.error('size: dist/ is missing — run `npm run build` first.');
  process.exit(1);
}

// What a bundler actually pulls in for `import ... from '@zaatar-tech/voltix'`:
// the entry plus the shared chunks it imports. Measuring index.mjs alone
// understates it.
const parts = ['index.mjs', ...readdirSync(dist).filter((f) => /^chunk-.*\.mjs$/.test(f))];
const bytes = gzipSync(Buffer.concat(parts.map((f) => readFileSync(dist + f))), { level: 9 }).length;

// Quote in decimal kB (what bundlephobia reports) rounded up-ish to one decimal,
// so the claim is never smaller than either the binary or decimal reading.
const size = (bytes / 1000).toFixed(1);

// Every spot that states the size, with the number as capture group 1.
const CLAIMS = [
  ['README.md', /(?<=gzip-)([\d.]+)(?=%20KB-)/g],
  ['README.md', /(?<=\*\*~)([\d.]+)(?= KB\*\*)/g],
  ['README.md', /(?<=~)([\d.]+)(?= KB gzipped)/g],
  ['docs/getting-started.md', /(?<=about )([\d.]+)(?= KB gzipped)/g],
  ['site/src/content/getting-started.md', /(?<=about )([\d.]+)(?= KB gzipped)/g],
  ['site/index.html', /([\d.]+)(?= KB, zero dependencies)/g],
];

const write = process.argv.includes('--write');
const stale = [];

for (const [file, re] of CLAIMS) {
  const path = root + file;
  const before = readFileSync(path, 'utf8');
  const found = before.match(re);
  if (!found) {
    console.error(`size: no size claim matched in ${file} — the wording changed, update scripts/size.mjs`);
    process.exit(1);
  }
  const wrong = found.filter((v) => v !== size);
  if (wrong.length === 0) continue;
  if (write) {
    writeFileSync(path, before.replace(re, size));
    console.log(`  updated ${file} (${[...new Set(wrong)].join(', ')} -> ${size})`);
  } else {
    stale.push(`${file}: claims ${[...new Set(wrong)].join(', ')} KB`);
  }
}

console.log(`size: ${bytes} B gzipped (${(bytes / 1024).toFixed(2)} KiB) -> quoted as ${size} KB`);

if (stale.length > 0) {
  console.error('\nsize: documented size is stale:');
  for (const s of stale) console.error(`  ${s}`);
  console.error('\nRun `npm run size:write` to update.');
  process.exit(1);
}
