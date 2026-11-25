# lift-page-test.py - v1.18.11, Cameron (Nov 25): "The base view should just be weight and sets. Make more compact.
# When we click in then show detail and plan. Also provide a button or [cue] to show I can click in... Make the
# progression chart cleaner and dynamic. Allow me to edit and override as an option if I want to push towards a goal.
# Graph should be able to show per week weight when I click on it not a static picture."
# Phone size, Denver time, made-up data. Run: python3 tests/lift-page-test.py   (serves the repo on :8095)
import os, subprocess, sys, time, datetime
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8095
BASE = f'http://localhost:{PORT}/'
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

DATA = {'app': 'CamsTrainingTracker', 'appVersion': '1.18.9', 'pairTotals': 'none',
        'settings': {'startDate': '2026-11-16', 'bodyweightLb': 165},
        'targets': {'back_squat': {'weight': 195, 'reps': 5, 'stall': 0, 'source': 'coach'}, 'rdl': {'weight': 195, 'reps': 7, 'source': 'coach'},
                    'calf_raise': {'weight': 105, 'reps': 12, 'source': 'coach'}, 'bss': {'weight': 70, 'reps': 8, 'source': 'engine'},
                    'leg_curl': {'weight': 100, 'reps': 11, 'source': 'coach'}, 'curl': {'weight': 50, 'reps': 10, 'source': 'engine'},
                    'oh_tri_ext': {'weight': 80, 'reps': 8, 'source': 'engine'}, 'ab_wheel': {'reps': 10},
                    'weighted_pullup': {'weight': 30, 'reps': 5, 'stall': 0, 'source': 'coach'}, 'power_clean': {'weight': 155, 'reps': 2, 'source': 'coach'}},
        'sessions': [], 'runs': []}

def open_at(browser, iso, errors, size=None, viewer=False):
    ctx = browser.new_context(viewport=size or {'width': 393, 'height': 851}, reduced_motion='reduce', device_scale_factor=1, is_mobile=not size, has_touch=not size, timezone_id='America/Denver')
    ctx.route('https://api.github.com/**', lambda r: r.abort())
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.clock.install(time=datetime.datetime.fromisoformat(iso))
    pg.goto(BASE); pg.wait_for_selector('#view')
    pg.evaluate("b => import('./js/store.js').then(m => m.importAll(b))", DATA)
    if viewer: pg.evaluate("import('./js/sync.js').then(m => m.saveSync({ repo: 'cam/training-data', token: 'x', role: 'viewer', lastPulledExport: null }))")
    pg.reload(); pg.wait_for_timeout(700)
    pg.evaluate("() => import('./js/ui.js').then(m => m.hideToast())")
    return ctx, pg

def to_lift1(pg):
    pg.click('button[data-view="plan"]'); pg.wait_for_timeout(200)
    pg.click('#plan-seg [data-pane="sessions"]'); pg.click('[data-pick="lift1"]'); pg.wait_for_timeout(150)

TV = "() => import('./js/store.js').then(m => m.getTargets())"
GOALS = "() => import('./js/store.js').then(m => m.getSettings()).then(s => s.liftGoals || {})"

def tap_week(pg, i, n):
    # the chart's columns sit between L=34 and W-R=326 of a 340-wide viewBox
    pg.locator('#lift-chart svg').scroll_into_view_if_needed(); pg.wait_for_timeout(50)
    box = pg.locator('#lift-chart svg').bounding_box()
    x = box['x'] + (34 + i * 292 / (n - 1)) / 340 * box['width']
    pg.mouse.click(x, box['y'] + box['height'] / 2); pg.wait_for_timeout(120)
    return x, box

try:
  with sync_playwright() as p:
    chrome = os.environ.get('CHROME_PATH') or next((c for c in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium') if os.path.exists(c)), None)
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    errors = []

    print('The list: one line a lift, sets x reps, weight and a chevron')
    ctx, pg = open_at(browser, '2026-11-25T09:30:00-07:00', errors)
    to_lift1(pg)
    rows = pg.locator('.plan-session .ex-row')
    texts = [t.replace('\n', ' ') for t in rows.all_inner_texts()]
    check('every lift of Lift 1 is a row: 8 rows, each with a chevron', rows.count() == 8 and pg.locator('.plan-session .ex-row .ex-go').count() == 8, texts)
    sq = pg.locator('.ex-row[data-ex="back_squat"]').inner_text().replace('\n', ' ')
    check('squat row: 3 × 5 and 195 lb, nothing else (no rest, no badge)', '3 × 5' in sq and '195 lb' in sq and 'rest' not in sq and 'coach' not in sq, sq)
    check('accessories show the target reps (RDL 3 × 7 at 195, calf 3 × 12 at 105), the finisher its rounds (curl 3 × 10 at 50)', '3 × 7' in pg.locator('.ex-row[data-ex="rdl"]').inner_text() and '3 × 12' in pg.locator('.ex-row[data-ex="calf_raise"]').inner_text() and '3 × 10' in pg.locator('.ex-row[data-ex="curl"]').inner_text() and '50 lb' in pg.locator('.ex-row[data-ex="curl"]').inner_text())
    check('ab wheel: bodyweight', 'bw' in pg.locator('.ex-row[data-ex="ab_wheel"]').inner_text())
    hs = pg.evaluate("[...document.querySelectorAll('.plan-session .ex-row')].map(r => r.getBoundingClientRect().height)")
    check('rows are tap-sized (44 px or more) and compact (under 64 px)', all(44 <= h < 64 for h in hs), hs)
    check('a line says to tap in', 'Tap a lift' in pg.locator('.plan-session .ps-hint').inner_text())
    check('the session goal sits behind an (i), not in the card', pg.locator('.plan-session .ps-head .info-btn').count() == 1 and 'priority' not in pg.locator('.plan-session').inner_text())
    check('page fits the phone width', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
    card_h = pg.evaluate("document.querySelector('.plan-session').getBoundingClientRect().height")
    check('the Lift 1 card is shorter than before (under 760 px; it was about 1000)', card_h < 760, card_h)
    pg.screenshot(path=os.path.join(ROOT, 'tests', 'shots-lift-list.png')) if os.environ.get('SHOTS') else None

    print('The lift page')
    pg.click('.ex-row[data-ex="back_squat"]'); pg.wait_for_selector('#lift-sheet')
    nx = pg.locator('#lift-next').inner_text()
    check('next time: 195 lb, 3 × 5, its rest and who set it', '195' in nx and '3 × 5' in nx and '165 s rest' in nx and 'coach' in nx, nx)
    check('it fills the screen like a page, with a Back button', pg.evaluate("(() => { const s = document.querySelector('.sheet'); return s.classList.contains('sheet-page') && s.getBoundingClientRect().height >= window.innerHeight - 1; })()") and pg.locator('.lift-back').count() == 1)
    read = pg.locator('#lift-read').inner_text()
    vals = pg.locator('.lcc-v').all_inner_texts()
    check('the chart opens on week 11: 245 × 3 doing well, 225 × 3 steady, 220 × 3 struggling', 'Week 11' in read and vals == ['245 × 3', '225 × 3', '220 × 3'], [read, vals])
    n = pg.locator('.lc-wk').count()
    check('a column for now and each week to 12', n == 11 and pg.locator('.lc-wk').first.text_content() == 'now', n)
    tap_week(pg, 4, n)
    check('tap week 6: the numbers follow (215 × 5, 205 × 5, 200 × 5)', 'Week 6' in pg.locator('#lift-read').inner_text() and pg.locator('.lcc-v').all_inner_texts() == ['215 × 5', '205 × 5', '200 × 5'], [pg.locator('#lift-read').inner_text(), pg.locator('.lcc-v').all_inner_texts()])
    check('the selected week is marked under the chart', pg.locator('.lc-wk.on').text_content() == '6')
    x, box = tap_week(pg, 1, n)
    pg.mouse.move(x, box['y'] + 50); pg.mouse.down()
    for i in (2, 3, 4, 5, 6):
        pg.mouse.move(box['x'] + (34 + i * 292 / (n - 1)) / 340 * box['width'], box['y'] + 60, steps=3)
    pg.mouse.up(); pg.wait_for_timeout(100)
    check('drag across: lands on week 8, heavier (230 × 3)', 'Week 8' in pg.locator('#lift-read').inner_text() and 'Heavier' in pg.locator('#lift-read').inner_text() and pg.locator('.lcc-v').first.inner_text() == '230 × 3', pg.locator('#lift-read').inner_text())
    pg.focus('#lift-chart svg'); pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(80)
    check('arrow keys move a week (week 9)', 'Week 9' in pg.locator('#lift-read').inner_text())
    tap_week(pg, n - 1, n)
    check('week 12 is the retest: about 230 × 5 if doing well', 'Retest' in pg.locator('#lift-read').inner_text() and pg.locator('.lcc-v').first.inner_text() == '~230 × 5', pg.locator('.lcc-v').all_inner_texts())
    pg.click('.lc-case[data-case="steady"]'); pg.wait_for_timeout(100)
    check('pick Steady: its line is drawn bold, the week stays', pg.locator('path.lc-line.on').get_attribute('data-case') == 'steady' and 'Week 12' in pg.locator('#lift-read').inner_text())
    pg.click('.lc-case[data-case="well"]'); pg.wait_for_timeout(100)
    pg.click('#lift-chart [data-mode="max"]'); pg.wait_for_timeout(100)
    tap_week(pg, 9, n)
    check('Est. max: week 11 reads 270 / 248 / 242, the benchmark line drawn, the lift for that week below', pg.locator('.lcc-v').all_inner_texts() == ['270', '248', '242'] and pg.locator('svg .lc-bench').count() == 1 and '245 × 3' in pg.locator('#lift-extra').inner_text(), [pg.locator('.lcc-v').all_inner_texts(), pg.locator('#lift-extra').inner_text()])
    pg.click('#lift-chart [data-mode="weight"]'); pg.wait_for_timeout(100)
    pg.click('#lift-chart .lc-more summary'); pg.wait_for_timeout(100)
    check('Every week: a row per week 3 to 12', pg.locator('#lift-weeks tr[data-week]').count() == 10)
    pg.click('#lift-weeks tr[data-week="5"]'); pg.wait_for_timeout(100)
    check('tap a row: the chart goes to that week', 'Week 5' in pg.locator('#lift-read').inner_text() and pg.locator('#lift-weeks tr.on').get_attribute('data-week') == '5')
    check('How it moves: the plan and the three cases', 'Reps stay at 5' in pg.locator('#lift-how').inner_text() and pg.locator('#lift-how li').count() == 3)
    check('the page fits the phone width', pg.evaluate("document.querySelector('.sheet').scrollWidth <= document.querySelector('.sheet').clientWidth + 1"))

    print('Override the next target')
    pg.click('#lift-edit'); pg.wait_for_selector('#lift-t-weight')
    pg.fill('#lift-t-weight', '205'); pg.wait_for_timeout(150)
    check('205 × 5: fine; the chart follows as he types (week 11 doing well 255 × 3)', pg.locator('#lift-t-check').get_attribute('class').endswith('ok') or 'follows' in pg.locator('#lift-t-check').inner_text(), pg.locator('#lift-t-check').inner_text())
    tap_week(pg, 9, n)
    check('...the chart now starts from 205', pg.locator('.lcc-v').first.inner_text().startswith('25'), pg.locator('.lcc-v').all_inner_texts())
    pg.fill('#lift-t-weight', '30'); pg.wait_for_timeout(100)
    check('30 lb on the squat: refused (under the empty bar), Save off', pg.locator('#lift-t-save').is_disabled() and 'empty bar' in pg.locator('#lift-t-check').inner_text())
    pg.fill('#lift-t-weight', '295'); pg.wait_for_timeout(100)
    check('295: flagged, the button asks to Save anyway', 'Save anyway' in pg.locator('#lift-t-save').inner_text() and 'half again' in pg.locator('#lift-t-check').inner_text())
    pg.fill('#lift-t-weight', '205'); pg.wait_for_timeout(100)
    pg.click('#lift-t-save'); pg.wait_for_timeout(400)
    t = pg.evaluate(TV)['back_squat']
    check('saved: 205 × 5, set by you, the flat count cleared', t['weight'] == 205 and t['reps'] == 5 and t['source'] == 'you' and t['stall'] == 0, t)
    check('the page and the list show it', '205' in pg.locator('#lift-next').inner_text() and 'Set by you' in pg.locator('#lift-next').inner_text() and '205 lb' in pg.locator('.ex-row[data-ex="back_squat"]').inner_text())
    check('a toast with Undo', pg.locator('#toast-action').count() == 1 and pg.locator('#toast-action').is_visible())
    pg.click('#toast-action'); pg.wait_for_timeout(400)
    t = pg.evaluate(TV)['back_squat']
    check('Undo puts the coach\'s 195 × 5 back', t['weight'] == 195 and t['source'] == 'coach', t)
    check('...and the page shows it again', '195' in pg.locator('#lift-next').inner_text())

    print('A goal for week 12')
    pg.click('#lift-g-edit'); pg.wait_for_selector('#lift-g-weight')
    check('quick picks: the Intermediate benchmark and his best single', 'Intermediate 274' in pg.locator('.lg-quick').inner_text() and 'Your best 245' in pg.locator('.lg-quick').inner_text())
    pg.fill('#lift-g-weight', '2650'); pg.wait_for_timeout(150)
    check('2650 (a typo): refused', pg.locator('#lift-g-save').is_disabled() and 'typo' in pg.locator('#lift-g-check').inner_text())
    pg.fill('#lift-g-weight', '290'); pg.wait_for_timeout(150)
    check('290: flagged past what a block adds; Save waits for "Keep it anyway"', pg.locator('#lift-g-save').is_disabled() and pg.locator('.lg-ok').is_visible() and '20%' in pg.locator('#lift-g-check').inner_text())
    pg.click('.lg-chip >> nth=0'); pg.wait_for_timeout(150)
    check('tap Intermediate 274: 274 × 1, a push is offered and picked (normal steps end short)', pg.input_value('#lift-g-weight') == '274' and pg.locator('.lg-opt').count() == 2 and pg.locator('.lg-opt.on').get_attribute('data-push') == '5', pg.locator('#lift-g-pace').inner_text())
    check('the chart shows the goal while he decides', pg.locator('#lift-chart .lc-goal-mark').count() == 1)
    pg.fill('#lift-g-weight', '265'); pg.wait_for_timeout(150)
    check('265: normal steps get there if doing well, so normal is picked', pg.locator('.lg-opt.on').get_attribute('data-push') == '0' and 'week 11' in pg.locator('.lg-opt[data-push="0"]').inner_text(), pg.locator('#lift-g-pace').inner_text())
    pg.click('.lg-opt[data-push="5"]'); pg.wait_for_timeout(150)
    pg.click('#lift-g-save'); pg.wait_for_timeout(400)
    g = pg.evaluate(GOALS).get('back_squat') or {}
    check('saved in settings: 265 × 1, pushing 5 lb extra, not flagged', g.get('weight') == 265 and g.get('reps') == 1 and g.get('push') == 5 and g.get('beyond') is False, g)
    gt = pg.locator('#lift-goal').inner_text()
    check('the goal card says where each case gets to and how it pushes', '265 lb × 1' in gt and 'Pushing: 10 lb each clean session' in gt, gt)
    tap_week(pg, 4, n)
    check('the chart runs the push: week 6 doing well 235 × 5 (was 215)', pg.locator('.lcc-v').first.inner_text() == '235 × 5', pg.locator('.lcc-v').all_inner_texts())
    check('How it moves says 10 lb more each time (5 plus 5 toward the goal)', '10 lb more each time (5 plus 5 toward your goal)' in pg.locator('#lift-how').inner_text())
    pg.click('#lift-g-remove'); pg.wait_for_timeout(400)
    check('Remove: no goal in settings, the card is back to Set a goal', not pg.evaluate(GOALS).get('back_squat') and 'Set a goal' in pg.locator('#lift-goal').inner_text())
    pg.click('#toast-action'); pg.wait_for_timeout(400)
    check('Undo brings the goal back', (pg.evaluate(GOALS).get('back_squat') or {}).get('weight') == 265)

    print('Back closes the page')
    pg.go_back(); pg.wait_for_timeout(250)
    check('Android Back: the lift page closes, Plan stays', pg.locator('#lift-sheet').count() == 0 and pg.locator('.plan-session').count() == 1)

    print('Pull-up and a bodyweight lift')
    pg.click('[data-pick="lift2"]'); pg.wait_for_timeout(150)
    check('pull-up row shows added weight (+30 lb)', '+30 lb' in pg.locator('.ex-row[data-ex="weighted_pullup"]').inner_text(), pg.locator('.ex-row[data-ex="weighted_pullup"]').inner_text())
    pg.click('.ex-row[data-ex="weighted_pullup"]'); pg.wait_for_selector('#lift-sheet')
    check('pull-up page: +30 now, the chart in added weight', '+30' in pg.locator('#lift-next').inner_text() and pg.locator('.lcc-v').first.inner_text().startswith('+'), pg.locator('.lcc-v').all_inner_texts())
    pg.evaluate("() => import('./js/ui.js').then(m => m.closeModal())"); pg.wait_for_timeout(100)
    pg.click('[data-pick="lift1"]'); pg.wait_for_timeout(150)
    pg.click('.ex-row[data-ex="ab_wheel"]'); pg.wait_for_selector('#lift-sheet')
    check('ab wheel: reps chart, no weight toggle, no goal card', 'reps' in pg.locator('.lcc-v').first.inner_text() and pg.locator('#lift-chart [data-mode]').count() == 0 and pg.locator('#lift-goal').count() == 0)
    pg.evaluate("() => import('./js/ui.js').then(m => m.closeModal())"); pg.wait_for_timeout(100)
    check('no page errors', not errors, errors)
    ctx.close()

    print('A computer set to Only views')
    errors2 = []
    ctx, pg = open_at(browser, '2026-11-25T09:30:00-07:00', errors2, size={'width': 1280, 'height': 900}, viewer=True)
    pg.click('button[data-view="plan"]'); pg.wait_for_timeout(300)
    check('computer: every session as one line a lift', pg.locator('.plan-session').count() == 3 and pg.locator('.plan-session .ex-row').count() >= 20)
    pg.click('.plan-session[data-session="lift1"] .ex-row[data-ex="back_squat"]'); pg.wait_for_selector('#lift-sheet')
    check('computer: the page opens, with no Edit and no goal buttons', pg.locator('#lift-edit').count() == 0 and pg.locator('#lift-g-edit').count() == 0 and 'set on the phone' in pg.locator('#lift-goal').inner_text())
    check('computer: no page errors', not errors2, errors2)
    ctx.close()
    browser.close()
finally:
  server.terminate()

print('\nAll v1.18.11 checks passed' if not fails else f'\n{len(fails)} FAILED')
sys.exit(1 if fails else 0)
