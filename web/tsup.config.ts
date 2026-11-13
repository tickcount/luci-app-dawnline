import { defineConfig } from 'tsup';
import { build, type Plugin } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { catalogOf, parsePo } from './i18n/po.ts';
import { shadowCss } from './build/shadow-css.ts';

const PKG = '../package/luci-app-dawnline';
const ADMIN_OUT = `${PKG}/htdocs/luci-static/resources/dawnline`;
// Outside the web root: the portal CGI serves them only with a valid code.
const PORTAL_OUT = `${PKG}/root/usr/share/dawnline/portal/assets`;
// Bytes a LuCI module may weigh: uhttpd sends them uncompressed. It was 451 KiB (the size of the old app.js); the
// owner let it grow (2026-11-11, to 512 KiB; 2026-11-12, to 576 KiB for the networks behind routers) rather than
// split the pages further. Still a ceiling: past it, what a page rarely needs goes into a module loaded on demand.
const BUDGET = 576 * 1024;

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

/** The portal's stylesheet: its parts (src/portal/styles, joined by @import) as one minified file. */
async function portalCss(): Promise<string> {
  const r = await build({
    entryPoints: ['src/portal/styles/index.css'],
    bundle: true,
    minify: true,
    write: false,
    legalComments: 'none',
    logLevel: 'silent',
  });
  return r.outputFiles[0].text.trim();
}

/** The portal's translations: a .po it imports becomes its lookup table (i18n/po.ts). */
export const poCatalog: Plugin = {
  name: 'po-catalog',
  setup(build) {
    build.onLoad({ filter: /\.po$/ }, (args) => ({
      contents: JSON.stringify(catalogOf(parsePo(fs.readFileSync(args.path, 'utf8')))),
      loader: 'json',
    }));
  },
};

// The pages' stylesheets (src/admin/styles/shadow/*.css, each an @import list over the portal's own
// parts and the admin's): bundled, made fit for a Shadow DOM (build/shadow-css.ts) and minified, then
// imported as text; the shell adopts it as one constructed stylesheet (admin/shell/host.ts).
export const shadowSheet: Plugin = {
  name: 'shadow-css-text',
  setup(build) {
    build.onResolve({ filter: /\.css$/ }, (args) => {
      const file = path.join(args.resolveDir, args.path);
      // A path not ending in .css: tsup's own CSS handling never sees it.
      return /admin[\\/]styles[\\/]shadow[\\/][^\\/]+\.css$/.test(file) ? { path: `${file}#shadow`, namespace: 'dl-shadow' } : undefined;
    });
    build.onLoad({ filter: /.*/, namespace: 'dl-shadow' }, async (args) => {
      const r = await build.esbuild.build({
        entryPoints: [args.path.replace(/#shadow$/, '')],
        bundle: true,
        minify: true,
        write: false,
        legalComments: 'none',
        logLevel: 'silent',
        metafile: true,
      });
      return {
        contents: shadowCss(r.outputFiles[0].text.trim(), { rootClasses: ['kbd', 'own-tsel', 'no-scope'] }),
        loader: 'text',
        // A part changed under --watch: built again.
        watchFiles: Object.keys(r.metafile.inputs).map((f) => path.resolve(f)),
      };
    });
  },
};

export default defineConfig([
  {
    // Four LuCI modules: `dawnline.app` (every page, and the old addresses sent on), `dawnline.style` (the
    // pages' stylesheet, loaded with each view's data: shell/style.ts), `dawnline.map` (the map and a device's
    // places, which a page loads when it draws one: shell/maps.ts) and `dawnline.qr` (the QR generator, which a
    // sheet loads when it draws a code: shell/qr.ts). One self-contained file each: no shared chunk, LuCI loads
    // a module as one file; each stays under the size budget (uhttpd sends them uncompressed).
    entry: { app: 'src/admin/main.ts', style: 'src/admin/style-module.ts', map: 'src/admin/map-module.ts', qr: 'src/admin/qr-module.ts' },
    format: ['esm'],
    splitting: false,
    outDir: ADMIN_OUT,
    outExtension: () => ({ js: '.js' }),
    target: 'es2020',
    // The folder is all build output (git-ignored): emptied first, so nothing stale ships.
    clean: true,
    sourcemap: false,
    // Identifiers only: LuCI's require directives in the banner must stay as written.
    minify: true,
    noExternal: ['qrcode-generator'],
    esbuildPlugins: [shadowSheet],
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
    onSuccess: async () => {
      for (const f of ['app.js', 'style.js', 'map.js', 'qr.js']) patchForLuci(path.join(ADMIN_OUT, f));
      // The map stays out of the pages' module: only its types may be imported there (a value import would bundle
      // MapLibre's loader, the markers and their stylesheet into every page).
      const app = fs.readFileSync(path.join(ADMIN_OUT, 'app.js'), 'utf8');
      if (app.includes('maplibre-gl'))
        throw new Error('app.js bundles the map: import it from shell/maps.ts (loadMaps), types only elsewhere');
      if (app.includes(':host{')) throw new Error('app.js bundles the stylesheet: it comes from shell/style.ts (loadStyle)');
      if (app.includes('qrcode')) throw new Error('app.js bundles the QR generator: it comes from shell/qr.ts (loadQr)');
      // LuCI runs a module as a function's body: an import left in one (a dependency tsup kept outside the bundle)
      // stops every page with a SyntaxError. It did once (2026-11-12): each is run that way here.
      for (const f of ['app.js', 'style.js', 'map.js', 'qr.js']) {
        try {
          new Function(fs.readFileSync(path.join(ADMIN_OUT, f), 'utf8'));
        } catch (e) {
          throw new Error(
            `${f} does not run as a LuCI module (${(e as Error).message}): a dependency left outside the bundle? add it to noExternal`,
          );
        }
      }
      for (const f of ['app.js', 'style.js', 'map.js', 'qr.js']) {
        const n = fs.statSync(path.join(ADMIN_OUT, f)).size;
        if (n > BUDGET)
          throw new Error(`${f} is ${n} bytes, over the ${BUDGET} budget: move what a page rarely needs into a module loaded on demand`);
      }
    },
  },
  {
    entry: { portal: 'src/portal/main.ts' },
    format: ['iife'],
    outDir: PORTAL_OUT,
    outExtension: () => ({ js: '.js' }),
    target: 'es2019',
    clean: true,
    sourcemap: false,
    minify: true,
    noExternal: ['qrcode-generator'],
    esbuildPlugins: [poCatalog],
    esbuildOptions(o) {
      o.legalComments = 'none';
      o.charset = 'utf8';
    },
    onSuccess: async () => {
      fs.writeFileSync(path.join(PORTAL_OUT, 'portal.css'), (await portalCss()) + '\n');
      // portal.uc sends these to a browser that takes gzip (a third of the bytes over a slow link).
      for (const f of ['portal.js', 'portal.css'])
        fs.writeFileSync(path.join(PORTAL_OUT, `${f}.gz`), zlib.gzipSync(fs.readFileSync(path.join(PORTAL_OUT, f)), { level: 9 }));
      fs.copyFileSync('src/portal/icon.svg', path.join(PORTAL_OUT, 'icon.svg'));
    },
  },
]);
