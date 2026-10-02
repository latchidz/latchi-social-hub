#!/usr/bin/env python3
"""Scenario E (packaged app, real WM via openbox + xdotool):
window controls — maximize, minimize/restore, drag, resize + min-size,
close — driven through the app's own hub API where possible."""
import json, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import cdp
from cdp import shell, out

PORT = sys.argv[1]
cdp.PORT = int(PORT)
APP = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'dist', 'linux-unpacked', 'latchi-social-hub'))

def wm(*cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return (r.stdout + r.stderr).strip()

def win_id():
    # first window whose pid matches our app
    pid = str(proc.pid)
    ids = wm('xdotool', 'search', '--onlyvisible', '--name', 'LATCHI').splitlines()
    ids = [i for i in ids if i.strip()]
    return ids[0] if ids else None

def geom(wid):
    g = wm('xdotool', 'getwindowgeometry', '--shell', wid)
    d = dict(l.split('=', 1) for l in g.splitlines() if '=' in l)
    return int(d['WIDTH']), int(d['HEIGHT']), int(d['X']), int(d['Y'])

def win_metrics():
    return json.loads(sh.eval("JSON.stringify({iw:window.innerWidth,ih:window.innerHeight,ow:window.outerWidth,oh:window.outerHeight,h:document.hidden})"))

proc = subprocess.Popen([APP, f'--remote-debugging-port={PORT}', '--remote-allow-origins=*'],
                        stdout=open('/tmp/pkg-e.log', 'w'), stderr=subprocess.STDOUT)
sh = shell()
time.sleep(2)
wid = win_id()
out('E1 window-found', bool(wid))
m0 = win_metrics(); g0 = geom(wid)
out('E2 initial', {'metrics': m0, 'wm': g0})

# --- MAXIMIZE (through the app's own control) ---
sh.eval("window.hub.windowControl('maximize')")
time.sleep(1.5)
m1 = win_metrics(); g1 = geom(wid)
out('E3 maximize', {'metrics': m1, 'wm': g1, 'bigger': (m1['ow'] > m0['ow'] and m1['oh'] > m0['oh'])})

# --- MINIMIZE (app control) → document.hidden must be true ---
sh.eval("window.hub.windowControl('minimize')")
time.sleep(1.5)
m2 = win_metrics()
hidden_when_min = m2['h']
out('E4 minimize', {'hidden': hidden_when_min})

# --- RESTORE (app control) → back from minimized via WM activation (user path) ---
wm('xdotool', 'windowactivate', wid); time.sleep(1.5)
m3 = win_metrics()
out('E5a wm-activate-after-minimize', {'hidden': m3['h']})
# restore via app API (down from maximized)
sh.eval("window.hub.windowControl('restore')")
time.sleep(1.5)
m3b = win_metrics(); g3b = geom(wid)
out('E5b restore-via-api', {'hidden': m3b['h'], 'back-to-normal': (m3b['ow'] < m1['ow'])})
# maximize again via API, then restore again (toggle path)
sh.eval("window.hub.windowControl('maximize')"); time.sleep(1.2)
g4a = geom(wid)
sh.eval("window.hub.windowControl('restore')"); time.sleep(1.2)
g4b = geom(wid)
out('E5c max-restore-toggle', {'maxed': g4a, 'restored': g4b, 'ok': g4a[1] > g4b[1] + 100})

# --- resize to a normal size, then DRAG via the WM ---
subprocess.run(['xdotool', 'windowsize', wid, '1200', '800']); time.sleep(1)
gx0 = geom(wid)
wm('xdotool', 'windowmove', wid, '60', '60'); time.sleep(1)
gx1 = geom(wid)
out('E6 drag-move', {'before': gx0, 'after': gx1, 'moved': (gx1[2] == 60 and gx1[3] == 60)})

# --- RESIZE below minimum via the WM → app must enforce min 1000x620 ---
subprocess.run(['xdotool', 'windowsize', wid, '800', '500']); time.sleep(1.5)
m4 = win_metrics(); g4 = geom(wid)
out('E7 resize-800x500-min-enforced', {'metrics': m4, 'wm': g4,
    'at-least-min': (m4['iw'] >= 1000 and m4['ih'] >= 620)})

# --- big resize works ---
subprocess.run(['xdotool', 'windowsize', wid, '1400', '900']); time.sleep(1)
m5 = win_metrics()
out('E8 resize-1400x900', m5)

# --- CLOSE via the app's own button → full process exit ---
sh.eval("window.hub.windowControl('close')")
end = time.time() + 15
while time.time() < end and proc.poll() is None:
    time.sleep(0.5)
out('E9 close-exit', proc.poll() is not None)
