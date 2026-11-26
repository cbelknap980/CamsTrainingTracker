# runs-tab-test.py - v1.25.0, Cameron (Nov 26): "lets clean up the run tab. look into running apps that travk progress
# towards a goal and get inspiration. propose then impliment 5 things you find specifically that make user experience
# better". The five: goals on top, the next run first with finished ones folded, the intervals as blocks, a plan check
# on every run, the runs grouped by week with Garmin's line at the bottom. Phone size, Denver time, made-up data.
# Run: python3 tests/runs-tab-test.py   (serves the repo on :8099)
import os, subprocess, sys, time, datetime
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8099
BASE = f'http://localhost:{PORT}/'
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

R1 = {'id': 'r-1', 'date': '2026-11-18', 'type': 'Intervals', 'planId': 'run1', 'typeLocked': True, 'distance': 2.7, 'minutes': 27, 'hr': 160, 'week': 1, 'source': 'manual'}
R2 = {'id': 'r-2', 'date': '2026-11-22', 'type': 'Long run', 'planId': 'run2', 'typeLocked': True, 'distance': 3.6, 'minutes': 36, 'hr': 158, 'week': 1, 'source': 'manual'}
R3 = {'id': 'garmin-3', 'garminId': '3', 'date': '2026-11-26', 'startTime': '11:43', 'type': 'Intervals', 'planId': 'run1', 'typeLocked': True, 'distance': 3.4, 'minutes': 61, 'hr': 135, 'week': 2, 'source': 'garmin'}
K1 = {'id': 'k-1', 'date': '2026-12-01', 'type': '5K test', 'planId': 'run1', 'typeLocked': True, 'distance': 4.5, 'minutes': 44, 'best5k': 1620, 'week': 3, 'source': 'manual'}
K2 = {'id': 'k-2', 'date': '2026-12-29', 'type': '5K test', 'planId': 'run1', 'typeLocked': True, 'distance': 4.5, 'minutes': 43, 'best5k': 1560, 'week': 7, 'source': 'manual'}
KBAD = {'id': 'k-bad', 'date': '2026-12-01', 'type': '5K test', 'planId': 'run1', 'typeLocked': True, 'distance': 4.5, 'minutes': 60, 'best5k': 2900, 'week': 3, 'source': 'manual'}

def data(runs):
    return {'app': 'CamsTrainingTracker', 'appVersion': '1.24.0', 'pairTotals': 'none', 'settings': {'startDate': '2026-11-16', 'bodyweightLb': 165},
            'targets': {'back_squat': {'weight': 195, 'reps': 5, 'stall': 0, 'source': 'coach'}}, 'sessions': [], 'runs': runs}

def open_at(browser, iso, errors, runs, size=None, garmin=None):
    ctx = browser.new_context(viewport=size or {'width': 393, 'height': 851}, reduced_motion='reduce', device_scale_factor=1, is_mobile=not size, has_touch=not size, timezone_id='America/Denver')
    ctx.route('https://api.github.com/**', lambda r: r.abort())
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.clock.install(time=datetime.datetime.fromisoformat(iso))
    pg.goto(BASE); pg.wait_for_selector('#view')
    pg.evaluate("b => import('./js/store.js').then(m => m.importAll(b))", data(runs))
    if garmin is not None:
        # sync on (no token, so nothing is fetched) and Garmin's state as the phone keeps it
        pg.evaluate("g => import('./js/store.js').then(async m => { await m.kvSet('sync', { repo: 'me/training-data', role: 'phone' }); await m.kvSet('garmin', g); })", garmin)
    pg.reload(); pg.wait_for_timeout(700)
    pg.evaluate("() => import('./js/ui.js').then(m => m.hideToast())")
    pg.click('button[data-view="runs"]'); pg.wait_for_selector('#runs-week'); pg.wait_for_timeout(200)
    return ctx, pg

OK_GARMIN = {'found': True, 'fetchedAt': '2026-11-26T21:04:39Z', 'activities': 7, 'lastError': None}
txt = lambda pg, sel: pg.locator(sel).first.inner_text().replace('\n', ' ')

try:
  with sync_playwright() as p:
    chrome = os.environ.get('CHROME_PATH') or next((c for c in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium') if os.path.exists(c)), None)
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    errors = []

    print('Thursday Nov 26 (week 2): intervals done, long run next')
    ctx, pg = open_at(browser, '2026-11-26T15:00:00-07:00', errors, [R1, R2, R3], garmin=OK_GARMIN)
    order = pg.evaluate("[...document.querySelectorAll('.runs-main > .card, .runs-side > .card')].map(c => c.id)")
    check('1. the goals come first, then this week, miles by week and the runs', order == ['runs-goal', 'runs-week', 'runs-miles', 'runs-list'], order)
    five = txt(pg, '[data-goal="5k"]'); long = txt(pg, '[data-goal="long"]')
    check('1. 5K: goal 23:00, no time yet, first check-in Tue Dec 1 in 5 days', 'goal 23:00' in five and 'no time yet' in five and 'First check-in Tue, Dec 1, in 5 days' in five, five)
    check('1. the 5K bar is empty (dashed) until the first check-in', pg.locator('[data-goal="5k"] .goal-bar.empty').count() == 1)
    check('1. long run: 3.6 of 7 mi, 3.75 mi this weekend, 7 mi in week 11 if every one is done', 'goal 7 mi' in long and '3.6 mi' in long and 'This weekend: 3.75 mi' in long and '7 mi in week 11' in long, long)
    w = pg.evaluate("document.querySelector('[data-goal=\"long\"] .goal-bar span').style.width")
    check('1. the long run bar is about half full (51%)', w == '51%', w)
    check('1. the planned runs done so far', '3 planned runs done so far, none missed' in txt(pg, '#runs-goal-done'), txt(pg, '#runs-goal-done'))
    plans = pg.locator('#runs-week .run-plan')
    check('2. the long run (next) comes before the intervals (done)', plans.nth(0).get_attribute('data-run') == 'run2' and plans.nth(1).get_attribute('data-run') == 'run1')
    done = txt(pg, '.run-plan[data-run="run1"]')
    check('2. the finished intervals fold to one line: done Thu, its numbers, the plan check', 'folded' in plans.nth(1).get_attribute('class') and '✓ done Thu' in done and '3.4 mi · 1:01:00' in done and 'Well over' in done and '61 min of about 28' in done and 'Fast:' not in done, done)
    check('3. 61 of about 28 min shows red', pg.locator('.run-plan[data-run="run1"] .run-check.off').count() == 1)
    heads = pg.locator('#runs-list .rl-head').all_inner_texts()
    check('5. runs grouped by week, newest first, each with its miles and count', len(heads) == 2 and 'Week 2' in heads[0] and '3.4 mi · 1 run' in heads[0] and 'Week 1' in heads[1] and '6.3 mi · 2 runs' in heads[1], heads)
    chips = pg.evaluate("[...document.querySelectorAll('#runs-list .run-item')].map(r => [r.dataset.id, (r.querySelector('.run-check') || {}).dataset ? r.querySelector('.run-check').dataset.check : null])")
    check('3. each run has its check: the long intervals red, the others green', chips == [['garmin-3', 'off'], ['r-2', 'good'], ['r-1', 'good']], chips)
    check('5. no "Add effort" tag on any run', 'Add effort' not in pg.locator('#runs-list').inner_text())
    check('5. Garmin\'s line sits at the bottom of the runs', pg.locator('#runs-list #garmin-row.foot').count() == 1 and 'Garmin is connected' in txt(pg, '#garmin-status'), txt(pg, '#garmin-row'))
    check('page fits the phone width', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
    hs = pg.evaluate("[...document.querySelectorAll('.goal-row, .run-fold')].map(b => b.getBoundingClientRect().height)")
    check('goal rows and folded runs are tap-sized (44 px or more)', len(hs) == 3 and all(h >= 44 for h in hs), hs)
    pg.screenshot(path=os.path.join(ROOT, 'tests', 'shots-runs-tab.png'), full_page=True) if os.environ.get('SHOTS') else None
    pg.click('.run-plan[data-run="run1"] .run-fold'); pg.wait_for_selector('#run-sheet')
    check('3. the run sheet says the same', 'Well over' in txt(pg, '#run-check') and '61 min of about 28' in txt(pg, '#run-check'), txt(pg, '#run-check'))
    pg.evaluate("() => import('./js/ui.js').then(m => m.closeModal())"); pg.wait_for_timeout(200)
    pg.click('[data-goal="5k"]'); pg.wait_for_selector('#run-sheet')
    check('1. a tap on the 5K goal opens the intervals\' 12 weeks', pg.get_attribute('#run-sheet', 'data-run') == 'run1')
    pg.evaluate("() => import('./js/ui.js').then(m => m.closeModal())"); pg.wait_for_timeout(200)
    pg.click('[data-goal="long"]'); pg.wait_for_selector('#run-sheet')
    check('1. a tap on the long run goal opens the long run\'s 12 weeks', pg.get_attribute('#run-sheet', 'data-run') == 'run2')
    ctx.close()

    print('Tuesday Nov 24 morning: the intervals are next, drawn as blocks')
    ctx, pg = open_at(browser, '2026-11-24T08:00:00-07:00', errors, [R1, R2], garmin=OK_GARMIN)
    first = pg.locator('#runs-week .run-plan').first
    check('2. today\'s intervals come first', first.get_attribute('data-run') == 'run1' and 'today' in first.get_attribute('class'))
    kinds = pg.evaluate("[...document.querySelectorAll('.run-plan[data-run=\"run1\"] .wo-b')].map(b => b.className.replace('wo-b wo-', ''))")
    check('4. blocks: warm-up, 5 fast with 5 easy, cool-down', kinds == ['warm'] + ['fast', 'easy'] * 5 + ['cool'], kinds)
    wid = pg.evaluate("(() => { const b = [...document.querySelectorAll('.run-plan[data-run=\"run1\"] .wo-b')].map(x => x.getBoundingClientRect().width); return [b[0], b[1], b[11]]; })()")
    check('4. block widths follow the minutes (5 min warm-up wider than a 2 min fast part, 3 min cool-down between)', wid[0] > wid[2] > wid[1], wid)
    hts = pg.evaluate("[...document.querySelectorAll('.run-plan[data-run=\"run1\"] .wo-b')].slice(0, 3).map(x => x.getBoundingClientRect().height)")
    check('4. the fast parts stand tallest', hts[1] > hts[0] > hts[2], hts)
    legend = txt(pg, '.run-plan[data-run="run1"] .wo-legend')
    check('4. under the blocks: 5 min warm-up, about 28 min, 3 min cool-down', '5 min warm-up' in legend and 'about 28 min' in legend and '3 min cool-down' in legend, legend)
    lines = pg.locator('.run-plan[data-run="run1"] .run-lines > div').all_inner_texts()
    check('4. the fast and easy lines stay; the warm-up line is in the blocks now', len(lines) == 2 and lines[0].startswith('Fast:') and lines[1].startswith('Easy:'), lines)
    check('4. no blocks on the long run', pg.locator('.run-plan[data-run="run2"] .wo').count() == 0)
    ctx.close()

    print('Garmin with a problem: the line goes to the top')
    ctx, pg = open_at(browser, '2026-11-26T15:00:00-07:00', errors, [R1, R2, R3], garmin={**OK_GARMIN, 'lastError': 'Garmin did not accept the key.'})
    top = pg.evaluate("(() => { const g = document.getElementById('garmin-row'); return [g.parentElement.id || g.parentElement.className, !!g.closest('#runs-list'), g.classList.contains('warn')]; })()")
    check('5. a Garmin problem shows above the cards, not tucked at the bottom', top[1] is False and top[2] is True, top)
    ctx.close()

    print('After two check-ins (Wed Dec 30)')
    ctx, pg = open_at(browser, '2026-12-30T12:00:00-07:00', errors, [R1, R2, R3, K1, K2])
    five = txt(pg, '[data-goal="5k"]')
    check('1. 5K: 26:00 now, 3:00 to go, next check-in Tue Feb 2', '26:00' in five and '3:00 to go' in five and 'Next check-in Tue, Feb 2' in five, five)
    w = pg.evaluate("document.querySelector('[data-goal=\"5k\"] .goal-bar span').style.width")
    check('1. a quarter of the way from the first check-in (27:00) to 23:00', w == '25%', w)
    tests = pg.locator('#runs-5k .goal-test').all_inner_texts()
    check('1. the check-ins so far, with the change', len(tests) == 2 and '27:00' in tests[0] and '26:00' in tests[1] and '−1:00' in tests[1], tests)
    ctx.close()

    print('A 5K that looks wrong')
    ctx, pg = open_at(browser, '2026-12-02T12:00:00-07:00', errors, [R1, R2, R3, KBAD])
    flag = txt(pg, '#runs-goal .goal-flag')
    check('a 48:20 5K is held for his OK on the goals card', 'Check your Dec 1 5K' in flag and 'outside' in flag, flag)
    check('and the 5K goal still has no time', 'no time yet' in txt(pg, '[data-goal="5k"]'))
    pg.click('#runs-goal .goal-flag'); pg.wait_for_selector('#run-sheet')
    check('a tap opens the run with The time is right', pg.locator('#run-5k-ok').count() == 1)
    ctx.close()

    print('The computer')
    ctx, pg = open_at(browser, '2026-11-26T15:00:00-07:00', errors, [R1, R2, R3], size={'width': 1280, 'height': 900}, garmin=OK_GARMIN)
    cols = pg.evaluate("[[...document.querySelectorAll('.runs-main > .card')].map(c => c.id), [...document.querySelectorAll('.runs-side > .card')].map(c => c.id), document.querySelector('.runs-main').getBoundingClientRect().top === document.querySelector('.runs-side').getBoundingClientRect().top]")
    check('two columns: goals and this week on the left, miles and runs on the right', cols == [['runs-goal', 'runs-week'], ['runs-miles', 'runs-list'], True], cols)
    ctx.close()

    check('no page errors', not errors, errors)
    browser.close()
finally:
    server.terminate()

print('\nAll Runs tab checks passed' if not fails else f'\n{len(fails)} FAILED: {fails}')
sys.exit(1 if fails else 0)
