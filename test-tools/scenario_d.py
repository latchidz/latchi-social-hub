#!/usr/bin/env python3
"""Scenario D (packaged app, inside an isolated network namespace with a
veth we can up/down LIVE): offline detection, offline screen + retry, and
automatic recovery when connectivity returns — no app restart."""
import json, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from cdp import shell, overlay, page, out

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'dist', 'linux-unpacked', 'latchi-social-hub'))
PORT = sys.argv[1] if len(sys.argv) > 1 else '9335'

def link(state):
    subprocess.run(['ip', 'link', 'set', 'veth1', state], check=False)
    time.sleep(1.2)

def ov_state():
    ov = overlay()
    if not ov: return None
    v = ov.eval("JSON.stringify({t:document.body.dataset.type,vis:document.getElementById('overlay').classList.contains('visible'),p:document.body.dataset.platform,retry:!document.getElementById('ovRetry').hidden})")
    ov.close()
    return json.loads(v)

def net_reported(sh):
    return sh.eval('navigator.onLine')

# 1) launch ONLINE inside the netns
proc = subprocess.Popen([APP, f'--remote-debugging-port={PORT}', '--remote-allow-origins=*', '--no-sandbox'],
                        stdout=open('/tmp/pkg-d.log', 'w'), stderr=subprocess.STDOUT)
sh = shell()
out('D1 online', net_reported(sh))
sh.eval("window.hub.selectPlatform('instagram')")
end = time.time() + 60
while time.time() < end:
    s = ov_state()
    if s and not s['vis']: break
    time.sleep(1)
out('D2 instagram-ready-online', s)

# 2) CUT the connection live
link('down')
out('D3 after-cut navigator.onLine', net_reported(sh))

# 3) open a platform while offline → offline screen + retry
sh.eval("window.hub.selectPlatform('facebook')")
end = time.time() + 70
while time.time() < end:
    s = ov_state()
    if s and s['t'] == 'offline' and s['vis']: break
    time.sleep(1)
out('D4 offline-state', s)

# 4) press retry while still offline → stays offline (correct)
ov = overlay()
ov.eval("document.getElementById('ovRetry').click()")
ov.close()
time.sleep(6)
out('D5 retry-while-offline-stays-offline', ov_state())

# 5) RESTORE connectivity live — app must auto-recover without restart
link('up')
end = time.time() + 90
recovered = None
while time.time() < end:
    s = ov_state()
    if s and not s['vis']:
        recovered = True; break
    time.sleep(1)
out('D6 auto-recovered-after-reconnect', {'recovered': bool(recovered), 'state': s})
out('D7 online-again', net_reported(sh))

fb = page('facebook.com')
out('D8 facebook-content-after-recovery', bool(fb))
if fb:
    c = fb.eval("JSON.stringify({n:document.getElementsByTagName('*').length,r:document.readyState})")
    out('D8b facebook-dom', json.loads(c)); fb.close()

sh.eval("window.hub.windowControl('close')"); time.sleep(2)
out('D9 exited', proc.poll() is not None)
