#!/usr/bin/env python3
"""CDP driver for the packaged LATCHI SOCIAL HUB (production validation)."""
import json, subprocess, sys, time, urllib.request, uuid
from websocket import create_connection

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9222

def http_json(path):
    for _ in range(60):
        try:
            return json.loads(urllib.request.urlopen(f'http://127.0.0.1:{PORT}{path}', timeout=2).read())
        except Exception:
            time.sleep(0.5)
    raise SystemExit(f'CDP http endpoint not reachable on {PORT}')

def targets():
    return [t for t in http_json('/json') if t.get('type') == 'page']

def find_target(substr):
    for t in targets():
        if substr in t.get('url', ''):
            return t
    return None

class Page:
    def __init__(self, ws_url, name):
        self.ws = create_connection(ws_url, timeout=30)
        self.name = name
        self._id = 0
    def eval(self, expr, await_promise=False):
        self._id += 1
        self.ws.send(json.dumps({'id': self._id, 'method': 'Runtime.evaluate', 'params': {
            'expression': expr, 'returnByValue': True, 'awaitPromise': await_promise}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get('id') == self._id:
                r = msg.get('result', {})
                if 'exceptionDetails' in r:
                    return {'__exc': r['exceptionDetails'].get('exception', {}).get('description', 'exception')}
                return r.get('result', {}).get('value')
    def close(self):
        try: self.ws.close()
        except Exception: pass

def page(substr, wait=20):
    """Connect to a target whose URL contains substr."""
    end = time.time() + wait
    while time.time() < end:
        t = find_target(substr)
        if t:
            return Page(t['webSocketDebuggerUrl'], substr)
        time.sleep(0.5)
    return None

def shell():
    p = page('shell/index.html', 30)
    if not p: raise SystemExit('shell target not found')
    return p

def overlay():
    return page('overlay/overlay.html', 10)

def wait_platform_ready(pid, timeout=60):
    """Wait until the platform overlay is no longer showing loading for pid."""
    end = time.time() + timeout
    while time.time() < end:
        ov = overlay()
        if ov:
            v = ov.eval("JSON.stringify({t:document.body.dataset.type,vis:document.getElementById('overlay').classList.contains('visible'),p:document.body.dataset.platform})")
            ov.close()
            try:
                d = json.loads(v)
                if not (d['vis'] and d['p'] == pid):
                    return True  # overlay no longer covering this platform
            except Exception:
                pass
        time.sleep(0.6)
    return False

def out(label, val):
    print(f'{label}: {json.dumps(val, ensure_ascii=False)}', flush=True)
