# tweaks-test.py - v1.18.5, Cameron's fourth round of workout notes (Nov 24): easy ramp-up plate loads, no 27.5 lb
# dumbbells, a chip to rate a set that went by unrated, and the 12-week projection in Plan.
# Phone size, Denver time, made-up data. Run: python3 tests/tweaks-test.py   (serves the repo on :8093)
import os, subprocess, sys, time, datetime
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8093
BASE = f'http://localhost:{PORT}/'
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

CURL = [{'exerciseId': 'curl', 'name': 'Standing dumbbell curl', 'setIndex': i, 'round': i, 'blockId': 'finisher', 'weight': 55, 'reps': 10, 'rpe': 8,
         'done': True, 'skipped': False, 'repRange': [10, 12], 'target': {'weight': 55, 'reps': 10}} for i in (1, 2, 3)]
DATA = {'app': 'CamsTrainingTracker', 'appVersion': '1.18.4', 'pairTotals': 'none',
        'settings': {'startDate': '2026-11-16', 'bodyweightLb': 165},
        'targets': {'back_squat': {'weight': 185, 'reps': 6, 'stall': 0, 'source': 'engine'}, 'curl': {'weight': 55, 'reps': 10, 'source': 'engine'},
                    'rdl': {'weight': 195, 'reps': 6, 'source': 'engine'}, 'calf_raise': {'weight': 105, 'reps': 11, 'source': 'engine'},
                    'power_clean': {'weight': 155, 'reps': 2, 'source': 'coach'}},
        'sessions': [{'id': 'ses_t1', 'sessionId': 'lift1', 'sessionName': 'Lift 1', 'week': 2, 'phase': {'id': 'baseline'}, 'date': '2026-11-23',
                      'startedAt': '2026-11-23T22:00:00.000Z', 'endedAt': '2026-11-23T23:00:00.000Z', 'status': 'complete', 'sets': CURL, 'whatChanged': []}],
        'runs': []}

def open_at(browser, iso, errors):
    ctx = browser.new_context(viewport={'width': 360, 'height': 698}, reduced_motion='reduce', device_scale_factor=1, is_mobile=True, has_touch=True, timezone_id='America/Denver')
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.clock.install(time=datetime.datetime.fromisoformat(iso))
    pg.goto(BASE); pg.wait_for_selector('#view')
    pg.evaluate("b => import('./js/store.js').then(m => m.importAll(b))", DATA)
    pg.reload(); pg.wait_for_timeout(700)
    return ctx, pg

try:
  with sync_playwright() as p:
    chrome = os.environ.get('CHROME_PATH') or next((c for c in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium') if os.path.exists(c)), None)
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    errors = []

    print('No 27.5 lb dumbbells')
    ctx, pg = open_at(browser, '2026-11-25T10:00:00-07:00', errors)
    t = pg.evaluate("() => import('./js/store.js').then(m => m.getTargets())")
    check('upgrade: the 55 lb curl target (2 x 27.5) is 50 now, reps kept; barbell lifts untouched', t['curl']['weight'] == 50 and t['curl']['reps'] == 10 and t['back_squat']['weight'] == 185, t['curl'])
    home = pg.locator('#view').inner_text()
    check('Home: the curls logged at 55 are flagged to check (no such dumbbell)', 'Standing dumbbell curl' in home and 'no such dumbbell' in home, home[:300])

    print('Plan: tap an exercise for its 12 weeks')
    pg.click('button[data-view="plan"]'); pg.wait_for_timeout(200)
    pg.click('#plan-seg [data-pane="sessions"]'); pg.click('[data-pick="lift1"]'); pg.wait_for_timeout(150)
    pg.click('tr[data-ex="back_squat"]'); pg.wait_for_selector('#proj-sheet')
    sh = pg.locator('#proj-sheet').inner_text()
    check('back squat: now 185 x 6, a week-12 target, a chart and a week table', 'Now' in sh and '185 × 6' in sh and 'Week 12, on plan' in sh and pg.locator('#proj-sheet svg path').count() == 2 and pg.locator('#proj-table tr').count() >= 5, sh[:300])
    pg.evaluate("() => import('./js/ui.js').then(m => m.closeModal())"); pg.wait_for_timeout(100)
    pg.click('tr[data-ex="curl"]'); pg.wait_for_selector('#proj-sheet')
    sh = pg.locator('#proj-sheet').inner_text()
    check('curl: starts from 50 and never lands on an odd total (2 x 27.5, 2 x 32.5 ...)', '50 × 10' in sh and not any(f'{w} ×' in sh for w in (55, 65, 75, 85)), sh[:400])
    pg.evaluate("() => import('./js/ui.js').then(m => m.closeModal())"); pg.wait_for_timeout(100)
    pg.click('[data-pick="lift3"]'); pg.wait_for_timeout(100)
    pg.click('tr[data-ex="power_clean"]'); pg.wait_for_selector('#proj-sheet')
    check('power clean: says the app does not raise it by itself', 'nothing to project' in pg.locator('#proj-sheet').inner_text())
    ctx.close()

    print('Lift 1: easy ramp-ups, and rating a set that went by')
    ctx, pg = open_at(browser, '2026-11-30T15:00:00-07:00', errors)
    pg.click('#today-card .btn'); pg.wait_for_selector('#start-workout')
    pg.click('#start-workout'); pg.wait_for_selector('.player'); pg.wait_for_timeout(150)
    ramp_text, chip = None, False
    for i in range(2500):
        cw = pg.locator('#change-weight')
        if ramp_text is None and cw.count() and '→ 135' in cw.inner_text(): ramp_text = cw.inner_text()
        if pg.locator('#jd-missed').count() and pg.locator('#jd-missed').is_visible():
            chip = True; break
        btn = pg.locator('#confirm-btn')
        if btn.count() and btn.is_visible(): pg.clock.run_for(700); btn.click(); pg.wait_for_timeout(20)
        else: pg.clock.run_for(1000)
    check('ramp-up: 95 -> 135 (2 x 45 plates, it was 130), and what to add', ramp_text is not None and '95 → 135 lb (add 20 a side)' in ramp_text, ramp_text)
    check('a set the timer logged unrated shows a Rate chip on the next set\'s card', chip)
    if chip:
        j = int(pg.locator('#jd-missed').get_attribute('data-idx'))
        pg.click('#jd-missed'); pg.wait_for_selector('#rate-missed')
        pg.click('#rate-missed .effort-chip[data-key="solid"]'); pg.wait_for_timeout(100)
        pg.wait_for_timeout(200)
        r = pg.evaluate("j => import('./js/store.js').then(m => m.getInProgress()).then(x => x && x.timeline ? x.timeline.steps[j].record : null)", j)
        check('rating it from the sheet counts: Solid (RPE 8), no longer unrated', r is not None and r.get('rpe') == 8 and not r.get('unconfirmed'), r)
        nxt = pg.locator('#jd-missed').get_attribute('data-idx') if pg.locator('#jd-missed').count() else None
        check('the chip moves on to the next unrated set or goes away', nxt is None or int(nxt) != j, nxt)
    ctx.close()
    check('no page errors', not errors, errors[:3])
    browser.close()
finally:
    server.terminate()
print(f"\n{len(fails)} FAILED: {fails}" if fails else '\nAll v1.18.5 checks passed')
sys.exit(1 if fails else 0)
