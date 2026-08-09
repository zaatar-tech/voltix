import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Social platforms cache the og:image by URL and keep serving the bytes they first
// fetched, so re-uploading the same filename shows the old card forever (Facebook's
// re-scrape refreshes the metadata, not the stored image). Stamping a hash of the
// file onto the URL means the URL changes exactly when the picture does.
function ogCacheBust() {
  return {
    name: 'og-cache-bust',
    transformIndexHtml(html: string) {
      const png = readFileSync(fileURLToPath(new URL('./public/og.png', import.meta.url)));
      const hash = createHash('sha1').update(png).digest('hex').slice(0, 8);
      return html.replaceAll('/og.png', `/og.png?v=${hash}`);
    },
  };
}

// The site dogfoods voltix by aliasing the bare import to the library source.
export default defineConfig({
  plugins: [react(), viteSingleFile(), ogCacheBust()],
  resolve: {
    alias: {
      '@zaatar-tech/voltix': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
  },
  server: { fs: { allow: ['..', '../..'] } },
});
