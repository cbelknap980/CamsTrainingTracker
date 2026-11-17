"""End-to-end check in headless Chrome at phone size. Run: python3 tests/browser-test.py (serves the repo on :8080)."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'tests', 'shots')
os.makedirs(SHOTS, exist_ok=True)
server = subprocess.Popen([sys.executable, '-m', 'http.server', '8080'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else f'  {info}'))
    if not cond: fails.append(name)

def run_session(page, start_selector, baseline_weights, shots_prefix, skip_rests=True, go_behind_at=None):
    page.click(start_selector)
    page.wait_for_selector('.player')
    steps = 0
    kinds = []
    trimmed = False
    while steps < 400:
        if page.locator('.card h1', has_text='Session').count() and not page.locator('.player').count():
            break
        kind = page.locator('.step-kind').inner_text().strip().lower()
        kinds.append(kind)
        name = page.locator('.step-name').inner_text().strip()
        if steps in (0, 3, 12):
            page.screenshot(path=f'{SHOTS}/{shots_prefix}-step{steps}.png')
        if go_behind_at is not None and steps == go_behind_at and not trimmed:
            page.clock.run_for(30 * 60 * 1000)  # 30 minutes vanish (the test skipped rests, so it was well ahead)
            page.wait_for_timeout(300)
            page.screenshot(path=f'{SHOTS}/{shots_prefix}-behind.png')
            check(f'{shots_prefix}: clock shows behind after 30 min lost', 'behind' in page.locator('#clock').inner_text().lower(), page.locator('#clock').inner_text())
            tb = page.locator('#trim-btn')
            check(f'{shots_prefix}: trim button visible', tb.is_visible())
            if tb.is_visible():
                tb.click(); page.wait_for_selector('.modal .sheet')
                page.screenshot(path=f'{SHOTS}/{shots_prefix}-trim-preview.png')
                notes = page.locator('.modal .lines li').all_inner_texts()
                check(f'{shots_prefix}: trim preview lists cuts', len(notes) >= 1, notes)
                page.click('.modal .btn.primary'); page.wait_for_timeout(200)
                trimmed = True
        if kind.startswith('baseline') or kind.startswith('retest'):
            w = baseline_weights.get(name, 135)
            page.fill('#in-weight', str(w)); page.fill('#in-rpe', '8')
            page.click('button.btn.primary:has-text("Done")')
        elif kind.startswith('work set') or kind.startswith('ramp') or kind.startswith('hold'):
            # first-time accessories need a weight
            wv = page.locator('#in-weight')
            if wv.count() and wv.input_value() == '':
                page.fill('#in-weight', '30')
            page.click('button.btn.primary')
        elif kind == 'rest':
            if skip_rests: page.click('button.btn.primary:has-text("Skip rest")')
            else:
                secs = int(page.locator('#timer').inner_text().split(':')[0]) * 60 + int(page.locator('#timer').inner_text().split(':')[1])
                page.clock.run_for((secs + 1) * 1000)
        elif kind in ('timed', 'stretch', 'transition'):
            t = page.locator('#timer').inner_text(); m, s = t.split(':')
            page.clock.run_for((int(m) * 60 + int(s) + 1) * 1000)  # let it auto-advance
        elif kind == 'your call':
            page.click('button.btn.primary:has-text("Do it")')
        else:
            page.click('button.btn.primary')
        page.wait_for_timeout(60)
        steps += 1
    page.wait_for_selector('.card h1')
    page.screenshot(path=f'{SHOTS}/{shots_prefix}-summary.png', full_page=True)
    return steps, kinds

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 393, 'height': 851}, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True)
    ctx.grant_permissions(['notifications'], origin='http://localhost:8080')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    # Pretend it is Monday Nov 16, 2026, 6:00 am local
    page.clock.install(time='2026-11-16T06:00:00')
    page.goto('http://localhost:8080/')
    page.wait_for_selector('.card.accent h1')
    page.screenshot(path=f'{SHOTS}/home-week1.png', full_page=True)
    check('home shows Lift 1 on Monday week 1', 'Lift 1' in page.locator('.card.accent h1').inner_text())
    check('week chip says Week 1', 'week 1' in page.locator('#week-chip').inner_text().lower())

    # ---- Lift 1 end to end (week 1, baseline), go behind during block B to test trim ----
    print('Lift 1')
    steps, kinds = run_session(page, '.card.accent .btn.primary', {'Box squat': 185}, 'lift1', skip_rests=True, go_behind_at=14)
    check('lift1 reached summary', page.locator('h1', has_text='Session').count() == 1)
    lines = page.locator('.card .lines li').all_inner_texts()
    check('lift1 what-changed has a baseline line for box squat at 165', any('Box squat baseline' in l and '165' in l for l in lines), lines)
    check('lift1 what-changed covers RDL start weight', any('Romanian deadlift' in l for l in lines), lines)
    page.click('button:has-text("Done")')
    page.wait_for_selector('.card.accent')
    page.screenshot(path=f'{SHOTS}/home-after-lift1.png', full_page=True)
    rows = page.locator('table tr').all_inner_texts()
    check('home next targets lists Box squat 165 x 4', any('Box squat' in r and '165' in r for r in rows), rows)
    check('home shows what changed card', page.locator('h3', has_text='What changed').count() == 1)

    # ---- Lift 2 with resume mid-way ----
    print('Lift 2 (with reload + resume)')
    page.click('button:has-text("Lift 2")')
    page.wait_for_selector('.player')
    for _ in range(3):
        k = page.locator('.step-kind').inner_text().lower()
        if k == 'timed':
            t = page.locator('#timer').inner_text(); m, s = t.split(':'); page.clock.run_for((int(m) * 60 + int(s) + 1) * 1000)
        else:
            page.click('button.btn.primary')
        page.wait_for_timeout(80)
    before_idx = page.locator('.player-head .block').inner_text()
    page.reload(); page.wait_for_selector('h1')
    check('reload offers Resume', page.locator('h1', has_text='Resume session').count() == 1)
    sw = page.evaluate("navigator.serviceWorker.getRegistration().then(r => !!(r && r.active))")
    check('service worker active (notification path available)', sw, sw)
    page.screenshot(path=f'{SHOTS}/resume.png')
    page.click('button:has-text("Resume")'); page.wait_for_selector('.player')
    check('resume returns to the same block', page.locator('.player-head .block').inner_text() == before_idx, (before_idx, page.locator('.player-head .block').inner_text()))
    # finish lift 2 from here using the same loop (reuse by faking start selector = no click): emulate
    steps2 = 0
    while steps2 < 400 and page.locator('.player').count():
        kind = page.locator('.step-kind').inner_text().strip().lower(); name = page.locator('.step-name').inner_text().strip()
        if kind.startswith('baseline'):
            page.fill('#in-weight', '95' if 'press' in name.lower() else '25'); page.click('button.btn.primary:has-text("Done")')
        elif kind.startswith('work set') or kind.startswith('ramp') or kind.startswith('hold'):
            wv = page.locator('#in-weight')
            if wv.count() and wv.input_value() == '': page.fill('#in-weight', '40')
            page.click('button.btn.primary')
        elif kind == 'rest': page.click('button.btn.primary:has-text("Skip rest")')
        elif kind in ('timed', 'stretch', 'transition'):
            t = page.locator('#timer').inner_text(); m, s = t.split(':'); page.clock.run_for((int(m) * 60 + int(s) + 1) * 1000)
        else: page.click('button.btn.primary')
        page.wait_for_timeout(60); steps2 += 1
    page.wait_for_selector('h1', state='visible')
    check('lift2 reached summary', page.locator('h1', has_text='Session').count() == 1)
    lines2 = page.locator('.card .lines li').all_inner_texts()
    check('lift2 strict press baseline 95 -> 85 (2.5 lb rounding)', any('Strict press baseline' in l and '85' in l for l in lines2), lines2)
    check('lift2 pull-up baseline logged', any('Weighted pull-up baseline' in l for l in lines2), lines2)
    page.screenshot(path=f'{SHOTS}/lift2-summary.png', full_page=True)
    page.click('button:has-text("Done")'); page.wait_for_selector('.card.accent')

    # ---- Lift 3 with real timers on a couple of rests (auto-advance + cue path) ----
    print('Lift 3')
    steps3, kinds3 = run_session(page, 'button:has-text("Lift 3")', {'Power clean': 135, 'Front squat': 155, 'Push press': 115}, 'lift3', skip_rests=False)
    check('lift3 reached summary', page.locator('h1', has_text='Session').count() == 1)
    lines3 = page.locator('.card .lines li').all_inner_texts()
    check('lift3 power clean line present', any('Power clean' in l for l in lines3), lines3)
    check('lift3 side plank line present', any('Side plank' in l for l in lines3), lines3)
    check('lift3 if-time decision was offered', 'your call' in kinds3, set(kinds3))
    page.click('button:has-text("Done")'); page.wait_for_selector('.card.accent')

    # ---- History ----
    page.click('#tabs button[data-view="history"]'); page.wait_for_selector('.list-item')
    check('history lists 3 sessions', page.locator('.list-item').count() == 3, page.locator('.list-item').count())
    page.locator('.list-item').first.click(); page.wait_for_selector('.modal table')
    page.screenshot(path=f'{SHOTS}/history-detail.png', full_page=True)
    page.click('.modal button:has-text("Close")')

    # ---- Runs ----
    page.click('#tabs button[data-view="runs"]'); page.click('button:has-text("Log a run")'); page.wait_for_selector('.modal')
    page.fill('.modal input[type="number"] >> nth=0', '3.1'); page.fill('.modal input[type="number"] >> nth=1', '27.5')
    page.click('.modal button:has-text("Save run")'); page.wait_for_selector('table')
    check('run saved with pace', '8:52' in page.locator('table').inner_text(), page.locator('table').inner_text())
    page.screenshot(path=f'{SHOTS}/runs.png', full_page=True)

    # ---- Architecture tab + search ----
    page.click('#tabs button[data-view="architecture"]'); page.wait_for_selector('.arch-svg')
    check('architecture draws 13 boxes', page.locator('.arch-svg g[data-part]').count() == 13, page.locator('.arch-svg g[data-part]').count())
    page.fill('input[type="search"]', 'trim'); page.wait_for_timeout(100)
    check('search "trim" highlights Player and Rules', page.locator('.arch-svg .box.hit').count() >= 2, page.locator('.arch-svg .box.hit').count())
    check('search filters the part list', page.locator('.arch-part').count() <= 4, page.locator('.arch-part').count())
    page.screenshot(path=f'{SHOTS}/architecture-search.png', full_page=True)

    # ---- Export Excel + backup download ----
    page.click('#settings-btn'); page.wait_for_selector('.modal')
    with page.expect_download() as dl:
        page.click('button:has-text("Export to Excel")')
    xpath = os.path.join(SHOTS, 'export.xlsx'); dl.value.save_as(xpath)
    check('excel export downloaded', os.path.getsize(xpath) > 2000)
    with page.expect_download() as dl2:
        page.click('button:has-text("Download backup file")')
    bpath = os.path.join(SHOTS, 'backup.json'); dl2.value.save_as(bpath)
    b = json.load(open(bpath))
    check('backup has 3 sessions, 1 run, targets', len(b['sessions']) == 3 and len(b['runs']) == 1 and 'back_squat' in b['targets'], {k: len(v) if isinstance(v, list) else '' for k, v in b.items()})
    page.screenshot(path=f'{SHOTS}/settings.png', full_page=True)

    # ---- Week 3 home with targets: ramp-ups appear ----
    page.click('.modal button:has-text("Close")')
    page.clock.set_system_time('2026-11-30T06:00:00'); page.clock.set_fixed_time('2026-11-30T06:00:00')
    page.click('#tabs button[data-view="home"]'); page.wait_for_selector('.card.accent h1')
    check('week 3 chip', 'week 3' in page.locator('#week-chip').inner_text().lower(), page.locator('#week-chip').inner_text())
    page.click('.card.accent .btn.primary'); page.wait_for_selector('.player')
    # skip warmup to reach the first squat step
    for _ in range(12):
        k = page.locator('.step-kind').inner_text().lower()
        if k.startswith('ramp'): break
        if k == 'timed' or k == 'transition':
            page.click('button.btn.primary')
        elif k == 'rest': page.click('button.btn.primary')
        page.wait_for_timeout(50)
    check('week 3 squat starts with a ramp-up set at 45 lb', page.locator('.step-kind').inner_text().lower().startswith('ramp') and '45 lb' in page.locator('.step-target').inner_text(), page.locator('.step-target').inner_text())
    page.screenshot(path=f'{SHOTS}/week3-ramp.png')
    # v1.1 checks: last-time line, PR on a heavier set, menu sheet, tint attribute
    check('week 3 body has work tint attr', page.evaluate("document.body.getAttribute('data-kind')") in ('work', 'calm'), page.evaluate("document.body.getAttribute('data-kind')"))
    # advance through the ramp-ups to the first work set
    for _ in range(12):
        k = page.locator('.step-kind').inner_text().lower()
        if k.startswith('work set'): break
        page.click('button.btn.primary'); page.wait_for_timeout(60)
    check('week 3 first work set shows Last time', page.locator('.last-time').count() == 1 and '165' in page.locator('.last-time').inner_text(), page.locator('.last-time').inner_text() if page.locator('.last-time').count() else 'none')
    page.screenshot(path=f'{SHOTS}/week3-workset.png')
    check('v1.2 strip has one segment per block (6 on Lift 1)', page.locator('.strip-bar .seg').count() == 6, page.locator('.seg-label').all_inner_texts())
    check('v1.2 segment labels use exercise names', 'Squat' in page.locator('.seg-label').all_inner_texts() and any('RDL' in t for t in page.locator('.seg-label').all_inner_texts()), page.locator('.seg-label').all_inner_texts())
    check('v1.2 status line shows block and steps', 'Block 2 of 6' in page.locator('#clock').inner_text() and 'steps' in page.locator('#clock').inner_text(), page.locator('#clock').inner_text())
    check('v1.2 readout tiles show weight and reps', page.locator('.readout .tile').count() == 3 and '165' in page.locator('.tile-weight').inner_text(), page.locator('.readout').inner_text())
    page.click('.strip'); page.wait_for_selector('.overview')
    check('v1.2 overview lists blocks with set ticks', page.locator('.ov-block').count() == 6 and page.locator('.tick.current').count() == 1, page.locator('.ov-block').count())
    page.screenshot(path=f'{SHOTS}/overview.png', full_page=True)
    page.click('.overview button:has-text("Close")')
    page.click('button:has-text("Edit")'); page.fill('#in-weight', '195'); page.fill('#in-reps', '5'); page.click('button.btn.primary')
    page.wait_for_timeout(200)
    check('heavier set triggers PR toast', page.locator('#toast').is_visible() and 'PR' in page.locator('#toast').inner_text(), page.locator('#toast').inner_text())
    check('rest screen shows ring and up-next', page.locator('.ring-fg').count() == 1 and 'up next' in page.locator('.step-main').inner_text().lower(), page.locator('.step-main').inner_text()[:80])
    page.screenshot(path=f'{SHOTS}/week3-rest.png')
    page.click('.player-head .icon-btn'); page.wait_for_selector('.menu')
    check('menu lists pause, back, end', page.locator('.menu-item').count() >= 3, page.locator('.menu-item').all_inner_texts())
    page.screenshot(path=f'{SHOTS}/menu.png')
    page.click('.menu-item:has-text("End session")'); page.click('.modal button:has-text("End session")'); page.wait_for_selector('h1')
    check('summary shows PR card', page.locator('.pr-card').count() == 1, page.locator('.pr-card').inner_text() if page.locator('.pr-card').count() else 'none')
    page.screenshot(path=f'{SHOTS}/week3-summary.png', full_page=True)

    real_errors = [e for e in errors if 'favicon' not in e and 'Failed to load resource' not in e]
    check('no console errors', not real_errors, real_errors[:5])
    browser.close()

server.terminate()
print('\n' + (f'{len(fails)} FAILED: {fails}' if fails else 'All browser checks passed'))
sys.exit(1 if fails else 0)
