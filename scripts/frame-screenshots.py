#!/usr/bin/env python3
"""Put the README screenshots into a browser window on a dawn gradient.

Raw captures live in docs/screenshots/raw/<name>.png; the framed images are
written to docs/screenshots/<name>.png. Needs a Chromium-based browser for the
headless render (BROWSER=/path/to/chrome, default: Brave or Chrome on macOS).
Run: scripts/frame-screenshots.py
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

# name -> what the address bar shows
SHOTS = {
    'overview': 'router.lan · Dawnline',
    'people': 'router.lan · Dawnline · People',
    'person': 'router.lan · Dawnline · Myata',
    'portal': 'vpn.example.com/kamiro-telosu-bavine',
    'map': 'router.lan · Dawnline · Overview',
    'access': 'router.lan · Dawnline · Home · Access',
}
PAD_X, PAD_Y, BAR = 120, 96, 40

CANDIDATES = [
    os.environ.get('BROWSER', ''),
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    shutil.which('chromium') or '',
    shutil.which('google-chrome') or '',
]

TEMPLATE = """<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;width:{w}px;height:{h}px;overflow:hidden}}
body{{display:flex;align-items:center;justify-content:center;
 font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
 background:
  radial-gradient({gw}px {gh}px at 50% 118%, rgba(255,140,70,.55), rgba(255,140,70,0) 70%),
  radial-gradient({gw2}px {gh2}px at 50% 100%, rgba(250,90,120,.30), rgba(250,90,120,0) 70%),
  linear-gradient(180deg,#070a14 0%,#0c1226 55%,#1a1430 100%)}}
.win{{width:{iw}px;border-radius:14px;overflow:hidden;background:#000;
 box-shadow:0 0 0 1px rgba(255,255,255,.08),0 40px 120px rgba(0,0,0,.65),0 10px 30px rgba(0,0,0,.4)}}
.bar{{height:{bar}px;background:#15171c;display:flex;align-items:center;gap:8px;padding:0 16px;
 border-bottom:1px solid rgba(255,255,255,.06);position:relative}}
.dot{{width:12px;height:12px;border-radius:50%}}
.url{{position:absolute;left:50%;transform:translateX(-50%);height:24px;padding:0 14px;border-radius:7px;
 background:#0d0f13;color:#8b8f98;font-size:13px;display:flex;align-items:center;gap:6px;white-space:nowrap}}
.url svg{{width:11px;height:11px;fill:none;stroke:#8b8f98;stroke-width:2}}
img{{display:block;width:{iw}px;height:{ih}px}}
</style></head><body><div class="win"><div class="bar">
<span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span>
<span class="url"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>{url}</span>
</div><img src="file://{src}"></div></body></html>"""


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(24)
    return struct.unpack('>II', head[16:24])


def main():
    browser = next((b for b in CANDIDATES if b and os.path.exists(b)), None)
    if not browser:
        sys.exit('No Chromium-based browser found; set BROWSER=/path/to/chrome')
    tmp = tempfile.mkdtemp()
    for name, url in SHOTS.items():
        src = os.path.join(RAW, f'{name}.png')
        if not os.path.exists(src):
            print(f'skip {name}: no raw capture')
            continue
        iw, ih = png_size(src)
        w, h = iw + 2 * PAD_X, ih + BAR + 2 * PAD_Y
        html = os.path.join(tmp, f'{name}.html')
        with open(html, 'w', encoding='utf-8') as f:
            f.write(TEMPLATE.format(w=w, h=h, iw=iw, ih=ih, bar=BAR, url=url, src=src,
                                    gw=int(w * .8), gh=int(h * .5), gw2=int(w * .6), gh2=int(h * .45)))
        out = os.path.join(OUT, f'{name}.png')
        subprocess.run([browser, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
                        '--force-device-scale-factor=1', f'--window-size={w},{h}', f'--screenshot={out}', f'file://{html}'],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f'{name}: {w}x{h}')
    shutil.rmtree(tmp)


if __name__ == '__main__':
    main()
