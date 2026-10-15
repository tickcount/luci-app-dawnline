#!/usr/bin/env python3
"""Static checks for the ucode sources that need no router.

ucode resolves names where they are used: calling a function that is declared
further down the same file fails at runtime ("access to undeclared variable").
Also: calls and named imports must match what a Dawnline module exports, and
the rpcd methods (dawnline.rpc.*) must match the plugin and its ACL.
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
    f"{root}/usr/libexec/dawnline/resolver",
    f"{root}/usr/bin/dawnline",
    f"{root}/usr/share/dawnline/portal/www/cgi-bin/portal",
]
files = [f for f in files if os.path.exists(f)]
bad = 0


def problem(msg):
    global bad
    print(msg)
    bad = 1


def strip_comments(text):
    return re.sub(r'//[^\n]*|/\*.*?\*/', '', text, flags=re.S)


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
    lines = open(f, encoding='utf-8').read().split('\n')
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

print(f"lint-ucode: {len(files)} files checked" + (", problems found" if bad else ", ok"))
sys.exit(bad)
