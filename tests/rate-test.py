# rate-test.py - v1.18.1: rating a set after Save (the summary and a session in Progress), and the one-time upgrade.
# Phone size, Denver time. Run: python3 tests/rate-test.py   (serves the repo on :8089; screenshots in tests/shots)
import os, subprocess, sys, time, datetime, json
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'tests', 'shots'); os.makedirs(SHOTS, exist_ok=True)
PORT = 8089
BASE = f'http://localhost:{PORT}/'
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

# A finished Lift 1 (week 3) waiting on Review: the back squat at its 185 x 6 target, the last set logged by the timer
# with no effort picked. `unrated` = which squat sets the timer logged.
DRAFT = """([start, end, recordId, weight, reps, unrated]) => Promise.all([import('./js/builder.js'), import('./js/store.js'), import('./js/data.js')]).then(async ([b, st, d]) => {
  const D = await d.loadData();
  const settings = await st.getSettings();
  const targets = await st.getTargets();
  const tl = b.buildTimeline({ plan: D.plan, rules: D.rules, settings, sessionId: 'lift1', week: d.weekNumber(new Date(start), settings.startDate), targets });
  const sq = tl.steps.filter(s => s.kind === 'set' && s.exerciseId === 'back_squat' && !s.ramp);
  const sets = sq.map((s, i) => ({ exerciseId: s.exerciseId, name: s.name, setIndex: s.setIndex, round: s.round, ramp: false, baseline: s.baseline, retest: s.retest,
    holdSeconds: s.holdSeconds, perSide: s.perSide, repRange: s.repRange, target: { ...(s.target || {}) }, blockId: s.blockId,
    weight, reps, rpe: 8, done: true, skipped: false, ...(unrated.includes(i) ? { unconfirmed: true } : {}) }));
  await st.setPendingReview({ timeline: tl, status: 'complete', startedAt: start, endedAt: end, actualSeconds: 3000, pausedSeconds: 0, gymSeconds: 3000,
    plannedSeconds: tl.plannedSeconds, trims: [], livePrs: [], engineMinutes: 0, sets, recordId });
  return sq.length;
})"""

def target(page, id):
    return page.evaluate("id => import('./js/store.js').then(m => m.getTargets()).then(t => t[id] || null)", id)
def session(page, id):
    return page.evaluate("id => import('./js/store.js').then(m => m.getSession(id))", id)
def toast_text(page):
    return page.evaluate("() => { const t = document.querySelector('.toast'); return t ? t.innerText : ''; }")

with sync_playwright() as p:
    chrome = os.environ.get('CHROME_PATH') or next((c for c in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium') if os.path.exists(c)), None)
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    errors = []

    print('Rate a set on the summary, after Save')
    ctx = browser.new_context(viewport={'width': 360, 'height': 698}, reduced_motion='reduce', device_scale_factor=2, is_mobile=True, has_touch=True, timezone_id='America/Denver')
    page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
    page.clock.install(time=datetime.datetime.fromisoformat('2026-11-30T11:30:00-07:00'))   # Monday of week 3, Lift 1
    page.goto(BASE); page.wait_for_selector('.card.accent h1')
    page.evaluate("() => import('./js/store.js').then(async m => { await m.setPairTotals('none'); await m.saveSettings({ startDate: '2026-11-16', bodyweightLb: 180 }); await m.setTargets({ back_squat: { weight: 185, reps: 6, stall: 1, source: 'engine', updated: '2026-11-23T18:00:00.000Z' } }); })")
    n = page.evaluate(DRAFT, ['2026-11-30T17:00:00.000Z', '2026-11-30T18:00:00.000Z', 'ses_rate1', 185, 6, [2]])
    page.reload(); page.wait_for_selector('#save-session')   # a finished session not saved yet opens on Review
    check('review: the squat set the timer logged is listed, and Save does not wait for it', page.locator('#review-unchecked').count() == 1 and not page.locator('#save-session').is_disabled(), page.locator('#view').inner_text()[:300])
    page.click('#save-session'); page.wait_for_selector('#summary-done')
    rec = session(page, 'ses_rate1')
    check('saved: the session keeps the target and flat count the squat had going in (rule 12)', rec['targetsBefore']['back_squat']['weight'] == 185 and rec['targetsBefore']['back_squat']['stall'] == 1, rec.get('targetsBefore'))
    t = target(page, 'back_squat')
    check('saved unrated: the squat holds at 185 x 6, count 1', t['weight'] == 185 and t['reps'] == 6 and t['stall'] == 1, t)
    changes = page.locator('#view .card', has_text='What changed for next time')
    check('summary: What changed says why it held, and offers to rate the set', 'no effort picked' in changes.inner_text() and page.locator('#rate-unrated').count() == 1 and 'Rate the set the timer logged' in page.locator('#rate-unrated').inner_text(), changes.inner_text())
    check('summary: the Sets table has a Rate button on that set only', page.locator('.rate-btn').count() == 1, page.locator('.rate-btn').count())
    changes.scroll_into_view_if_needed()
    page.screenshot(path=f'{SHOTS}/rate-summary.png')
    page.click('#rate-unrated'); page.wait_for_selector('#rate-sheet')
    sheet = page.locator('#rate-sheet').inner_text()
    check('the sheet names the set, its numbers and asks how it felt; Save waits for a pick', 'Back squat' in sheet and '185' in sheet and 'How did it feel?' in sheet and page.locator('#rate-sheet .effort-chip').count() == 4 and page.locator('#rate-sheet .effort-chip.on').count() == 0 and page.locator('#rate-save').is_disabled(), sheet)
    page.click('#rate-sheet .effort-chip.effort-solid'); page.wait_for_timeout(100)
    check('a pick lights it and opens Save', page.locator('#rate-sheet .effort-chip.on').count() == 1 and not page.locator('#rate-save').is_disabled())
    page.screenshot(path=f'{SHOTS}/rate-sheet.png')
    page.click('#rate-save'); page.wait_for_selector('#rate-sheet', state='detached')
    page.wait_for_timeout(150)
    said = toast_text(page)
    t = target(page, 'back_squat')
    check('rated Solid: the session counts now, 190 x 4 next time, count 0, and the toast says so', t['weight'] == 190 and t['reps'] == 4 and t['stall'] == 0 and '190' in said and 'Next time' in said, [t, said])
    rec = session(page, 'ses_rate1')
    sq = [x for x in rec['sets'] if x['exerciseId'] == 'back_squat']
    check('the set is rated in the saved session, and its line says it was rated later', all(not x.get('unconfirmed') for x in sq) and sq[-1]['rpe'] == 8 and any('rated after saving' in l['text'] for l in rec['whatChanged']), [[x.get('rpe'), x.get('unconfirmed')] for x in sq])
    check('the summary is drawn again: no Rate left, the new line shown', page.locator('.rate-btn').count() == 0 and page.locator('#rate-unrated').count() == 0 and 'rated after saving' in page.locator('#view').inner_text(), page.locator('#view').inner_text()[-500:])
    page.click('#summary-done'); page.wait_for_selector('.card.accent h1')

    print('Rate sets in Progress, one at a time')
    page.clock.set_system_time(datetime.datetime.fromisoformat('2026-12-07T11:30:00-07:00'))   # Monday of week 4
    page.evaluate(DRAFT, ['2026-12-07T17:00:00.000Z', '2026-12-07T18:00:00.000Z', 'ses_rate2', 190, 5, [1, 2]])
    page.reload(); page.wait_for_selector('#save-session')
    page.click('#save-session'); page.wait_for_selector('#summary-done'); page.click('#summary-done'); page.wait_for_selector('.card.accent h1')
    held = target(page, 'back_squat')
    check('two sets saved unrated: the squat holds at 190 x 4', held['weight'] == 190 and held['reps'] == 4, held)
    page.click('#tabs button[data-view="progress"]'); page.wait_for_selector('#progress-mode')
    page.click('#progress-mode button[data-mode="sessions"]'); page.wait_for_selector('.list-item')
    page.locator('.list-item').first.click(); page.wait_for_selector('.modal .rate-btn')
    check('the session in Progress has a Rate button on each set the timer logged, and one under What changed', page.locator('.modal .rate-btn').count() == 2 and page.locator('.modal #rate-unrated').count() == 1 and 'Rate the 2 sets the timer logged' in page.locator('.modal #rate-unrated').inner_text())
    page.screenshot(path=f'{SHOTS}/rate-history.png')
    page.locator('.modal .rate-btn').first.click(); page.wait_for_selector('#rate-sheet')
    page.click('#rate-sheet .effort-chip.effort-solid'); page.click('#rate-save'); page.wait_for_selector('.modal .rate-btn')
    said = toast_text(page)
    t = target(page, 'back_squat')
    check('one of two rated: the other still holds the squat, and the toast says one more to rate', t['weight'] == 190 and t['reps'] == 4 and '1 more' in said and page.locator('.modal .rate-btn').count() == 1, [t, said])
    page.locator('.modal .rate-btn').first.click(); page.wait_for_selector('#rate-sheet')
    page.click('#rate-sheet button#rate-cancel'); page.wait_for_selector('.modal .rate-btn')
    check('Cancel goes back to the session with its Rate button', page.locator('.modal .rate-btn').count() == 1)
    page.locator('.modal .rate-btn').first.click(); page.wait_for_selector('#rate-sheet')
    page.click('#rate-sheet .effort-chip.effort-solid'); page.click('#rate-save'); page.wait_for_timeout(300)
    said = toast_text(page)
    t = target(page, 'back_squat')
    check('both rated: the squat moves on from 190 x 4, and the toast gives the new target', (t['weight'], t['reps']) != (190, 4) and 'Next time' in said and page.locator('.modal .rate-btn').count() == 0, [t, said])
    page.click('.modal button:has-text("Close")')

    print('An older session: rated, the newer target stays')
    old = session(page, 'ses_rate1')
    page.evaluate("s => import('./js/store.js').then(m => m.putSession(s))", {**old, 'sets': [{**x, 'unconfirmed': True} if i == len(old['sets']) - 1 else x for i, x in enumerate(old['sets'])]})
    before = target(page, 'back_squat')
    page.click('#progress-mode button[data-mode="overview"]'); page.click('#progress-mode button[data-mode="sessions"]'); page.wait_for_selector('.list-item')
    page.locator('.list-item').nth(1).click(); page.wait_for_selector('.modal .rate-btn')
    page.locator('.modal .rate-btn').first.click(); page.wait_for_selector('#rate-sheet')
    page.click('#rate-sheet .effort-chip.effort-hard'); page.click('#rate-save'); page.wait_for_timeout(300)
    check('rating an older session keeps the effort and leaves the newer target alone', target(page, 'back_squat') == before and 'later session' in toast_text(page) and session(page, 'ses_rate1')['sets'][-1]['rpe'] == 9, toast_text(page))
    page.click('.modal button:has-text("Close")')
    ctx.close()

    print('The one-time upgrade on his phone')
    ctx2 = browser.new_context(viewport={'width': 412, 'height': 839}, reduced_motion='reduce', device_scale_factor=2, is_mobile=True, has_touch=True, timezone_id='America/Denver')
    pg = ctx2.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.clock.install(time=datetime.datetime.fromisoformat('2026-11-21T15:00:00-07:00'))   # Saturday of week 1, v1.18.0 data
    pg.goto(BASE); pg.wait_for_selector('.card.accent h1')
    OLD = {'app': 'CamsTrainingTracker', 'appVersion': '1.18.0', 'planVersion': '1.5', 'exportedAt': '2026-11-21T20:00:00.000Z',
           'targets': {'back_squat': {'weight': 165, 'reps': 4, 'stall': 1, 'source': 'engine'}, 'strict_press': {'weight': 95, 'reps': 5, 'stall': 0}},
           'sessions': [], 'settings': {'startDate': '2026-11-16'}, 'pairTotals': 'none', 'checkins': [], 'coachApplied': [], 'garminIgnored': [],
           'runs': [{'id': 'garmin-1', 'garminId': '1', 'source': 'garmin', 'date': '2026-11-18', 'startTime': '17:10', 'type': 'Intervals', 'planId': 'run1', 'autoType': True,
                     'autoWhy': "the week's intervals were still open", 'distance': 3.1, 'minutes': 31, 'pace': 10, 'week': 1, 'rpe': None, 'notes': ''},
                    {'id': 'run_hand', 'date': '2026-11-20', 'type': 'Long run', 'planId': 'run2', 'distance': 3.5, 'minutes': 38, 'week': 1}]}
    # what v1.18.0 left on his phone: the data and no record of upgrades
    pg.evaluate("b => import('./js/store.js').then(async m => { await m.importAll(b); await m.kvDel('dataVersion'); })", OLD)
    pg.reload(); pg.wait_for_selector('.card.accent h1'); pg.wait_for_timeout(300)
    said = toast_text(pg)
    runs = {r['id']: r for r in pg.evaluate("import('./js/store.js').then(m => m.getRuns())")}
    t = pg.evaluate("import('./js/store.js').then(m => m.getTargets())")
    check('upgrade: flat counts start again at 0, weights stay', t['back_squat']['stall'] == 0 and t['back_squat']['weight'] == 165, t)
    check('upgrade: the Garmin run the old app counted as intervals is an easy run waiting for Count it; his own run stays', runs['garmin-1']['type'] == 'Easy run' and runs['garmin-1']['planId'] is None and runs['run_hand']['type'] == 'Long run' and runs['run_hand']['planId'] == 'run2', [runs['garmin-1'], runs['run_hand']])
    check('upgrade: one toast says what changed', 'Count it' in said, said)
    app_version = pg.evaluate("import('./js/data.js').then(m => m.APP_VERSION)")
    check('upgrade: the data is marked as upgraded to this version', pg.evaluate("import('./js/store.js').then(m => m.kvGet('dataVersion'))") == app_version, app_version)
    pg.evaluate("import('./js/store.js').then(async m => { const t = await m.getTargets(); t.back_squat.stall = 2; await m.setTargets(t); })")
    pg.reload(); pg.wait_for_selector('.card.accent h1'); pg.wait_for_timeout(300)
    check('upgrade: it runs once (a count made since stays)', pg.evaluate("import('./js/store.js').then(m => m.getTargets())")['back_squat']['stall'] == 2)
    pg.click('#tabs button[data-view="runs"]'); pg.wait_for_selector('#runs-week')
    row = pg.locator('.run-plan[data-run="run1"]')
    check('Runs tab: the intervals are open and offer Count it for that run', 'Count it' in row.inner_text() and row.locator('[data-count="garmin-1"]').count() == 1, row.inner_text())
    row.scroll_into_view_if_needed()
    pg.screenshot(path=f'{SHOTS}/rate-upgrade-count-it.png')
    # his answer for the Nov 18 run: a run on the side
    check('Runs tab: Side run sits next to Count it', row.locator('[data-side="garmin-1"]').count() == 1 and row.locator('[data-side="garmin-1"]').inner_text() == 'Side run', row.inner_text())
    row.locator('[data-side="garmin-1"]').click(); pg.wait_for_timeout(300)
    g1 = next(r for r in pg.evaluate("import('./js/store.js').then(m => m.getRuns())") if r['id'] == 'garmin-1')
    check('Side run: an easy run for good, for no planned run, and the intervals stop asking', g1['type'] == 'Easy run' and g1['planId'] is None and g1['typeLocked'] is True and pg.locator('#runs-week [data-count]').count() == 0 and 'side run' in toast_text(pg), [g1, toast_text(pg)])
    check('Side run: it still counts toward the week\'s miles', '6.6 mi this week' in pg.locator('#runs-week').inner_text(), pg.locator('#runs-week').inner_text())
    pg.click('#tabs button[data-view="home"]'); pg.wait_for_selector('.card.accent h1')
    check('Side run: Home asks nothing about it either', pg.locator('#view [data-count]').count() == 0, pg.locator('#view').inner_text()[:300])
    # a restore of an older backup gets the upgrade too
    pg.evaluate("b => import('./js/store.js').then(m => m.importAll(b)).then(() => import('./js/upgrade.js')).then(u => u.runUpgrades())", OLD)
    t = pg.evaluate("import('./js/store.js').then(m => m.getTargets())")
    check('a restored v1.18.0 backup gets the same one-time changes', t['back_squat']['stall'] == 0 and pg.evaluate("import('./js/store.js').then(m => m.kvGet('dataVersion'))") == app_version, t)
    ctx2.close()

    check('no page errors', not errors, errors[:5])
    browser.close()
server.terminate()
print(f'\n{len(fails)} FAILED' if fails else '\nAll browser checks passed')
sys.exit(1 if fails else 0)
