#!/usr/bin/env python3
"""Scenario D3 (final offline flow, packaged app):
cut network → open platform → OFFLINE screen visible → restore network
(re-add route) → press the real Retry button → platform recovers live,
no app restart. This mirrors the required test steps exactly."""
import json, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import cdp
from cdp import shell, overlay, page, out

PORT = sys.argv[1]
cdp.PORT = int(PORT)
APP = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'dist', 'linux-unpacked', 'latchi-social-hub'))

def sh(*cmd):
    subprocess.run(cmd, check=False)

def cut():
    sh('sudo', 'ip', 'link', 'set', 'veth1', 'down')
    time.sleep(1.2)

def restore():
    sh('sudo', 'ip', 'link', 'set', 'veth1', 'up')
    time.sleep(0.5)
    sh('sudo', 'ip', 'netns', 'exec', 'lshtest', 'ip', 'route', 'add', 'default', 'via', '10.200.0.1')
    time.sleep(2)

def ov_full():
    ov = overlay()
    if not ov: return None
    v = ov.eval("JSON.stringify({t:document.body.dataset.type,vis:document.getElementById('overlay').classList.contains('visible'),retry:!document.getElementById('ovRetry').hidden})")
    ov.close()
    return json.loads(v)

proc = subprocess.Popen([APP, f'--remote-debugging-port={PORT}', '--remote-allow-origins=*'],
                        stdout=open('/tmp/pkg-d3.log', 'w'), stderr=subprocess.STDOUT)
sh_ = shell()

# 1) online first — make sure networking works
out('D3-1 online', sh_.eval('navigator.onLine'))
sh_.eval("window.hub.selectPlatform('instagram')")
end = time.time() + 60
while time.time() < end:
    s = ov_full()
    if s and not s['vis']: break
    time.sleep(1)
out('D3-2 instagram-ready', s)

# 2) CUT
cut()
out('D3-3 navigator-onLine-after-cut', sh_.eval('navigator.onLine'))

# 3) open a platform while offline → offline screen, visible, retry button
sh_.eval("window.hub.selectPlatform('facebook')")
end = time.time() + 70
while time.time() < end:
    s = ov_full()
    if s and s['t'] == 'offline' and s['vis']: break
    time.sleep(1)
out('D3-4 offline-screen', s)

# 4) retry while still offline → must stay offline (nothing to load)
ov = overlay()
ov.eval("document.getElementById('ovRetry').click()"); ov.close()
time.sleep(6)
out('D3-5 retry-while-offline', ov_full())

# 5) RESTORE network, then press Retry → live recovery, no restart
restore()
out('D3-6 navigator-onLine-after-restore', sh_.eval('navigator.onLine'))
ov = overlay()
ov.eval("document.getElementById('ovRetry').click()"); ov.close()

end = time.time() + 90
recovered = False
while time.time() < end:
    s = ov_full()
    if s and not s['vis']:
        recovered = True; break
    time.sleep(1)
out('D3-7 recovered-after-retry', {'recovered': recovered, 'overlay': s})

time.sleep(6)  # let the SPA paint
fb = page('facebook.com')
if fb:
    c = fb.eval("JSON.stringify({n:document.getElementsByTagName('*').length,tc:(document.body&&document.body.textContent||'').replace(/\\s+/g,' ').trim().length,r:document.readyState,u:location.href.split('/').slice(0,3).join('/')})")
    out('D3-8 facebook-content-after-recovery', json.loads(c)); fb.close()
else:
    out('D3-8 facebook-content-after-recovery', 'NO TARGET')

sh_.eval("window.hub.windowControl('close')"); time.sleep(2)
out('D3-9 exited', proc.poll() is not None)
