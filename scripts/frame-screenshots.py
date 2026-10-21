#!/usr/bin/env python3
"""Frame the README screenshots the way the portal draws its own surfaces.

Raw captures live in docs/screenshots/raw/<name>.png at SCALE device pixels
per CSS pixel (scripts/capture-screenshots.mjs takes the admin's from a router,
scripts/capture-portal.mjs the portal's from its demo); the framed images
are written to docs/screenshots/<name>.png at the same scale. Each page sits on
a panel like the portal's sheets (#121212, radius 36, 16px around it, the page
inside at radius 20) on the portal's own black. A shot in FLOWS gets its steps
in a row in front of the page's lower edge, numbered: sheets captured alone on
a transparent page (raw/<step>.png, FLOW_MARGIN around each). Needs a
Chromium-based browser for the headless render (BROWSER=/path/to/chrome,
default: Brave or Chrome on macOS).
Run: scripts/frame-screenshots.py [name ...]   (all of them when no name is given)
"""
import os
import shutil
import struct
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
RAW = os.path.join(ROOT, 'docs', 'screenshots', 'raw')
OUT = os.path.join(ROOT, 'docs', 'screenshots')
FONT = os.path.join(ROOT, 'package', 'luci-app-dawnline', 'root', 'usr', 'share', 'dawnline', 'portal', 'assets',
                    'geist-latin-wght-normal.woff2')

SHOTS = ['overview', 'people', 'person', 'portal', 'overview-ru', 'people-ru', 'person-ru', 'portal-ru']
# name -> the steps in front of its page, in order (raw captures). The portal's come from its demo
# (scripts/capture-portal.mjs), not a router: adding a device there would add one. -ru: README_ru's.
FLOWS = {
    'portal': ['portal-add-1', 'portal-add-2', 'portal-add-3'],
    'portal-ru': ['portal-add-1-ru', 'portal-add-2-ru', 'portal-add-3-ru'],
}
PAD_X, PAD_Y, INSET = 96, 80, 16  # canvas around the panel; panel around the page
FLOW_MARGIN = (56, 40, 56, 72)  # around a step's sheet in its capture: left, top, right, bottom
STEP_GAP, STEP_OVER, STEP_PAD = 28, 150, 120  # between steps; how far they reach over the page; canvas beside them
SCALE = 2

CANDIDATES = [
    os.environ.get('BROWSER', ''),
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    shutil.which('chromium') or '',
    shutil.which('google-chrome') or '',
]

TEMPLATE = """<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:Geist;src:url('file://{font}') format('woff2');font-weight:100 900}}
html,body{{margin:0;width:{w}px;height:{h}px;overflow:hidden}}
body{{position:relative;background:#080808}}
.panel{{position:absolute;left:{px}px;top:{py}px;width:{pw}px;height:{ph}px;
 border-radius:36px;background:#121212;box-shadow:inset 0 0 0 1px rgba(255,255,255,.05),0 30px 80px rgba(0,0,0,.5)}}
.page{{position:absolute;left:{x}px;top:{y}px;width:{iw}px;height:{ih}px;display:block;border-radius:20px;
 box-shadow:0 0 0 1px rgba(255,255,255,.04)}}
.sheet{{position:absolute;display:block;filter:drop-shadow(0 24px 48px rgba(0,0,0,.6))}}
.n{{position:absolute;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;
 font:600 16px Geist,sans-serif;color:#ededed;background:#232323;
 box-shadow:0 0 0 1px rgba(255,255,255,.12),0 6px 16px rgba(0,0,0,.5)}}
</style></head><body><div class="panel"></div><img class="page" src="file://{src}">{steps}</body></html>"""


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(24)
    return struct.unpack('>II', head[16:24])


def layout(iw, ih, flow):
    """Where the page goes and its steps in a row in front of its lower edge: (width, height, page x, page y, steps)."""
    w, h = iw + 2 * (INSET + PAD_X), ih + 2 * (INSET + PAD_Y)
    x, y = PAD_X + INSET, PAD_Y + INSET
    if not flow:
        return w, h, x, y, ''
    ml, mt, mr, mb = FLOW_MARGIN
    sizes = [tuple(v // SCALE for v in png_size(src)) for src in flow]
    row = sum(pw - ml - mr for pw, _ in sizes) + STEP_GAP * (len(sizes) - 1)
    w = max(w, row + 2 * STEP_PAD)
    x = (w - iw) // 2
    top = y + ih - STEP_OVER
    h = top + max(ph - mt - mb for _, ph in sizes) + PAD_Y
    out, sx = [], (w - row) // 2
    for i, (src, (pw, ph)) in enumerate(zip(flow, sizes)):
        out.append(f'<img class="sheet" src="file://{src}" style="left:{sx - ml}px;top:{top - mt}px;width:{pw}px;height:{ph}px">')
        out.append(f'<span class="n" style="left:{sx - 14}px;top:{top - 14}px">{i + 1}</span>')
        sx += pw - ml - mr + STEP_GAP
    return w, h, x, y, ''.join(out)


def main():
    browser = next((b for b in CANDIDATES if b and os.path.exists(b)), None)
    if not browser:
        sys.exit('No Chromium-based browser found; set BROWSER=/path/to/chrome')
    only = sys.argv[1:]
    unknown = [n for n in only if n not in SHOTS]
    if unknown:
        sys.exit(f'unknown screenshot {", ".join(unknown)} (one of {", ".join(SHOTS)})')
    tmp = tempfile.mkdtemp()
    for name in SHOTS:
        if only and name not in only:
            continue
        src = os.path.join(RAW, f'{name}.png')
        if not os.path.exists(src):
            print(f'skip {name}: no raw capture')
            continue
        iw, ih = (v // SCALE for v in png_size(src))
        flow = [os.path.join(RAW, f'{step}.png') for step in FLOWS.get(name, [])]
        if not all(os.path.exists(p) for p in flow):
            print(f'{name}: a step is missing, the page alone')
            flow = []
        w, h, x, y, steps = layout(iw, ih, flow)
        html = os.path.join(tmp, f'{name}.html')
        with open(html, 'w', encoding='utf-8') as f:
            f.write(TEMPLATE.format(w=w, h=h, x=x, y=y, iw=iw, ih=ih, px=x - INSET, py=y - INSET, pw=iw + 2 * INSET,
                                    ph=ih + 2 * INSET, src=src, font=FONT, steps=steps))
        out = os.path.join(OUT, f'{name}.png')
        subprocess.run([browser, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
                        f'--force-device-scale-factor={SCALE}', f'--window-size={w},{h}', f'--screenshot={out}', f'file://{html}'],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f'{name}: {w}x{h}')
    shutil.rmtree(tmp)


if __name__ == '__main__':
    main()
