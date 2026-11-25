# audit-test.py - v1.18.15, fixes from the Nov 25 progression audit, approved by Cameron ("All four fixes"):
# the Holding steady card on Home, and a coach change older than a later session of that lift is left out.
# Phone size, Denver time, made-up data. Run: python3 tests/audit-test.py   (serves the repo on :8097)
import os, subprocess, sys, time, datetime
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8097
BASE = f'http://localhost:{PORT}/'
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

def fs_session(date, week):
    sets = [{'exerciseId': 'front_squat', 'name': 'Front squat', 'setIndex': i, 'ramp': False, 'baseline': False, 'retest': False, 'repRange': [5, 6],
             'target': {'weight': 140, 'reps': 5}, 'blockId': 'B', 'weight': 140, 'reps': 5, 'rpe': 9, 'done': True, 'skipped': False,
             'at': f'{date}T18:{10 + i}:00.000Z'} for i in (1, 2, 3)]
    return {'id': f'ses_{date}', 'sessionId': 'lift3', 'sessionName': 'Lift 3: Full body', 'week': week, 'phase': {'id': 'build', 'name': 'Build', 'weeks': [3, 4, 5, 6]},
            'date': date, 'startedAt': f'{date}T18:00:00.000Z', 'endedAt': f'{date}T19:00:00.000Z', 'status': 'complete', 'sets': sets}

DATA = {'app': 'CamsTrainingTracker', 'appVersion': '1.18.14', 'pairTotals': 'none',
        'settings': {'startDate': '2026-11-16', 'bodyweightLb': 165},
        'targets': {'front_squat': {'weight': 140, 'reps': 5, 'stall': 0, 'source': 'engine'}, 'back_squat': {'weight': 195, 'reps': 5, 'stall': 0, 'source': 'engine'},
                    'curl': {'weight': 50, 'reps': 10, 'source': 'engine'}},
        'sessions': [fs_session('2026-11-27', 2), fs_session('2026-12-04', 3), fs_session('2026-12-11', 4)], 'runs': []}

try:
  with sync_playwright() as p:
    chrome = os.environ.get('CHROME_PATH') or next((c for c in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium') if os.path.exists(c)), None)
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    errors = []
    ctx = browser.new_context(viewport={'width': 393, 'height': 851}, reduced_motion='reduce', device_scale_factor=1, is_mobile=True, has_touch=True, timezone_id='America/Denver')
    ctx.route('https://api.github.com/**', lambda r: r.abort())
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.clock.install(time=datetime.datetime.fromisoformat('2026-12-13T09:30:00-07:00'))
    pg.goto(BASE); pg.wait_for_selector('#view')
    pg.evaluate("b => import('./js/store.js').then(m => m.importAll(b))", DATA)
    pg.evaluate("c => import('./js/store.js').then(m => m.kvSet('coach', c))", {'adjustments': [
        {'id': 'old1', 'exerciseId': 'front_squat', 'weight': 150, 'reps': 5, 'basedOn': '2026-11-28T00:00:00Z'},
        {'id': 'new1', 'exerciseId': 'curl', 'weight': 60, 'reps': 10, 'basedOn': '2026-12-11T19:00:00.000Z'}]})
    pg.reload(); pg.wait_for_timeout(900)
    tt = pg.locator('#toast').inner_text() if pg.locator('#toast').is_visible() else ''
    T = pg.evaluate("() => import('./js/store.js').then(m => m.getTargets())")
    print('coach file with basedOn')
    check('a coach change worked out before two later front squat sessions is left out (140 stays)', T['front_squat']['weight'] == 140, T['front_squat'])
    check('a coach change based on the latest data applies (curl 60 x 10)', T['curl']['weight'] == 60 and T['curl']['reps'] == 10, T['curl'])
    check('the toast says the old one was skipped', 'Skipped an older coach change for Front squat' in tt and 'Coach updated 1 thing' in tt, tt)
    pg.evaluate("() => import('./js/ui.js').then(m => m.hideToast())")
    pg.evaluate("() => window.scrollTo(0, 0)")
    print('Holding steady')
    card = pg.locator('#stall-note')
    check('Home names the front squat at 140 x 5 for 3 sessions', card.count() == 1 and 'Front squat' in card.inner_text() and '140 lb x 5' in card.inner_text() and '3 sessions' in card.inner_text(), card.inner_text() if card.count() else '')
    check('the 5-6 range has no room for a rep fewer, so it offers 135 lb', card.locator('[data-act="take"]').inner_text() == 'Try 135 lb', card.locator('[data-act="take"]').inner_text())
    check('the back squat (no sessions yet) is not named', 'Back squat' not in card.inner_text())
    if os.environ.get('SHOTS'): pg.screenshot(path=os.path.join(os.environ['SHOTS'], 'holding-steady.png'))
    card.locator('[data-act="take"]').click(); pg.wait_for_timeout(500)
    T = pg.evaluate("() => import('./js/store.js').then(m => m.getTargets())")
    check('Try 135 lb sets the front squat to 135 x 5, as his own target', T['front_squat']['weight'] == 135 and T['front_squat']['reps'] == 5 and T['front_squat']['source'] == 'you', T['front_squat'])
    check('the card goes away', pg.locator('#stall-note').count() == 0)
    pg.evaluate("() => import('./js/store.js').then(m => m.setTarget('front_squat', { weight: 140, reps: 5, source: 'engine' }))")
    pg.evaluate("() => import('./js/store.js').then(m => m.saveSettings({ stallNoteSeen: {} }))")
    pg.reload(); pg.wait_for_timeout(700)
    pg.evaluate("() => import('./js/ui.js').then(m => m.hideToast())")
    pg.locator('#stall-note [data-act="keep"]').click(); pg.wait_for_timeout(500)
    T = pg.evaluate("() => import('./js/store.js').then(m => m.getTargets())")
    check('Keep going leaves 140 x 5 and hides the card at these numbers', T['front_squat']['weight'] == 140 and pg.locator('#stall-note').count() == 0, T['front_squat'])
    pg.reload(); pg.wait_for_timeout(700)
    check('...and it stays hidden after a reload', pg.locator('#stall-note').count() == 0)
    check('no page errors', not errors, errors)
    ctx.close()
    browser.close()
finally:
  server.terminate()

print('\nAll v1.18.15 checks passed' if not fails else f'\n{len(fails)} FAILED')
sys.exit(1 if fails else 0)
