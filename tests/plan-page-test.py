# plan-page-test.py - v1.18.14, Cameron (Nov 25): "This page still feels clunky." The computer Plan page leads with
# today's session, flags what this week has not logged with the days it still fits, puts the other days on one line
# each (a click opens one), shows the phases on the week strip, and keeps check-ins, goals and an "About this plan"
# fold in a right column. The phone keeps its four tabs; the missed banner sits on its Week tab.
# Denver time, made-up data. Run: python3 tests/plan-page-test.py   (serves the repo on :8096)
import os, subprocess, sys, time, datetime
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8096
BASE = f'http://localhost:{PORT}/'
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

def lift1(week, date):
    sets = [{'exerciseId': 'back_squat', 'blockId': 'a', 'done': True, 'weight': 185, 'reps': 5} for _ in range(3)]
    return {'id': f's-{date}', 'sessionId': 'lift1', 'sessionName': 'Lift 1: Legs', 'week': week, 'date': date, 'startedAt': f'{date}T17:00:00.000Z',
            'endedAt': f'{date}T18:00:00.000Z', 'status': 'complete', 'actualSeconds': 3600, 'plannedSeconds': 3600, 'sets': sets}

DATA = {'app': 'CamsTrainingTracker', 'appVersion': '1.18.13', 'pairTotals': 'none',
        'settings': {'startDate': '2026-11-16', 'bodyweightLb': 165},
        'targets': {'back_squat': {'weight': 195, 'reps': 5, 'stall': 0, 'source': 'coach'}, 'strict_press': {'weight': 90, 'reps': 5, 'source': 'coach'}},
        'sessions': [lift1(2, '2026-11-23')], 'runs': []}

def open_at(browser, iso, errors, size=None, viewer=True):
    phone = size is None
    ctx = browser.new_context(viewport=size or {'width': 393, 'height': 851}, reduced_motion='reduce', device_scale_factor=1, is_mobile=phone, has_touch=phone, timezone_id='America/Denver')
    ctx.route('https://api.github.com/**', lambda r: r.abort())
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.clock.install(time=datetime.datetime.fromisoformat(iso))
    pg.goto(BASE); pg.wait_for_selector('#view')
    pg.evaluate("b => import('./js/store.js').then(m => m.importAll(b))", DATA)
    if viewer and not phone: pg.evaluate("import('./js/sync.js').then(m => m.saveSync({ repo: 'cam/training-data', token: 'x', role: 'viewer', lastPulledExport: null }))")
    pg.reload(); pg.wait_for_timeout(700)
    pg.evaluate("() => import('./js/ui.js').then(m => m.hideToast())")
    pg.click('button[data-view="plan"]:visible'); pg.wait_for_timeout(300)
    return ctx, pg

LAPTOP = {'width': 1366, 'height': 768}
top = lambda pg, sel: pg.evaluate(f"Math.round(document.querySelector('{sel}').getBoundingClientRect().top + scrollY)")
left = lambda pg, sel: pg.evaluate(f"Math.round(document.querySelector('{sel}').getBoundingClientRect().left)")

try:
  with sync_playwright() as p:
    chrome = os.environ.get('CHROME_PATH') or next((c for c in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium') if os.path.exists(c)), None)
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])

    print('Wednesday of week 2 on a laptop (Lift 1 done, Tuesday\'s run not logged)')
    errors = []
    ctx, pg = open_at(browser, '2026-11-25T09:30:00-07:00', errors, size=LAPTOP)
    sub = pg.inner_text('#plan-sub')
    check('the line under the title: week, phase, dates and how many are done', sub == 'Week 2 of 12 · Baseline · Nov 23 – 29 · 1 of 5 done so far', sub)
    check('one strip: 12 weeks with phase names over them (5), no phase legend on the page', pg.locator('#plan-weeks .wk-cell').count() == 12 and pg.locator('#plan-weeks .wk-ph').count() == 5 and pg.locator('.phase-row:visible').count() == 0)
    now = pg.locator('#plan-weeks .wk-cell.now').inner_text().replace('\n', ' ')
    check('week 2 is marked and shows its start date', now == '2 Nov 23', now)
    check('the Build label spans weeks 3 to 6', pg.locator('.wk-ph.ph-build').get_attribute('style').replace(' ', '') == 'grid-column:3/7', pg.locator('.wk-ph.ph-build').get_attribute('style'))
    miss = pg.locator('#plan-missed .miss-row')
    mt = miss.first.inner_text().replace('\n', ' ') if miss.count() else ''
    check('a banner says Run 1 is not logged, what it asks and where it still fits', miss.count() == 1 and miss.first.get_attribute('data-missed') == 'run1' and "Run 1: Intervals isn't logged." in mt and '5 × 2 min fast' in mt and 'It still fits Thursday, Saturday or Sunday.' in mt, mt)
    tag = pg.inner_text('#plan-today .today-tag')
    check('today\'s session comes first: Lift 2, tagged Today · Wed, Nov 25', pg.get_attribute('#plan-today', 'data-session') == 'lift2' and tag == 'Today · Wed, Nov 25', [tag, pg.get_attribute('#plan-today', 'data-session')])
    check('...on the first screen, under the strip and the banner', top(pg, '#plan-today') < 400, top(pg, '#plan-today'))
    sp = pg.locator('#plan-today .ex-row[data-ex="strict_press"]').inner_text().replace('\n', ' ')
    check('...with its lifts as one line each (strict press 4 × 5, 90 lb)', '4 × 5' in sp and '90 lb' in sp, sp)
    check('only today\'s session is open; the others are one line each', pg.locator('.plan-session').count() == 1)
    rows = pg.locator('#plan-rest .rw-row')
    ids = [rows.nth(i).get_attribute('data-item') for i in range(rows.count())]
    check('rest of the week: Lift 1, Run 1, Lift 3, Run 2 in day order', ids == ['lift1', 'run1', 'lift3', 'run2'], ids)
    r1 = pg.locator('.rw-row[data-item="lift1"]').inner_text().replace('\n', ' ')
    check('Lift 1: Mon 23, 3 sets, done', 'Mon 23' in r1 and '3 sets' in r1 and '✓ done' in r1, r1)
    check('Run 1: not logged', 'not logged' in pg.locator('.rw-row[data-item="run1"]').inner_text())
    r3 = pg.locator('.rw-row[data-item="lift3"]').inner_text().replace('\n', ' ')
    check('Lift 3: Fri 27, how many lifts and minutes', 'Fri 27' in r3 and 'lifts · about' in r3, r3)
    check('rest days on one line: Thu, Sun', 'Thu, Sun' in pg.inner_text('#plan-rest .rw-rest'), pg.inner_text('#plan-rest .rw-rest'))
    hs = pg.evaluate("[...document.querySelectorAll('.rw-row')].map(r => r.getBoundingClientRect().height)")
    check('the lines are click-sized (44 px or more)', all(h >= 44 for h in hs), hs)
    pg.click('.rw-row[data-item="lift3"]'); pg.wait_for_timeout(100)
    check('a click opens Lift 3 under its line', pg.locator('.rw-panel .plan-session[data-session="lift3"]').is_visible() and pg.get_attribute('.rw-row[data-item="lift3"]', 'aria-expanded') == 'true')
    pg.click('.rw-row[data-item="run2"]'); pg.wait_for_timeout(100)
    check('a run opens to what it asks', pg.locator('.rw-item:has([data-item="run2"]) .rw-panel .run-ask').is_visible() and 'mi' in pg.locator('.rw-item:has([data-item="run2"]) .rw-panel .run-ask').inner_text())
    pg.click('.rw-row[data-item="run2"]'); pg.wait_for_timeout(100)
    check('a second click closes it', not pg.locator('.rw-item:has([data-item="run2"]) .rw-panel').is_visible() and pg.get_attribute('.rw-row[data-item="run2"]', 'aria-expanded') == 'false')
    pg.click('button[data-view="home"]:visible'); pg.wait_for_timeout(250); pg.click('button[data-view="plan"]:visible'); pg.wait_for_timeout(300)
    check('what was open stays open after leaving the page and coming back', pg.locator('.rw-panel .plan-session[data-session="lift3"]').is_visible())
    check('two columns: check-ins, goals and About on the right', left(pg, '#checkin') > left(pg, '#plan-today') + 400 and left(pg, '#plan-goals') == left(pg, '#checkin') and left(pg, '#plan-about') == left(pg, '#checkin'))
    check('...check-ins start level with the banner, not below the sessions', abs(top(pg, '#checkin') - top(pg, '#plan-missed')) < 4, [top(pg, '#checkin'), top(pg, '#plan-missed')])
    goals = pg.inner_text('#plan-goals')
    check('goals: all 10 in order, and "How the plan works" moved out', pg.locator('#plan-goals .goal-list li').count() == 10 and 'How the plan works' not in goals)
    check('About this plan is closed to start', pg.get_attribute('#plan-about', 'open') is None and not pg.locator('#plan-about .phase-row').first.is_visible())
    pg.click('#plan-about summary'); pg.wait_for_timeout(100)
    ab = pg.inner_text('#plan-about')
    check('About holds the phases, how the plan works, each session\'s goal and the runs', pg.locator('#plan-about .phase-row').count() == 5 and 'How the plan works' in ab and 'What each session is for' in ab and 'Run 2: Long easy run.' in ab, ab[:200])
    pg.click('.rw-row[data-item="lift3"]'); pg.click('#plan-about summary'); pg.wait_for_timeout(100)
    H = pg.evaluate('document.documentElement.scrollHeight')
    check('the page is about 2 laptop screens or less with everything folded (it was 5.1)', H <= 768 * 2.1, H)
    check('no sideways scroll', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
    pg.click('#plan-today .ex-row[data-ex="strict_press"]'); pg.wait_for_selector('#lift-sheet')
    check('a lift in today\'s session opens its page', 'Strict press' in pg.inner_text('#lift-sheet'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    if pg.locator('#lift-sheet').is_visible(): pg.click('.lift-back')
    pg.wait_for_timeout(200)
    pg.click('#plan-missed button[data-go="runs"]'); pg.wait_for_timeout(400)
    check('Open Runs goes to the Runs tab', pg.locator('#tabs .tab.active').get_attribute('data-view') == 'runs', pg.locator('#tabs .tab.active').get_attribute('data-view'))
    check('no page errors', not errors, errors)
    ctx.close()

    print('Tuesday: the run is today')
    errors = []
    ctx, pg = open_at(browser, '2026-11-24T09:00:00-07:00', errors, size=LAPTOP)
    check('today\'s card is Run 1 with its fast and easy lines', pg.get_attribute('#plan-today', 'data-run') == 'run1' and pg.locator('#plan-today .run-lines p').count() == 3 and 'Today · Tue, Nov 24' in pg.inner_text('#plan-today'))
    check('nothing is missed yet', pg.locator('#plan-missed').count() == 0)
    check('Lift 2 is a line for Wednesday', 'Wed 25' in pg.locator('.rw-row[data-item="lift2"]').inner_text())
    check('no page errors', not errors, errors)
    ctx.close()

    print('Thursday: Wednesday\'s Lift 2 and Tuesday\'s run are both missed')
    errors = []
    ctx, pg = open_at(browser, '2026-11-26T09:00:00-07:00', errors, size=LAPTOP)
    rows = pg.locator('#plan-missed .miss-row')
    txt = [t.replace('\n', ' ') for t in rows.all_inner_texts()]
    check('two lines: the run (today, Saturday or Sunday) and the lift (today or Sunday)', rows.count() == 2 and 'It still fits today, Saturday or Sunday.' in txt[0] and "Lift 2: Upper isn't logged." in txt[1] and 'It still fits today or Sunday.' in txt[1], txt)
    check('the lift line goes to Home, where its catch-up starts', pg.locator('#plan-missed [data-missed="lift2"] button').get_attribute('data-go') == 'home')
    check('the next session leads: Next · Fri, Nov 27, Lift 3', pg.get_attribute('#plan-today', 'data-session') == 'lift3' and pg.inner_text('#plan-today .today-tag') == 'Next · Fri, Nov 27', pg.inner_text('#plan-today .today-tag'))
    check('no page errors', not errors, errors)
    ctx.close()

    print('A narrower window (1100 px): one column, nothing cut off')
    errors = []
    ctx, pg = open_at(browser, '2026-11-25T09:30:00-07:00', errors, size={'width': 1100, 'height': 800})
    check('the right column drops under the week', top(pg, '#checkin') > top(pg, '#plan-rest'))
    check('no sideways scroll', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
    check('no page errors', not errors, errors)
    ctx.close()

    print('The phone on Thursday: the same banner on the Week tab, the tabs as before')
    errors = []
    ctx, pg = open_at(browser, '2026-11-26T09:00:00-07:00', errors)
    check('Week tab: the banner with both lines, then the 12 weeks and 7 days', pg.locator('#plan-missed .miss-row').count() == 2 and pg.locator('.wk-cell').count() == 12 and pg.locator('.day-row').count() == 7)
    check('the buttons are thumb-sized (44 px or more)', all(b['height'] >= 44 for b in [pg.locator('#plan-missed button').nth(i).bounding_box() for i in range(2)]))
    check('no sideways scroll', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
    check('no computer layout on the phone', pg.locator('.plan-cols').count() == 0 and pg.locator('#plan-seg').count() == 1)
    check('no page errors', not errors, errors)
    ctx.close()
    browser.close()
finally:
  server.terminate()

print('\nAll v1.18.14 checks passed' if not fails else f'\n{len(fails)} FAILED')
sys.exit(1 if fails else 0)
