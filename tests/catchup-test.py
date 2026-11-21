# catchup-test.py - v1.8 catch-up day, end to end in a phone-sized browser.
# Lift 1 is ended early on Monday; on Thursday (a Slack day) the Home card offers the leftover sets and the
# lift that was missed on Wednesday; the catch-up is run and saved; the card clears and Progress shows the lift done.
# Run: python3 tests/catchup-test.py
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'tests', 'shots'); os.makedirs(SHOTS, exist_ok=True)
PORT = 8084
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

def tap_main(page, sel='.player-actions button.btn.primary'):
    """v1.18: the app ignores a main-button tap within 0.6 s of the one before (a double tap), so a test that taps on
    purpose lets the clock move that far first."""
    gap = page.evaluate("Date.now() - (window.__lastMainTap || 0)")
    if gap < 650: page.clock.run_for(int(650 - gap))
    page.click(sel)
    page.evaluate("window.__lastMainTap = Date.now()")

TARGETS = {'back_squat': {'weight': 170, 'reps': 4}, 'rdl': {'weight': 150, 'reps': 6}, 'calf_raise': {'weight': 135, 'reps': 10}, 'bss': {'weight': 60, 'reps': 8},
           'leg_curl': {'weight': 80, 'reps': 8}, 'curl': {'weight': 50, 'reps': 10}, 'oh_tri_ext': {'weight': 40, 'reps': 10}}

def secs(page):
    m, s = page.locator('#timer').inner_text().split(':'); return int(m) * 60 + int(s)
def kind(page): return page.locator('.step-kind').inner_text().strip().lower()
def name(page): return page.locator('.step-name').first.inner_text().strip()
def screen_key(page):
    return page.evaluate("() => ['.step-kind', '.step-name', '#where', '.step-where'].map(s => { const e = document.querySelector(s); return e ? e.textContent.trim() : ''; }).join('|')")
def run_out(page):
    """Let the clock run until the step ends by itself. v1.18: a stretch done one side at a time has two clocks and no #timer."""
    if page.locator('#timer').count(): page.clock.run_for((secs(page) + 1) * 1000); return
    key = screen_key(page)
    for _ in range(600):
        page.clock.run_for(1000)
        if not page.locator('.player').count() or screen_key(page) != key: return
def step(page):
    """Move one step forward the way Cameron would: Set-up done (or Ready), Done on a set, or let a timer run out."""
    k = kind(page)
    if page.locator('#confirm-btn').count(): tap_main(page, '#confirm-btn'); page.clock.run_for(700)   # v1.18: a second tap within 0.6 s is ignored
    elif k in ('timed', 'stretch') or (k == 'set up' and not page.locator('#up-next').count()): run_out(page)
    else: tap_main(page, '.player-actions button.btn.primary')
    page.wait_for_timeout(60)
def save_review(page):
    page.wait_for_selector('h1:has-text("Review and save")')
    if page.locator('#confirm-skipped').count(): page.click('#confirm-skipped'); page.wait_for_timeout(150)
    page.click('#save-session'); page.wait_for_selector('h1:has-text("Session")')

with sync_playwright() as p:
    chrome = os.environ.get('CHROME_PATH') or next((c for c in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium') if os.path.exists(c)), None)
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 393, 'height': 851}, reduced_motion='reduce', device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script("window.SpeechSynthesisUtterance = function (t) { this.text = t; }; Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak() {} }, configurable: true });")
    # Monday of week 3 (build weeks: no baseline work-up), 6:00 am
    page.clock.install(time='2026-11-30T06:00:00')
    page.goto(f'http://localhost:{PORT}/'); page.wait_for_selector('.card.accent h1')
    page.evaluate("t => import('./js/store.js').then(async m => { await m.setTargets(t); await m.setPairTotals('none'); })", TARGETS)
    page.reload(); page.wait_for_selector('.card.accent h1')
    check('nothing owed at the start of the week', page.locator('#catchup-card').count() == 0)

    print('Monday: Lift 1, ended early part-way through block B')
    page.click('.card.accent .btn.primary'); page.wait_for_selector('#start-workout'); page.click('#start-workout'); page.wait_for_selector('.player')
    done_rdl = 0
    for _ in range(200):
        if kind(page) == 'work' and name(page) == 'Romanian deadlift':
            if done_rdl == 2: break   # stop with the third RDL set on screen: 1 RDL, 2 calf raise sets, all of C and the finisher are left
            done_rdl += 1
        step(page)
    page.click('#more-btn'); page.click('text=End session early'); page.click('.modal button:has-text("End session")')
    save_review(page)
    note = page.locator('#owed-note')
    check('summary says how many sets were not done and where they went', note.count() == 1 and 'catch-up list' in note.inner_text(), note.inner_text() if note.count() else 'no note')
    page.screenshot(path=f'{SHOTS}/catchup-summary.png', full_page=True)
    page.click('button:has-text("Done")'); page.wait_for_selector('.card.accent h1')
    card = page.locator('#catchup-card')
    check('Monday Home shows what is owed, under the today card', card.count() == 1 and 'owed this week' in card.inner_text().lower() and 'Thursday or Sunday' in card.inner_text(), card.inner_text() if card.count() else 'no card')

    print('Thursday: Slack day')
    page.clock.set_system_time('2026-12-03T06:00:00')
    page.reload(); page.wait_for_selector('.card.accent h1')
    card = page.locator('#catchup-card')
    text = card.inner_text()
    check('the today card becomes Catch-up day', page.locator('.card.accent h1').inner_text() == 'Catch-up day', page.locator('.card.accent h1').inner_text())
    check('it lists the leftover sets by lift', 'Legs:' in text and 'Romanian deadlift 1 set' in text and 'Standing calf raise' in text and 'Bulgarian split squat 3 sets' in text, text)
    check('it offers the lift that was missed on Wednesday, not Friday\'s', 'Lift 2: Upper was planned for Wednesday' in text and card.locator('[data-missed="lift2"]').count() == 1 and card.locator('[data-missed="lift3"]').count() == 0, text)
    page.screenshot(path=f'{SHOTS}/catchup-home.png')
    owed_sets = int(text.split(' set')[0].split()[-1])

    page.click('#catchup-start'); page.wait_for_selector('#start-workout')
    pre = page.locator('#view').inner_text()
    check('overview is the Catch-up session with blocks named by lift', 'Catch-up' in pre and 'Legs · block B' in pre and 'Legs · finisher' in pre, pre[:400])
    page.screenshot(path=f'{SHOTS}/catchup-preview.png', full_page=True)
    page.click('#start-workout'); page.wait_for_selector('.player')
    work = 0
    for _ in range(300):
        if page.locator('h1', has_text='Review and save').count() and not page.locator('.player').count(): break
        if kind(page) == 'work': work += 1
        if work == 1 and kind(page) == 'work' and not os.path.exists(f'{SHOTS}/catchup-set.png'): page.screenshot(path=f'{SHOTS}/catchup-set.png')
        step(page)
    check('the catch-up runs exactly the owed sets', work == owed_sets, [work, owed_sets])
    page.wait_for_selector('h1:has-text("Review and save")')
    rv = page.locator('#view').inner_text()
    check('review: sets for a lift already logged keep its target', 'catch-up sets' in rv.lower(), rv[:600])
    save_review(page)
    rec = page.evaluate("import('./js/store.js').then(async m => (await m.getSessions())[0])")
    check('saved as a Catch-up session in week 3, sets tagged with their lift', rec['sessionId'] == 'catchup' and rec['week'] == 3 and rec['status'] == 'complete' and all(s['blockId'].startswith('lift1:') for s in rec['sets']), [rec['sessionId'], rec['week']])
    page.click('button:has-text("Done")'); page.wait_for_selector('.card.accent h1')
    card = page.locator('#catchup-card')
    check('after the catch-up only the missed lift is left on the card', card.count() == 1 and 'left over' not in card.inner_text() and card.locator('[data-missed="lift2"]').count() == 1 and page.locator('#catchup-start').count() == 0, card.inner_text() if card.count() else 'no card')

    page.click('#tabs button[data-view="progress"]'); page.wait_for_selector('#progress-status')
    legs = page.locator('#progress-status .adh-row', has_text='Legs').locator('.adh-cell')
    upper = page.locator('#progress-status .adh-row', has_text='Upper').locator('.adh-cell')
    check('Progress: Legs week 3 counts as done once made up, Upper week 3 is still open', 'done' in legs.nth(2).get_attribute('class') and 'open' in upper.nth(2).get_attribute('class'), [legs.nth(2).get_attribute('class'), upper.nth(2).get_attribute('class')])
    page.click('#progress-mode button[data-mode="sessions"]'); page.wait_for_selector('.list-item')   # v1.9: the log is the Sessions view in Progress
    check('Sessions lists the Catch-up session', 'Catch-up' in page.locator('.list-item').first.inner_text(), page.locator('.list-item').first.inner_text())

    print('Next Monday: nothing rolls over')
    page.clock.set_system_time('2026-12-07T06:00:00')
    page.click('#tabs button[data-view="home"]'); page.wait_for_selector('.card.accent h1')
    check('a new week starts clean', page.locator('#catchup-card').count() == 0)
    check('no page errors', not errors, errors[:5])
    browser.close()

server.terminate()
print('\n' + (f'{len(fails)} FAILED: {fails}' if fails else 'All catch-up checks passed'))
sys.exit(1 if fails else 0)
