# feel-test.py - v1.14 feel changes, end to end in a phone-sized browser: week rings on Home, (i) sheets,
# the Android back gesture (sheet, page, workout), icon shortcuts, the hero workout screen with folding cues,
# Undo for Done and Skip, the status bar color per phase, Session done with volume and Save image, swipe to
# delete a session with Undo, and a tap-size check. Run: python3 tests/feel-test.py
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'tests', 'shots'); os.makedirs(SHOTS, exist_ok=True)
PORT = 8085
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

TARGETS = {'back_squat': {'weight': 170, 'reps': 4}, 'rdl': {'weight': 150, 'reps': 6}, 'calf_raise': {'weight': 135, 'reps': 10}, 'bss': {'weight': 60, 'reps': 8},
           'leg_curl': {'weight': 80, 'reps': 8}, 'curl': {'weight': 50, 'reps': 10}, 'oh_tri_ext': {'weight': 40, 'reps': 10}}
PREV = {'id': 'ses_prev', 'sessionId': 'lift1', 'sessionName': 'Lift 1: Legs', 'logName': 'Lift 1', 'week': 2, 'date': '2026-11-23', 'startedAt': '2026-11-23T13:00:00.000Z',
        'endedAt': '2026-11-23T14:00:00.000Z', 'plannedSeconds': 3500, 'actualSeconds': 3400, 'pausedSeconds': 0, 'trims': [], 'status': 'complete', 'engineMinutes': 0,
        'sets': [{'exerciseId': 'back_squat', 'name': 'Back squat', 'setIndex': i, 'weight': 165, 'reps': 4, 'rpe': 8, 'done': True, 'skipped': False, 'blockId': 'lift1:A'} for i in (1, 2, 3)],
        'whatChanged': [], 'e1rms': {}, 'prs': []}

def secs(page):
    m, s = page.locator('#timer').inner_text().split(':'); return int(m) * 60 + int(s)
def kind(page): return page.locator('.step-kind').inner_text().strip().lower()
def name(page): return page.locator('.step-name').first.inner_text().strip()
def where(page): return page.locator('.step-where').first.inner_text().strip() if page.locator('.step-where').count() else ''
def screen_key(page):
    return page.evaluate("() => ['.step-kind', '.step-name', '#where', '.step-where'].map(s => { const e = document.querySelector(s); return e ? e.textContent.trim() : ''; }).join('|')")
def run_out(page):
    """Let the clock run until the step ends by itself. v1.18: a step done one side at a time has two clocks and no #timer."""
    if page.locator('#timer').count(): page.clock.run_for((secs(page) + 1) * 1000); return
    key = screen_key(page)
    for _ in range(600):
        page.clock.run_for(1000)
        if not page.locator('.player').count() or screen_key(page) != key: return
def step(page):
    k = kind(page)
    if page.locator('#confirm-btn').count(): page.click('#confirm-btn'); page.clock.run_for(700)   # v1.18: a second tap within 0.6 s is ignored
    elif k in ('timed', 'stretch') or (k == 'set up' and not page.locator('#up-next').count()): run_out(page)
    else: page.click('.player-actions button.btn.primary')
    page.wait_for_timeout(60)
def active_tab(page): return page.locator('#tabs .tab.active').get_attribute('data-view')
def small_targets(page):
    """Visible buttons and inputs under 40 px in either direction (the (i) dot counts its 44 px hit area)."""
    return page.evaluate("""() => [...document.querySelectorAll('button, input, select, summary, a, [role=button]')].filter(e => {
      const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false;
      const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      if (e.classList.contains('info-btn')) return false;
      if (e.type === 'file' || e.closest('[hidden]')) return false;
      return r.height < 40 || r.width < 40; }).map(e => (e.id || e.className || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height) + ' ' + (e.innerText || '').slice(0, 20))""")

with sync_playwright() as p:
    chrome = os.environ.get('CHROME_PATH') or next((c for c in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium') if os.path.exists(c)), None)
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 393, 'height': 851}, reduced_motion='reduce', device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script("window.SpeechSynthesisUtterance = function (t) { this.text = t; }; Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak() {} }, configurable: true }); window.__buzz = []; navigator.vibrate = p => { window.__buzz.push(p); return true; };")
    # Monday of week 3, 6:00 am: Lift 1 day
    page.clock.install(time='2026-11-30T06:00:00')
    page.goto(f'http://localhost:{PORT}/'); page.wait_for_selector('.card.accent h1')
    page.evaluate("([t, s]) => import('./js/store.js').then(async m => { await m.setTargets(t); await m.setPairTotals('none'); await m.putSession(s); })", [TARGETS, PREV])
    page.reload(); page.wait_for_selector('.card.accent h1')

    print('Home')
    rings = page.locator('#week-rings .ring-btn')
    check('week rings: Lifts, Runs, Hard efforts', rings.count() == 3 and [x.strip() for x in page.locator('.wk-ring-label').all_inner_texts()] == ['Lifts', 'Runs', 'Hard efforts'], page.locator('.wk-ring-label').all_inner_texts())
    check('rings count this week only (last week\'s Lift 1 is not in it)', '0/3' in page.locator('[data-ring=lifts] .wk-ring-num').inner_text().replace(' ', ''), page.locator('[data-ring=lifts]').inner_text())
    check('the rings sit above today\'s card', page.evaluate("document.querySelector('#week-rings').compareDocumentPosition(document.querySelector('#today-card')) & 4") > 0)
    page.screenshot(path=f'{SHOTS}/v114-home.png')
    mains = page.locator('#next-targets tr.tappable')
    check('v1.15 Home lists the main lifts only (7 rows, no leg curl or curls)', mains.count() == 7 and page.locator('#next-targets', has_text='Seated leg curl').count() == 0 and page.locator('#next-targets', has_text='Standing dumbbell curl').count() == 0 and 'Back squat' in mains.first.inner_text(), page.locator('#next-targets').inner_text()[:300])
    check('v1.15 a main lift with no target says so', 'Not set yet' in page.locator('#next-targets tr[data-ex=power_clean]').inner_text(), page.locator('#next-targets tr[data-ex=power_clean]').inner_text())
    page.click('.tab[data-view=plan]'); page.wait_for_timeout(100)
    page.tap('#tabs .tab[data-view=home]'); page.wait_for_timeout(100)
    check('a tap buzzes the phone', len(page.evaluate('window.__buzz')) >= 1, page.evaluate('window.__buzz'))
    page.click('[data-ring=lifts]'); page.wait_for_timeout(150)
    check('the Lifts ring opens Progress', active_tab(page) == 'progress', active_tab(page))

    print('Info sheets and the back gesture')
    info = page.locator('.info-btn').first
    check('Progress explains behind (i), not in a paragraph', page.locator('.section-note').count() == 0 and page.locator('.info-btn').count() >= 2, page.locator('.info-btn').count())
    info.click(); page.wait_for_selector('.modal .info-sheet')
    check('(i) opens a sheet with the explanation', '1 + reps' in page.locator('.modal').inner_text(), page.locator('.modal').inner_text()[:120])
    page.screenshot(path=f'{SHOTS}/v114-info-sheet.png')
    page.go_back(); page.wait_for_timeout(150)
    check('Back closes the sheet and stays on Progress', page.locator('.modal').is_hidden() and active_tab(page) == 'progress', active_tab(page))
    page.go_back(); page.wait_for_timeout(200)
    check('Back again goes Home instead of leaving the app', active_tab(page) == 'home' and page.url.startswith(f'http://localhost:{PORT}/'), (active_tab(page), page.url))

    print('Shortcuts')
    page.goto(f'http://localhost:{PORT}/?go=progress'); page.wait_for_timeout(600)
    check('?go=progress opens Progress and the address loses the ?go', active_tab(page) == 'progress' and '?go' not in page.url, (active_tab(page), page.url))
    page.goto(f'http://localhost:{PORT}/?go=today'); page.wait_for_selector('#start-workout')
    check('?go=today opens today\'s session page', 'Lift 1' in page.locator('#preview-hero h1').inner_text())
    tt = page.locator('#targets-today')
    check('v1.15 start page: Targets today right under the title', tt.count() == 1 and page.evaluate("document.querySelector('#preview-hero').nextElementSibling.id") == 'targets-today')
    sq = page.locator('#targets-today tr[data-ex=back_squat]').inner_text() if page.locator('#targets-today tr[data-ex=back_squat]').count() else ''
    check('v1.15 Targets today: back squat 170 x 4 and last time', '170 lb × 4' in sq and 'last 165 × 4 (3 sets)' in sq, sq)
    check('v1.15 Targets today: every weighted lift of the day, dumbbell totals shown', all(page.locator(f'#targets-today tr[data-ex={x}]').count() == 1 for x in ('rdl', 'calf_raise', 'bss', 'leg_curl', 'curl', 'oh_tri_ext')) and '50 lb × 10' in page.locator('#targets-today tr[data-ex=curl]').inner_text() and 'two 25s' in page.locator('#targets-today tr[data-ex=curl]').inner_text() and page.locator('#targets-today tr[data-ex=ab_wheel]').count() == 0, tt.inner_text()[:400])
    page.screenshot(path=f'{SHOTS}/v115-targets-today.png')
    m = json.load(open(os.path.join(ROOT, 'manifest.webmanifest')))
    check('manifest offers three long-press shortcuts', [s['url'] for s in m.get('shortcuts', [])] == ['./?go=today', './?go=runs', './?go=progress'])

    print('Workout')
    page.click('#start-workout'); page.wait_for_selector('.player')
    bar = lambda: page.evaluate("document.querySelector('meta[name=theme-color]').content")
    for _ in range(80):   # v1.18: each bar change on the way up waits for Set-up done, so there are more taps
        if kind(page) == 'work' and name(page) == 'Back squat': break
        step(page)
    check('status bar takes the work color', bar() == '#12432f', bar())
    check('hero: 170 big, 4 reps and the effort on one line', page.locator('#hero-readout .hw-num').inner_text().strip() == '170' and page.locator('.hl-reps b').inner_text().strip() == '4' and 'tank' in page.locator('.hl-effort').inner_text(), page.locator('#hero-readout').inner_text())
    check('cues open on set 1', page.locator('details.cues[open]').count() == 1)
    check('no Next line under a work set', page.locator('.step-main .next').count() == 0)
    page.screenshot(path=f'{SHOTS}/v114-work-set.png')
    small = small_targets(page)
    check('workout buttons are at least 40 px', not small, small)
    page.click('.player-actions .secondary button:has-text("Edit")'); page.wait_for_selector('#in-weight')
    page.fill('#in-weight', ''); page.click('.stepper:has(#in-weight) button[aria-label=more]')
    check('v1.15 barbell: + on an empty weight box starts at the 45 lb bar', page.locator('#in-weight').input_value() == '45', page.locator('#in-weight').input_value())
    page.fill('#in-weight', '5'); page.click('.player-actions button.btn.primary'); page.wait_for_timeout(100)
    check('v1.16 a weight under the bar is held: same set, the number stays, a note asks to fix it or tap Done again', page.locator('#num-flag').is_visible() and 'empty bar' in page.locator('#num-flag').inner_text() and 'Set 1 of 3' in where(page) and page.locator('#in-weight').input_value() == '5', (where(page), page.locator('#edit-panel').inner_text()[:200]))
    page.screenshot(path=f'{SHOTS}/v116-flag-in-workout.png')
    page.fill('#in-weight', '170'); page.click('.player-actions .secondary button:has-text("Hide")'); page.wait_for_timeout(60)
    page.click('.player-actions button.btn.primary'); page.wait_for_selector('#jd-undo')
    check('rest screen offers Undo for the set just logged', page.locator('#jd-undo').is_visible())
    page.screenshot(path=f'{SHOTS}/v114-rest-undo.png')
    check('status bar takes the rest color', bar() == '#1a3c73', bar())
    page.click('#jd-undo'); page.wait_for_timeout(100)
    check('Undo goes back to set 1, not logged', kind(page) == 'work' and 'Set 1 of 3' in where(page), (kind(page), where(page)))
    page.click('.player-actions button.btn.primary'); page.wait_for_timeout(80)
    for _ in range(10):
        if kind(page) == 'work': break
        step(page)
    check('set 2: cues folded away', 'Set 2 of 3' in where(page) and page.locator('details.cues').count() == 1 and page.locator('details.cues[open]').count() == 0, (where(page), page.locator('details.cues[open]').count()))
    page.click('.player-actions .secondary button:has-text("Skip")'); page.wait_for_timeout(80)
    check('Skip shows a toast with Undo', page.locator('#toast-action').is_visible() and 'Skipped' in page.locator('#toast').inner_text())
    page.screenshot(path=f'{SHOTS}/v114-skip-undo.png')
    page.click('#toast-action'); page.wait_for_timeout(80)
    check('Undo brings set 2 back', kind(page) == 'work' and 'Set 2 of 3' in where(page), (kind(page), where(page)))
    page.go_back(); page.wait_for_timeout(150)
    check('Back during a workout opens the menu', page.locator('.modal .menu').count() == 1 and page.locator('.player').count() == 1)
    page.go_back(); page.wait_for_timeout(150)
    check('Back again closes the menu, the workout stays', page.locator('.modal').is_hidden() and page.locator('.player').count() == 1)
    if page.locator('#edit-panel').is_hidden(): page.click('.player-actions .secondary button:has-text("Edit")')
    page.fill('#in-weight', '400'); page.click('.player-actions button.btn.primary'); page.wait_for_timeout(100)
    check('v1.16 far over the target is held too', page.locator('#num-flag').is_visible() and 'Set 2 of 3' in where(page), where(page))
    page.click('.player-actions button.btn.primary'); page.wait_for_timeout(80)
    check('v1.16 Done a second time keeps the number', 'Set 2 of 3' not in where(page) or kind(page) != 'work', (kind(page), where(page)))
    page.click('#more-btn'); page.click('text=End session early'); page.click('.modal button:has-text("End session")')
    page.wait_for_selector('h1:has-text("Review and save")')
    page.go_back(); page.wait_for_timeout(150)
    check('Back on the unsaved review stays put', page.locator('h1:has-text("Review and save")').count() == 1)
    check('v1.16 a number kept in the workout is not asked about again on the review', page.locator('#review-open .open-item.num').count() == 0, page.locator('#review-open').inner_text()[:300] if page.locator('#review-open').count() else '')
    page.locator('.review-card', has_text='Back squat').locator('.review-set').first.click(); page.wait_for_selector('.modal input')
    page.locator('.modal input').first.fill('5'); page.click('.modal button:has-text("Save")'); page.wait_for_timeout(150)
    check('v1.16 review: a number typed in that looks wrong is listed and holds Save', page.locator('#review-open .open-item.num').count() == 1 and 'under the empty bar' in page.locator('#review-open').inner_text() and page.locator('#save-session').is_disabled() and page.locator('#confirm-numbers').count() == 1, page.locator('#review-open').inner_text()[:300])
    page.screenshot(path=f'{SHOTS}/v116-review-flag.png')
    page.locator('#review-open .open-item.num').click(); page.wait_for_selector('.modal #num-flag')
    page.locator('.modal input').first.fill('170'); page.click('.modal button:has-text("Save")'); page.wait_for_timeout(150)
    check('v1.16 review: fixing it clears the flag', page.locator('#review-open .open-item.num').count() == 0)
    if page.locator('#confirm-skipped').count(): page.click('#confirm-skipped'); page.wait_for_timeout(150)
    page.click('#save-session'); page.wait_for_selector('#done-card')

    print('Session done')
    txt = page.locator('#done-card').inner_text()
    check('volume compared with the same session last time', 'vs last time' in txt, txt)
    check('the week\'s rings on the card: Lifts 1/3', '1/3' in page.locator('#done-card [data-ring=lifts]').inner_text().replace(' ', ''), page.locator('#done-card .wk-rings').inner_text() if page.locator('#done-card .wk-rings').count() else 'none')
    check('status bar back to the app color', bar() == '#0d0f13', bar())
    page.screenshot(path=f'{SHOTS}/v114-session-done.png', full_page=True)
    with page.expect_download() as dl:
        page.click('#save-image')
    d = dl.value
    path = os.path.join(SHOTS, 'v114-share-card.png'); d.save_as(path)
    check('Save image makes a PNG of the card', d.suggested_filename.endswith('.png') and os.path.getsize(path) > 20000, (d.suggested_filename, os.path.getsize(path)))

    print('Swipe to delete')
    page.click('#summary-done'); page.wait_for_timeout(250)
    check('Home after the session: Lifts 1/3', '1/3' in page.locator('#week-rings [data-ring=lifts]').inner_text().replace(' ', '').replace('\n', ''))
    page.screenshot(path=f'{SHOTS}/v114-home-after.png')
    page.click('.tab[data-view=progress]'); page.wait_for_timeout(150)
    page.click('#progress-mode button[data-mode=sessions]'); page.wait_for_selector('.swipe-wrap')
    before = page.locator('.swipe-wrap').count()
    page.evaluate("""() => { const r = document.querySelector('.swipe-wrap .list-item'); const b = r.getBoundingClientRect(); const y = b.top + b.height / 2;
      const ev = (t, x) => r.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y }));
      ev('pointerdown', b.right - 20); for (let i = 1; i <= 10; i++) ev('pointermove', b.right - 20 - i * 25); ev('pointerup', b.right - 270); }""")
    page.wait_for_timeout(500)
    check('swipe left deletes the session and offers Undo', page.locator('.swipe-wrap').count() == before - 1 and page.locator('#toast-action').is_visible(), (before, page.locator('.swipe-wrap').count()))
    page.screenshot(path=f'{SHOTS}/v114-swipe-undo.png')
    page.click('#toast-action'); page.wait_for_timeout(400)
    check('Undo puts it back', page.locator('.swipe-wrap').count() == before, page.locator('.swipe-wrap').count())

    print('v1.15 header and the dumbbell question')
    page.evaluate("() => import('./js/store.js').then(async m => { await m.kvDel('pairTotals'); await m.kvSet('sync', { repo: 'x/y', role: 'phone', token: 't', lastPushedAt: '2026-11-30T05:09:00' }); })")
    page.goto(f'http://localhost:{PORT}/'); page.wait_for_selector('#pair-prompt')
    chip = page.locator('#week-chip').bounding_box(); sync = page.locator('#sync-chip').bounding_box()
    check('header: the week pill is one line and clear of the sync chip', chip['height'] < 40 and chip['x'] + chip['width'] <= sync['x'], (chip, sync, page.locator('#sync-chip').inner_text()))
    check('header: the sync chip fits its time at 393 px', page.locator('#sync-chip .sc-time').is_visible() and not page.locator('#sync-chip .sc-word').is_visible(), page.locator('#sync-chip').inner_text())
    page.screenshot(path=f'{SHOTS}/v115-pair-question.png')
    check('the question hides the tab bar until it is answered', not page.locator('#tabs').is_visible())
    check('the choices name the dumbbells', page.locator('.pair-row[data-ex=bss] [data-pick=total]').inner_text() == 'Two 30s' and page.locator('.pair-row[data-ex=bss] [data-pick=one]').inner_text() == 'Two 60s', page.locator('.pair-row[data-ex=bss]').inner_text())
    bar_box = page.locator('.pair-bar').bounding_box()
    check('Save is in view without scrolling', bar_box['y'] + bar_box['height'] <= 851 and page.locator('#pair-save').is_disabled(), bar_box)
    page.click('#pair-keep'); page.wait_for_selector('#pair-prompt', state='detached'); page.wait_for_timeout(150)
    check('Not sure leaves the numbers, brings the tabs back and is not asked again', page.locator('#tabs').is_visible() and page.evaluate("() => import('./js/store.js').then(m => m.getPairTotals())") == 'kept', page.evaluate("() => import('./js/store.js').then(m => m.getPairTotals())"))
    page.reload(); page.wait_for_timeout(800)
    check('a reload does not bring the question back', page.locator('#pair-prompt').count() == 0)
    page.evaluate("() => import('./js/store.js').then(m => m.kvDel('sync'))"); page.reload(); page.wait_for_timeout(600)

    print('Tap sizes')
    for tab in ('home', 'progress', 'plan', 'runs'):
        page.click(f'.tab[data-view={tab}]'); page.wait_for_timeout(250)
        small = small_targets(page)
        check(f'{tab}: every button at least 40 px', not small, small)
    print('v1.16 numbers already saved (Cameron\'s Nov 17 squat)')
    ctx2 = browser.new_context(viewport={'width': 393, 'height': 851}, reduced_motion='reduce', device_scale_factor=2, is_mobile=True, has_touch=True)
    p2 = ctx2.new_page(); p2.on('pageerror', lambda e: errors.append(str(e)))
    p2.clock.install(time='2026-11-19T17:11:00')
    p2.goto(f'http://localhost:{PORT}/'); p2.wait_for_selector('.card.accent h1')
    S = lambda w, **k: {'exerciseId': 'back_squat', 'name': 'Back squat', 'done': True, 'skipped': False, 'ramp': False, 'repRange': [4, 6], 'target': {'weight': 10, 'reps': 4}, 'weight': w, 'reps': 4, 'rpe': 8, 'blockId': 'A', **k}
    NOV17 = {'id': 'ses_n17', 'sessionId': 'lift1', 'sessionName': 'Lift 1: Legs', 'logName': 'Lift 1', 'week': 1, 'date': '2026-11-17', 'startedAt': '2026-11-17T17:00:00.000Z', 'endedAt': '2026-11-17T18:00:00.000Z',
             'plannedSeconds': 3500, 'actualSeconds': 3400, 'pausedSeconds': 0, 'trims': [], 'status': 'complete', 'phase': {'id': 'baseline'},
             'sets': [S(5, baseline=True, repRange=[5, 5], reps=5, target={'weight': None, 'reps': 5}, setIndex=0), S(10, setIndex=1, target={'weight': 5, 'reps': 4}), S(10, setIndex=2), S(10, setIndex=3)],
             'whatChanged': [{'exerciseId': 'back_squat', 'name': 'Back squat', 'text': 'Back squat baseline: 5 lb x 5. Training weight 5 lb through week 2.'}], 'e1rms': {'back_squat': 11}, 'prs': []}
    p2.evaluate("([s, t]) => import('./js/store.js').then(async m => { await m.saveSettings({ ...(await m.getSettings()), startDate: '2026-11-16' }); await m.setPairTotals('none'); await m.setTargets(t); await m.putSession(s); })",
                [NOV17, {'back_squat': {'weight': 5, 'reps': 4, 'source': 'baseline', 'e1rm': 11, 'bestE1rm': 11, 'bestWeight': 10, 'baselineWeight': 5}}])
    p2.reload(); p2.wait_for_selector('#check-numbers')
    check('Home leads with Check these numbers for the squat', 'Back squat' in p2.locator('#check-numbers').inner_text() and '5, 10, 10, 10 lb' in p2.locator('#check-numbers').inner_text() and p2.evaluate("document.querySelector('#check-numbers').compareDocumentPosition(document.querySelector('#week-rings')) & 4") > 0, p2.locator('#check-numbers').inner_text())
    check('Main lifts shows Check instead of a target built on the bad numbers', 'Check' in p2.locator('#next-targets tr[data-ex=back_squat]').inner_text() and '5 lb' not in p2.locator('#next-targets tr[data-ex=back_squat]').inner_text(), p2.locator('#next-targets tr[data-ex=back_squat]').inner_text())
    p2.screenshot(path=f'{SHOTS}/v116-check-card.png')
    p2.click('#check-numbers .check-row'); p2.wait_for_selector('.fix-sheet')
    p2.fill('#fix-all', '195'); p2.wait_for_timeout(50)
    check('one weight fills every set', all(x.input_value() == '195' for x in p2.locator('.fix-row input').all()) and p2.locator('.fix-row').count() == 4, [x.input_value() for x in p2.locator('.fix-row input').all()])
    p2.screenshot(path=f'{SHOTS}/v116-fix-sheet.png')
    p2.click('#fix-save'); p2.wait_for_selector('.fix-sheet', state='detached'); p2.wait_for_timeout(300)
    check('after the fix the card is gone and the squat target is 175 x 4 (90% of 195)', p2.locator('#check-numbers').count() == 0 and '175 lb × 4' in p2.locator('#next-targets tr[data-ex=back_squat]').inner_text() and 'e1RM 228' in p2.locator('#next-targets tr[data-ex=back_squat]').inner_text(), p2.locator('#next-targets tr[data-ex=back_squat]').inner_text())
    saved = p2.evaluate("() => import('./js/store.js').then(async m => (await m.getSessions()).find(s => s.id === 'ses_n17'))")
    check('the saved session holds 195 on every set and says it was corrected', [x['weight'] for x in saved['sets']] == [195, 195, 195, 195] and 'corrected' in saved['whatChanged'][0]['text'], [x['weight'] for x in saved['sets']])
    p2.locator('#next-targets').scroll_into_view_if_needed(); p2.wait_for_timeout(3600)
    p2.locator('#next-targets').screenshot(path=f'{SHOTS}/v116-main-lifts-after.png')
    ctx2.close()

    check('no page errors', not errors, errors)
    browser.close()

server.terminate()
print('\n' + (f'{len(fails)} FAILED: {fails}' if fails else 'All feel checks passed'))
sys.exit(1 if fails else 0)
