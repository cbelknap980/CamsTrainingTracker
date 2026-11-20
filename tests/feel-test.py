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
        'sets': [{'exerciseId': 'back_squat', 'name': 'Box squat', 'setIndex': i, 'weight': 165, 'reps': 4, 'rpe': 8, 'done': True, 'skipped': False, 'blockId': 'lift1:A'} for i in (1, 2, 3)],
        'whatChanged': [], 'e1rms': {}, 'prs': []}

def secs(page):
    m, s = page.locator('#timer').inner_text().split(':'); return int(m) * 60 + int(s)
def kind(page): return page.locator('.step-kind').inner_text().strip().lower()
def name(page): return page.locator('.step-name').first.inner_text().strip()
def where(page): return page.locator('.step-where').first.inner_text().strip() if page.locator('.step-where').count() else ''
def step(page):
    k = kind(page)
    if page.locator('#confirm-btn').count(): page.click('#confirm-btn')
    elif k in ('timed', 'stretch') or (k == 'set up' and not page.locator('#up-next').count()): page.clock.run_for((secs(page) + 1) * 1000)
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
    m = json.load(open(os.path.join(ROOT, 'manifest.webmanifest')))
    check('manifest offers three long-press shortcuts', [s['url'] for s in m.get('shortcuts', [])] == ['./?go=today', './?go=runs', './?go=progress'])

    print('Workout')
    page.click('#start-workout'); page.wait_for_selector('.player')
    bar = lambda: page.evaluate("document.querySelector('meta[name=theme-color]').content")
    for _ in range(40):
        if kind(page) == 'work' and name(page) == 'Box squat': break
        step(page)
    check('status bar takes the work color', bar() == '#12432f', bar())
    check('hero: 170 big, 4 reps and the effort on one line', page.locator('#hero-readout .hw-num').inner_text().strip() == '170' and page.locator('.hl-reps b').inner_text().strip() == '4' and 'tank' in page.locator('.hl-effort').inner_text(), page.locator('#hero-readout').inner_text())
    check('cues open on set 1', page.locator('details.cues[open]').count() == 1)
    check('no Next line under a work set', page.locator('.step-main .next').count() == 0)
    page.screenshot(path=f'{SHOTS}/v114-work-set.png')
    small = small_targets(page)
    check('workout buttons are at least 40 px', not small, small)
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
    page.click('.player-actions button.btn.primary'); page.wait_for_timeout(80)
    page.click('#more-btn'); page.click('text=End session early'); page.click('.modal button:has-text("End session")')
    page.wait_for_selector('h1:has-text("Review and save")')
    page.go_back(); page.wait_for_timeout(150)
    check('Back on the unsaved review stays put', page.locator('h1:has-text("Review and save")').count() == 1)
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

    print('Tap sizes')
    for tab in ('home', 'progress', 'plan', 'runs'):
        page.click(f'.tab[data-view={tab}]'); page.wait_for_timeout(250)
        small = small_targets(page)
        check(f'{tab}: every button at least 40 px', not small, small)
    check('no page errors', not errors, errors)
    browser.close()

server.terminate()
print('\n' + (f'{len(fails)} FAILED: {fails}' if fails else 'All feel checks passed'))
sys.exit(1 if fails else 0)
