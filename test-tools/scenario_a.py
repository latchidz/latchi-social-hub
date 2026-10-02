#!/usr/bin/env python3
"""Scenario A (packaged app): cold start, shell UI, all 4 platforms, 
bidirectional switching, no-reload markers, DOM content checks."""
import json, subprocess, sys, time, os
sys.path.insert(0, os.path.dirname(__file__))
from cdp import shell, overlay, page, wait_platform_ready, out

APP = os.path.join(os.path.dirname(__file__), '..', 'dist', 'linux-unpacked', 'latchi-social-hub')
PORT = sys.argv[1] if len(sys.argv) > 1 else '9222'
T0 = time.time()

# ── cold start ─────────────────────────────────────────────────────────────
proc = subprocess.Popen([APP, f'--remote-debugging-port={PORT}', '--remote-allow-origins=*'],
                        stdout=open('/tmp/pkg-a.log', 'w'), stderr=subprocess.STDOUT)
sh = shell()
boot_ms = int((time.time() - T0) * 1000)
dom = sh.eval("""JSON.stringify({
  dir: document.documentElement.dir, lang: document.documentElement.lang,
  titlebar: !!document.getElementById('titlebar'),
  winControls: ['btnMin','btnMax','btnClose'].filter(i=>document.getElementById(i)).length,
  sidebar: !!document.getElementById('sidebar'),
  platformButtons: document.querySelectorAll('.side-item[data-platform]').length,
  label: (document.querySelector('[data-i18n="sidebar.platforms"]')||{}).textContent })""")
out('A1 cold-start boot_ms', boot_ms)
out('A2 shell-dom', json.loads(dom))

ov = overlay()
ovd = ov.eval("JSON.stringify({t:document.body.dataset.type,vis:document.getElementById('overlay').classList.contains('visible')})")
ov.close()
out('A3 home-overlay', json.loads(ovd))

# ── all four platforms: open → ready → real content → marker ───────────────
markers = {}
content = {}
for pid in ['instagram', 'facebook', 'messenger', 'telegram']:
    sh.eval(f'window.hub.selectPlatform({pid!r})')
    ok = wait_platform_ready(pid, 60)
    time.sleep(3.5)  # SPA paint settle
    pg = page(f'{pid}.com') or page('telegram.org')
    if pg:
        c = pg.eval("""JSON.stringify({n:document.getElementsByTagName('*').length,
          tc:(document.body&&document.body.textContent||'').replace(/\\s+/g,' ').trim().length,
          r:document.readyState, u:location.href.split('/').slice(0,3).join('/')})""")
        content[pid] = json.loads(c)
        pg.eval(f'window.__lsh_marker = "keep-{pid}"')
        markers[pid] = True
        pg.close()
    out(f'A4 {pid} ready+content', {'ready': ok, 'content': content.get(pid)})
    time.sleep(0.4)

# ── forward switching: instagram → facebook → messenger → telegram ─────────
for pid in ['instagram', 'facebook', 'messenger', 'telegram']:
    sh.eval(f'window.hub.selectPlatform({pid!r})')
    time.sleep(1.2)

# ── back switching: telegram → messenger → facebook → instagram ────────────
for pid in ['telegram', 'messenger', 'facebook', 'instagram']:
    sh.eval(f'window.hub.selectPlatform({pid!r})')
    time.sleep(1.2)

# ── no-reload proof: markers must survive all the round trips ──────────────
alive = {}
for pid in ['instagram', 'facebook', 'messenger', 'telegram']:
    sh.eval(f'window.hub.selectPlatform({pid!r})')
    time.sleep(1.0)
    pg = page(f'{pid}.com') or page('telegram.org')
    if pg:
        m = pg.eval('window.__lsh_marker || null')
        alive[pid] = (m == f'keep-{pid}')
        pg.close()
out('A5 markers-survived-no-reload', alive)

# overlay hidden while an active ready platform is shown
ov = overlay()
ovd = ov.eval("JSON.stringify({t:document.body.dataset.type,vis:document.getElementById('overlay').classList.contains('visible')})")
ov.close()
out('A6 overlay-hidden-after-switching', json.loads(ovd))

# settings via the exposed bridge (production path)
st = sh.eval('window.hub.getSettings()')
out('A7 settings', st)

info = sh.eval('window.hub.getAppInfo()')
out('A8 app-info', info)

sh.eval("window.hub.windowControl('close')")  # real user close path
time.sleep(2.5)
rc = proc.poll()
out('A9 app-exited-after-close', rc is not None)
out('A10 total-test-ms', int((time.time() - T0) * 1000))
