# bugfix-test.py - v1.15.1 bug hunt: each check below failed before the fix. Phone size, Denver time.
# Run: python3 tests/bugfix-test.py
import os, subprocess, sys, time, datetime
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'tests', 'shots'); os.makedirs(SHOTS, exist_ok=True)
PORT = 8087
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

# Lift 3 targets for most lifts; rope pushdown has none, so its first set opens the weight box by itself
TARGETS = {'power_clean': {'weight': 115, 'reps': 2}, 'front_squat': {'weight': 135, 'reps': 5}, 'push_press': {'weight': 105, 'reps': 3},
           'lateral_raise': {'weight': 30, 'reps': 12}, 'db_row': {'weight': 60, 'reps': 8}, 'preacher_curl': {'weight': 40, 'reps': 8},
           'calf_raise': {'weight': 105, 'reps': 10}, 'weighted_pullup': {'weight': 25, 'reps': 4}}
SESSION = {'id': 'ses_old', 'sessionId': 'lift2', 'sessionName': 'Lift 2: Upper', 'week': 3, 'date': '2026-12-02', 'startedAt': '2026-12-02T13:00:00.000Z', 'endedAt': '2026-12-02T14:00:00.000Z',
           'status': 'complete', 'actualSeconds': 3600, 'plannedSeconds': 3600, 'trims': [], 'whatChanged': [], 'prs': [],
           'sets': [{'exerciseId': 'weighted_pullup', 'name': 'Weighted pull-up', 'setIndex': i + 1, 'weight': w, 'reps': 5, 'rpe': 8, 'done': True, 'skipped': False, 'blockId': 'A'} for i, w in enumerate([20, 25, 25])]}

def secs(page):
    m, s = page.locator('#timer').inner_text().split(':'); return int(m) * 60 + int(s)
def kind(page): return page.locator('.step-kind').inner_text().strip().lower()
def name(page): return page.locator('.step-name').first.inner_text().strip()
def to_set(page, want):
    for _ in range(300):
        if kind(page) == 'work' and name(page) == want: return True
        if page.locator('#confirm-btn').count(): page.click('#confirm-btn')
        elif kind(page) in ('timed', 'stretch'): page.clock.run_for((secs(page) + 1) * 1000)
        else: page.click('.player-actions button.btn.primary')
        page.wait_for_timeout(30)
    return False

with sync_playwright() as p:
    chrome = os.environ.get('CHROME_PATH') or next((c for c in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium') if os.path.exists(c)), None)
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 412, 'height': 915}, reduced_motion='reduce', device_scale_factor=2, is_mobile=True, has_touch=True, timezone_id='America/Denver')
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script("window.SpeechSynthesisUtterance = function (t) { this.text = t; }; Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak() {} }, configurable: true });")
    page.clock.install(time=datetime.datetime.fromisoformat('2026-12-04T06:00:00-07:00'))  # Friday of week 3, Lift 3
    page.goto(f'http://localhost:{PORT}/'); page.wait_for_selector('.card.accent h1')
    page.evaluate("([t, s]) => import('./js/store.js').then(async m => { await m.setTargets(t); await m.putSession(s); await m.setPairTotals('none'); await m.saveSettings({ bodyweightLb: 200 }); })", [TARGETS, SESSION])
    page.reload(); page.wait_for_selector('.card.accent h1')
    check('Home: Lift 3 offers Start before it is done', page.locator('#today-done').count() == 0 and page.locator('#today-card .btn.primary').inner_text() == 'Start')

    print('Workout: a set with no weight')
    page.click('#today-card .btn.primary'); page.wait_for_selector('#start-workout'); page.click('#start-workout'); page.wait_for_selector('.player')
    check('reached the first rope pushdown set', to_set(page, 'Rope pushdown'))
    check('the weight box is open on a set with no weight', page.locator('#edit-panel').is_visible())
    page.fill('#in-weight', '70')
    page.clock.run_for((secs(page) + 2) * 1000); page.wait_for_timeout(150)
    jd = page.locator('#jd-w').inner_text() if page.locator('#jd-w').count() else ''
    check('a set that ends on its timer keeps the weight typed during it (was logged with no weight)', jd.startswith('70'), jd)
    # the next rope pushdown set carries 70; Skip ahead to round 2 and blank it, to test + on an empty weight
    page.evaluate("() => { const pl = document.querySelector('#just-done'); }")
    page.click('#jd-w'); page.wait_for_selector('#fix-weight'); page.fill('#fix-weight', ''); page.click('#modal .btn.primary'); page.wait_for_timeout(100)
    check('weight cleared on the last-set card', page.locator('#jd-w').inner_text().startswith('?'), page.locator('#jd-w').inner_text())
    page.click('#jd-w-plus'); page.wait_for_timeout(150)
    opened = page.locator('#fix-weight').count() == 1
    check('+ on an empty weight opens the number box instead of logging 5 lb', opened and page.locator('#jd-w').inner_text().startswith('?'), page.locator('#jd-w').inner_text())
    page.screenshot(path=f'{SHOTS}/bugfix-plus-empty.png')
    if opened: page.fill('#fix-weight', '70'); page.click('#modal .btn.primary'); page.wait_for_timeout(100)
    check('typed weight saved on the card', page.locator('#jd-w').inner_text().startswith('70'), page.locator('#jd-w').inner_text())

    print('Closing the app mid-session and saving it 2 hours later')
    page.clock.run_for(60 * 1000)
    st = page.evaluate("import('./js/store.js').then(m => m.getInProgress()).then(s => ({ start: s.sessionStart, last: s.lastTick, paused: s.pausedTotal }))")
    page.goto('about:blank')
    page.clock.set_system_time(datetime.datetime.fromtimestamp(st['last'] / 1000 + 2 * 3600, tz=datetime.timezone.utc))
    page.goto(f'http://localhost:{PORT}/'); page.wait_for_selector('h1:has-text("Resume session?")')
    page.click('button:has-text("Save what I did and stop")'); page.wait_for_selector('h1:has-text("Review and save")')
    line = page.locator('#view .card p.muted').first.inner_text()
    mins = round((st['last'] - st['start'] - st['paused']) / 60000)
    got = int(line.split(' · ')[2].split(' min')[0])
    check('Save what I did and stop counts the time to when the app was last used, not the hours away', abs(got - mins) <= 1, f'{line} (expected about {mins} min)')
    if page.locator('#confirm-skipped').count(): page.click('#confirm-skipped'); page.wait_for_timeout(150)
    page.click('#save-session'); page.wait_for_selector('#summary-done'); page.click('#summary-done'); page.wait_for_selector('#today-card')
    done = page.locator('#today-done')
    check('Home: after saving today\'s lift the card says so and Start is no longer the main button', done.count() == 1 and 'Ended early' in done.inner_text() and page.locator('#today-card .btn.primary').count() == 0, done.inner_text() if done.count() else 'no line')
    page.screenshot(path=f'{SHOTS}/bugfix-home-done.png')

    print('Progress > Exercises')
    page.click('#tabs .tab[data-view="progress"]'); page.wait_for_timeout(400); page.click('#progress-mode [data-mode="exercises"]'); page.wait_for_timeout(400)
    row = page.locator('.list-item', has_text='Weighted pull-up').inner_text()
    check('exercise list shows the top set of the newest session, not its first set', '25 lb × 5' in row, row)
    check('pull-up e1RM uses the bodyweight from Settings (200 + 25 lb x 5 = 263)', 'best e1RM 263' in row, row)
    page.locator('.list-item', has_text='Weighted pull-up').click(); page.wait_for_timeout(200)
    check('the pull-up sheet uses the same bodyweight', '263' in page.locator('#modal').inner_text(), page.locator('#modal').inner_text()[:200])
    page.keyboard.press('Escape')

    print('Settings')
    page.evaluate("import('./js/store.js').then(m => m.saveSettings({ startDate: '' }))")
    page.reload(); page.wait_for_selector('#today-card')
    chip = page.locator('#week-chip').inner_text()
    check('a blank week 1 date falls back to the plan start (week numbers were NaN)', chip.startswith('Week 3'), chip)
    page.click('#settings-btn'); page.wait_for_selector('#modal input[type=date]')
    page.fill('#modal input[type=date]', ''); page.locator('#modal input[type=date]').dispatch_event('change'); page.wait_for_timeout(200)
    bw = page.locator('#modal .field', has_text='Bodyweight').locator('input')
    bw.fill(''); bw.dispatch_event('change'); page.wait_for_timeout(200)
    s = page.evaluate("import('./js/store.js').then(m => m.kvGet('settings'))")
    check('clearing the date or bodyweight in Settings does not save a blank', s.get('startDate') != '' and s.get('bodyweightLb') == 200, s)
    check('no page errors', not errors, errors)

    browser.close()
server.terminate()
print('\nAll bug-fix checks passed' if not fails else f'\n{len(fails)} failed')
sys.exit(1 if fails else 0)
