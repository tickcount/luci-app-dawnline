#!/usr/bin/env python3
"""Static checks for the ucode sources that need no router.

ucode resolves names where they are used: calling a function that is declared
further down the same file fails at runtime ("access to undeclared variable").
Also: calls and named imports must match what a Dawnline module exports, the
rpcd methods (dawnline.rpc.*) must match the plugin and its ACL, and regexes
stay POSIX (rules/backend.md). Imports against the module layering are
reported as notes, not failures.
Run: scripts/lint-ucode.py [package root]
"""
import glob
import json
import os
import re
import sys

root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'package', 'luci-app-dawnline', 'root')
MODDIR = f"{root}/usr/share/ucode/dawnline"
PLUGIN = f"{root}/usr/share/rpcd/ucode/luci.dawnline"
ACL = f"{root}/usr/share/rpcd/acl.d/luci-app-dawnline.json"
modules = sorted(glob.glob(f"{MODDIR}/*.uc") + glob.glob(f"{MODDIR}/rpc/*.uc"))
files = modules + [
    PLUGIN,
    f"{root}/usr/libexec/dawnline/agent",
    f"{root}/usr/libexec/dawnline/updater",
    f"{root}/usr/bin/dawnline",
    f"{root}/usr/share/dawnline/portal/cgi.uc",
]
files = [f for f in files if os.path.exists(f)]
bad = 0


def problem(msg):
    global bad
    print(msg)
    bad = 1


def strip_comments(text):
    return re.sub(r'//[^\n]*|/\*.*?\*/', '', text, flags=re.S)


def blank_comments(text):
    """Comments replaced by their newlines: line numbers stay, their text goes."""
    return re.sub(r'//[^\n]*|/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'), text, flags=re.S)


# A regex literal on one line: `/…/` with no slash inside, followed by flags or
# a delimiter (so a division keeps out). Good enough for how Dawnline writes them.
REGEX_LITERAL = re.compile(r'(?<![\w)\]])/((?:\\.|[^/\\\n])+)/[gis]*(?=[,);\s])')


def modname(path):
    """dawnline/rpc/people.uc → 'rpc.people' (as in import … from 'dawnline.rpc.people')."""
    rel = os.path.relpath(path, MODDIR)[:-3]
    return rel.replace(os.sep, '.')


for f in files:
    code = strip_comments(open(f, encoding='utf-8').read())
    defs = {m.group(1): m.start() for m in re.finditer(r'^(?:export )?function (\w+)\(', code, re.M)}
    for name, pos in defs.items():
        for m in re.finditer(r'(?<![\w.\'"`])' + name + r'\(', code[:pos]):
            line = code[: m.start()].count('\n') + 1
            problem(f"{f}:{line}: {name}() is used before its definition")
    # In a module an exported function is an expression statement: its closing
    # brace needs a semicolon ("Expecting ';'" breaks the whole module).
    lines = blank_comments(open(f, encoding='utf-8').read()).split('\n')
    inside = None
    for n, text in enumerate(lines, 1):
        if inside is None and re.match(r'^export function \w+\(', text):
            inside = n
        elif inside is not None and re.match(r'^}', text):
            if not text.startswith('};'):
                problem(f"{f}:{n}: exported function from line {inside} must end with '}};'")
            inside = None
        # ucode regexes are POSIX: a (?: group fails when the line runs ("Repetition
        # not preceded by valid expression"), and let [a, b] = … does not compile.
        if re.search(r'/[^/\n]*\(\?[:=!][^/\n]*/', text):
            problem(f"{f}:{n}: ucode regexes are POSIX: no (?: (?= (?! groups")
        # Lazy quantifiers (*? +? }?) and the [\s\S] class are PCRE: the C
        # library's regcomp does something else with them or rejects them.
        for m in REGEX_LITERAL.finditer(text):
            body = m.group(1)
            if re.search(r'(?<!\\)[*+}]\?', body):
                problem(f"{f}:{n}: ucode regexes are POSIX: no lazy quantifiers (*? +? }}?) in /{body}/")
            if re.search(r'\[\\[sS]\\[sS]\]', body):
                problem(f"{f}:{n}: ucode regexes are POSIX: no [\\s\\S] class in /{body}/ (use (.|\\n) or a negated class)")
        if re.match(r'\s*(let|const)\s*[\[{]', text):
            problem(f"{f}:{n}: ucode has no destructuring")

# Calls into another Dawnline module (alias.fn(...)) and named imports must name
# something it exports: one removed from a module but still used elsewhere only
# fails at runtime.
exports = {}
for f in modules:
    text = open(f, encoding='utf-8').read()
    exports[modname(f)] = set(re.findall(r'^export (?:function|const|let) (\w+)', text, re.M))
for f in files:
    code = strip_comments(open(f, encoding='utf-8').read())
    for alias, mod in re.findall(r"import \* as (\w+) from 'dawnline\.([\w.]+)'", code):
        if mod not in exports:
            problem(f"{f}: imports dawnline.{mod}, which does not exist")
            continue
        # Calls, and constants (upper case: a lower-case "geo.json" in a string is no access).
        for m in re.finditer(r'(?<![\w.])' + alias + r'\.(\w+\(|[A-Z][A-Z0-9_]*\b)', code):
            name = m.group(1).rstrip('(')
            if name not in exports[mod]:
                line = code[: m.start()].count('\n') + 1
                problem(f"{f}:{line}: {alias}.{name} is not exported by dawnline.{mod}")
    for names, mod in re.findall(r"import \{([^}]*)\} from 'dawnline\.([\w.]+)'", code):
        if mod not in exports:
            problem(f"{f}: imports dawnline.{mod}, which does not exist")
            continue
        for name in re.split(r'\s*,\s*', names.strip()):
            name = re.split(r'\s+as\s+', name)[0].strip()
            if name and name not in exports[mod]:
                problem(f"{f}: {name} is not exported by dawnline.{mod}")

# rpcd methods: every rpc module's `methods` is merged by the plugin, no name is
# defined twice (the later one would silently win), and the ACL's read list
# names methods that exist.
methods = {}
for f in glob.glob(f"{MODDIR}/rpc/*.uc"):
    text = strip_comments(open(f, encoding='utf-8').read())
    m = re.search(r'^export const methods = \{\n(.*?)^\};', text, re.M | re.S)
    if not m:
        continue
    mod = modname(f)
    if os.path.exists(PLUGIN) and f"from 'dawnline.{mod}'" not in open(PLUGIN, encoding='utf-8').read():
        problem(f"{PLUGIN}: does not import dawnline.{mod}, whose methods would be missing")
    for name in re.findall(r"^\t'?(\w+)'?: \{", m.group(1), re.M):
        if name in methods:
            problem(f"{f}: method {name} is also defined in dawnline.{methods[name]}")
        methods[name] = mod
if methods and os.path.exists(ACL):
    acl = json.load(open(ACL, encoding='utf-8'))['luci-app-dawnline']
    for kind in ('read', 'write'):
        for name in acl.get(kind, {}).get('ubus', {}).get('luci.dawnline', []):
            if name != '*' and name not in methods:
                problem(f"{ACL}: {kind} lists {name}, which no dawnline.rpc module defines")
        if 'uci' in acl.get(kind, {}) and 'dawnline' in acl[kind]['uci']:
            problem(f"{ACL}: {kind} grants uci 'dawnline' (private keys, no validation): use the rpc methods")

# Layering (rules/backend.md): util, schema → core → store → domain modules →
# apply → entry points. A module importing one from a layer above it is
# reported, not failed, until the existing edges are untangled.
LAYER = {'util': 0, 'i18n': 0, 'schema': 1, 'core': 2, 'store': 3, 'apply': 5}
LAYER_NAME = {0: 'util', 1: 'schema', 2: 'core', 3: 'store', 4: 'domain', 5: 'apply'}
notes = 0
for f in modules:
    mod = modname(f)
    if mod.startswith('rpc.'):
        continue  # an entry point: may import anything
    mine = LAYER.get(mod, 4)
    for dep in re.findall(r"from 'dawnline\.([\w.]+)'", strip_comments(open(f, encoding='utf-8').read())):
        theirs = LAYER.get(dep, 4)
        if theirs > mine or (theirs == mine and mine < 4 and dep != mod):
            print(f"note: {f}: {mod} ({LAYER_NAME[mine]}) imports dawnline.{dep} ({LAYER_NAME[theirs]}), a layer above it")
            notes += 1
if notes:
    print(f"lint-ucode: {notes} layering notes (not failures)")

print(f"lint-ucode: {len(files)} files checked" + (", problems found" if bad else ", ok"))
sys.exit(bad)
