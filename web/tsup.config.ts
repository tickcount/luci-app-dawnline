import { defineConfig } from 'tsup';
import { transform, type Plugin } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const PKG = '../package/luci-app-dawnline';
const ADMIN_OUT = `${PKG}/htdocs/luci-static/resources/dawnline`;
// Outside the web root: the portal CGI serves them only with a valid code.
const PORTAL_OUT = `${PKG}/root/usr/share/dawnline/portal/assets`;

// LuCI evaluates a module's source as a function body whose parameters are
// the `'require x'` directives; it must `return` its class. tsup emits ESM,
// so the trailing `export { ... }` is rewritten into a baseclass.
function patchForLuci(file: string) {
  const code = fs.readFileSync(file, 'utf8');
  const patched = code.replace(/export\s*{([\s\S]*?)};?\s*$/, (_m, body: string) => {
    const props = body
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [local, exported] = s.split(/\s+as\s+/);
        return exported ? `${exported}: ${local}` : local;
      });
    return `return baseclass.extend({ ${props.join(', ')} });\n`;
  });
  if (patched === code) throw new Error(`LuCI patch failed: no export block in ${file}`);
  fs.writeFileSync(file, patched);
}

/** Minify CSS with esbuild (the same engine that bundles the scripts). */
async function minifyCss(css: string): Promise<string> {
  return (await transform(css, { loader: 'css', minify: true, legalComments: 'none' })).code.trim();
}

// The admin styles live in a template string in styles.ts (rendered inside each
// view); squeeze that string before bundling. It has no ${} and no backslashes.
const minifyStylesTs: Plugin = {
  name: 'minify-styles-ts',
  setup(build) {
    build.onLoad({ filter: /admin[\\/]styles\.ts$/ }, async (args) => {
      const src = fs.readFileSync(args.path, 'utf8');
      const m = /const CSS = `([\s\S]*?)`;/.exec(src);
      if (!m) throw new Error('styles.ts: CSS template not found');
      if (/\$\{|\\/.test(m[1])) throw new Error('styles.ts: the CSS must not contain ${} or backslashes');
      const css = await minifyCss(m[1]);
      return { contents: src.replace(m[0], `const CSS = \`${css}\`;`), loader: 'ts' };
    });
  },
};

export default defineConfig([
  {
    entry: { app: 'src/admin/main.ts' },
    format: ['esm'],
    outDir: ADMIN_OUT,
    outExtension: () => ({ js: '.js' }),
    target: 'es2020',
    clean: false,
    sourcemap: false,
    // Identifiers only: LuCI's require directives in the banner must stay as written.
    minify: true,
    noExternal: ['qrcode-generator'],
    esbuildPlugins: [minifyStylesTs],
    banner: {
      js: [
        '// Generated from dawnline/web — do not edit by hand.',
        "'use strict';",
        "'require baseclass';",
        "'require dom';",
        "'require form';",
        "'require poll';",
        "'require rpc';",
        "'require uci';",
        "'require ui';",
      ].join('\n'),
    },
    esbuildOptions(o) {
      o.legalComments = 'none';
      o.charset = 'utf8';
    },
    onSuccess: async () => patchForLuci(path.join(ADMIN_OUT, 'app.js')),
  },
  {
    entry: { portal: 'src/portal/main.ts' },
    format: ['iife'],
    outDir: PORTAL_OUT,
    outExtension: () => ({ js: '.js' }),
    target: 'es2019',
    clean: false,
    sourcemap: false,
    minify: true,
    noExternal: ['qrcode-generator'],
    esbuildOptions(o) {
      o.legalComments = 'none';
      o.charset = 'utf8';
    },
    onSuccess: async () => {
      fs.writeFileSync(path.join(PORTAL_OUT, 'portal.css'), (await minifyCss(fs.readFileSync('src/portal/portal.css', 'utf8'))) + '\n');
      fs.copyFileSync('src/portal/icon.svg', path.join(PORTAL_OUT, 'icon.svg'));
      for (const f of fs.readdirSync('src/portal/fonts')) fs.copyFileSync(path.join('src/portal/fonts', f), path.join(PORTAL_OUT, f));
    },
  },
]);
