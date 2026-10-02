#!/usr/bin/env python3
"""Scenario D2: same offline flow, but run as a normal user (no root,
no --no-sandbox if possible) to isolate the environment variable.
Also captures overlay visibility internals + screenshots."""
import json, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from cdp import shell, overlay, page, out, Page, http_json

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'dist', 'linux-unpacked', 'latchi-social-hub'))
PORT = sys.argv[1] if len(sys.argv) > 1 else '9336'
EXTRA = sys.argv[2:]  # e.g. --no-sandbox

def link(state):
    subprocess.run(['sudo', 'ip', 'link', 'set', 'veth1', state], check=False)
    time.sleep(1.5)

def ov_full():
    ov = overlay()
    if not ov: return None
    v = ov.eval("JSON.stringify({t:document.body.dataset.type,vis:document.getElementById('overlay').classList.contains('visible'),hidden:document.hidden,vs:document.visibilityState,retry:!document.getElementById('ovRetry').hidden})")
    ov.close()
    return json.loads(v)

def shot(target_substr, name):
    t = None
    for x in http_json('/json'):
        if x.get('type') == 'page' and target_substr in x.get('url', ''):
            t = x; break
    if not t: return False
    p = Page(t['webSocketDebuggerUrl'], name)
    p._id += 1
    p.ws.send(json.dumps({'id': p._id, 'method': 'Page.captureScreenshot', 'params': {'format': 'png'}}))
    import base64
    while True:
        m = json.loads(p.ws.recv())
        if m.get('id') == p._id:
            data = m.get('result', {}).get('data')
            if data:
                open(f'/tmp/lsh-d2-{name}.png', 'wb').write(base64.b64decode(data))
                p.close(); return True
            p.close(); return False

env = dict(os.environ)
proc = subprocess.Popen([APP, f'--remote-debugging-port={PORT}', '--remote-allow-origins=*'] + EXTRA,
                        env=env, stdout=open('/tmp/pkg-d2.log', 'w'), stderr=subprocess.STDOUT)
sh = shell()
out('D2-1 boot-overlay', ov_full())

link('down')
out('D2-2 online-after-cut', sh.eval('navigator.onLine'))
sh.eval("window.hub.selectPlatform('facebook')")
end = time.time() + 70
last = None
while time.time() < end:
    last = ov_full()
    if last and last['t'] == 'offline': break
    time.sleep(1)
out('D2-3 offline-state-full', last)
shot('shell/index.html', 'shell-offline')
shot('overlay/overlay.html', 'overlay-offline')

link('up')
end = time.time() + 90
rec = False
while time.time() < end:
    s = ov_full()
    if s and s['t'] != 'offline':
        rec = True; break
    time.sleep(1)
out('D2-4 after-reconnect', {'recovered': rec, 'state': s})
time.sleep(6)  # let facebook fully load
fb = page('facebook.com')
if fb:
    c = fb.eval("JSON.stringify({n:document.getElementsByTagName('*').length,tc:(document.body&&document.body.textContent||'').length,r:document.readyState})")
    out('D2-5 facebook-dom', json.loads(c)); fb.close()
shot('shell/index.html', 'shell-recovered')

sh.eval("window.hub.windowControl('close')"); time.sleep(2)
out('D2-6 exited', proc.poll() is not None)
