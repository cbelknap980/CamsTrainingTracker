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

def pass_review(page, prefix, override=None):
    page.wait_for_selector('h1:has-text("Review and save")')
    check(f'{prefix}: review shows verdict badges', page.locator('.verdict').count() >= 1, page.locator('.verdict').count())
    page.screenshot(path=f'{SHOTS}/{prefix}-review.png', full_page=True)
    if override:
        card = page.locator('.review-card', has_text=override[0]).first
        card.locator('.review-next input').first.fill(str(override[1]))
        card.locator('.review-next input').first.dispatch_event('change')
        page.wait_for_timeout(200)
        check(f'{prefix}: override tags set by you', page.locator('.verdict.you').count() >= 1)
    # v1.5: skipped sets must be confirmed (or filled in) before Save unlocks
    if page.locator('#confirm-skipped').count():
        seen['gated'] = seen.get('gated', 0) + (1 if page.locator('#save-session').is_disabled() else 0)
        page.click('#confirm-skipped'); page.wait_for_timeout(150)
    check(f'{prefix}: review has no open items left', page.locator('#review-clear').count() == 1 and not page.locator('#save-session').is_disabled(), page.locator('#review-open').inner_text() if page.locator('#review-open').count() else '')
    page.click('button:has-text("Save session")')
    page.wait_for_selector('h1:has-text("Session")')

def timer_secs(page):
    m, s = page.locator('#timer').inner_text().split(':')
    return int(m) * 60 + int(s)

def start_from_preview(page, start_selector, shot=None):
    """v1.4: Start opens the pre-session overview; Start workout begins the session."""
    page.click(start_selector)
    page.wait_for_selector('#start-workout')
    if shot: page.screenshot(path=f'{SHOTS}/{shot}.png', full_page=True)
    page.click('#start-workout')
    page.wait_for_selector('.player')

IS_SET = ('work', 'ramp', 'hold')
IS_LEAD = ('rest', 'set up', 'switch', 'get ready', 'confirm')
seen = {}

def lead_step(page, skip_rests=True):
    """v1.5: a countdown before a new block waits for Set-up done; other countdowns run or get skipped."""
    if page.locator('#confirm-btn').count():
        seen['confirms'] = seen.get('confirms', 0) + 1
        page.click('#confirm-btn')
    elif skip_rests: page.click('.player-actions button.btn.primary')
    else: page.clock.run_for((timer_secs(page) + 1) * 1000)

def run_session(page, start_selector, baseline_weights, shots_prefix, skip_rests=True, go_behind_at=None):
    start_from_preview(page, start_selector, shot=f'{shots_prefix}-preview')
    steps = 0
    kinds = []
    trimmed = False
    while steps < 400:
        if page.locator('h1', has_text='Review and save').count() and not page.locator('.player').count():
            break
        kind = page.locator('.step-kind').inner_text().strip().lower()
        kinds.append(kind)
        name = page.locator('.step-name').first.inner_text().strip()
        seen['pause'] = seen.get('pause', True) and page.locator('#pause-btn').count() == 1
        if page.locator('#fin-row').count() and 'fin' not in seen: seen['fin'] = page.locator('#fin-row').inner_text()
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
            page.fill('#in-weight', str(w))
            page.click('button.btn.primary:has-text("Done")')
        elif kind.startswith(IS_SET):
            # first-time machine and cable accessories have no weight yet: the edit panel is open for it
            wv = page.locator('#in-weight')
            if wv.count() and wv.is_visible() and wv.input_value() == '':
                page.fill('#in-weight', '30')
                page.click('button.btn.primary')
            elif skip_rests or kind.startswith('hold'):
                page.click('button.btn.primary')
            else:
                page.clock.run_for((timer_secs(page) + 1) * 1000)  # v1.4: the set ends on its own timer
        elif kind.startswith(IS_LEAD) and page.locator('#up-next').count():
            lead_step(page, skip_rests)
        elif kind in ('timed', 'stretch', 'set up'):
            page.clock.run_for((timer_secs(page) + 1) * 1000)  # let it auto-advance
        elif kind == 'your call':
            page.click('button.btn.primary:has-text("Do it")')
        else:
            page.click('button.btn.primary')
        page.wait_for_timeout(60)
        steps += 1
    pass_review(page, shots_prefix, override=('Box squat', 170) if shots_prefix == 'lift1' else None)
    page.screenshot(path=f'{SHOTS}/{shots_prefix}-summary.png', full_page=True)
    return steps, kinds

with sync_playwright() as p:
    chrome = os.environ.get('CHROME_PATH') or next((c for c in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium') if os.path.exists(c)), None)
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 393, 'height': 851}, reduced_motion='reduce', device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True)
    ctx.grant_permissions(['notifications'], origin='http://localhost:8080')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    # v1.4: capture what the app says out loud
    page.add_init_script("""window.__said = [];
      window.SpeechSynthesisUtterance = function (t) { this.text = t; };
      Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak(u) { window.__said.push(u.text); } }, configurable: true });""")
    # Pretend it is Monday Nov 16, 2026, 6:00 am local
    page.clock.install(time='2026-11-16T06:00:00')
    page.goto('http://localhost:8080/')
    page.wait_for_selector('.card.accent h1')
    page.screenshot(path=f'{SHOTS}/home-week1.png', full_page=True)
    check('home shows Lift 1 on Monday week 1', 'Lift 1' in page.locator('.card.accent h1').inner_text())
    check('week chip says Week 1', 'week 1' in page.locator('#week-chip').inner_text().lower())
    check('v1.4 home offers install while in a browser tab', page.locator('#install-card').count() == 1)

    # ---- Lift 1 end to end (week 1, baseline), go behind during block B to test trim ----
    print('Lift 1')
    # v1.4: Lift 1 runs with auto-advance switched off in Settings (sets wait for Done, as before v1.4)
    page.click('#settings-btn'); page.wait_for_selector('.modal')
    page.locator('.toggle', has_text='End each set on its own timer').locator('input').uncheck(); page.wait_for_timeout(150)
    page.click('.modal button:has-text("Close")')
    steps, kinds = run_session(page, '.card.accent .btn.primary', {'Box squat': 185}, 'lift1', skip_rests=True, go_behind_at=14)
    check('v1.5 Pause is in the header on every step of the session', seen.get('pause') is True)
    check('v1.5 each new block waited for Set-up done (4 on Lift 1)', seen.get('confirms') == 4, seen.get('confirms'))
    check('v1.5 finisher row lists its exercises', all(x in seen.get('fin', '') for x in ('Standing curl', 'Tri ext', 'Ab wheel')), seen.get('fin'))
    page.click('#settings-btn'); page.wait_for_selector('.modal')
    page.locator('.toggle', has_text='End each set on its own timer').locator('input').check(); page.wait_for_timeout(150)
    page.click('.modal button:has-text("Close")')
    check('lift1 reached summary', page.locator('h1', has_text='Session').count() == 1)
    lines = page.locator('.card .lines li').all_inner_texts()
    check('lift1 what-changed has a baseline line for box squat at 165', any('Box squat baseline' in l and '165' in l for l in lines), lines)
    check('lift1 what-changed covers RDL start weight', any('Romanian deadlift' in l for l in lines), lines)
    page.click('button:has-text("Done")')
    page.wait_for_selector('.card.accent')
    page.screenshot(path=f'{SHOTS}/home-after-lift1.png', full_page=True)
    rows = page.locator('table tr').all_inner_texts()
    check('home next targets lists Box squat 170 x 4 (your override)', any('Box squat' in r and '170' in r and 'set by you' in r.lower() for r in rows), rows)
    # Benchmarks: enter strict press 100 -> target 90 x 4
    check('benchmarks card lists 7 lifts', page.locator('h3:has-text("Benchmarks")').count() == 1 and page.locator('tr.tappable', has_text='Strict press').count() == 1)
    page.locator('tr.tappable', has_text='Strict press').click(); page.wait_for_selector('.modal input')
    page.fill('.modal input', '100'); page.wait_for_timeout(100)
    check('benchmark preview shows 90 x 4', '90 lb' in page.locator('.modal p.muted').last.inner_text(), page.locator('.modal p.muted').last.inner_text())
    page.click('.modal button:has-text("Save benchmark")'); page.wait_for_timeout(300)
    rows = page.locator('table tr').all_inner_texts()
    check('home shows Strict press 90 x 4 from benchmark', any('Strict press' in r and '90' in r for r in rows), [r for r in rows if 'Strict' in r])
    check('home shows what changed card', page.locator('h3', has_text='What changed').count() == 1)

    # ---- Lift 2 with resume mid-way ----
    print('Lift 2 (with reload + resume)')
    page.click('button:has-text("Lift 2")')
    page.wait_for_selector('#start-workout')
    pre = page.locator('#view').inner_text()
    check('v1.4 preview shows the session goal and time', 'Upper-body strength' in pre and 'About' in pre and 'min' in pre, pre[:200])
    check('v1.4 preview: strict press prefilled from the benchmark target', page.locator('input[data-ex="strict_press"]').input_value() == '90', page.locator('input[data-ex="strict_press"]').input_value())
    check('v1.4 preview: pull-up has no weight yet, works up today', 'Work up today' in pre)
    check('v1.5 preview: incline dumbbell press estimate is a total (90 = 2 x 45)', page.locator('input[data-ex="incline_db_press"]').input_value() == '90' and page.locator('.pre-ex .est').count() >= 1 and '2 × 45' in pre, page.locator('input[data-ex="incline_db_press"]').input_value())
    check('v1.4 preview: machine row has no estimate', page.locator('input[data-ex="cs_row"]').input_value() == '')
    page.fill('input[data-ex="incline_db_press"]', '100'); page.locator('input[data-ex="incline_db_press"]').dispatch_event('change'); page.wait_for_timeout(100)
    check('v1.4 preview: a typed weight sticks and loses the estimate tag', page.locator('input[data-ex="incline_db_press"]').input_value() == '100' and '2 × 50' in page.locator('#view').inner_text())
    page.screenshot(path=f'{SHOTS}/lift2-preview.png', full_page=True)
    page.click('#start-workout')
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
    saw_bench = False
    while steps2 < 400 and page.locator('.player').count():
        kind = page.locator('.step-kind').inner_text().strip().lower(); name = page.locator('.step-name').first.inner_text().strip()
        if kind.startswith('baseline'):
            page.fill('#in-weight', '95' if 'press' in name.lower() else '25'); page.click('button.btn.primary:has-text("Done")')
        elif kind.startswith(IS_SET):
            wv = page.locator('#in-weight')
            if wv.count() and wv.is_visible() and wv.input_value() == '': page.fill('#in-weight', '40')
            if 'incline dumbbell press' in name.lower() and not saw_bench:
                saw_bench = True
                check('v1.5 typed preview total (100) is the set target, shown with 2 x 50', '100' in page.locator('.tile-weight').inner_text() and '2 × 50' in page.locator('.tile-weight').inner_text(), page.locator('.tile-weight').inner_text())
            page.click('button.btn.primary')
        elif kind.startswith(IS_LEAD) and page.locator('#up-next').count(): lead_step(page)
        elif kind in ('timed', 'stretch', 'set up'):
            page.clock.run_for((timer_secs(page) + 1) * 1000)
        else: page.click('button.btn.primary')
        page.wait_for_timeout(60); steps2 += 1
    pass_review(page, 'lift2')
    check('lift2 reached summary', page.locator('h1', has_text='Session').count() == 1)
    lines2 = page.locator('.card .lines li').all_inner_texts()
    check('lift2 strict press used the benchmark target (no baseline step)', any('Strict press' in l and 'baseline' not in l for l in lines2), lines2)
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

    # ---- v1.5: numbers saved per dumbbell before the update get one question, then are doubled ----
    KV = """(key, del) => new Promise(r => { const q = indexedDB.open('cams-training-tracker'); q.onsuccess = () => { const st = q.result.transaction('kv', 'readwrite').objectStore('kv'); const t = del ? st.delete(key) : st.get(key); t.onsuccess = () => r(t.result === undefined ? null : t.result); }; })"""
    check('v1.5 a fresh install never sees the dumbbell question', page.evaluate(f"({KV})('pairTotals')") == 'none')
    before = page.evaluate(f"({KV})('targets')")
    page.evaluate(f"({KV})('pairTotals', true)")
    page.reload(); page.wait_for_selector('#pair-prompt')
    check('v1.5 old dumbbell numbers: the app asks once and lists them', 'Lateral raise' in page.locator('#pair-prompt').inner_text() and 'Incline dumbbell press' in page.locator('#pair-prompt').inner_text(), page.locator('#pair-prompt').inner_text()[:300])
    page.screenshot(path=f'{SHOTS}/v15-pair-prompt.png', full_page=True)
    check('v1.7.1 Save is locked until every lift has an answer', page.locator('#pair-save').is_disabled())
    for row in page.locator('.pair-row').all():
        row.locator('[data-pick="total"]' if row.get_attribute('data-ex') == 'curl' else '[data-pick="one"]').click()
    check('v1.7.1 each row shows what the answer does', 'Becomes' in page.locator('.pair-row[data-ex="lateral_raise"] .pair-result').inner_text() and 'Stays' in page.locator('.pair-row[data-ex="curl"] .pair-result').inner_text(), page.locator('#pair-prompt').inner_text()[:400])
    page.screenshot(path=f'{SHOTS}/v171-pair-prompt.png', full_page=True)
    page.click('#pair-save'); page.wait_for_selector('#pair-prompt', state='detached'); page.wait_for_selector('.card.accent h1')
    after = page.evaluate(f"({KV})('targets')")
    check('v1.5 doubling: two-dumbbell targets doubled, others untouched', after['lateral_raise']['weight'] == 2 * before['lateral_raise']['weight'] and after['incline_db_press']['weight'] == 2 * before['incline_db_press']['weight'] and after['back_squat']['weight'] == before['back_squat']['weight'] and after['db_row']['weight'] == before['db_row']['weight'], (before.get('lateral_raise'), after.get('lateral_raise')))
    check('v1.7.1 a lift answered Both together is left alone', after['curl']['weight'] == before['curl']['weight'] and page.evaluate(f"({KV})('pairTotals')") == 'mixed', (before.get('curl'), after.get('curl')))
    page.reload(); page.wait_for_selector('.card.accent h1')
    check('v1.5 the question is not asked twice', page.locator('#pair-prompt').count() == 0)

    # ---- History (v1.9: Sessions inside Progress) ----
    page.click('#tabs button[data-view="progress"]'); page.wait_for_selector('#progress-mode')
    page.click('#progress-mode button[data-mode="sessions"]'); page.wait_for_selector('.list-item')
    check('history lists 3 sessions', page.locator('.list-item').count() == 3, page.locator('.list-item').count())
    page.locator('.list-item').first.click(); page.wait_for_selector('.modal table')
    page.screenshot(path=f'{SHOTS}/history-detail.png', full_page=True)
    page.click('.modal button:has-text("Close")')
    page.click('#progress-mode button[data-mode="exercises"]'); page.wait_for_timeout(400); page.wait_for_selector('.list-item')
    check('exercise log lists exercises', page.locator('.list-item').count() >= 10, page.locator('.list-item').count())
    page.locator('.list-item', has_text='Box squat').click(); page.wait_for_selector('.modal table')
    check('exercise sheet has set rows', page.locator('.modal table tr').count() >= 4, page.locator('.modal table tr').count())
    page.screenshot(path=f'{SHOTS}/exercise-log.png', full_page=True)
    page.click('.modal button:has-text("Close")')

    # ---- Runs ----
    page.click('#tabs button[data-view="runs"]'); page.click('button:has-text("Log a run")'); page.wait_for_selector('.modal')
    page.fill('#run-distance', '3.1'); page.fill('#run-time', '27.5')
    page.click('.modal button:has-text("Save run")'); page.wait_for_selector('.run-item')
    check('run saved with pace', '8:52/mi' in page.locator('.run-item').first.inner_text() and '27:30' in page.locator('.run-item').first.inner_text(), page.locator('.run-item').first.inner_text())
    page.screenshot(path=f'{SHOTS}/runs.png', full_page=True)

    # ---- v1.6 Progress tab ----
    page.click('#tabs button[data-view="progress"]'); page.wait_for_selector('#progress-status')
    check('v1.6 progress: week 1 status with three lifts done', 'Week 1 of 12' in page.locator('#progress-status h1').inner_text() and page.locator('#progress-status .adh-cell.done').count() == 4, [page.locator('#progress-status h1').inner_text(), page.locator('#progress-status .adh-cell.done').count()])
    check('v1.6 progress: a strength card for each of the 7 benchmark lifts', page.locator('.strength-card').count() == 7, page.locator('.strength-card').count())
    sq_card = page.locator('.strength-card[data-ex="back_squat"]')
    check('v1.9 progress: one session shows the best set and next target, not a lone dot', sq_card.locator('.e1rm-now').inner_text().strip().endswith('lb') and sq_card.locator('.baseline-box').count() == 1 and sq_card.locator('.viz-dot').count() == 0 and '×' in sq_card.locator('.baseline-num').first.inner_text(), sq_card.inner_text())
    sq_card.click(); page.wait_for_selector('.modal table')
    check('v1.9 progress: tapping a lift opens every set of it', page.locator('.modal h2').inner_text() == 'Box squat' and page.locator('.modal table tr').count() >= 2, page.locator('.modal').inner_text()[:200])
    page.click('.modal button:has-text("Close")')
    mus = page.locator('#muscle-sets')
    check('v1.9 progress: sets per muscle group, biceps and triceps called out', mus.locator('.muscle-row').count() == 9 and mus.locator('.muscle-row.arms').count() == 2 and float(mus.locator('.muscle-row[data-group="quads"] .muscle-num b').inner_text()) > 0, mus.inner_text()[:300])
    check('v1.6 progress: work sets per week has one bar, in week 1', page.locator('#weekly-sets .viz-bar').count() == 1 and 'Week 1' in page.locator('#weekly-sets .viz-bar').get_attribute('aria-label'), page.locator('#weekly-sets .viz-bar').count())
    check('v1.6 progress: accessories table lists logged accessories', page.locator('#accessories tr').count() >= 8, page.locator('#accessories tr').count())
    check('v1.6 progress: no load-backup card on the phone', page.locator('#load-backup').count() == 0)
    check('v1.6 progress: page fits the phone width', page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), page.evaluate('[document.documentElement.scrollWidth, window.innerWidth]'))
    page.screenshot(path=f'{SHOTS}/progress-phone.png', full_page=True)

    # ---- v1.9 Plan tab and coach check-ins ----
    page.click('#tabs button[data-view="plan"]'); page.wait_for_selector('#checkin')
    check('v1.9 plan: goals, 12 weeks, this week and all three sessions', page.locator('.goal-list li').count() == 10 and page.locator('.wk-cell').count() == 12 and page.locator('.day-row').count() == 7 and page.locator('.plan-session').count() == 3, [page.locator('.goal-list li').count(), page.locator('.plan-session').count()])
    check('v1.9 plan: this week marks the lifts done', page.locator('.day-status.done').count() >= 3, page.locator('.day-status.done').count())
    tgt0 = page.evaluate(f"({KV})('targets')")['incline_db_press']['weight']
    page.select_option('#checkin-about', 'incline_db_press'); page.wait_for_timeout(100)
    check('v1.9 check-in: weight tags need an exercise', not page.locator('.tag-btn[data-tag="too_heavy"]').is_disabled())
    page.click('.tag-btn[data-tag="too_heavy"]'); page.click('.tag-btn[data-tag="rest_long"]')
    page.fill('#checkin-text', 'Last set was a grind, and the rests dragged.')
    page.click('#checkin-send'); page.wait_for_selector('.msg.app')
    tgt1 = page.evaluate(f"({KV})('targets')")['incline_db_press']
    st = page.evaluate(f"({KV})('settings')")
    check('v1.9 check-in: Too heavy lowers the next target one step, marked coach', tgt1['weight'] < tgt0 and tgt1['source'] == 'coach', [tgt0, tgt1])
    check('v1.9 check-in: Rest too long takes 15 s off that lift', st.get('restAdjust', {}).get('incline_db_press') == -15, st.get('restAdjust'))
    check('v1.9 check-in: the app answers with what changed', 'next time' in page.locator('.msg.app').last.inner_text(), page.locator('.msg.app').last.inner_text())
    check('v1.9 check-in: the plan shows the shorter rest', '(-15 from check-ins)' in page.locator('.plan-session[data-session="lift2"] tr[data-ex="incline_db_press"]').inner_text())
    chk = page.evaluate(f"({KV})('checkins')")
    check('v1.9 check-in: saved with its tags', len(chk) == 1 and chk[0]['tags'] == ['too_heavy', 'rest_long'] and chk[0]['exerciseId'] == 'incline_db_press', chk)
    check('v1.9 plan: page fits the phone width', page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), page.evaluate('[document.documentElement.scrollWidth, window.innerWidth]'))
    page.screenshot(path=f'{SHOTS}/plan-phone.png', full_page=True)

    # ---- Architecture tab + search ----
    # polish: on a phone the Architecture page moved from the tab bar into Settings
    check('polish: phone tab bar has four tabs', page.locator('#tabs .tab:visible').count() == 4, page.locator('#tabs .tab:visible').count())
    page.click('#settings-btn'); page.wait_for_selector('#arch-open'); page.click('#arch-open'); page.wait_for_selector('.arch-svg')
    check('architecture draws 18 boxes', page.locator('.arch-svg g[data-part]').count() == 18, page.locator('.arch-svg g[data-part]').count())
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
    page.clock.set_system_time('2026-11-30T06:00:00')
    page.click('#tabs button[data-view="home"]'); page.wait_for_selector('.card.accent h1')
    check('week 3 chip', 'week 3' in page.locator('#week-chip').inner_text().lower(), page.locator('#week-chip').inner_text())
    start_from_preview(page, '.card.accent .btn.primary', shot='week3-preview')
    said_from = page.evaluate('window.__said.length')
    # v1.5: Pause in the header during the warm-up
    check('v1.5 warm-up step shows Pause in the header', page.locator('.player-head #pause-btn').is_visible() and 'Pause' in page.locator('#pause-btn').inner_text())
    page.click('#pause-btn'); page.wait_for_timeout(100)
    t0 = page.locator('#timer').inner_text(); page.clock.run_for(20000); page.wait_for_timeout(100)
    check('v1.5 paused: banner shows, button says Resume, clock stands still', page.locator('#paused-banner').count() == 1 and 'Resume' in page.locator('#pause-btn').inner_text() and page.locator('#timer').inner_text() == t0, page.locator('#timer').inner_text())
    page.screenshot(path=f'{SHOTS}/v15-paused.png')
    page.click('#paused-banner'); page.wait_for_timeout(100)
    check('v1.5 tapping the banner resumes', page.locator('#paused-banner').count() == 0)
    # skip warmup to reach the first squat step
    for _ in range(12):
        k = page.locator('.step-kind').inner_text().lower()
        if k.startswith('ramp'): break
        if k.startswith('set up') and 'box squat' in page.locator('.step-main').inner_text().lower():
            # v1.4: the set-up before the first barbell set; v1.5: it waits for Set-up done, then the get-ready count
            check('v1.4 barbell set-up step is 60 s and shows what is next', timer_secs(page) in (54, 55) and 'up next' in page.locator('.step-main').inner_text().lower(), page.locator('.step-main').inner_text()[:120])
            check('v1.4 set-up screen is the rest color', page.evaluate("document.body.getAttribute('data-kind')") == 'rest')
            # v1.5: equipment taken -> do block B now, then swap back
            check('v1.5 set-up screen offers Equipment taken', page.locator('#swap-btn').count() == 1)
            page.click('#swap-btn'); page.wait_for_selector('.swap-choice')
            check('v1.5 swap sheet lists the later blocks (B, C, Finisher)', page.locator('.swap-choice').count() == 3, page.locator('.swap-choice').all_inner_texts())
            page.screenshot(path=f'{SHOTS}/v15-swap.png')
            page.locator('.swap-choice').first.click(); page.wait_for_timeout(150)
            check('v1.5 after the swap, Romanian deadlift is up next and squat comes after', 'romanian deadlift' in page.locator('#up-next').inner_text().lower() and page.locator('.seg-label').all_inner_texts()[1].startswith('RDL'), page.locator('.seg-label').all_inner_texts())
            page.click('#swap-btn'); page.wait_for_selector('.swap-choice')
            page.locator('.swap-choice', has_text='Box squat').click(); page.wait_for_timeout(150)
            check('v1.5 swapping back puts Box squat next again', 'box squat' in page.locator('#up-next').inner_text().lower() and page.locator('.seg-label').all_inner_texts()[1] == 'Squat', page.locator('.seg-label').all_inner_texts())
            check('v1.5 a new block waits: the main button is Set-up done', page.locator('#confirm-btn').count() == 1)
            page.clock.run_for((timer_secs(page) + 20) * 1000); page.wait_for_timeout(120)
            check('v1.5 set-up clock runs out and holds for the tap', 'confirm' in page.locator('.step-kind').inner_text().lower() and timer_secs(page) == 0 and page.evaluate('window.__said.slice(-1)[0]') == 'Tap set-up done when you are ready.', (page.locator('.step-kind').inner_text(), page.evaluate('window.__said.slice(-1)[0]')))
            page.screenshot(path=f'{SHOTS}/v15-confirm-setup.png')
            page.click('#confirm-btn'); page.wait_for_timeout(120)
            check('v1.4 get-ready: screen turns amber for the last 5 s', page.evaluate("document.body.getAttribute('data-kind')") == 'ready' and 'get ready' in page.locator('.step-kind').inner_text().lower(), page.locator('.step-kind').inner_text())
            page.screenshot(path=f'{SHOTS}/v14-get-ready.png')
            page.clock.run_for(6000); page.wait_for_timeout(120)
            continue
        page.click('.player-actions button.btn.primary')
        page.wait_for_timeout(50)
    check('week 3 squat starts with a ramp-up set at 45 lb', page.locator('.step-kind').inner_text().lower().startswith('ramp') and '45 lb' in page.locator('.step-target').inner_text(), page.locator('.step-target').inner_text())
    page.screenshot(path=f'{SHOTS}/week3-ramp.png')
    said = page.evaluate('window.__said.slice(%d)' % said_from)
    check('v1.4 voice: set-up, the coming set with weight and reps, then Go', any(x.startswith('Set up for Box squat') for x in said) and any('Box squat, ramp-up, 45 pounds, 5 reps' in x for x in said) and said[-1] == 'Go.', said[-6:])
    check('v1.4 work screen: green, pace bar, where-you-are line', page.evaluate("document.body.getAttribute('data-kind')") == 'work' and page.locator('#pace-fill').count() == 1 and 'Barbell' in page.locator('.step-where').inner_text(), page.locator('.step-where').inner_text())
    page.clock.run_for(8000); page.wait_for_timeout(120)
    check('v1.4 pace bar counts reps', 'rep 1 of 5' in page.locator('#pace-text').inner_text().lower(), page.locator('#pace-text').inner_text())
    # let this ramp-up set end on its own timer
    page.clock.run_for((timer_secs(page) + 1) * 1000); page.wait_for_timeout(150)
    check('v1.4 set ended by itself and rest started', page.locator('.step-kind').inner_text().lower().startswith('rest') and page.evaluate("document.body.getAttribute('data-kind')") == 'rest', page.locator('.step-kind').inner_text())
    check('v1.4 voice says rest and its length', page.evaluate('window.__said.slice(-1)[0]') == 'Rest. 1 minute.', page.evaluate('window.__said.slice(-1)[0]'))
    check('v1.4 back button returns to the set', page.locator('#back-btn').count() == 1)
    page.click('#back-btn'); page.wait_for_timeout(100)
    check('v1.4 back reopened the ramp-up set', page.locator('.step-kind').inner_text().lower().startswith('ramp'))
    # v1.1 checks: last-time line, PR on a heavier set, menu sheet, tint attribute
    check('week 3 body has work tint attr', page.evaluate("document.body.getAttribute('data-kind')") in ('work', 'calm'), page.evaluate("document.body.getAttribute('data-kind')"))
    # advance through the ramp-ups to the first work set
    for _ in range(14):
        k = page.locator('.step-kind').inner_text().lower()
        if k == 'work': break
        page.click('.player-actions button.btn.primary'); page.wait_for_timeout(60)
    check('v1.4 work set: large name, set n of N, focus cues, plain effort', 'Set 1 of 3' in page.locator('.step-where').inner_text() and page.locator('.tips .tip').count() >= 2 and 'Leave 2-3' in page.locator('.tile-effort').inner_text() and 'in the tank' in page.locator('.tile-effort').inner_text(), page.locator('.step-main').inner_text()[:200])
    page.screenshot(path=f'{SHOTS}/v14-work-set.png')
    check('week 3 first work set shows Last time', page.locator('.last-time').count() == 1 and '165' in page.locator('.last-time').inner_text(), page.locator('.last-time').inner_text() if page.locator('.last-time').count() else 'none')
    page.screenshot(path=f'{SHOTS}/week3-workset.png')
    check('v1.2 strip has one segment per block (6 on Lift 1)', page.locator('.strip-bar .seg').count() == 6, page.locator('.seg-label').all_inner_texts())
    check('v1.2 segment labels use exercise names', 'Squat' in page.locator('.seg-label').all_inner_texts() and any('RDL' in t for t in page.locator('.seg-label').all_inner_texts()), page.locator('.seg-label').all_inner_texts())
    check('v1.2 status line shows block and steps', 'Block 2 of 6' in page.locator('#clock').inner_text() and 'steps' in page.locator('#clock').inner_text(), page.locator('#clock').inner_text())
    check('v1.2 readout tiles show weight and reps', page.locator('.readout .tile').count() == 3 and '170' in page.locator('.tile-weight').inner_text(), page.locator('.readout').inner_text())
    page.click('.strip'); page.wait_for_selector('.overview')
    check('v1.2 overview lists blocks with set ticks', page.locator('.ov-block').count() == 6 and page.locator('.tick.current').count() == 1, page.locator('.ov-block').count())
    page.screenshot(path=f'{SHOTS}/overview.png', full_page=True)
    page.click('.overview button:has-text("Close")')
    page.click('button:has-text("Edit")'); page.fill('#in-weight', '195'); page.fill('#in-reps', '5')
    page.clock.run_for(120 * 1000); page.wait_for_timeout(100)
    check('v1.4 a set with the edit panel open waits for Done', page.locator('.step-kind').inner_text().lower() == 'work')
    page.click('.player-actions button.btn.primary')
    page.wait_for_timeout(200)
    check('heavier set triggers PR toast', page.locator('#toast').is_visible() and 'PR' in page.locator('#toast').inner_text(), page.locator('#toast').inner_text())
    check('rest screen shows the clock bar and up-next', page.locator('#rest-fill').count() == 1 and 'up next' in page.locator('.step-main').inner_text().lower(), page.locator('.step-main').inner_text()[:80])
    # v1.4: fix the set that just ended from the rest screen
    check('v1.4 rest shows the set just done with Solid selected', '195' in page.locator('#jd-w').inner_text() and page.locator('#jd-r').inner_text().strip() == '5' and page.locator('#just-done .effort-chip.on').get_attribute('data-key') == 'solid', page.locator('#just-done').inner_text())
    check('v1.5 last-set card says Logged before any change', 'Logged' in page.locator('#jd-saved').inner_text())
    page.screenshot(path=f'{SHOTS}/week3-rest.png')
    page.click('#just-done .effort-chip[data-key="hard"]'); page.wait_for_timeout(100)
    check('v1.4 effort chip changes the logged effort', page.locator('#just-done .effort-chip.on').get_attribute('data-key') == 'hard')
    check('v1.5 a change shows the Saved check', 'Saved' in page.locator('#jd-saved').inner_text() and 'flash' in page.locator('#jd-saved').get_attribute('class'), page.locator('#jd-saved').inner_text())
    page.screenshot(path=f'{SHOTS}/v15-rest-saved.png')
    # v1.5: weight and reps change with - and + on the card
    page.click('#jd-w-minus'); page.click('#jd-w-minus'); page.click('#jd-r-minus'); page.wait_for_timeout(100)
    check('v1.5 steppers change the logged weight and reps and the next set', '185' in page.locator('#jd-w').inner_text() and page.locator('#jd-r').inner_text().strip() == '4' and '185' in page.locator('.tile-weight').inner_text(), (page.locator('#jd-w').inner_text(), page.locator('#jd-r').inner_text(), page.locator('.tile-weight').inner_text()))
    page.click('#jd-w'); page.wait_for_selector('#fix-weight')
    page.fill('#fix-weight', '190'); page.fill('#fix-reps', '4'); page.click('.modal button:has-text("Save")'); page.wait_for_timeout(150)
    check('v1.4 fixing weight on the rest screen updates the record and the next set', '190' in page.locator('#jd-w').inner_text() and page.locator('#jd-r').inner_text().strip() == '4' and '190' in page.locator('.tile-weight').inner_text(), (page.locator('#just-done').inner_text(), page.locator('.tile-weight').inner_text()))
    page.screenshot(path=f'{SHOTS}/v14-rest-fixed.png')
    page.click('#more-btn'); page.wait_for_selector('.menu')
    check('menu lists pause, back, end', page.locator('.menu-item').count() >= 3, page.locator('.menu-item').all_inner_texts())
    page.screenshot(path=f'{SHOTS}/menu.png')
    page.click('.menu-item:has-text("End session")'); page.click('.modal button:has-text("End session")')
    page.wait_for_selector('h1:has-text("Review and save")')
    rev = page.locator('.review-card', has_text='Box squat').inner_text()
    check('v1.4 review shows the corrected set with its effort word', '190 lb × 4' in rev and 'Hard' in rev, rev)
    check('v1.5 review lists the skipped sets first and locks Save', page.locator('#review-open .open-item').count() >= 5 and page.locator('#save-session').is_disabled() and 'to check first' in page.locator('#save-session').inner_text(), page.locator('#save-session').inner_text())
    page.screenshot(path=f'{SHOTS}/v15-review-open.png', full_page=True)
    # fill one in by hand, confirm the rest
    page.locator('#review-open .open-item').first.click(); page.wait_for_selector('.modal input')
    page.locator('.modal input').nth(0).fill('170'); page.locator('.modal input').nth(1).fill('4'); page.click('.modal button:has-text("I did it")'); page.wait_for_timeout(150)
    rev = page.locator('.review-card', has_text='Box squat').inner_text()
    check('v1.5 a skipped set filled in on the review counts as done', '170 lb × 4' in rev, rev)
    pass_review(page, 'week3')
    check('v1.5 Save was locked until the skipped sets were confirmed', seen.get('gated', 0) >= 1, seen.get('gated'))
    check('summary shows PR card', page.locator('.pr-card').count() == 1, page.locator('.pr-card').inner_text() if page.locator('.pr-card').count() else 'none')
    page.screenshot(path=f'{SHOTS}/week3-summary.png', full_page=True)

    real_errors = [e for e in errors if 'favicon' not in e and 'Failed to load resource' not in e]
    check('no console errors', not real_errors, real_errors[:5])
    browser.close()

server.terminate()
print('\n' + (f'{len(fails)} FAILED: {fails}' if fails else 'All browser checks passed'))
sys.exit(1 if fails else 0)
