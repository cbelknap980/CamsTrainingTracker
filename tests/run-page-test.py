# run-page-test.py - v1.24.0, Cameron (Nov 26): "Okay lets put these 5k tests in the plan as defined points. I the plan.
# Lets show the plan over the 12 week sprints (similar to how we show the plan for weights)".
# The runs as rows on the Plan list, a run page per run (the 12 weeks, the 5K check-ins as fixed points, a chart once
# there is a check-in), 5K marks on the week strips. Phone size, Denver time, made-up data.
# Run: python3 tests/run-page-test.py   (serves the repo on :8094)
import os, subprocess, sys, time, datetime
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8094
BASE = f'http://localhost:{PORT}/'
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

RUNS = [
    {'id': 'r-iv', 'date': '2026-11-17', 'type': 'Intervals', 'planId': 'run1', 'distance': 2.9, 'minutes': 28, 'week': 1, 'source': 'manual'},
    {'id': 'r-lr', 'date': '2026-11-21', 'type': 'Long run', 'planId': 'run2', 'distance': 3.6, 'minutes': 35, 'week': 1, 'source': 'manual'},
]
DEC1 = {'id': 'r-5k', 'date': '2026-12-01', 'type': '5K test', 'planId': 'run1', 'distance': 4.5, 'minutes': 44, 'best5k': 1600, 'week': 3, 'source': 'manual'}
def data(runs):
    return {'app': 'CamsTrainingTracker', 'appVersion': '1.23.0', 'pairTotals': 'none', 'settings': {'startDate': '2026-11-16', 'bodyweightLb': 165},
            'targets': {'back_squat': {'weight': 195, 'reps': 5, 'stall': 0, 'source': 'coach'}}, 'sessions': [], 'runs': runs}

def open_at(browser, iso, errors, runs, size=None):
    ctx = browser.new_context(viewport=size or {'width': 393, 'height': 851}, reduced_motion='reduce', device_scale_factor=1, is_mobile=not size, has_touch=not size, timezone_id='America/Denver')
    ctx.route('https://api.github.com/**', lambda r: r.abort())
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.clock.install(time=datetime.datetime.fromisoformat(iso))
    pg.goto(BASE); pg.wait_for_selector('#view')
    pg.evaluate("b => import('./js/store.js').then(m => m.importAll(b))", data(runs))
    pg.reload(); pg.wait_for_timeout(700)
    pg.evaluate("() => import('./js/ui.js').then(m => m.hideToast())")
    return ctx, pg

def to_runs(pg):
    pg.click('button[data-view="plan"]'); pg.wait_for_timeout(200)
    pg.click('#plan-seg [data-pane="sessions"]'); pg.click('[data-pick="runs"]'); pg.wait_for_timeout(150)

def tap_week(pg, week):
    # the chart's weeks sit between L=38 and W-R=326 of a 340-wide viewBox
    svg = pg.locator('#run-chart svg'); svg.scroll_into_view_if_needed(); pg.wait_for_timeout(50)
    box = svg.bounding_box()
    pg.mouse.click(box['x'] + (38 + (week - 1) * 288 / 11) / 340 * box['width'], box['y'] + box['height'] / 2); pg.wait_for_timeout(120)

try:
  with sync_playwright() as p:
    chrome = os.environ.get('CHROME_PATH') or next((c for c in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium') if os.path.exists(c)), None)
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    errors = []

    print('Before the first check-in (Thu Nov 26, week 2)')
    ctx, pg = open_at(browser, '2026-11-26T13:00:00-07:00', errors, RUNS)
    pg.click('button[data-view="plan"]'); pg.wait_for_timeout(200)
    marks = pg.locator('#plan-weeks .wk-mark.on')
    check('the week strip marks weeks 3, 7 and 12 with 5K', marks.count() == 3 and [m.get_attribute('data-test-week') for m in marks.all()] == ['3', '7', '12'] and all(t == '5K' for t in marks.all_inner_texts()))
    tops = pg.evaluate("[...document.querySelectorAll('#plan-weeks .wk-mark.on')].map(m => [m.getBoundingClientRect().left, document.querySelectorAll('#plan-weeks .wk-cell')[Number(m.dataset.testWeek) - 1].getBoundingClientRect().left, m.getBoundingClientRect().top > document.querySelector('#plan-weeks .wk-cell').getBoundingClientRect().bottom])")
    check('each 5K mark sits under its own week', all(abs(a - b) < 2 and below for a, b, below in tops), tops)
    pg.click('#plan-seg [data-pane="goals"]'); pg.wait_for_timeout(100)
    check('the Goals tab strip has the same marks', pg.locator('#plan-weeks .wk-mark.on').count() == 3)
    to_runs(pg)
    rows = pg.locator('#plan-runs .run-row')
    iv = pg.locator('.run-row[data-run="run1"]').inner_text().replace('\n', ' '); lr = pg.locator('.run-row[data-run="run2"]').inner_text().replace('\n', ' ')
    check('Sessions, Runs: one row a run with a chevron, like the lifts', rows.count() == 2 and pg.locator('#plan-runs .run-row .ex-go').count() == 2, [iv, lr])
    check('the intervals row says what is next: 5 × 2 min at 7:45-8:15', '5 × 2 min' in iv and '7:45-8:15' in iv and 'Intervals' in iv, iv)
    check('the long run row: 3.75 mi (10% past 3.6) and the heart rate', '3.75 mi' in lr and '130-150' in lr, lr)
    chips = pg.locator('#plan-checkins .rk-chip')
    check('the 5K check-ins are three fixed points: week 3 Dec 1, week 7 Dec 29, week 12 Feb 2', chips.count() == 3 and [c.replace('\n', ' ') for c in chips.all_inner_texts()] == ['Week 3 Dec 1', 'Week 7 Dec 29', 'Week 12 Feb 2'], chips.all_inner_texts())
    hs = pg.evaluate("[...document.querySelectorAll('#plan-runs .run-row, #plan-runs .rk-chip')].map(r => r.getBoundingClientRect().height)")
    check('rows and chips are tap-sized (44 px or more)', all(h >= 44 for h in hs), hs)
    check('page fits the phone width', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
    pg.screenshot(path=os.path.join(ROOT, 'tests', 'shots-run-list.png')) if os.environ.get('SHOTS') else None

    print('The intervals page, before the first check-in')
    rows.first.click(); pg.wait_for_selector('#run-sheet'); pg.wait_for_timeout(200)
    nxt = pg.locator('#run-next').inner_text().replace('\n', ' ')
    check('next time: 5 × 2 at 7:45-8:15, still open this week', '5 × 2' in nxt and '7:45-8:15' in nxt and 'still open' in nxt, nxt)
    cells = pg.locator('#run-strip .rp-cell')
    check('the 12 weeks: 12 cells, weeks 3, 7 and 12 are the check-ins, week 1 done', cells.count() == 12 and [c.get_attribute('data-week') for c in pg.locator('#run-strip .rp-cell.test').all()] == ['3', '7', '12'] and 'done' in (cells.nth(0).get_attribute('class') or ''))
    check('no chart before the first check-in; the page says Dec 1 starts it', pg.locator('#run-chart svg').count() == 0 and 'Dec 1' in pg.locator('#run-chart-wait').inner_text())
    cells.nth(6).click(); pg.wait_for_timeout(100)
    rd = pg.locator('#run-read').inner_text()
    check('tapping week 7 reads it: Dec 29, 5K check-in', 'Week 7' in rd and 'Dec 29' in rd and '5K check-in' in rd and 'on' in (cells.nth(6).get_attribute('class') or ''), rd)
    cells.nth(4).click(); pg.wait_for_timeout(100)
    check('week 5 says its pace comes from the week 3 check-in', 'week 3 check-in' in pg.locator('#run-read-sub').inner_text(), pg.locator('#run-read-sub').inner_text())
    pg.click('#run-chart .lc-more summary'); pg.wait_for_timeout(100)
    trs = pg.locator('#run-weeks tr[data-week]')
    check('every week: 12 rows, the check-ins in them', trs.count() == 12 and '5K check-in' in trs.nth(2).inner_text() and 'from wk 3' in trs.nth(3).inner_text(), [trs.nth(i).inner_text() for i in range(4)])
    ck = pg.locator('#run-checks').inner_text()
    check('the check-ins card: week 3 is next, the goal is 23:00', 'Next' in ck and 'Week 12' in ck and '23:00' in ck, ck)
    check('how it moves names the rates and their sources', all(s in pg.locator('#run-how').inner_text() for s in ('0.5%', '0.3%', 'VDOT O2', 'Gunnarsson', 'Skovgaard', 'Esfarjani')))
    check('run page fits the phone width', pg.evaluate("(s => s.scrollWidth <= s.clientWidth + 1)(document.querySelector('#run-sheet').closest('.sheet'))"))
    pg.click('.lift-back'); pg.wait_for_timeout(200)

    print('The long run page')
    pg.click('.run-row[data-run="run2"]'); pg.wait_for_selector('#run-sheet'); pg.wait_for_timeout(200)
    nxt = pg.locator('#run-next').inner_text().replace('\n', ' ')
    check('next time: 3.75 mi this weekend, longest in 30 days 3.6', '3.75' in nxt and 'This weekend' in nxt and '3.6 mi' in nxt, nxt)
    check('the chart has the plan line, the week 1 run as a dot, and the 7 mi cap', pg.locator('#run-chart path.lc-line').count() == 1 and pg.locator('#run-chart [data-done="1"]').count() == 1 and 'Up to 7 mi' in pg.locator('#run-chart svg').inner_html())
    tap_week(pg, 10)
    rd = pg.locator('#run-read').inner_text()
    check('tapping week 10 reads its weekend and distance', 'Week 10' in rd and ' mi' in rd and 'Jan 23' in rd, rd)
    how = pg.locator('#run-how').inner_text()
    check('how it moves: the 10% rule, when it reaches 7 mi, and its source', '10%' in how and 'reach 7 mi in week' in how and 'Frandsen' in how, how)
    check('the Every week fold stays open from page to page', pg.locator('#run-weeks').is_visible())
    check('every week: 12 rows, week 1 done 3.6 mi', pg.locator('#run-weeks tr[data-week]').count() == 12 and '3.6 mi' in pg.locator('#run-weeks tr[data-week="1"]').inner_text())
    pg.click('.lift-back'); pg.wait_for_timeout(200)
    ctx.close()

    print('Week 3: the check-in on the Week tab')
    ctx, pg = open_at(browser, '2026-12-01T07:00:00-07:00', errors, RUNS)
    pg.click('button[data-view="plan"]'); pg.wait_for_timeout(200); pg.click('#plan-seg [data-pane="week"]'); pg.wait_for_timeout(100)
    tue = pg.locator('#plan-week .day-row[data-day="2"]').inner_text()
    check('Tuesday Dec 1 says Run 1: 5K check-in', 'Run 1: 5K check-in' in tue, tue)
    to_runs(pg)
    iv = pg.locator('.run-row[data-run="run1"]').inner_text().replace('\n', ' ')
    check('the intervals row turns into the 5K check-in, Dec 1', '5K check-in' in iv and 'Dec 1' in iv, iv)
    ctx.close()

    print('After a 26:40 check-in on Dec 1 (Wed Dec 2)')
    ctx, pg = open_at(browser, '2026-12-02T09:00:00-07:00', errors, RUNS + [DEC1])
    to_runs(pg)
    iv = pg.locator('.run-row[data-run="run1"]').inner_text().replace('\n', ' ')
    check('next intervals come from the 5K: 5 × 2 min at 8:05-8:25', '5 × 2 min' in iv and '8:05-8:25' in iv, iv)
    check('the week 3 chip shows the time', '26:40' in pg.locator('#plan-checkins [data-test-week="3"]').inner_text())
    pg.click('#plan-checkins [data-test-week="7"]'); pg.wait_for_selector('#run-sheet'); pg.wait_for_timeout(200)
    check('tapping the week 7 chip opens the intervals page on week 7', 'Week 7' in pg.locator('#run-read').inner_text())
    check('the chart is there: 3 lines, rings at weeks 7 and 12 on each, your 26:40 as a dot at week 3',
          pg.locator('#run-chart path.lc-line').count() == 3 and pg.locator('#run-chart [data-ring]').count() == 6 and pg.locator('#run-chart [data-done="3"]').count() == 1 and '26:40' in pg.locator('#run-chart svg').inner_html())
    vals = [v for v in pg.locator('#run-chart .lc-case .lcc-v').all_inner_texts()]
    check('week 7: doing well 26:08, steady 26:21, struggling 26:40', vals == ['26:08', '26:21', '26:40'], vals)
    tap_week(pg, 12)
    vals = [v for v in pg.locator('#run-chart .lc-case .lcc-v').all_inner_texts()]
    check('dragging to week 12: 25:29, 25:57, 26:40', vals == ['25:29', '25:57', '26:40'] and 'Week 12' in pg.locator('#run-read').inner_text(), vals)
    check('the goal is too far for this chart, so it shows as a note above it', 'Goal 23:00 ↑' in pg.locator('#run-chart svg').inner_html())
    ck = pg.locator('#run-checks').inner_text().replace('\n', ' ')
    check('check-ins: week 3 26:40, week 7 next at about 26:21 (steady), the gap to 23:00 by week 12', '26:40' in ck and 'Next · ~26:21' in ck and '~25:57' in ck and '2:29 short' in ck, ck)
    pg.click('#run-chart .lc-case[data-case="well"]'); pg.wait_for_timeout(150)
    check('picking doing well redraws with it bold and the check-ins follow', 'on' in (pg.locator('#run-chart .lc-case[data-case="well"]').get_attribute('class') or '') and '~25:29' in pg.locator('#run-checks').inner_text())
    pg.click('#run-chart .lc-case[data-case="steady"]'); pg.wait_for_timeout(100)
    nxt = pg.locator('#run-next').inner_text().replace('\n', ' ')
    check('next time says where the pace comes from', '8:05-8:25' in nxt and 'Dec 1 5K, 26:40' in nxt, nxt)
    pg.screenshot(path=os.path.join(ROOT, 'tests', 'shots-run-page.png')) if os.environ.get('SHOTS') else None
    pg.click('.lift-back'); pg.wait_for_timeout(200)
    pg.click('button[data-view="runs"]'); pg.wait_for_selector('#runs-5k-weeks')
    pg.click('#runs-5k-weeks'); pg.wait_for_selector('#run-sheet')
    check('the Runs tab\'s 5K card opens the same page', pg.locator('#run-sheet[data-run="run1"]').count() == 1)
    ctx.close()

    print('Computer')
    ctx, pg = open_at(browser, '2026-12-02T09:00:00-07:00', errors, RUNS + [DEC1], size={'width': 1366, 'height': 768})
    pg.click('button[data-view="plan"]'); pg.wait_for_timeout(300)
    check('the strip marks weeks 3, 7 and 12 under the weeks', pg.locator('#plan-weeks .wk-mark.on').count() == 3)
    check('the right column has the Runs card with both rows', pg.locator('.plan-rail #plan-runs .run-row').count() == 2)
    pg.click('.plan-rail .run-row[data-run="run1"]'); pg.wait_for_selector('#run-sheet'); pg.wait_for_timeout(200)
    w = pg.evaluate("document.querySelector('#run-sheet').closest('.sheet').getBoundingClientRect().width")
    check('the run page opens as a sheet no wider than 620 px', w <= 620, w)
    ctx.close()

    check('no page errors', not errors, errors)
    browser.close()
finally:
    server.terminate()
print('\n' + (f'{len(fails)} FAILED' if fails else 'All run page checks passed'))
sys.exit(1 if fails else 0)
