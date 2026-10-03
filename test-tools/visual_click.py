#!/usr/bin/env python3
"""Visual/real-input check (dev-only tool, NOT part of the packaged app).

Lesson of 0.1.0: DOM/API-driven tests all passed while a CSS bug rendered
the confirm-modal backdrop over the whole shell at boot — the sidebar was
fogged and dead for REAL mouse users. This tool drives the app with real
X11 mouse clicks and verifies the composited result.

Requires (sandbox/dev machine): xvfb, openbox, xdotool, imagemagick.

Usage:
  xvfb-run -a --server-args="-screen 0 1440x900x24" bash -c \
    'openbox & sleep 2; python3 test-tools/visual_click.py 9360; kill %1'
"""
import json, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import cdp
from cdp import shell, out

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9360
cdp.PORT = PORT
HOME = os.environ.get('LSH_VISUAL_HOME', '/tmp/lsh-visual-home')
os.makedirs(HOME, exist_ok=True)
# Deterministic baseline: the sandbox may have ≤4.9GB RAM, which would
# auto-enable performance mode on first boot (LRU view budget would then
# reload platforms mid-click-through). Seed the real userData of BOTH
# possible app names with perfMode=false so the visual run exercises the
# standard profile; the perf paths have their own smoke section.
for _app in ('latchi-social-hub', 'LATCHI SOCIAL HUB'):
    _cfg = os.path.join(HOME, '.config', _app)
    os.makedirs(_cfg, exist_ok=True)
    _sf = os.path.join(_cfg, 'settings.json')
    try:
        _cur = json.load(open(_sf)) if os.path.exists(_sf) else {}
    except Exception:
        _cur = {}
    _cur['perfMode'] = False
    json.dump(_cur, open(_sf, 'w'))

def xdotool(*cmd):
    return subprocess.run(['xdotool', *cmd], capture_output=True, text=True).stdout.strip()

proc = subprocess.Popen(['npx', 'electron', '.', f'--remote-debugging-port={PORT}', '--remote-allow-origins=*'],
                        cwd=os.path.join(os.path.dirname(__file__), '..'),
                        env=dict(os.environ, HOME=HOME),
                        stdout=open('/tmp/lsh-visual.log', 'w'), stderr=subprocess.STDOUT)
try:
    end = time.time() + 45
    while time.time() < end:
        try:
            s = shell(); break
        except Exception:
            time.sleep(1)
    time.sleep(4)

    wid = xdotool('search', '--onlyvisible', '--name', 'LATCHI').splitlines()[0]
    geo = dict(l.split('=', 1) for l in xdotool('getwindowgeometry', '--shell', wid).splitlines() if '=' in l)
    wx, wy = int(geo['X']), int(geo['Y'])
    out('V1 window', {'id': wid, 'pos': (wx, wy)})

    # 8 platforms, dynamic rectangular tiles (sidebar is scrollable for 8)
    tiles = json.loads(s.eval(
        "JSON.stringify([...document.querySelectorAll('.tile[data-platform]')]"
        ".map(t=>({id:t.dataset.platform, top:t.getBoundingClientRect().top}))"
        ".map(o=>({id:o.id, visible:o.top>0 && o.top<innerHeight})))"))
    out('V1b tiles', tiles)
    for platform in [t['id'] for t in tiles]:
        # scroll the sidebar until the tile is on-screen (8 tiles overflow at 900px)
        s.eval(f"document.querySelector('.tile[data-platform={platform}]').scrollIntoView({{block:'center'}})")
        time.sleep(0.25)
        btn = json.loads(s.eval(
            f"JSON.stringify((r=>({{cx:r.left+r.width/2,cy:r.top+r.height/2}}))"
            f"(document.querySelector('.tile[data-platform={platform}]').getBoundingClientRect()))"))
        xdotool('mousemove', str(int(wx + btn['cx'])), str(int(wy + btn['cy'])))
        time.sleep(0.3)
        xdotool('click', '1')
        deadline = time.time() + 30
        active = None
        while time.time() < deadline:
            active = s.eval(f"document.querySelector('.tile.active')?.dataset.platform || null")
            if active == platform: break
            time.sleep(1)
        out(f'V2 real-click {platform}', 'ACTIVATED' if active == platform else f'FAILED (active={active})')

    subprocess.run(['import', '-window', wid, '/tmp/lsh-visual-final.png'])
    out('V3 composited-screenshot', '/tmp/lsh-visual-final.png')
finally:
    try: s.eval("window.hub.windowControl('close')")
    except Exception: pass
    time.sleep(2)
    out('V4 exited', proc.poll() is not None)
