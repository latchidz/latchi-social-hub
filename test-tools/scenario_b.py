#!/usr/bin/env python3
"""Scenario B (packaged app): persistence across FULL app restarts.
Language EN via real UI → close → filesystem check → relaunch → verify
EN/LTR + last platform + settings; then back to AR → restart → RTL."""
import json, subprocess, sys, time, os, glob
sys.path.insert(0, os.path.dirname(__file__))
from cdp import shell, overlay, page, wait_platform_ready, out

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'dist', 'linux-unpacked', 'latchi-social-hub'))
PORT = sys.argv[1] if len(sys.argv) > 1 else '9332'

def launch():
    return subprocess.Popen([APP, f'--remote-debugging-port={PORT}', '--remote-allow-origins=*'],
                            stdout=open('/tmp/pkg-b.log', 'a'), stderr=subprocess.STDOUT)

def quit_app(sh):
    sh.eval("window.hub.windowControl('close')")
    time.sleep(2.5)

def shell_state(sh):
    v = sh.eval("""JSON.stringify({
      dir: document.documentElement.dir, lang: document.documentElement.lang,
      active: (document.querySelector('.side-item[data-platform].active')||{}).dataset || null })""",
        )
    d = json.loads(v)
    d['activePlatform'] = (d.get('active') or {}).get('platform') if isinstance(d.get('active'), dict) else None
    return d

def settings(sh):
    return sh.eval('window.hub.getSettings()', await_promise=True)

# ── run 1: switch to English via the real UI, visit platforms, quit ────────
p1 = launch(); sh = shell()
out('B1 run1-boot', shell_state(sh))
sh.eval("document.getElementById('navLanguage').click()"); time.sleep(0.8)
sh.eval("document.querySelector('button[data-lang=\"en\"]').click()"); time.sleep(1.2)
out('B2 run1-after-EN-switch', shell_state(sh))
sh.eval("window.hub.selectPlatform('telegram')")
wait_platform_ready('telegram', 60); time.sleep(2)
out('B3 run1-settings', settings(sh))
quit_app(sh)

# ── filesystem evidence ────────────────────────────────────────────────────
cands = glob.glob(os.path.expanduser('~/.config/*'))
ud = [c for c in cands if 'latchi' in c.lower() or 'LATCHI' in c]
out('B4 user-data-dir', ud)
data = {}
if ud:
    d = ud[0]
    data['settings.json'] = os.path.exists(os.path.join(d, 'settings.json'))
    if data['settings.json']:
        data['settings-content'] = json.load(open(os.path.join(d, 'settings.json')))
    parts = sorted(glob.glob(os.path.join(d, 'Partitions', '*')))
    data['partitions'] = [os.path.basename(x) for x in parts]
    for pid in ['instagram', 'facebook', 'messenger', 'telegram']:
        pk = os.path.join(d, 'Partitions', pid)
        data[f'{pid}-has-cookies'] = os.path.exists(os.path.join(pk, 'Cookies'))
        ls_dirs = glob.glob(os.path.join(pk, 'Local Storage', 'leveldb'))
        data[f'{pid}-has-localstorage'] = bool(ls_dirs)
out('B5 filesystem-persistence', data)

# ── run 2: relaunch — everything must persist ─────────────────────────────
p2 = launch(); sh = shell()
out('B6 run2-boot (expect ltr + en + telegram active)', shell_state(sh))
out('B7 run2-settings', settings(sh))
info = sh.eval('window.hub.getAppInfo()', await_promise=True)
out('B8 run2-app-info', info)
# telegram session should restore without a fresh login page reload — check content alive
pg = page('telegram.org')
if pg:
    m = pg.eval("JSON.stringify({n:document.getElementsByTagName('*').length,u:location.pathname})")
    out('B9 run2-telegram-restored', json.loads(m)); pg.close()

# back to Arabic via UI, quit, relaunch, expect RTL
sh.eval("document.getElementById('navLanguage').click()"); time.sleep(0.8)
sh.eval("document.querySelector('button[data-lang=\"ar\"]').click()"); time.sleep(1.2)
out('B10 run2-after-AR-switch', shell_state(sh))
quit_app(sh)
p3 = launch(); sh = shell()
out('B11 run3-boot (expect rtl + ar)', shell_state(sh))
quit_app(sh)
for p in (p2, p3):
    try: p.wait(timeout=5)
    except Exception: p.kill()
