import { defineConfig } from 'tsup';
import { build, transform, type Plugin } from 'esbuild';
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

/** The portal's stylesheet: its parts (src/portal/styles, joined by @import) as one minified file. */
async function portalCss(): Promise<string> {
  const r = await build({
    entryPoints: ['src/portal/styles/index.css'],
    bundle: true,
    minify: true,
    write: false,
    legalComments: 'none',
    // The fonts sit next to the stylesheet on the router: their URLs stay as written.
    external: ['*.woff2'],
    logLevel: 'silent',
  });
  return r.outputFiles[0].text.trim();
}

// The admin styles are plain .css files under src/admin/styles, imported as
// text and joined in styles/index.ts (rendered inside each view): each is
// minified here. They get a namespace (and a path not ending in .css) of
// their own, so tsup's CSS handling, which would emit a stylesheet, never sees them.
const adminCss: Plugin = {
  name: 'admin-css-text',
  setup(build) {
    build.onResolve({ filter: /\.css$/ }, (args) =>
      /admin[\\/]styles$/.test(args.resolveDir)
        ? { path: `${path.join(args.resolveDir, args.path)}#text`, namespace: 'dl-css' }
        : undefined,
    );
    build.onLoad({ filter: /.*/, namespace: 'dl-css' }, async (args) => ({
      contents: await minifyCss(fs.readFileSync(args.path.replace(/#text$/, ''), 'utf8')),
      loader: 'text',
    }));
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
    esbuildPlugins: [adminCss],
    banner: {
      js: [
        '// Generated from dawnline/web — do not edit by hand.',
        "'use strict';",
        "'require baseclass';",
        "'require dom';",
        "'require poll';",
        "'require rpc';",
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
      fs.writeFileSync(path.join(PORTAL_OUT, 'portal.css'), (await portalCss()) + '\n');
      fs.copyFileSync('src/portal/icon.svg', path.join(PORTAL_OUT, 'icon.svg'));
      for (const f of fs.readdirSync('src/portal/fonts')) fs.copyFileSync(path.join('src/portal/fonts', f), path.join(PORTAL_OUT, f));
    },
  },
]);
