# runs-tab-test.py - v1.25.0, Cameron (Nov 26): "lets clean up the run tab. look into running apps that travk progress
# towards a goal and get inspiration. propose then impliment 5 things you find specifically that make user experience
# better". The five: goals on top, the next run first with finished ones folded, the intervals as blocks, a plan check
# on every run, the runs grouped by week with Garmin's line at the bottom.
# v1.26.0, Cameron (Nov 26): "5 more things. Focus on latout and attentive this time". The goals as two tiles, a
# Monday-to-Sunday strip, the next run as one big card with Log at the bottom, the runs as activity rows, one color per
# run type with the miles stacked by type. Phone size, Denver time, made-up data.
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
    order = pg.evaluate("[...document.querySelectorAll('.runs-main > *, .runs-side > .card')].map(c => c.id)")
    check('the goals come first, then this week, miles by week and the runs', order == ['runs-goal', 'runs-week', 'runs-miles', 'runs-list'], order)
    # v1.26.0 1. the goals as two tiles side by side, a big number on each
    five = txt(pg, '[data-goal="5k"]'); long = txt(pg, '[data-goal="long"]')
    check('1. 5K tile: no time yet, goal 23:00, check-in Tue Dec 1 in 5 days', 'No time yet' in five and 'goal 23:00' in five and 'Check-in Tue, Dec 1' in five and 'in 5 days' in five, five)
    check('1. the 5K bar is empty (dashed) until the first check-in', pg.locator('[data-goal="5k"] .goal-bar.empty').count() == 1)
    check('1. long run tile: 3.6 mi, goal 7 mi, 3.75 mi this weekend, 7 mi by week 11', '3.6 mi' in long and 'goal 7 mi' in long and 'This weekend: 3.75 mi' in long and '7 mi by week 11' in long, long)
    w = pg.evaluate("document.querySelector('[data-goal=\"long\"] .goal-bar span').style.width")
    check('1. the long run bar is about half full (51%)', w == '51%', w)
    tiles = pg.evaluate("[...document.querySelectorAll('.goal-tile')].map(t => { const r = t.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })")
    vw = pg.evaluate('window.innerWidth')
    check('1. two tiles side by side, same height, each under half the screen', len(tiles) == 2 and tiles[0][0] == tiles[1][0] and tiles[0][2] == tiles[1][2] and all(t[1] < vw / 2 for t in tiles) and all(t[2] >= 44 for t in tiles), tiles)
    big = pg.evaluate("[getComputedStyle(document.querySelector('[data-goal=\"long\"] .goal-big')).fontSize, getComputedStyle(document.querySelector('[data-goal=\"long\"] .goal-sub')).fontSize].map(parseFloat)")
    check('1. the number is the biggest thing on the tile (over twice the small lines)', big[0] > 2 * big[1], big)
    check('1. the planned runs done so far', '3 planned runs done so far, none missed' in txt(pg, '#runs-goal-done'), txt(pg, '#runs-goal-done'))
    # 2. the week strip
    days = pg.evaluate("[...document.querySelectorAll('#runs-strip .rw-day')].map(d => [d.dataset.date, d.classList.contains('today'), d.querySelector('.rw-mark').dataset.mark, d.querySelector('.rw-mark').textContent])")
    check('2. strip: Mon 23 to Sun 29, seven days', len(days) == 7 and days[0][0] == '2026-11-23' and days[6][0] == '2026-11-29', days)
    check('2. Thu 26 is today, with the intervals done (a check)', days[3][1] and days[3][2] == 'iv-done' and days[3][3] == '✓', days[3])
    check('2. Tue 24 is plain (the intervals moved to Thu)', days[1][2] == 'none' and days[1][3] == '24', days[1])
    check('2. Sat and Sun carry the long run, either day (dashed)', days[5][2] == 'lr-planned' and days[6][2] == 'lr-planned' and pg.locator('#runs-strip .rw-mark.either').count() == 2, days[5:])
    lab = pg.get_attribute('#runs-strip .rw-day.today', 'aria-label')
    check('2. a screen reader hears the day in words', lab == 'Thursday, Nov 26, today, Intervals done', lab)
    check('2. the week total sits by the heading', txt(pg, '#runs-week-total') == '1 of 2 done · 3.4 mi', txt(pg, '#runs-week-total'))
    # 3. the next run as one big card, Log at its bottom
    hero = pg.locator('#runs-next')
    check('3. the next run is the long run, Sat Nov 28 or Sun 29', hero.get_attribute('data-run') == 'run2' and 'Next run · Sat Nov 28 or Sun 29' in txt(pg, '#runs-next'), txt(pg, '#runs-next'))
    sizes = pg.evaluate("['.run-next-ask', '.run-next-name', '.run-next .run-detail'].map(s => parseFloat(getComputedStyle(document.querySelector(s)).fontSize))")
    check('3. the ask (3.75 mi) is the biggest text, then the name, then the notes', sizes[0] > sizes[1] > sizes[2], sizes)
    lg = pg.evaluate("(() => { const b = document.getElementById('runs-next-log').getBoundingClientRect(), c = document.getElementById('runs-next').getBoundingClientRect(); return [Math.round(b.width), Math.round(c.width), Math.round(b.height), Math.round(c.bottom - b.bottom), document.getElementById('runs-next').lastElementChild.id]; })()")
    check('3. Log this run is the last thing on the card, full width and 52 px tall', lg[4] == 'runs-next-log' and lg[0] >= lg[1] - 32 and lg[2] >= 52 and lg[3] <= 16, lg)
    check('3. the Log a run button up top is the quiet one now', 'primary' not in pg.get_attribute('#log-run', 'class') and 'primary' in pg.get_attribute('#runs-next-log', 'class'))
    done = txt(pg, '.run-plan[data-run="run1"]')
    check('3. the finished intervals fold to one line below: done Thu, numbers, the plan check', 'folded' in pg.get_attribute('.run-plan[data-run="run1"]', 'class') and '✓ done Thu' in done and '3.4 mi · 1:01:00' in done and 'Well over' in done and '61 min of about 28' in done, done)
    check('3. 61 of about 28 min shows red', pg.locator('.run-plan[data-run="run1"] .run-check.off').count() == 1)
    # 4. the runs as activity rows
    heads = pg.locator('#runs-list .rl-head').all_inner_texts()
    check('4. runs grouped by week, newest first, each with its miles and count', len(heads) == 2 and 'Week 2' in heads[0] and '3.4 mi · 1 run' in heads[0] and 'Week 1' in heads[1] and '6.3 mi · 2 runs' in heads[1], heads)
    rows = pg.evaluate("[...document.querySelectorAll('#runs-list .run-item')].map(r => [r.dataset.id, r.querySelector('.run-date').innerText.replace('\\n', ' '), r.querySelector('.run-type b').innerText, (r.querySelector('.run-src') || {}).innerText || '', [...r.querySelectorAll('.ra-stat')].map(s => s.innerText.replace('\\n', ' ')), r.querySelector('.run-check').dataset.check])")
    check('4. Thu 26 intervals: the date tile, the type and its source, Distance / Pace / Time / Avg HR, the red check', rows[0] == ['garmin-3', 'Thu 26', 'Intervals', 'Garmin', ['Distance 3.4 mi', 'Pace 17:56/mi', 'Time 1:01:00', 'Avg HR 135'], 'off'], rows[0])
    check('4. the other two are green and typed by hand', [r[5] for r in rows[1:]] == ['good', 'good'] and [r[3] for r in rows[1:]] == ['', ''] and rows[1][1] == 'Sun 22' and rows[2][1] == 'Wed 18', rows)
    xs = pg.evaluate("[...document.querySelectorAll('#runs-list .ra-stat[data-stat=\"Time\"]')].map(s => Math.round(s.getBoundingClientRect().left))")
    check('4. the stats line up down the list', len(set(xs)) == 1, xs)
    check('4. no "Add effort" tag on any run', 'Add effort' not in pg.locator('#runs-list').inner_text())
    check('4. Garmin\'s line sits at the bottom of the runs', pg.locator('#runs-list #garmin-row.foot').count() == 1 and 'Garmin is connected' in txt(pg, '#garmin-status'), txt(pg, '#garmin-row'))
    # 5. one color per run type
    col = pg.evaluate("""(() => { const c = s => getComputedStyle(document.querySelector(s)); return {
      tileLong: c('[data-goal="long"] .goal-bar span').backgroundColor, stripLong: c('#runs-strip .rw-mark.t-lr').borderTopColor, heroDot: c('#runs-next .run-dot').backgroundColor, rowLong: c('.run-item[data-id="r-2"] .run-date').boxShadow,
      stripIv: c('#runs-strip .rw-mark.t-iv').backgroundColor, fast: c('.run-plan[data-run="run1"] .run-dot').backgroundColor, five: c('[data-goal="5k"] .run-dot').backgroundColor }; })()""")
    blue, amber = 'rgb(61, 138, 230)', 'rgb(201, 138, 18)'
    check('5. the long run is the same blue on the tile, the strip and the next-run card', col['tileLong'] == blue and col['stripLong'] == blue and col['heroDot'] == blue, col)
    check('5. intervals are the same amber on the strip and the row', col['stripIv'] == amber and col['fast'] == amber, col)
    check('5. the 5K has its own color (not a status green, yellow or red)', col['five'] == 'rgb(226, 77, 139)', col)
    key = pg.locator('#runs-miles-key .viz-key').all_inner_texts()
    check('5. the miles chart has a legend: Long run, Intervals', key == ['Long run', 'Intervals'], key)
    segs = pg.evaluate("[...document.querySelectorAll('#runs-miles .viz-stack')].map(g => [g.dataset.week, [...g.querySelectorAll('.viz-seg')].map(s => s.dataset.key)])")
    check('5. week 1 stacks long run under intervals; week 2 is intervals only', segs == [['1', ['lr', 'iv']], ['2', ['iv']]], segs)
    gap = pg.evaluate("(() => { const s = [...document.querySelectorAll('#runs-miles .viz-stack[data-week=\"1\"] .viz-seg')].map(x => x.getBBox()); return Math.round((s[0].y - (s[1].y + s[1].height)) * 10) / 10; })()")
    check('5. a 2 px gap between the parts', gap == 2, gap)
    check('page fits the phone width', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
    hs = pg.evaluate("[...document.querySelectorAll('.goal-tile, .run-fold, #runs-next-log, .run-item')].map(b => b.getBoundingClientRect().height)")
    check('tiles, folded runs, Log and the run rows are tap-sized (44 px or more)', len(hs) == 7 and all(h >= 44 for h in hs), hs)
    pg.screenshot(path=os.path.join(ROOT, 'tests', 'shots-runs-tab.png'), full_page=True) if os.environ.get('SHOTS') else None
    pg.click('.run-plan[data-run="run1"] .run-fold'); pg.wait_for_selector('#run-sheet')
    check('the run sheet says the same', 'Well over' in txt(pg, '#run-check') and '61 min of about 28' in txt(pg, '#run-check'), txt(pg, '#run-check'))
    pg.evaluate("() => import('./js/ui.js').then(m => m.closeModal())"); pg.wait_for_timeout(200)
    pg.click('.run-item[data-id="r-2"]'); pg.wait_for_selector('#run-sheet')
    check('a tap on a run row opens it', 'Long run' in txt(pg, '#run-sheet'))
    pg.evaluate("() => import('./js/ui.js').then(m => m.closeModal())"); pg.wait_for_timeout(200)
    pg.click('[data-goal="5k"]'); pg.wait_for_selector('#run-sheet')
    check('1. a tap on the 5K tile opens the intervals\' 12 weeks', pg.get_attribute('#run-sheet', 'data-run') == 'run1')
    pg.evaluate("() => import('./js/ui.js').then(m => m.closeModal())"); pg.wait_for_timeout(200)
    pg.click('[data-goal="long"]'); pg.wait_for_selector('#run-sheet')
    check('1. a tap on the long run tile opens the long run\'s 12 weeks', pg.get_attribute('#run-sheet', 'data-run') == 'run2')
    pg.evaluate("() => import('./js/ui.js').then(m => m.closeModal())"); pg.wait_for_timeout(200)
    pg.click('#runs-next-log'); pg.wait_for_selector('#run-type')
    check('3. Log this run opens the form as a long run', pg.input_value('#run-type') == 'Long run', pg.input_value('#run-type'))
    ctx.close()

    print('Tuesday Nov 24 morning: the intervals are next, drawn as blocks')
    ctx, pg = open_at(browser, '2026-11-24T08:00:00-07:00', errors, [R1, R2], garmin=OK_GARMIN)
    check('3. today\'s intervals are the big card', pg.get_attribute('#runs-next', 'data-run') == 'run1' and 'today' in pg.get_attribute('#runs-next', 'class') and 'Next run · today' in txt(pg, '#runs-next'))
    kinds = pg.evaluate("[...document.querySelectorAll('#runs-next .wo-b')].map(b => b.className.replace('wo-b wo-', ''))")
    check('blocks: warm-up, 5 fast with 5 easy, cool-down', kinds == ['warm'] + ['fast', 'easy'] * 5 + ['cool'], kinds)
    wid = pg.evaluate("(() => { const b = [...document.querySelectorAll('#runs-next .wo-b')].map(x => x.getBoundingClientRect().width); return [b[0], b[1], b[11]]; })()")
    check('block widths follow the minutes (5 min warm-up wider than a 2 min fast part, 3 min cool-down between)', wid[0] > wid[2] > wid[1], wid)
    hts = pg.evaluate("[...document.querySelectorAll('#runs-next .wo-b')].slice(0, 3).map(x => x.getBoundingClientRect().height)")
    check('the fast parts stand tallest', hts[1] > hts[0] > hts[2], hts)
    fast = pg.evaluate("getComputedStyle(document.querySelector('#runs-next .wo-fast')).backgroundColor")
    check('5. the fast parts wear the intervals amber', fast == 'rgb(201, 138, 18)', fast)
    legend = txt(pg, '#runs-next .wo-legend')
    check('under the blocks: 5 min warm-up, about 28 min, 3 min cool-down', '5 min warm-up' in legend and 'about 28 min' in legend and '3 min cool-down' in legend, legend)
    lines = pg.locator('#runs-next .run-lines > div').all_inner_texts()
    check('the fast and easy lines stay; the warm-up line is in the blocks', len(lines) == 2 and lines[0].startswith('Fast:') and lines[1].startswith('Easy:'), lines)
    check('the long run follows as a short row, no blocks', pg.locator('.run-plan[data-run="run2"]').count() == 1 and pg.locator('.run-plan[data-run="run2"] .wo').count() == 0)
    day = pg.evaluate("[...document.querySelectorAll('#runs-strip .rw-day')].map(d => d.querySelector('.rw-mark').dataset.mark)")
    check('2. strip: intervals planned today (Tue), long run either weekend day', day == ['none', 'iv-planned', 'none', 'none', 'none', 'lr-planned', 'lr-planned'], day)
    ctx.close()

    print('Tuesday Dec 1: the first 5K check-in is today')
    ctx, pg = open_at(browser, '2026-12-01T09:00:00-07:00', errors, [R1, R2, R3], garmin=OK_GARMIN)
    hero = txt(pg, '#runs-next')
    check('3. the check-in is the big card, named once', hero.count('5K check-in') == 1 and pg.locator('#runs-next .run-next-name').count() == 0, hero)
    check('2. and it is today on the strip, in the 5K color', pg.evaluate("document.querySelector('#runs-strip .rw-day.today .rw-mark').dataset.mark") == 'fk-planned')
    check('1. the 5K tile says check-in today', 'Check-in today' in txt(pg, '[data-goal="5k"]'), txt(pg, '[data-goal="5k"]'))
    pg.click('#runs-next-log'); pg.wait_for_selector('#run-type')
    check('3. Log this run opens the form as a 5K test', pg.input_value('#run-type') == '5K test', pg.input_value('#run-type'))
    ctx.close()

    print('Garmin with a problem: the line goes to the top')
    ctx, pg = open_at(browser, '2026-11-26T15:00:00-07:00', errors, [R1, R2, R3], garmin={**OK_GARMIN, 'lastError': 'Garmin did not accept the key.'})
    top = pg.evaluate("(() => { const g = document.getElementById('garmin-row'); return [g.parentElement.id || g.parentElement.className, !!g.closest('#runs-list'), g.classList.contains('warn')]; })()")
    check('a Garmin problem shows above the cards, not tucked at the bottom', top[1] is False and top[2] is True, top)
    ctx.close()

    print('After two check-ins (Wed Dec 30)')
    ctx, pg = open_at(browser, '2026-12-30T12:00:00-07:00', errors, [R1, R2, R3, K1, K2])
    five = txt(pg, '[data-goal="5k"]')
    check('1. 5K tile: 26:00 big, 3:00 to go, next Tue Feb 2', '26:00' in five and '3:00 to go' in five and 'Next Tue, Feb 2' in five, five)
    w = pg.evaluate("document.querySelector('[data-goal=\"5k\"] .goal-bar span').style.width")
    check('1. a quarter of the way from the first check-in (27:00) to 23:00', w == '25%', w)
    tests = pg.locator('#runs-5k .goal-test').all_inner_texts()
    check('1. the check-ins so far, with the change', len(tests) == 2 and '27:00' in tests[0] and '26:00' in tests[1] and '−1:00' in tests[1], tests)
    key = pg.locator('#runs-miles-key .viz-key').all_inner_texts()
    check('5. the legend adds the 5K test once there is one', key == ['Long run', 'Intervals', '5K test'], key)
    check('page fits the phone width', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
    ctx.close()

    print('A 5K that looks wrong')
    ctx, pg = open_at(browser, '2026-12-02T12:00:00-07:00', errors, [R1, R2, R3, KBAD])
    flag = txt(pg, '#runs-goal .goal-flag')
    check('a 48:20 5K is held for his OK under the goals', 'Check your Dec 1 5K' in flag and 'outside' in flag, flag)
    check('and the 5K tile still has no time', 'No time yet' in txt(pg, '[data-goal="5k"]'))
    pg.click('#runs-goal .goal-flag'); pg.wait_for_selector('#run-sheet')
    check('a tap opens the run with The time is right', pg.locator('#run-5k-ok').count() == 1)
    ctx.close()

    print('The computer')
    ctx, pg = open_at(browser, '2026-11-26T15:00:00-07:00', errors, [R1, R2, R3], size={'width': 1280, 'height': 900}, garmin=OK_GARMIN)
    cols = pg.evaluate("[[...document.querySelectorAll('.runs-main > *')].map(c => c.id), [...document.querySelectorAll('.runs-side > .card')].map(c => c.id), document.querySelector('.runs-main').getBoundingClientRect().top === document.querySelector('.runs-side').getBoundingClientRect().top]")
    check('two columns: goals and this week on the left, miles and runs on the right', cols == [['runs-goal', 'runs-week'], ['runs-miles', 'runs-list'], True], cols)
    ctx.close()

    check('no page errors', not errors, errors)
    browser.close()
finally:
    server.terminate()

print('\nAll Runs tab checks passed' if not fails else f'\n{len(fails)} FAILED: {fails}')
sys.exit(1 if fails else 0)
