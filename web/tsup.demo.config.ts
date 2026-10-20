import { defineConfig } from 'tsup';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { poCatalog } from './tsup.config';

// The portal demo: a static site in dist/demo (vercel.json deploys it). The
// real portal with the demo's router in the page (src/portal/demo); its
// stylesheet is the portal's plus the demo's pieces, its shell is portal.uc's.
const OUT = 'dist/demo';

export default defineConfig({
  entry: { portal: 'src/portal/demo/main.ts' },
  format: ['iife'],
  outDir: OUT,
  outExtension: () => ({ js: '.js' }),
  target: 'es2019',
  // Not cleaned: the folder may hold Vercel's project link (.vercel).
  clean: false,
  sourcemap: false,
  minify: true,
  noExternal: ['qrcode-generator'],
  esbuildPlugins: [poCatalog],
  esbuildOptions(o) {
    o.legalComments = 'none';
    o.charset = 'utf8';
  },
  onSuccess: async () => {
    const css = await build({
      entryPoints: ['src/portal/demo/demo.css'],
      bundle: true,
      minify: true,
      write: false,
      legalComments: 'none',
      external: ['*.woff2'],
      logLevel: 'silent',
    });
    fs.writeFileSync(path.join(OUT, 'portal.css'), css.outputFiles[0].text.trim() + '\n');
    fs.copyFileSync('src/portal/demo/index.html', path.join(OUT, 'index.html'));
    fs.copyFileSync('src/portal/icon.svg', path.join(OUT, 'icon.svg'));
    for (const f of fs.readdirSync('src/portal/fonts')) fs.copyFileSync(path.join('src/portal/fonts', f), path.join(OUT, f));
  },
});
