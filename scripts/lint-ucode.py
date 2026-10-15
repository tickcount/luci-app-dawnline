#!/usr/bin/env python3
"""Static checks for the ucode sources that need no router.

ucode resolves names where they are used: calling a function that is declared
further down the same file fails at runtime ("access to undeclared variable").
Run: scripts/lint-ucode.py [package root]
"""
import glob
import os
import re
import sys

root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'package', 'luci-app-dawnline', 'root')
files = glob.glob(f"{root}/usr/share/ucode/dawnline/*.uc") + [
    f"{root}/usr/share/rpcd/ucode/luci.dawnline",
    f"{root}/usr/libexec/dawnline/agent",
    f"{root}/usr/libexec/dawnline/updater",
    f"{root}/usr/libexec/dawnline/resolver",
    f"{root}/usr/bin/dawnline",
    f"{root}/usr/share/dawnline/portal/www/cgi-bin/portal",
]
bad = 0
checked = 0
for f in files:
    if not os.path.exists(f):
        continue
    checked += 1
    code = re.sub(r'//[^\n]*|/\*.*?\*/', '', open(f, encoding='utf-8').read(), flags=re.S)
    defs = {m.group(1): m.start() for m in re.finditer(r'^(?:export )?function (\w+)\(', code, re.M)}
    for name, pos in defs.items():
        for m in re.finditer(r'(?<![\w.\'"`])' + name + r'\(', code[:pos]):
            line = code[: m.start()].count('\n') + 1
            print(f"{f}:{line}: {name}() is used before its definition")
            bad = 1
print(f"lint-ucode: {checked} files checked" + (", problems found" if bad else ", ok"))
sys.exit(bad)
