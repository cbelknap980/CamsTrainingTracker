# upgrades-test.py - v1.19: notes per exercise, the all-out last set, the knee check. Phone size, Denver time.
# Run: python3 tests/upgrades-test.py
import os, subprocess, sys, time, datetime
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'tests', 'shots'); os.makedirs(SHOTS, exist_ok=True)
PORT = 8089
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

TARGETS = {'back_squat': {'weight': 185, 'reps': 5}, 'rdl': {'weight': 155, 'reps': 6}, 'calf_raise': {'weight': 105, 'reps': 10}, 'bss': {'weight': 50, 'reps': 8},
           'leg_curl': {'weight': 80, 'reps': 8}, 'curl': {'weight': 50, 'reps': 10}, 'oh_tri_ext': {'weight': 40, 'reps': 10},
           'power_clean': {'weight': 135, 'reps': 2}, 'front_squat': {'weight': 135, 'reps': 5}, 'push_press': {'weight': 105, 'reps': 4},
           'lateral_raise': {'weight': 30, 'reps': 12}, 'db_row': {'weight': 60, 'reps': 8}, 'preacher_curl': {'weight': 40, 'reps': 8}}
# Monday of week 4: Lift 1 done
LEGS = {'id': 'ses_legs', 'sessionId': 'lift1', 'sessionName': 'Lift 1: Legs', 'week': 4, 'date': '2026-12-07', 'startedAt': '2026-12-07T13:00:00.000Z', 'endedAt': '2026-12-07T14:00:00.000Z',
        'status': 'complete', 'actualSeconds': 3600, 'plannedSeconds': 3600, 'trims': [], 'whatChanged': [], 'prs': [],
        'sets': [{'exerciseId': 'back_squat', 'name': 'Back squat', 'setIndex': i + 1, 'weight': 185, 'reps': 5, 'rpe': 8, 'done': True, 'skipped': False, 'blockId': 'A', 'repRange': [4, 6]} for i in range(3)]}

def small_targets(page):
    return page.evaluate("""() => [...document.querySelectorAll('button, input, select, summary, a, [role=button]')].filter(e => {
      const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false;
      const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      if (e.classList.contains('info-btn')) return false;
      if (e.type === 'file' || e.closest('[hidden]')) return false;
      return r.height < 40 || r.width < 40; }).map(e => (e.id || e.className || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))""")
def overflow(page):
    return page.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 1")
def at(page, iso):
    page.clock.set_system_time(datetime.datetime.fromisoformat(iso)); page.reload(); page.wait_for_selector('.card.accent h1')
def store(page, js):
    return page.evaluate(f"() => import('./js/store.js').then(m => {js})")

def kind(page): return page.locator('.step-kind').inner_text().strip().lower() if page.locator('.step-kind').count() else '?'
def name(page): return page.locator('.step-main .step-name').first.inner_text().strip() if page.locator('.step-main .step-name').count() else ''
def secs(page):
    t = page.locator('#timer').inner_text() if page.locator('#timer').count() else '0:00'
    m, s = t.split(':'); return int(m) * 60 + int(s)
def walk(page, done, limit=400):
    """Taps through the workout (Set-up done, Done, Skip rest, timed steps run out) until done() is true."""
    for _ in range(limit):
        if done(): return True
        if page.locator('#confirm-btn').count(): page.click('#confirm-btn')
        elif kind(page) in ('timed', 'stretch'): page.clock.run_for((secs(page) + 1) * 1000)
        else: page.click('.player-actions button.btn.primary')
        page.clock.run_for(700)   # v1.18: a second main-button tap within 0.6 s is ignored
        page.wait_for_timeout(30)
    return False
def fits(page):
    return page.evaluate("() => { const p = document.querySelector('.player'); const m = p && p.querySelector('.step-main'); return !!m && !p.classList.contains('overflowing') && m.scrollHeight <= m.clientHeight + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1; }")
def end_early(page):
    page.click('#more-btn'); page.wait_for_selector('.menu')
    page.click('.menu-item:has-text("End session")'); page.click('.modal button:has-text("End session")')
    page.wait_for_selector('h1:has-text("Review and save")')

with sync_playwright() as p:
    chrome = os.environ.get('CHROME_PATH') or next((c for c in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium') if os.path.exists(c)), None)
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 360, 'height': 640}, reduced_motion='reduce', device_scale_factor=2, is_mobile=True, has_touch=True, timezone_id='America/Denver')
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script("window.SpeechSynthesisUtterance = function (t) { this.text = t; }; Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak() {} }, configurable: true });")
    page.clock.install(time=datetime.datetime.fromisoformat('2026-12-07T06:00:00-07:00'))  # Monday of week 4
    page.goto(f'http://localhost:{PORT}/'); page.wait_for_selector('.card.accent h1')
    page.evaluate("([t]) => import('./js/store.js').then(async m => { await m.setTargets(t); await m.setPairTotals('none'); })", [TARGETS])
    page.reload(); page.wait_for_selector('.card.accent h1')

    print('All-out set, week 4 start page')
    page.click('#today-card .btn.primary'); page.wait_for_selector('#start-workout')
    sq_row = page.locator('.pre-left[data-note=back_squat]').inner_text()
    check('the back squat line says the last set is all-out', 'last set all-out' in sq_row, sq_row)
    check('Targets today says it too', 'last set all-out' in page.locator('#targets-today tr[data-ex=back_squat]').inner_text(), page.locator('#targets-today tr[data-ex=back_squat]').inner_text())
    check('RDL has no all-out set', 'all-out' not in page.locator('.pre-left[data-note=rdl]').inner_text())

    print('Notes per exercise')
    page.click('.pre-left[data-note=back_squat]'); page.wait_for_selector('#note-input')
    page.fill('#note-input', 'Pins at 7, left knee: narrow stance')
    page.click('#note-save'); page.wait_for_timeout(200)
    check('the note shows under the lift', 'Pins at 7, left knee: narrow stance' in page.locator('.pre-left[data-note=back_squat] .pre-note').inner_text())
    check('the edit mark lights on a lift with a note', page.locator('.pre-left[data-note=back_squat] .pre-note-ico.on').count() == 1 and page.locator('.pre-left[data-note=rdl] .pre-note-ico.on').count() == 0)
    page.screenshot(path=os.path.join(SHOTS, 'v119-notes.png'))
    long = 'x' * 120
    page.click('.pre-left[data-note=rdl]'); page.wait_for_selector('#note-input'); page.fill('#note-input', long); page.click('#note-save'); page.wait_for_timeout(150)
    notes = store(page, 'm.getExNotes()')
    check('notes are kept to 80 characters and saved by lift', len(notes['rdl']['text']) == 80 and notes['back_squat']['text'].startswith('Pins'), notes)
    page.click('.pre-left[data-note=rdl]'); page.wait_for_selector('#note-clear'); page.click('#note-clear'); page.wait_for_timeout(150)
    check('Clear removes a note', 'rdl' not in store(page, 'm.getExNotes()'))
    exp = store(page, "m.exportAll('1.19.0', '1.4')")
    check('a backup carries notes and knee scores', 'back_squat' in exp['exNotes'] and isinstance(exp['knee'], list), list(exp.keys()))
    check('the start page has no sideways scroll at 360 px', not overflow(page))
    page.click('.stack .btn.ghost'); page.wait_for_selector('#today-card')

    print('Knee check, the day after legs')
    page.evaluate("([s]) => import('./js/store.js').then(m => m.putSession(s))", [LEGS])
    at(page, '2026-12-08T07:00:00-07:00')
    check('Tuesday: Home asks about the knee after yesterday', page.locator('#knee-morning').count() == 1 and "Monday's legs" in page.locator('#knee-morning').inner_text(), page.locator('#knee-morning').inner_text() if page.locator('#knee-morning').count() else '')
    small = small_targets(page)
    check('Home buttons stay at least 40 px with the knee card', not small, small)
    check('Home has no sideways scroll at 360 px', not overflow(page))
    page.locator('#knee-morning').screenshot(path=os.path.join(SHOTS, 'v119-knee-morning.png'))
    page.click('#knee-morning [data-score="5"]'); page.wait_for_timeout(200)
    log = store(page, 'm.getKneeLog()')
    check('a tap saves the score and the card goes', page.locator('#knee-morning').count() == 0 and len(log) == 1 and log[0]['score'] == 5 and log[0]['when'] == 'morning', log)
    page.reload(); page.wait_for_selector('.card.accent h1')
    check('it is not asked again that day', page.locator('#knee-morning').count() == 0)

    print('Friday with the knee at 5')
    at(page, '2026-12-11T06:00:00-07:00')
    kh = page.locator('#today-knee').inner_text() if page.locator('#today-knee').count() else ''
    check('Home: the today card names the knee swaps', 'Knee 5/10' in kh and 'hang power clean' in kh and 'box front squat' in kh, kh)
    page.click('#today-card .btn.primary'); page.wait_for_selector('#start-workout')
    ks = page.locator('#knee-swap').inner_text() if page.locator('#knee-swap').count() else ''
    check('the start page explains the swaps, same weight', 'Hang power clean' in ks and 'Box front squat' in ks and 'same weight' in ks, ks)
    tt = page.locator('#targets-today').inner_text()
    check('Targets today lists the swapped lifts at the planned weight', 'Hang power clean' in tt and '135 lb' in tt, tt)
    check('the all-out note stays on the front squat line (week 4 ends Sunday; Friday is still week 4)', 'last set all-out' in page.locator('.pre-left[data-note=front_squat]').inner_text())
    page.screenshot(path=os.path.join(SHOTS, 'v119-knee-start.png'))
    page.click('#knee-rate'); page.wait_for_selector('.knee-sheet')
    page.click('.knee-sheet [data-score="2"]'); page.wait_for_timeout(250)
    check('rating it 2 today turns the swaps off', page.locator('#knee-swap').count() == 0 and 'Power clean' in page.locator('#targets-today').inner_text())
    page.click('#knee-rate') if page.locator('#knee-rate').count() else None

    print('Progress')
    page.click('.stack .btn.ghost'); page.wait_for_selector('#today-card')
    page.click('#tabs .tab[data-view=progress]'); page.wait_for_selector('#knee-trend')
    kt = page.locator('#knee-trend').inner_text()
    check('Progress shows the knee scores', '2/10' in kt and '2 days rated' in kt, kt)
    page.locator('#knee-trend').screenshot(path=os.path.join(SHOTS, 'v119-knee-trend.png'))
    check('no page errors', not errors, errors)

    print('In the workout (Lift 1, week 4, 360 x 640)')
    ctx2 = browser.new_context(viewport={'width': 360, 'height': 640}, reduced_motion='reduce', device_scale_factor=2, is_mobile=True, has_touch=True, timezone_id='America/Denver')
    page = ctx2.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script("window.SpeechSynthesisUtterance = function (t) { this.text = t; }; window.__said = []; Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak(u) { window.__said.push(u.text); } }, configurable: true });")
    page.clock.install(time=datetime.datetime.fromisoformat('2026-12-07T06:00:00-07:00'))
    page.goto(f'http://localhost:{PORT}/'); page.wait_for_selector('.card.accent h1')
    T2 = dict(TARGETS, strict_press={'weight': 95, 'reps': 5}, weighted_pullup={'weight': 25, 'reps': 5}, incline_db_press={'weight': 70, 'reps': 8}, cs_row={'weight': 100, 'reps': 8}, incline_curl={'weight': 30, 'reps': 10})
    page.evaluate("([t]) => import('./js/store.js').then(async m => { await m.setTargets(t); await m.setPairTotals('none'); await m.setExNote('back_squat', 'Pins at 7, narrow stance'); })", [T2])
    page.reload(); page.wait_for_selector('.card.accent h1')
    page.click('#today-card .btn.primary'); page.wait_for_selector('#start-workout'); page.click('#start-workout'); page.wait_for_selector('.player')
    check('the set-up screen for the squat shows his note', walk(page, lambda: page.locator('#up-next .upnext-note').count() > 0 and 'Back squat' in page.locator('#up-next').inner_text()), page.locator('#up-next').inner_text() if page.locator('#up-next').count() else '')
    check('the note reads as typed, and the screen still fits', 'Pins at 7, narrow stance' in page.locator('#up-next .upnext-note').inner_text() and fits(page))
    page.screenshot(path=os.path.join(SHOTS, 'v119-setup-note.png'))
    check('reached the first squat work set', walk(page, lambda: kind(page) == 'work' and name(page) == 'Back squat'), (kind(page), name(page)))
    check('no knee question before the first work set is done', page.locator('#knee-ask').count() == 0)
    page.click('.player-actions button.btn.primary'); page.clock.run_for(700); page.wait_for_timeout(100)
    check('after it, the last-set card asks about the knee in its top row', page.locator('#just-done #knee-ask').count() == 1 and page.locator('#knee-ask').inner_text().strip() == 'Knee?', page.locator('#just-done').inner_text() if page.locator('#just-done').count() else '')
    check('the rest screen still fits with the knee button', fits(page))
    page.screenshot(path=os.path.join(SHOTS, 'v119-knee-ask.png'))
    page.click('#knee-ask'); page.wait_for_selector('.knee-sheet')
    page.screenshot(path=os.path.join(SHOTS, 'v119-knee-sheet.png'))
    page.click('.knee-sheet [data-score="5"]'); page.wait_for_timeout(200)
    check('a 5 switches the rest of the squat sets to the box squat', 'Box squat' in page.locator('#up-next').inner_text() and page.locator('#knee-ask').inner_text().strip() == 'Knee 5', (page.locator('#up-next').inner_text(), page.locator('#knee-ask').inner_text()))
    check('the score is saved with the set and in the knee log', page.evaluate("() => import('./js/store.js').then(m => m.getKneeLog())")[0]['score'] == 5)
    check('reached the all-out set (box squat, set 3)', walk(page, lambda: kind(page) == 'all-out'), (kind(page), name(page)))
    hero = page.locator('#hero-readout').inner_text()
    check('the all-out set reads 5+, names the box squat, and opens the reps box', '5+' in hero and 'As many good reps as you can' in hero and 'tank' not in hero and name(page).startswith('Box squat') and page.locator('#edit-panel:not([hidden])').count() == 1, (hero, name(page)))
    check('its voice line asks for as many good reps as he can', any('as many good reps as you can' in x for x in page.evaluate('window.__said')), page.evaluate('window.__said')[-3:])
    check('the all-out screen fits', fits(page))
    page.screenshot(path=os.path.join(SHOTS, 'v119-allout.png'))
    page.fill('#in-reps', '9'); page.click('.player-actions button.btn.primary'); page.clock.run_for(700); page.wait_for_timeout(150)
    end_early(page)
    rev = page.locator('.review-card', has_text='Back squat').first.inner_text()
    check('review: the box squat sets hold the squat weight because of the knee', 'knee 5/10: box squat' in rev and 'Hold' in rev, rev)
    page.screenshot(path=os.path.join(SHOTS, 'v119-review-knee.png'), full_page=True)

    print('In the workout (Lift 2, week 4): an all-out press')
    page.evaluate("() => import('./js/store.js').then(m => m.kvDel('pendingReview'))")
    page.clock.set_system_time(datetime.datetime.fromisoformat('2026-12-09T06:00:00-07:00')); page.goto(f'http://localhost:{PORT}/'); page.wait_for_timeout(800)
    if page.locator('button:has-text("Discard")').count(): page.locator('button:has-text("Discard")').first.click(); page.wait_for_timeout(300)
    page.wait_for_selector('#today-card .btn.primary')
    page.click('#today-card .btn.primary'); page.wait_for_selector('#start-workout'); page.click('#start-workout'); page.wait_for_selector('.player')
    check('reached the all-out strict press (set 4)', walk(page, lambda: kind(page) == 'all-out' and name(page) == 'Strict press'), (kind(page), name(page)))
    page.fill('#in-reps', '11'); page.click('.player-actions button.btn.primary'); page.clock.run_for(700); page.wait_for_timeout(150)
    end_early(page)
    rev = page.locator('.review-card', has_text='Strict press').first.inner_text()
    check('review: the press goes up 7.5 lb (3 steps) on an all-out 11 at 95', 'all-out set: 11 reps' in rev and 'Up +7.5' in rev, rev)
    check('no page errors in the workout', not errors, errors)
    browser.close()

server.terminate()
print(f'\n{len(fails)} FAILED' if fails else '\nAll upgrade checks passed')
sys.exit(1 if fails else 0)
