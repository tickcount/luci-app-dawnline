// Dawnline's string catalogs, collected from the code (run in web/):
//
//   node i18n/extract.ts                     rewrite the .pot templates and merge the .po translations
//   node i18n/extract.ts --check             CI: fail when a catalog is out of date or a string is untranslated
//   node i18n/extract.ts --import a.json …   also take translations from drafts: [{ id, ctx?, plural?, str }],
//                                            str a string or, for a plural, one per form
//   node i18n/extract.ts --lint [--import a.json …] [--only src/admin/x.ts …]
//                                            write nothing: report string problems, bad or stray drafts
//                                            and, with --only, the strings of those files left untranslated
//
// Three catalogs (rules/i18n.md):
//   dawnline — the admin UI, its shared code, the backend's messages and the
//              LuCI menu: package/luci-app-dawnline/po (luci.mk builds
//              luci-i18n-dawnline-<lang> from it)
//   portal   — the personal portal, the shared code and the messages of the
//              backend modules the portal runs: src/portal/i18n, bundled into portal.js
//   demo     — what only the portal demo says: src/portal/demo/i18n
//
// A string is collected from _('…'), N_(n, '…', '…') and plural(n, '…', '…')
// with literal arguments, and from the backend's L_('…'): a service log line's
// words, written in English and put into the reader's language when shown (they
// also go into src/admin/events/log-templates.ts, the list the admin page
// matches log lines against). Anything else under those names is an error, as is
// a string LuCI could not find again (leading, trailing or doubled whitespace,
// newlines) and, in the portal and the shared code, a call at module level
// (the portal changes language in place, so text is made when it is drawn).
// The catalogs keep the files a string comes from, not lines: they change
// only when strings do.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import ts from 'typescript';
import { keyOf, parsePo, pluralForms, translated, writePo, type Entry, type Po } from './po.ts';

const WEB = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(WEB, '..');
const PKG = path.join(REPO, 'package/luci-app-dawnline');

/** The translations and their gettext plural rules (po2lmo hands the formula to LuCI's N_()). */
const LANGS: Record<string, { team: string; plural: string }> = {
  ru: {
    team: 'Russian',
    plural: 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
  },
};

const walk = (dir: string, keep: (f: string) => boolean): string[] =>
  !fs.existsSync(dir)
    ? []
    : fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((d) =>
          d.isDirectory() ? walk(path.join(dir, d.name), keep) : keep(path.join(dir, d.name)) ? [path.join(dir, d.name)] : [],
        )
        .sort();

const tsFiles = (dir: string, skip?: string) =>
  walk(path.join(WEB, dir), (f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !(skip && f.startsWith(path.join(WEB, skip) + path.sep)));

/** The backend: ucode modules and the ucode programs (by their shebang) in the package. */
const ucodeFiles = () =>
  walk(path.join(PKG, 'root'), (f) => f.endsWith('.uc') || (!path.extname(f) && fs.readFileSync(f, 'utf8').startsWith('#!/usr/bin/ucode')));

/**
 * The backend modules whose messages reach the portal's visitors (its own
 * refusals, what refuses a device change, the keys): the page translates them when
 * the router sends them in English (no translation package installed).
 */
const PORTAL_UCODE = ['portal.uc', 'devices.uc', 'core.uc', 'awg.uc'].map((f) => path.join(PKG, 'root/usr/share/ucode/dawnline', f));

const menuFiles = () => walk(path.join(PKG, 'root/usr/share/luci/menu.d'), (f) => f.endsWith('.json'));

interface CatalogSpec {
  name: string;
  pot: string;
  po: (lang: string) => string;
  sources: () => string[];
  menus?: () => string[];
  /** Strings here are made when the page is drawn (the portal switches language in place). */
  lazy: (file: string) => boolean;
  /** The service log's words (L_) are in it: only the admin page shows the log. */
  logs?: boolean;
}

const CATALOGS: CatalogSpec[] = [
  {
    name: 'dawnline',
    pot: path.join(PKG, 'po/templates/dawnline.pot'),
    po: (l) => path.join(PKG, `po/${l}/dawnline.po`),
    sources: () => [...tsFiles('src/admin'), ...tsFiles('src/shared'), ...ucodeFiles()],
    menus: menuFiles,
    logs: true,
    // rpcd keeps the backend's modules loaded while the language changes per call.
    lazy: (f) => f.startsWith(path.join(WEB, 'src/shared')) || f.startsWith(path.join(PKG, 'root')),
  },
  {
    name: 'portal',
    pot: path.join(WEB, 'src/portal/i18n/portal.pot'),
    po: (l) => path.join(WEB, `src/portal/i18n/${l}.po`),
    sources: () => [...tsFiles('src/portal', 'src/portal/demo'), ...tsFiles('src/shared'), ...PORTAL_UCODE],
    lazy: () => true,
  },
  {
    name: 'demo',
    pot: path.join(WEB, 'src/portal/demo/i18n/demo.pot'),
    po: (l) => path.join(WEB, `src/portal/demo/i18n/${l}.po`),
    sources: () => tsFiles('src/portal/demo'),
    lazy: () => true,
  },
];

/** Where the wrappers themselves pass strings on: not literals, by design. */
const WRAPPERS = new Set([path.join(WEB, 'src/shared/i18n.ts'), path.join(WEB, 'src/portal/i18n.ts')]);

/** The string arguments of each translation call: [msgid, msgid_plural?, msgctxt?]; `log`: a log line's words (L_). */
const CALLS: Record<string, { id: number; plural?: number; ctx?: number; log?: boolean }> = {
  _: { id: 0, ctx: 1 },
  N_: { id: 1, plural: 2, ctx: 3 },
  plural: { id: 1, plural: 2 },
  L_: { id: 0, log: true },
};

/** The generated list of log line templates (L_), for the admin page. */
const LOG_TEMPLATES_FILE = path.join(WEB, 'src/admin/events/log-templates.ts');
const logTemplates = new Set<string>();

const rel = (f: string) => path.relative(REPO, f).split(path.sep).join('/');

/** Why LuCI would not find this string again, or null. Its lookup squeezes whitespace (cbi.js trimws). */
export function badText(s: string): string | null {
  if (!s) return 'is empty';
  if (/[\n\r\t]/.test(s)) return 'has a newline or a tab (po2lmo cannot carry them)';
  if (/^\s|\s$/.test(s)) return 'starts or ends with a space';
  if (/\s\s/.test(s)) return 'has two spaces in a row';
  return null;
}

interface Found extends Entry {
  files: Set<string>;
}

class Errors {
  list: string[] = [];
  add(where: string, msg: string) {
    this.list.push(`${where}: ${msg}`);
  }
}

function isFunctionLike(n: ts.Node): boolean {
  return ts.isFunctionLike(n) || ts.isPropertyDeclaration(n) || ts.isClassStaticBlockDeclaration(n);
}

/** Every translation call in one file. */
function scan(file: string, lazy: boolean, logs: boolean, errors: Errors, out: Found[]) {
  const text = fs.readFileSync(file, 'utf8');
  const kind = file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const wrapper = WRAPPERS.has(file);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && CALLS[node.expression.text] && !wrapper) {
      const name = node.expression.text;
      const spec = CALLS[name];
      const where = `${rel(file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
      const lit = (i: number | undefined): string | undefined | null => {
        if (i === undefined) return undefined;
        const a = node.arguments[i];
        if (!a) return undefined;
        return ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) ? a.text : null;
      };
      const id = lit(spec.id);
      const pl = lit(spec.plural);
      const ctx = lit(spec.ctx);
      if (id == null || pl === null || (spec.plural !== undefined && pl === undefined) || ctx === null) {
        errors.add(
          where,
          `${name}() needs string literals: a variable or a template with \${…} cannot be collected (fill placeholders with fmt())`,
        );
      } else {
        for (const [what, s] of [
          ['msgid', id],
          ['plural', pl],
          ['context', ctx],
        ] as const)
          if (s !== undefined) {
            const why = badText(s);
            if (why) errors.add(where, `the ${what} ${JSON.stringify(s)} ${why}`);
          }
        // A log line's words are not translated where they are written: anywhere goes.
        if (spec.log) logTemplates.add(id);
        else if (lazy && !wrapper) {
          let p: ts.Node | undefined = node.parent;
          while (p && !isFunctionLike(p)) p = p.parent;
          if (!p) errors.add(where, `${name}() at module level: here text is made when it is drawn (the portal changes language in place)`);
        }
        const e: Found = { id, str: [], refs: [], files: new Set([rel(file)]) };
        if (spec.log && !logs) return;
        if (pl !== undefined) e.plural = pl;
        if (ctx !== undefined) e.ctx = ctx;
        out.push(e);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/** LuCI's menu titles (translated by the theme's menu). */
function scanMenu(file: string, out: Found[]) {
  const menu = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, { title?: string }>;
  for (const node of Object.values(menu)) if (node.title) out.push({ id: node.title, str: [], refs: [], files: new Set([rel(file)]) });
}

/** One catalog's strings, deduplicated and sorted (by code unit: the same order on every machine). */
function collect(spec: CatalogSpec, errors: Errors): Entry[] {
  const found: Found[] = [];
  for (const f of spec.sources()) scan(f, spec.lazy(f), !!spec.logs, errors, found);
  for (const f of spec.menus?.() ?? []) scanMenu(f, found);
  const byKey = new Map<string, Found>();
  for (const e of found) {
    const k = keyOf(e);
    const had = byKey.get(k);
    if (!had) byKey.set(k, e);
    else if (had.plural !== e.plural)
      errors.add(
        [...e.files][0],
        `${JSON.stringify(e.id)} is used ${had.plural === undefined || e.plural === undefined ? 'both as a plural and as a plain string' : `with two plurals (${JSON.stringify(had.plural)}, ${JSON.stringify(e.plural)})`}: give one of them a context`,
      );
    else e.files.forEach((f) => had.files.add(f));
  }
  return [...byKey.values()]
    .map(({ files, ...e }) => ({ ...e, refs: [...files].sort() }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : (a.ctx ?? '') < (b.ctx ?? '') ? -1 : (a.ctx ?? '') > (b.ctx ?? '') ? 1 : 0));
}

const HEADER: [string, string][] = [
  ['Project-Id-Version', 'Dawnline'],
  ['MIME-Version', '1.0'],
  ['Content-Type', 'text/plain; charset=UTF-8'],
  ['Content-Transfer-Encoding', '8bit'],
];

const read = (f: string): Po | null => (fs.existsSync(f) ? parsePo(fs.readFileSync(f, 'utf8')) : null);

interface Draft {
  id: string;
  ctx?: string;
  plural?: string;
  str: string | string[];
}

/** The placeholders of a string, in order: what a translation must keep. */
export const holes = (s: string) => (s.match(/%[sd]/g) ?? []).join(' ');

/** Problems in one translation, for --check and the summary. */
export function badTranslation(e: Entry): string | null {
  const want = holes(e.plural ?? e.id);
  if (e.plural !== undefined && holes(e.id) !== want) return `the singular and the plural have different placeholders`;
  for (const s of e.str) {
    if (!s) continue;
    if (s.includes('\\')) return `${JSON.stringify(s)} has a backslash (po2lmo would show it as written)`;
    if (s.includes('—')) return `${JSON.stringify(s)} has an em dash: use a plain dash (rules/i18n.md)`;
    const why = badText(s);
    if (why) return `${JSON.stringify(s)} ${why}`;
    if (holes(s) !== want) return `${JSON.stringify(s)} has the placeholders "${holes(s)}", the English "${want}"`;
  }
  return null;
}

/** The command line: --check, --lint, and the files after --import and --only. */
function options(argv: string[]) {
  const o = { check: false, lint: false, imports: [] as string[], only: [] as string[] };
  let list: string[] | null = null;
  for (const a of argv) {
    if (a === '--check' || a === '--lint') {
      o[a === '--check' ? 'check' : 'lint'] = true;
      list = null;
    } else if (a === '--import') list = o.imports;
    else if (a === '--only') list = o.only;
    else if (list) list.push(a);
    else throw new Error(`unknown argument ${a} (see the top of i18n/extract.ts)`);
  }
  return o;
}

const draftKey = (d: { ctx?: string; id: string; plural?: string }) => keyOf(d) + (d.plural !== undefined ? '\u0002' : '');

/** The list of log line templates as a module (formatted as the repo formats code). */
async function logTemplatesModule(): Promise<string> {
  const list = [...logTemplates].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const code = [
    "// Generated by web/i18n/extract.ts from the backend's L_() strings (npm run i18n): do not edit.",
    '// The words of service log lines, as written; events/model.ts matches log lines against them.',
    '',
    `export const LOG_TEMPLATES: string[] = ${JSON.stringify(list)};`,
    '',
  ].join('\n');
  return prettier.format(code, { ...(await prettier.resolveConfig(LOG_TEMPLATES_FILE)), filepath: LOG_TEMPLATES_FILE });
}

async function main() {
  const opt = options(process.argv.slice(2));
  const errors = new Errors();
  const problems: string[] = [];

  const drafts = new Map<string, Draft & { from: string }>();
  for (const f of opt.imports)
    for (const d of JSON.parse(fs.readFileSync(path.resolve(f), 'utf8')) as Draft[]) {
      const had = drafts.get(draftKey(d));
      if (had && JSON.stringify(had.str) !== JSON.stringify(d.str))
        problems.push(
          `drafts disagree on ${JSON.stringify(d.id)}: ${JSON.stringify(had.str)} (${had.from}), ${JSON.stringify(d.str)} (${f})`,
        );
      drafts.set(draftKey(d), { ...d, from: f });
    }
  const usedDrafts = new Set<string>();

  const collected = CATALOGS.map((spec) => ({ spec, entries: collect(spec, errors) }));
  const only = opt.only.map((f) => rel(path.resolve(f)));
  const under = (r: string) => only.some((o) => r === o || r.startsWith(`${o}/`));
  // Linting some files: the problems of those (other files may be half-way through a change).
  if (opt.lint) problems.push(...errors.list.filter((e) => !only.length || under(e.replace(/:\d+: [\s\S]*$/, ''))));
  else if (errors.list.length) {
    console.error(errors.list.join('\n'));
    console.error(`\n${errors.list.length} string problem(s): fix them in the code (rules/i18n.md).`);
    process.exit(1);
  }

  // What each language already has, across catalogs: a string translated in one is reused in the others.
  const known = new Map<string, Map<string, string[]>>();
  for (const lang of Object.keys(LANGS)) {
    const m = new Map<string, string[]>();
    for (const { spec } of collected)
      for (const e of read(spec.po(lang))?.entries ?? [])
        if (translated(e)) m.set(keyOf(e) + (e.plural !== undefined ? `\u0002${e.plural}` : ''), e.str);
    known.set(lang, m);
  }

  const inOnly = (e: Entry) => e.refs.some(under);
  const out = new Map<string, string>();
  const report: string[] = [];
  const missingOnly = new Set<string>();
  for (const { spec, entries } of collected) {
    out.set(
      spec.pot,
      writePo({
        header: [...HEADER, ['Plural-Forms', 'nplurals=2; plural=(n != 1);']],
        entries: entries.map((e) => ({ ...e, str: e.plural !== undefined ? ['', ''] : [''] })),
      }),
    );
    for (const [lang, info] of Object.entries(LANGS)) {
      const file = spec.po(lang);
      const old = new Map((read(file)?.entries ?? []).map((e) => [draftKey(e), e]));
      const header: [string, string][] = [...HEADER, ['Language', lang], ['Language-Team', info.team], ['Plural-Forms', info.plural]];
      const forms = pluralForms({ header, entries: [] });
      const merged = entries.map((e): Entry => {
        const k = draftKey(e);
        const blank = e.plural !== undefined ? Array<string>(forms).fill('') : [''];
        const draft = drafts.get(k);
        if (draft) {
          usedDrafts.add(k);
          const str = Array.isArray(draft.str) ? draft.str : [draft.str];
          if (str.length === blank.length) return { ...e, str };
          problems.push(`${spec.name}/${lang}: the draft for ${JSON.stringify(e.id)} has ${str.length} form(s), ${blank.length} needed`);
        }
        const was = old.get(k);
        // A changed plural keeps its forms only when the English plural stayed the same.
        if (was && translated(was) && was.plural === e.plural) return { ...e, str: was.str };
        const other = known.get(lang)!.get(keyOf(e) + (e.plural !== undefined ? `\u0002${e.plural}` : ''));
        return { ...e, str: other && other.length === blank.length ? other : blank };
      });
      out.set(file, writePo({ header, entries: merged }));
      const missing = merged.filter((e) => !translated(e));
      for (const e of merged) {
        const why = badTranslation(e);
        if (why && (!only.length || inOnly(e))) problems.push(`${rel(file)}: ${JSON.stringify(e.id)}: ${why}`);
      }
      report.push(`${spec.name}/${lang}: ${merged.length - missing.length} of ${merged.length} translated`);
      if (opt.check)
        for (const e of missing) problems.push(`${rel(file)}: untranslated ${JSON.stringify(e.id)}${e.ctx ? ` (${e.ctx})` : ''}`);
      for (const e of missing)
        if (inOnly(e))
          missingOnly.add(
            `no translation for ${JSON.stringify(e.id)}${e.ctx ? ` (context ${e.ctx})` : ''}${e.plural !== undefined ? ` (plural ${JSON.stringify(e.plural)})` : ''} [${e.refs.filter(under).join(' ')}]`,
          );
    }
  }
  for (const [k, d] of drafts)
    if (!usedDrafts.has(k))
      problems.push(`draft ${JSON.stringify(d.id)}${d.plural !== undefined ? ' (plural)' : ''} is not in the code (${d.from})`);
  problems.push(...missingOnly);

  out.set(LOG_TEMPLATES_FILE, await logTemplatesModule());

  if (opt.check || opt.lint) {
    if (opt.check)
      for (const [f, text] of out)
        if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== text)
          problems.unshift(`${rel(f)} is out of date: run "npm run i18n" in web/ and commit the result`);
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exit(1);
    }
    console.log(opt.lint ? 'No problems.' : report.join('\n'));
    return;
  }
  for (const [f, text] of out) {
    if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === text) continue;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  console.log(report.join('\n'));
  if (problems.length) console.warn(`\n${problems.join('\n')}`);
}

// Run as a program; imported (by the tests), only the checks above.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
