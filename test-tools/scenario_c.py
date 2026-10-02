#!/usr/bin/env python3
"""Scenario C (packaged app): download policy — sanitized names, no path
traversal, no silent overwrite, always into the OS Downloads folder."""
import http.server, json, os, socketserver, subprocess, sys, threading, time, glob
sys.path.insert(0, os.path.dirname(__file__))
from cdp import shell, page, out

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'dist', 'linux-unpacked', 'latchi-social-hub'))
PORT = sys.argv[1] if len(sys.argv) > 1 else '9333'
DL = os.path.expanduser('~/Downloads')

FILES = {
    '/f/normal.txt': (b'LATCHI SOCIAL HUB download policy test file\n', 'attachment; filename="lsh-download-test.txt"'),
    '/f/traversal.txt': (b'traversal probe\n', 'attachment; filename="../../../evil-lsh.txt"'),
}

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body, disp = FILES.get(self.path, (b'not found', 'inline'))
        self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Disposition', disp)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass

socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(('127.0.0.1', 8766), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()

for f in glob.glob(os.path.join(DL, 'lsh-download-test*')) + glob.glob(os.path.join(DL, 'evil-lsh*')) + glob.glob(os.path.expanduser('~/*evil-lsh*')) + glob.glob('/home/user/evil-lsh*'):
    os.remove(f)

proc = subprocess.Popen([APP, f'--remote-debugging-port={PORT}', '--remote-allow-origins=*'],
                        stdout=open('/tmp/pkg-c.log', 'w'), stderr=subprocess.STDOUT)
sh = shell()

# open instagram (https page) and trigger downloads from inside the platform page
sh.eval("window.hub.selectPlatform('instagram')")
time.sleep(10)
ig = page('instagram.com')
out('C1 instagram-page', bool(ig))

CLICK = """(function(u){{
  const a = document.createElement('a'); a.href = u; a.textContent = 'dl';
  document.body.appendChild(a); a.click(); a.remove(); return 'clicked';
}})('{url}')"""

if ig:
    out('C2 trigger-normal-download', ig.eval(CLICK.format(url='http://127.0.0.1:8766/f/normal.txt')))
    time.sleep(2.5)
    out('C3 trigger-traversal-download', ig.eval(CLICK.format(url='http://127.0.0.1:8766/f/traversal.txt')))
    time.sleep(2.5)
    out('C4 trigger-normal-again (collision)', ig.eval(CLICK.format(url='http://127.0.0.1:8766/f/normal.txt')))
    time.sleep(3)
    ig.close()

sh.eval("window.hub.windowControl('close')"); time.sleep(2)

results = {
    'downloads-dir': sorted(os.path.basename(x) for x in glob.glob(os.path.join(DL, 'lsh-download-test*'))),
    'traversal-file-in_downloads': sorted(os.path.basename(x) for x in glob.glob(os.path.join(DL, '*evil-lsh*'))),
    'escape_attempt_1_home_root': sorted(os.path.basename(x) for x in glob.glob(os.path.expanduser('~/../evil-lsh*')) + glob.glob(os.path.expanduser('~/evil-lsh*')) + glob.glob('/home/user/evil-lsh*')),
    'escape_attempt_2_slashes': sorted(os.path.basename(x) for x in glob.glob('/home/user/*evil*') + glob.glob('/home/*evil*')),
    'content-ok': False,
}
p = os.path.join(DL, 'lsh-download-test.txt')
if os.path.exists(p):
    results['content-ok'] = open(p, 'rb').read() == FILES['/f/normal.txt'][0]
out('C5 download-policy-results', results)
srv.shutdown()
try: proc.wait(timeout=5)
except Exception: proc.kill()
