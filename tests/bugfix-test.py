# bugfix-test.py - v1.15.1 bug hunt and the v1.18.0 hands-on test: each check below failed before the fix. Phone size, Denver time.
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
        page.clock.run_for(700)   # v1.18: the app ignores a second main-button tap within 0.6 s
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
    check('pull-up e1RM uses the bodyweight from Settings (200 + 25 lb x 5 = 262.5, shown to 5 lb: 265)', 'best e1RM 265' in row, row)
    page.locator('.list-item', has_text='Weighted pull-up').click(); page.wait_for_timeout(200)
    check('the pull-up sheet uses the same bodyweight', '265' in page.locator('#modal').inner_text(), page.locator('#modal').inner_text()[:200])
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

    # ---- v1.18.0: what the hands-on test of the new workout screen found, at Cameron's phone size ----
    print('v1.18.0 fixes, 360 x 698')
    ctx2 = browser.new_context(viewport={'width': 360, 'height': 698}, reduced_motion='reduce', is_mobile=True, has_touch=True, timezone_id='America/Denver')
    pg = ctx2.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.add_init_script("window.SpeechSynthesisUtterance = function (t) { this.text = t; }; Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak() {} }, configurable: true });")
    pg.clock.install(time=datetime.datetime.fromisoformat('2026-12-04T06:00:00-07:00'))
    pg.goto(f'http://localhost:{PORT}/'); pg.wait_for_selector('.card.accent h1')
    pg.evaluate("([t, s]) => import('./js/store.js').then(async m => { await m.setTargets(t); await m.putSession(s); await m.setPairTotals('none'); await m.saveSettings({ bodyweightLb: 200 }); })", [TARGETS, SESSION])
    pg.reload(); pg.wait_for_selector('#today-card')
    store = lambda js: pg.evaluate(f"import('./js/store.js').then(m => {js})")
    def k2(): return kind(pg)
    def n2(): return name(pg)
    def step2(): return int(pg.locator('.player').get_attribute('data-step'))
    def toast_text(): return pg.locator('#toast').inner_text() if pg.locator('#toast').is_visible() else ''
    def run(seconds):
        for _ in range(int(seconds)): pg.clock.run_for(1000)
        pg.wait_for_timeout(30)
    def main_tap():
        # the app ignores a second main-button tap within 0.6 s (v1.18), so deliberate taps are 0.7 s apart
        pg.click('.player-actions button.btn.primary'); pg.clock.run_for(700); pg.wait_for_timeout(30)
    def go_to(want_kind, want_name, limit=400):
        for _ in range(limit):
            if k2() == want_kind and n2() == want_name: return True
            if k2() in ('timed', 'stretch'): run(secs(pg) + 1)
            else: main_tap()
        return False
    pg.click('#today-card .btn.primary'); pg.wait_for_selector('#start-workout'); pg.click('#start-workout'); pg.wait_for_selector('.player')

    check('reached the first Power clean work set', go_to('work', 'Power clean'))
    at = step2()
    pg.locator('.player-actions button', has_text='Edit').click(); pg.wait_for_timeout(60)
    pg.fill('#in-reps', '-2'); main_tap()
    t1 = toast_text()
    check('Edit: reps below 0 are refused on Done, the set waits with the box open (it logged -2 reps)', step2() == at and k2() == 'work' and 'below 0' in t1 and pg.locator('#edit-panel').is_visible(), (step2(), at, t1))
    pg.fill('#in-reps', '2.5'); main_tap()
    t2 = toast_text()
    check('Edit: part of a rep is refused too (it logged 2.5 reps)', step2() == at and 'whole numbers' in t2, (step2(), at, t2))
    pg.fill('#in-reps', '2'); main_tap()
    check('Edit: 2 reps logs the set', k2() == 'rest' and pg.locator('#jd-r').inner_text().strip() == '2', (k2(), pg.locator('#jd-r').inner_text() if pg.locator('#jd-r').count() else ''))
    pg.click('#jd-r'); pg.wait_for_selector('#fix-reps'); pg.fill('#fix-reps', '-1'); pg.click('#jd-fix-save'); pg.wait_for_timeout(80)
    check('the last-set number sheet refuses reps below 0, says so inside the sheet, and stays open', pg.locator('#fix-reps').count() == 1 and pg.locator('#fix-refused').is_visible() and 'below 0' in pg.locator('#fix-refused').inner_text() and pg.locator('#jd-r').inner_text().strip() == '2', pg.locator('#jd-r').inner_text())
    pg.click('#modal .btn.ghost'); pg.wait_for_timeout(80)

    check('reached Power clean set 2', go_to('work', 'Power clean') and step2() == at + 2, step2())
    at = step2()
    pg.click('#more-btn'); pg.wait_for_selector('#modal .menu')
    menu_items = pg.locator('#modal .menu-item').all_inner_texts()
    pg.click('#modal .btn.ghost'); pg.wait_for_timeout(60)
    check('set 2 of a block under way: the menu has no Equipment taken, there is nothing to swap with (it stepped back, dropped the set and then said so)', not any('Equipment taken' in x for x in menu_items) and step2() == at and k2() == 'work', (menu_items, step2(), at))
    pg.click('.player-actions button.btn.primary'); pg.wait_for_timeout(120); pg.click('.player-actions button.btn.primary'); pg.wait_for_timeout(120)
    check('a quick second tap on Done does not skip the rest that comes up under the thumb (it did)', k2() == 'rest' and step2() == at + 1 and secs(pg) >= 80, (k2(), step2(), at, pg.locator('#timer').inner_text()))
    pg.click('#jd-r-minus'); pg.wait_for_timeout(80)
    check('the card corrects set 2 to 1 rep', pg.locator('#jd-r').inner_text().strip() == '1', pg.locator('#jd-r').inner_text())
    pg.click('#more-btn'); pg.locator('.menu-item', has_text='Back one step').click(); pg.wait_for_timeout(100)
    check('Back one step returns to set 2', step2() == at and k2() == 'work', (step2(), k2()))
    hero_reps = pg.locator('#hero-readout .hl-reps b').inner_text().strip()
    check('set 2 run again shows the corrected 1 rep, what it will log (it showed the planned 2 and logged 1)', hero_reps == '1', hero_reps)
    for _ in range(120):
        if step2() != at: break
        run(1)
    check('set 2 run again and ended by its timer keeps the corrected 1 rep (it went back to the planned 2)', step2() == at + 1 and pg.locator('#jd-r').inner_text().strip() == '1' and pg.locator('#jd-saved').inner_text() == 'Saved', (step2(), pg.locator('#jd-r').inner_text(), pg.locator('#jd-saved').inner_text()))

    def go_setup(want_name, limit=400):
        # a screen that waits for Set-up done, with this exercise up next (its name is the first .step-name there)
        for _ in range(limit):
            if pg.locator('#confirm-btn').count() and n2() == want_name: return True
            if k2() in ('timed', 'stretch'): run(secs(pg) + 1)
            else: main_tap()
        return False
    check('reached the set-up before the first dumbbell row set', go_setup('Dumbbell row'))
    pg.click('#pause-btn'); pg.wait_for_timeout(60)
    pg.clock.run_for(600 * 1000); pg.wait_for_timeout(60)
    main_tap()   # Set-up done while still paused
    pg.click('#pause-btn'); pg.wait_for_timeout(60)
    check('reached the first dumbbell row set', go_to('work', 'Dumbbell row'))
    at = step2()
    cls = pg.locator('#sides').get_attribute('class')
    pg.click('#side-right', force=True); pg.wait_for_timeout(80)
    check('get-set seconds of a one-arm set: Right is not a button yet, a tap there changes nothing (it broke both clocks)', 'phase-set' in cls and pg.locator('button#side-right').count() == 0 and 'phase-set' in pg.locator('#sides').get_attribute('class'), (cls, pg.locator('#sides').get_attribute('class')))
    run(6)
    pace = pg.locator('#pace-text').inner_text()
    check('then the left side runs, its reps paced from rep 1', 'phase-left' in pg.locator('#sides').get_attribute('class') and pace.startswith('Left · rep 1 of 8') or pace.startswith('Left · rep 2 of 8'), pace)
    run(8)
    pg.click('#side-right'); pg.wait_for_timeout(80); run(1)
    pace = pg.locator('#pace-text').inner_text()
    check('Right tapped early: the right side starts now, its reps counted from its own start', 'phase-right' in pg.locator('#sides').get_attribute('class') and pace.startswith('Right · rep 1 of 8'), pace)
    for _ in range(80):
        if step2() != at: break
        run(1)
        if '-' in pg.locator('#pace-text').inner_text() if pg.locator('#pace-text').count() else False: break
    check('the set ends after the right side, no rep number below 1 on the way', step2() == at + 1 and pg.locator('#jd-saved').count() == 1, (step2(), at))

    # ---- what the independent code review found ----
    ip = store("m.getInProgress()")
    lead = (ip['timeline']['steps'][at].get('record') or {}).get('lead') or {}
    check('Set-up done tapped during a 10 min pause: the pause is in the set-up record, so at most a minute of it counts (it read as a 5 s set-up)', lead.get('by') == 'tap' and lead.get('tapPaused', 0) >= 595 and lead.get('tap', 0) >= lead.get('tapPaused', 0), lead)
    row_secs = ip['timeline']['steps'][at]['seconds']
    check('review F2: the early Right tap leaves the set its planned 83 s (it was cut to where Right was tapped)', row_secs == 83, row_secs)
    pg.click('#jd-undo'); pg.wait_for_timeout(100)
    ip = store("m.getInProgress()")
    check('review F2: Undo runs the set again in full, 35.5 s a side (it ran on the shortened clock)', step2() == at and ip['sideAt']['end'] == 83 and abs(ip['sideAt']['leftEnd'] - 39.5) < 0.01 and ip['stepPlan'] == 83, (step2(), ip.get('sideAt'), ip.get('stepPlan')))
    run(6)
    pg.locator('.player-actions button', has_text='Edit').click(); pg.wait_for_timeout(60)
    pg.fill('#in-reps', '6')
    pg.locator('.player-actions button', has_text='Hide').click(); pg.wait_for_timeout(60)
    check('Hide keeps the typed reps in the boxes behind it (they were dropped)', pg.locator('#in-reps').input_value() == '6' and not pg.locator('#edit-panel').is_visible(), pg.locator('#in-reps').input_value())
    hero_reps = pg.locator('#hero-readout .hl-reps b').inner_text().strip()
    check('and the set screen shows the typed 6 reps the timer will log (it kept showing the planned 8)', hero_reps == '6', hero_reps)
    for _ in range(100):
        if step2() != at: break
        run(1)
    jd_saved = pg.locator('#jd-saved').inner_text() if pg.locator('#jd-saved').count() else ''
    check('after Edit and Hide the set still ends on its timer and logs the typed 6 reps (it sat at 0:00 waiting for Done)', step2() == at + 1 and pg.locator('#jd-r').inner_text().strip() == '6' and jd_saved == 'Logged', (step2(), at, pg.locator('#jd-r').inner_text() if pg.locator('#jd-r').count() else '', jd_saved))
    check('review F3: with no effort picked it stays marked for a rating, and no effort is lit on its card (the guess was lit and read as rated)', pg.locator('#just-done.unconfirmed').count() == 1 and pg.locator('#just-done .effort-chip').count() == 4 and pg.locator('#just-done .effort-chip.on').count() == 0)
    pg.click('#jd-r-plus'); pg.wait_for_timeout(80)
    check('review F3: new reps alone leave it marked, the effort is still a guess (a fix used to confirm it)', pg.locator('#jd-r').inner_text().strip() == '7' and pg.locator('#jd-saved').inner_text() == 'Saved' and pg.locator('#just-done.unconfirmed').count() == 1)

    check('reached the first finisher set, the preacher curl', go_to('work', 'Dumbbell preacher curl'))
    curl_at = step2()
    skey = lambda st: f"{st.get('blockId')}|{st.get('exerciseId')}|{st.get('setIndex')}|{st.get('round')}|{st.get('ramp')}"
    targets_of = lambda ip: {skey(st): st.get('target') for st in ip['timeline']['steps'] if st.get('kind') == 'set'}
    t0 = targets_of(store("m.getInProgress()"))
    curl_secs = store("m.getInProgress()")['timeline']['steps'][curl_at]['seconds']
    pg.locator('.player-actions button', has_text='Edit').click(); pg.wait_for_timeout(60)
    pg.fill('#in-weight', '35')
    run(curl_secs + 5)
    waited = step2() == curl_at
    pg.locator('.player-actions button', has_text='Hide').click(); pg.wait_for_timeout(60); run(3)
    check("Hide after the set's time ran out only closes the boxes: the set waits for Done (it was logged the moment Hide was tapped)", waited and step2() == curl_at and k2() == 'work' and not pg.locator('#edit-panel').is_visible(), (waited, step2(), curl_at, k2()))
    main_tap()
    t_carried = targets_of(store("m.getInProgress()"))
    carried_ok = [t_carried[k]['weight'] for k in t_carried if '|preacher_curl|' in k and not k.endswith('|1|1|False')] == [35, 35]
    pg.click('#swap-btn'); pg.wait_for_selector('.swap-choice[data-kind="later"]')
    pg.click('.swap-choice[data-kind="later"]'); pg.wait_for_timeout(120)
    order = [x['exerciseId'] for x in store("m.getInProgress()")['timeline']['steps'] if x.get('kind') == 'set' and x.get('blockId') == 'finisher']
    pg.click('#jd-undo'); pg.wait_for_timeout(120)
    t1 = targets_of(store("m.getInProgress()"))
    diff = {k: (t0.get(k), t1.get(k)) for k in set(t0) | set(t1) if t0.get(k) != t1.get(k)}
    check('review F1: Undo after Equipment taken puts the curl targets back on the curl sets and changes no other set (it wrote 35 x 8 onto the side plank and calf raise)', carried_ok and order[-1] == 'rope_pushdown' and step2() == curl_at and not diff, (carried_ok, order[-3:], step2(), curl_at, diff))

    pg.click('#more-btn'); pg.locator('.menu-item', has_text='End session early').click(); pg.wait_for_timeout(80)
    pg.click('#modal .btn.danger'); pg.wait_for_selector('h1:has-text("Review and save")')
    pend = store("m.getPendingReview()")
    ip = store("m.getInProgress()")
    check('a finished session is kept until Save, under the id it will be saved with', pend is not None and pend.get('recordId', '').startswith('ses_') and ip is None, (bool(pend), ip is None))
    rid = pend['recordId']
    if pg.locator('#confirm-skipped').count(): pg.click('#confirm-skipped'); pg.wait_for_timeout(200)
    pg.reload(); pg.wait_for_selector('h1:has-text("Review and save")')
    check('a reload on Review comes back to Review, with what was confirmed there (the session was lost)', pg.locator('#confirm-skipped').count() == 0 and pg.locator('#discard-session').count() == 1 and pg.locator('h1:has-text("Resume session?")').count() == 0 and 'not saved yet' in toast_text(), toast_text())
    pg.click('#tabs .tab[data-view="progress"]'); pg.wait_for_timeout(300); pg.click('#tabs .tab[data-view="home"]'); pg.wait_for_selector('#today-card')
    check('Home after leaving Review by a tab: Not saved yet, with Review and save', pg.locator('#pending-review').is_visible() and pg.locator('#pending-open').inner_text() == 'Review and save')
    pg.click('#today-card .btn'); pg.wait_for_selector('h1:has-text("Review and save")')
    check('starting a session while one is not saved opens that one first', 'Save your last session first' in toast_text(), toast_text())
    un = pg.locator('#review-unchecked')
    row_card = pg.locator('.review-card', has_text='Dumbbell row')
    check('review F3: Review lists the row set the timer logged, and since v1.18.7 the rated last set decides the row target (set 1 is no longer what holds it)', un.count() == 1 and 'Dumbbell row' in un.inner_text() and 'effort not rated' not in row_card.inner_text(), (un.inner_text() if un.count() else 'no card', row_card.inner_text()))
    un.locator('.open-item.unchecked', has_text='Dumbbell row').first.click(); pg.wait_for_selector('#edit-set-save')
    pg.locator('#modal input[inputmode="numeric"]').fill('8'); pg.click('#edit-set-save'); pg.wait_for_timeout(150)
    un = pg.locator('#review-unchecked')
    check('review F3: new reps saved there with no effort picked are kept, and the set stays not rated (Save kept the guess, then made him pick one)', pg.locator('#edit-set-save').count() == 0 and un.count() == 1 and '× 8' in un.inner_text(), un.inner_text() if un.count() else 'no card')
    un.locator('.open-item.unchecked', has_text='Dumbbell row').first.click(); pg.wait_for_selector('#edit-set-save')
    pg.locator('#modal .effort-chip[data-key="solid"]').click(); pg.click('#edit-set-save'); pg.wait_for_timeout(200)
    check('review F3: once rated, the row has its normal verdict again', 'effort not rated' not in pg.locator('.review-card', has_text='Dumbbell row').inner_text() and pg.locator('#review-unchecked').count() == 0, pg.locator('.review-card', has_text='Dumbbell row').inner_text())
    pg.evaluate("() => { const b = document.getElementById('save-session'); b.click(); b.click(); }")
    pg.wait_for_selector('#summary-done')
    saved = store("m.getSessions()")
    check('Save tapped twice saves the session once, under its id', len(saved) == 2 and sum(1 for x in saved if x['id'] == rid) == 1, [x['id'] for x in saved])
    check('after Save nothing is waiting any more', store("m.getPendingReview()") is None)
    pg.click('#summary-done'); pg.wait_for_selector('#today-card')
    pg.reload(); pg.wait_for_selector('#today-card')
    check('a reload after Save opens Home, not the review again', pg.locator('#pending-review').count() == 0 and pg.locator('h1:has-text("Review and save")').count() == 0)

    pg.click('#today-card .btn'); pg.wait_for_selector('#start-workout'); pg.click('#start-workout'); pg.wait_for_selector('.player')
    pg.click('#more-btn'); pg.locator('.menu-item', has_text='End session early').click(); pg.wait_for_timeout(80)
    pg.click('#modal .btn.danger'); pg.wait_for_selector('h1:has-text("Review and save")')
    check('a fresh review has no Discard, only Save', pg.locator('#discard-session').count() == 0)
    pg.reload(); pg.wait_for_selector('#discard-session')
    pg.click('#discard-session'); pg.wait_for_selector('#modal .btn.danger'); pg.click('#modal .btn.danger'); pg.wait_for_selector('#today-card')
    check('Discard on a review that came back: nothing saved, nothing waiting', len(store("m.getSessions()")) == 2 and store("m.getPendingReview()") is None and pg.locator('#pending-review').count() == 0)
    check('no page errors at 360 x 698', not errors, errors)
    ctx2.close()

    # ---- v1.18.0: the second hands-on test: a PR after a reload, a toast that outlived its screen, a session left open ----
    print('v1.18.0 second hands-on test, 360 x 698')
    ctx3 = browser.new_context(viewport={'width': 360, 'height': 698}, reduced_motion='reduce', is_mobile=True, has_touch=True, timezone_id='America/Denver')
    pg = ctx3.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.add_init_script("window.SpeechSynthesisUtterance = function (t) { this.text = t; }; Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak() {} }, configurable: true });")
    pg.clock.install(time=datetime.datetime.fromisoformat('2026-12-04T06:00:00-07:00'))
    pg.goto(f'http://localhost:{PORT}/'); pg.wait_for_selector('.card.accent h1')
    pr_targets = dict(TARGETS, power_clean={'weight': 115, 'reps': 2, 'bestE1rm': 110, 'bestWeight': 110})
    pg.evaluate("([t, s]) => import('./js/store.js').then(async m => { await m.setTargets(t); await m.putSession(s); await m.setPairTotals('none'); await m.saveSettings({ bodyweightLb: 200 }); })", [pr_targets, SESSION])
    pg.reload(); pg.wait_for_selector('#today-card')
    store = lambda js: pg.evaluate(f"import('./js/store.js').then(m => {js})")
    toast_on = lambda: pg.locator('#toast').is_visible()
    pg.click('#today-card .btn.primary'); pg.wait_for_selector('#start-workout'); pg.click('#start-workout'); pg.wait_for_selector('.player')
    found = False
    for _ in range(80):
        if k2() == 'rest' and pg.locator('#confirm-btn').count() and secs(pg) > 15: found = True; break
        if k2() in ('timed', 'stretch'): run(secs(pg) + 1)
        else: main_tap()
    pg.click('#confirm-btn'); pg.clock.run_for(700); pg.wait_for_timeout(30)
    said = toast_text()
    main_tap()   # Skip rest
    check('a toast about the rest goes when the rest does (It starts when the rest ends stayed over the next screen)', found and 'starts when the rest ends' in said and not toast_on(), (found, said, toast_text()))
    check('reached Power clean set 1', go_to('work', 'Power clean'))
    main_tap()
    pr1 = toast_text()
    pg.reload(); pg.wait_for_selector('button:has-text("Resume")'); pg.click('button:has-text("Resume")'); pg.wait_for_selector('.player')
    check('reached Power clean set 2 after a reload', go_to('work', 'Power clean'))
    main_tap()
    pr2 = toast_text()
    prs = store("m.getInProgress()")['prs']
    check('a PR set, a reload, then the same numbers again: no second PR (it was announced again and listed twice)', 'PR' in pr1 and 'PR' not in pr2 and len(prs) == 1, (pr1, pr2, prs))
    pg.click('#pause-btn'); pg.wait_for_timeout(60)
    pg.goto('about:blank'); pg.clock.fast_forward('03:10:00')
    pg.goto(f'http://localhost:{PORT}/'); pg.wait_for_selector('#view > *'); pg.wait_for_timeout(300)
    card = pg.locator('#resume-card')
    check('a session left open for more than 3 hours is offered to save or discard (it was deleted without a word)', card.count() == 1 and 'Unfinished session' in card.inner_text() and card.locator('button', has_text='Resume').count() == 0 and pg.locator('#resume-save').count() == 1, card.inner_text() if card.count() else pg.locator('#view').inner_text()[:200])
    if pg.locator('#resume-save').count():
        pg.click('#resume-save'); pg.wait_for_selector('h1:has-text("Review and save")')
        pend = store("m.getPendingReview()")
        done = [x for x in (pend or {}).get('sets', []) if x.get('exerciseId') == 'power_clean' and x.get('done') and not x.get('ramp')]
        check('Save what I did and stop opens the review with the sets that were logged', len(done) == 2, [(x.get('weight'), x.get('reps')) for x in done])
    check('no page errors in the second hands-on checks', not errors, errors)
    ctx3.close()

    browser.close()
server.terminate()
print('\nAll bug-fix checks passed' if not fails else f'\n{len(fails)} failed')
sys.exit(1 if fails else 0)
