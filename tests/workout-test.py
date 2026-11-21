# workout-test.py - v1.18: the workout screen, end to end in an Android-size browser, with made-up numbers
# (three-digit weights, one with a decimal). The main walk runs at 360 x 698: a 1080 x 2340 phone at 3x with the
# status bar and the three-button bar taken off, which is what the installed app gets on Cameron's phone (measured
# from his screenshots). Two more sizes follow. It follows Cameron's notes from his third workout:
#   nothing scrolls and nothing is cut off, a ready tap before each exercise, each bar change and the stretches,
#   the next sets with reps and weight, the whole workout one tap away, a red pause with the gym clock still running,
#   Left and Right on their own clocks, Equipment taken inside a finisher, the last-set card after the last finisher
#   set, reps in every voice line, louder beeps, set times that follow his pace, runs on Progress.
# Run: python3 tests/workout-test.py   (serves the repo on :8088; SHOTS=1 keeps screenshots in tests/shots)
import json, math, os, re, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'tests', 'shots'); os.makedirs(SHOTS, exist_ok=True)
KEEP = os.environ.get('SHOTS') == '1'
PORT = 8088
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

# Made-up numbers, not anyone's log. Week 3 (a build week), Lift 3: Full body.
TARGETS = {'power_clean': {'weight': 185, 'reps': 2}, 'front_squat': {'weight': 245, 'reps': 5}, 'lateral_raise': {'weight': 40, 'reps': 12},
           'push_press': {'weight': 162.5, 'reps': 3}, 'db_row': {'weight': 110, 'reps': 8}, 'preacher_curl': {'weight': 35, 'reps': 8},
           'rope_pushdown': {'weight': 120, 'reps': 10}, 'calf_raise': {'weight': 245, 'reps': 10}, 'leg_curl': {'weight': 130, 'reps': 10}}
# The same lift a week earlier: Set-up done for the front squat came 2:30 into a 1:00 set-up (one of the two
# sessions in a row that set-up time needs before it changes).
PREV = {'id': 'ses_prev', 'sessionId': 'lift3', 'sessionName': 'Lift 3: Full body', 'logName': 'Lift 3', 'week': 2, 'date': '2026-11-27',
        'startedAt': '2026-11-28T00:30:00.000Z', 'endedAt': '2026-11-28T01:36:00.000Z', 'plannedSeconds': 3900, 'actualSeconds': 3960, 'pausedSeconds': 0,
        'trims': [], 'status': 'complete', 'engineMinutes': 0, 'whatChanged': [], 'e1rms': {}, 'prs': [],
        'sets': [{'exerciseId': 'front_squat', 'name': 'Front squat', 'setIndex': i, 'weight': 240, 'reps': 5, 'rpe': 8, 'done': True, 'skipped': False, 'blockId': 'B',
                  'target': {'weight': 240, 'reps': 5}, 'at': f'2026-11-28T00:5{i}:00.000Z',
                  **({'lead': {'plan': 60, 'setup': 60, 'took': 155, 'paused': 0, 'by': 'tap', 'tap': 150}} if i == 1 else {})} for i in (1, 2, 3)]}
RUNS = [{'id': 'run_a', 'date': '2026-11-24', 'type': 'Intervals', 'planId': 'run1', 'distance': 3.1, 'minutes': 27.5, 'pace': 8.87, 'week': 2, 'notes': ''},
        {'id': 'run_b', 'date': '2026-11-29', 'type': 'Long run', 'planId': 'run2', 'distance': 5.5, 'minutes': 55, 'pace': 10, 'week': 2, 'notes': ''}]

STUB = "window.__said = []; window.SpeechSynthesisUtterance = function (t) { this.text = t; }; Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak(u) { window.__said.push(u.text); } }, configurable: true }); window.__buzz = []; navigator.vibrate = p => { window.__buzz.push(p); return true; };"

# One look at the workout screen.
STATE = """() => {
  const q = s => document.querySelector(s);
  const t = s => { const e = q(s); return e ? e.innerText.trim() : ''; };
  const pill = q('.step-kind'); const main = q('.step-main'); const player = q('.player'); const toast = q('#toast');
  return {
    player: !!(player && main) && !q('#save-session'), step: player ? Number(player.getAttribute('data-step')) : -1,
    kind: pill && !pill.hidden ? pill.textContent.trim().toLowerCase() : (q('#paused-banner') ? 'paused' : '?'),
    name: t('.step-name'), where: t('#where'), stepWhere: t('.step-where'), timer: t('#timer'), gym: t('#gym-clock'),
    confirm: !!q('#confirm-btn'), confirmText: t('#confirm-btn'), primary: t('.player-actions button.btn.primary'),
    jd: !!q('#just-done'), jdName: t('#just-done .jd-name'), jdSaved: t('#jd-saved'), jdOpen: !!q('#just-done.unconfirmed'),
    sides: !!q('#sides'), edit: !!q('#edit-panel:not([hidden])'), fin: t('#fin-row'), swap: !!q('#swap-btn'),
    bodyKind: document.body.getAttribute('data-kind'), upNext: t('#up-next').replace(/\\n+/g, ' | '),
    main: main ? main.innerText.replace(/\\n+/g, ' | ').slice(0, 600) : '', toast: toast && !toast.hidden ? toast.innerText.trim() : '',
    fit: player ? player.getAttribute('data-fit') : null
  };
}"""

# Does this screen scroll, overflow, cut text or put anything off the screen? (Cameron: "3 digits in weight cut off.
# Have to scroll down to see everything.")
MEASURE = """() => {
  const vh = window.innerHeight, vw = window.innerWidth;
  const cut = [], off = [];
  const player = document.querySelector('.player'); const main = document.querySelector('.step-main');
  const canvas = document.createElement('canvas').getContext('2d');
  const label = e => (e.id ? '#' + e.id : '.' + String(e.className || e.tagName).trim().split(/\\s+/).slice(0, 2).join('.'));
  for (const e of (player ? player.querySelectorAll('*') : [])) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || e.closest('[hidden]')) continue;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (e.tagName === 'INPUT' && e.type === 'number') {
      // a number box has to show a weight like 162.5 and two-digit reps whole
      canvas.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const inner = e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      for (const sample of [e.value, /weight/.test(e.id) ? '162.5' : '88']) { const need = canvas.measureText(sample).width; if (need > inner + 0.5) cut.push(`${label(e)} "${sample}" needs ${Math.round(need)} px, has ${Math.round(inner)}`); }
      continue;
    }
    const text = (e.innerText || '').trim().replace(/\\n/g, ' ');
    if (!text) continue;
    if ((cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis') && e.scrollWidth > e.clientWidth + 1 && e !== main) cut.push(`${label(e)} "${text.slice(0, 30)}" ${e.scrollWidth} > ${e.clientWidth}`);
    if (r.right > vw + 1 || r.left < -1) off.push(`${label(e)} x ${Math.round(r.left)}..${Math.round(r.right)}`);
    if (r.bottom > vh + 1 && !(main && main.contains(e))) off.push(`${label(e)} bottom ${Math.round(r.bottom)} > ${vh}`);
  }
  return { docScroll: document.documentElement.scrollHeight - vh, mainOver: main ? main.scrollHeight - main.clientHeight : 0, cut, off };
}"""

def clock_secs(t):
    parts = [int(x) for x in t.split(':')]
    return parts[-1] + 60 * parts[-2] + (3600 * parts[0] if len(parts) == 3 else 0)

class Walk:
    """Goes through a session the way a person would, looking at every screen on the way."""
    def __init__(self, page, tag):
        self.page, self.tag = page, tag
        self.screens = 0; self.bad = []; self.said = []; self.kinds = {}; self.fits = {}
    def state(self):
        self.said += self.page.evaluate('window.__said.splice(0)')
        return self.page.evaluate(STATE)
    def run(self, seconds):
        """Let the app's clock run, a second at a time, so its 250 ms tick sees every second."""
        left = seconds
        while left > 0:
            step = min(1, left); self.page.clock.run_for(int(step * 1000)); left -= step
    def run_out(self, limit=400):
        """Let the clock run until the app moves to the next step by itself. Returns the seconds that took."""
        key = self.page.evaluate("() => { const p = document.querySelector('.player'); return p && !document.querySelector('#save-session') ? p.getAttribute('data-step') : 'end'; }")
        for n in range(1, limit + 1):
            self.page.clock.run_for(1000)
            if self.page.evaluate("() => { const p = document.querySelector('.player'); return p && !document.querySelector('#save-session') ? p.getAttribute('data-step') : 'end'; }") != key: return n
        return None
    def tap(self, sel):
        self.page.click(sel); self.page.wait_for_timeout(30)
    def confirm(self):
        """Set-up done / Ready. A second tap within 0.6 s is ignored by the app, so the clock moves on a little."""
        self.tap('#confirm-btn'); self.page.clock.run_for(700)
    def look(self, s, note=''):
        m = self.page.evaluate(MEASURE)
        self.screens += 1
        key = s['kind'] + ('+last set' if s['jd'] else '') + ('+finisher' if s['fin'] else '') + ('+sides' if s['sides'] else '') + ('+edit' if s['edit'] else '')
        first = key not in self.kinds
        self.kinds[key] = self.kinds.get(key, 0) + 1
        self.fits[s['fit']] = self.fits.get(s['fit'], 0) + 1
        wrong = m['docScroll'] > 1 or m['mainOver'] > 1 or m['cut'] or m['off']
        if wrong: self.bad.append(f"{key} / {s['name']}{' ' + note if note else ''}: page scroll {m['docScroll']}, middle over by {m['mainOver']}, cut {m['cut'][:3]}, off {m['off'][:3]}")
        if KEEP and (first or wrong): self.page.screenshot(path=f"{SHOTS}/w118-{self.tag}-{self.screens:03d}-{re.sub('[^a-z]+', '-', key)}{'-BAD' if wrong else ''}.png")
        return m
    def move(self, s):
        k = s['kind']
        if s['confirm']: self.confirm()
        elif k in ('timed', 'stretch', 'hold'): self.run_out()
        elif k == 'your call': self.tap('.player-actions .secondary button:has-text("Skip it")')
        else: self.tap('.player-actions button.btn.primary')
    def go(self, on_screen=None, limit=700):
        for _ in range(limit):
            s = self.state()
            if not s['player']: return True
            self.look(s)
            if on_screen and on_screen(s): continue
            self.move(s)
        return False

def open_app(p, width, height):
    chrome = os.environ.get('CHROME_PATH') or next((c for c in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium') if os.path.exists(c)), None)
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': width, 'height': height}, reduced_motion='reduce', device_scale_factor=2, is_mobile=True, has_touch=True, timezone_id='America/Denver')
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'favicon' not in m.text and 'Failed to load resource' not in m.text else None)
    page.add_init_script(STUB)
    # Friday of week 3, 5:30 pm in Denver: Lift 3 day
    page.clock.install(time='2026-12-04T17:30:00')
    page.goto(f'http://localhost:{PORT}/'); page.wait_for_selector('.card.accent h1')
    page.evaluate("([t, s, runs]) => import('./js/store.js').then(async m => { await m.setTargets(t); await m.setPairTotals('none'); await m.putSession(s); for (const r of runs) await m.putRun(r); })", [TARGETS, PREV, RUNS])
    page.reload(); page.wait_for_selector('.card.accent h1')
    return browser, page, errors

def start_lift3(page):
    page.click('#today-card .btn'); page.wait_for_selector('#start-workout')
    return page.locator('#view').inner_text()

def back_home(page):
    """From a session's start page back to Home (its Back button; the Home tab only scrolls the page it is on)."""
    page.locator('#view button.btn.ghost', has_text='Back').click(); page.wait_for_selector('#today-card')

with sync_playwright() as p:
    # ------------------------------------------------------------------------------------------------------------
    print('360 x 698 (his phone): Lift 3 from the first drill to the last stretch')
    browser, page, errors = open_app(p, 360, 698)
    pre = start_lift3(page)
    check('start page: Lift 3 with the made-up weights, no learned times yet', 'Full body' in pre and '245 lb × 5' in pre and '162.5 lb × 3' in pre and page.locator('#pacing-note').count() == 0, pre[:300])
    page.click('#start-workout'); page.wait_for_selector('.player'); page.wait_for_timeout(150)
    w = Walk(page, '360')
    seen = {}
    body_kind = lambda: page.evaluate("document.body.getAttribute('data-kind')")
    bar_color = lambda: page.evaluate("document.querySelector('meta[name=theme-color]').content")
    rgb = lambda sel, prop='backgroundColor': page.evaluate("([s, p]) => getComputedStyle(document.querySelector(s))[p].match(/[\\d.]+/g).slice(0, 3).map(Number)", [sel, prop])

    def on_screen(s):
        k, nm = s['kind'], s['name']

        # ---- the first screen: the header, pause, the whole workout ----
        if 'start' not in seen:
            seen['start'] = 1
            check('header: Plan, time in the gym, Pause and the menu on one row', all(page.locator(f'.player-head {x}').count() == 1 for x in ('#plan-btn', '#gym-clock', '#pause-btn', '#more-btn')) and s['where'] == 'Warm-up', s['where'])
            check('strip: one letter per block, and how long is left with the finish time', page.locator('.seg-label').all_inner_texts() == ['W', 'A', 'B', 'C', 'F', 'S', '+'] and 'min left' in page.locator('#clock').inner_text() and 'ends' in page.locator('#clock').inner_text(), (page.locator('.seg-label').all_inner_texts(), page.locator('#clock').inner_text()))
            w.run(5)
            running_bar = bar_color()
            w.tap('#pause-btn')
            t0 = w.state(); w.look(t0, 'paused')
            w.run(40)
            t1 = w.state()
            check('pause (Cameron: "make it obvious I am paused"): red screen, red Pause button, red status bar', body_kind() == 'paused' and page.locator('.player.is-paused').count() == 1 and 'on' in page.locator('#pause-btn').get_attribute('class').split() and (lambda c: c[0] > 180 and c[1] < 90 and c[2] < 90)(rgb('#pause-btn')) and bar_color() == '#7d1b21' and bar_color() != running_bar, (body_kind(), rgb('#pause-btn'), bar_color()))
            check('pause: a banner counts the pause and says how to go on', page.locator('#paused-banner').is_visible() and 'Tap to resume' in page.locator('#paused-banner').inner_text() and page.locator('#paused-for').inner_text() in ('0:39', '0:40', '0:41') and 'Resume' in page.locator('#pause-btn').inner_text(), page.locator('#paused-banner').inner_text())
            check('pause (Cameron: "keep timer going, I want to see total time in gym"): the gym clock runs on, the step clock stands still', clock_secs(t1['gym']) - clock_secs(t0['gym']) in (39, 40, 41) and t1['timer'] == t0['timer'] and t1['timer'] != '', (t0['gym'], t1['gym'], t0['timer'], t1['timer']))
            w.tap('#paused-banner')
            t2 = w.state(); w.run(3); t3 = w.state()
            check('resume: back to the drill, its clock moves again', body_kind() != 'paused' and page.locator('#paused-banner').count() == 0 and 'Pause' in page.locator('#pause-btn').inner_text() and clock_secs(t2['timer']) - clock_secs(t3['timer']) in (2, 3, 4), (t2['timer'], t3['timer']))

            # the whole workout, with sets and weights (Cameron: "allow screen to show overall workout planned w/ details and weights")
            w.tap('#plan-btn'); page.wait_for_selector('#plan-sheet')
            sheet = page.locator('#plan-sheet').inner_text()
            rows = {r.locator('.ov-name').inner_text().strip(): r.locator('.ov-target').inner_text().strip() for r in page.locator('#plan-sheet .ov-row').all()}
            check('whole workout: seven blocks, each lift with sets, reps and weight', page.locator('#plan-sheet .ov-block').count() == 7 and rows.get('Power clean') == '4 sets · 185 lb × 2' and rows.get('Front squat') == '3 sets · 245 lb × 5' and rows.get('Push press') == '3 sets · 162.5 lb × 3' and rows.get('Standing calf raise') == '3 rounds · 245 lb × 10', rows)
            check('whole workout: dumbbell pairs, one side at a time, holds and stretches read right', rows.get('Lateral raise') == '3 sets · 40 lb (2 × 20) × 12' and rows.get('Dumbbell row') == '3 sets · 110 lb × 8 / side' and rows.get('Side plank') == '3 rounds · 25 s / side' and rows.get('Couch stretch') == '1:00 / side' and rows.get('Forward fold') == '0:45', rows)
            check('whole workout: ramp-up weights listed, time in the gym on top, nothing wider than the screen', 'Ramp-up' in sheet and '45×5' in sheet.replace(' ', '') and 'in the gym' in page.locator('#plan-sheet .ov-sub').inner_text() and page.evaluate("(() => { const m = document.querySelector('#modal .sheet') || document.querySelector('#modal'); return m.scrollWidth <= m.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth; })()"), sheet[:300])
            if KEEP: page.screenshot(path=f'{SHOTS}/w118-plan-sheet.png')
            w.tap('#plan-close')
            w.tap('.strip'); page.wait_for_selector('#plan-sheet'); w.tap('#plan-close')
            w.tap('#more-btn'); page.wait_for_selector('.menu')
            items = page.locator('.menu-item').all_inner_texts()
            check('menu: Pause, the whole workout, End session early (Back one step once there is one)', any('Pause' in x for x in items) and any('Whole workout' in x for x in items) and any('End session early' in x for x in items), items)
            page.click('.modal button:has-text("Close")'); page.wait_for_timeout(30)
            return False

        # ---- set-up before the first lift: what to load, what follows, and it waits for the tap ----
        if s['confirm'] and nm == 'Power clean' and k == 'set up' and 'pc_setup' not in seen:
            seen['pc_setup'] = 1
            check('voice (Cameron: "say reps"): the set-up line names the set with its reps and weight', 'Set up for Power clean, ramp-up, 5 reps at 45 pounds. 1 minute.' in w.said, w.said[-4:])
            check('set-up screen (Cameron: "for upcoming sets, show reps and weight"): the next set, then the ramp-ups and work sets to come', page.locator('#up-next .tile-weight b').inner_text().strip() == '45' and page.locator('#up-next .un-reps b').inner_text().strip() == '5' and 'Then ramp-up | 95 × 5, 130 × 3, 155 × 2' in s['upNext'] and 'Then 4 work sets | 185 lb × 2' in s['upNext'], s['upNext'])
            check('set-up screen: the main button is Set-up done, Equipment taken is offered', s['confirmText'] == 'Set-up done' and s['swap'] and s['where'] == 'Block A · Power clean', (s['confirmText'], s['where']))
            w.run(70)
            h = w.state(); w.look(h, 'holding')
            check('set-up (Cameron: "ensure I am good to go"): the clock runs out, then waits for the tap and says so', h['kind'] == 'confirm set-up' and h['timer'] == '0:00' and h['step'] == s['step'] and w.said[-1] == 'Tap set-up done when you are ready.' and body_kind() == 'ready', (h['kind'], h['timer'], w.said[-2:]))
            w.confirm()
            g = w.state(); w.look(g, 'get ready')
            check('after the tap: a 5 s get-ready count that says the name and the reps again', g['kind'] == 'get ready' and clock_secs(g['timer']) in (4, 5) and w.said[-1] == 'Power clean, 5 reps.', (g['kind'], g['timer'], w.said[-2:]))
            w.run_out()
            f = w.state()
            check('then the set starts by itself, with Go', f['kind'] == 'ramp-up' and f['name'] == 'Power clean' and w.said[-1] == 'Go.' and body_kind() == 'work', (f['kind'], w.said[-2:]))
            return True

        # ---- each bar change waits too, and says what to change ----
        if s['confirm'] and nm == 'Power clean' and k == 'rest':
            n = seen['bar_changes'] = seen.get('bar_changes', 0) + 1
            cw = page.locator('#change-weight').inner_text() if page.locator('#change-weight').count() else ''
            seen.setdefault('bar_texts', []).append(cw)
            if n == 1:
                jd = page.locator('#just-done')
                check('bar change after a ramp-up: that set is one line with nothing to rate (Cameron: "too busy"), so the plates to add and the sets to come all show',
                      'slim' in jd.get_attribute('class').split() and jd.locator('.effort-chip').count() == 0 and jd.locator('.jd-steps').count() == 0 and 'ramp-up · 45 lb × 5' in jd.locator('.jd-sub').inner_text() and jd.locator('#jd-undo').count() == 1
                      and 'Then ramp-up | 130 × 3, 155 × 2' in s['upNext'] and 'Then 4 work sets | 185 lb × 2' in s['upNext'] and page.locator('#change-side').is_visible() and s['fit'] == '0', (jd.inner_text(), s['upNext'], s['fit']))
                before = clock_secs(s['timer'])
                w.confirm()
                r = w.state(); w.look(r, 'tap during the rest')
                check('a Set-up done tap during the rest keeps the rest: a chip beside the clock says the tap is in, the clock runs on without a jump, nothing else moves',
                      r['step'] == s['step'] and not r['confirm'] and r['kind'] == 'rest' and page.locator('#ready-note').inner_text().strip() == 'Set-up done' and before - 2 <= clock_secs(r['timer']) <= before
                      and r['primary'] == 'Skip rest' and r['fit'] == s['fit'] and r['upNext'] == s['upNext'] and r['toast'] == 'It starts when the rest ends.', (r['kind'], before, r['timer'], r['primary'], r['fit'], r['toast']))
                took = w.run_out()
                g = w.state()
                check('the rest then runs out by itself into the next ramp-up, as long as the rest was planned (60 s)', g['kind'] == 'ramp-up' and g['name'] == 'Power clean' and before + 2 <= took <= before + 6 and 'Go.' in w.said[-2:], (g['kind'], took, before, w.said[-3:]))
                return True
            return False

        # ---- four work sets of two: the first three ended early with Done, so the fourth gets less time ----
        if k == 'work' and nm == 'Power clean':
            n = seen['pc'] = seen.get('pc', 0) + 1
            if n == 1:
                seen['pc_time'] = clock_secs(s['timer'])
                check('work set: the weight is the big number, reps and effort under it, set n of N on top', page.locator('#hero-readout .hw-num').inner_text().strip() == '185' and page.locator('.hl-reps b').inner_text().strip() == '2' and 'Set 1 of 4' in s['stepWhere'] and s['bodyKind'] == 'work', s['main'][:200])
                check('bar changes on the way up: 4 of them waited for Set-up done, each saying what to add', seen.get('bar_changes') == 4 and seen['bar_texts'][0].startswith('Change the weight: 45 → 95 lb') and '(add 25 a side)' in seen['bar_texts'][0] and '155 → 185 lb' in seen['bar_texts'][3] and '(add 15 a side)' in seen['bar_texts'][3], seen.get('bar_texts'))
            if n <= 3:
                w.run(9); w.tap('.player-actions button.btn.primary')
                r = w.state()
                if n == 1:
                    check('rest after a set at the same weight: no tap needed, the rest runs by itself', not r['confirm'] and r['kind'] == 'rest' and r['primary'] == 'Skip rest', (r['kind'], r['primary']))
                    check('rest: the set just done as a card, marked Logged, with Undo', r['jd'] and r['jdName'] == 'Power clean' and r['jdSaved'] == 'Logged' and not r['jdOpen'] and page.locator('#jd-undo').count() == 1, r['main'][:200])
                    check('voice: the rest line says how long, then the next set with reps and weight', w.said[-1] == 'Rest, 1 minute 30 seconds. Then Power clean, set 2 of 4, 2 reps at 185 pounds.', w.said[-2:])
                if n == 3:
                    seen['pace_toast'] = r['toast']
                return True
            new_time = clock_secs(s['timer'])
            m = re.match(r'^Power clean: sets now get (\d+) s \(was (\d+) s\), to match your pace$', seen.get('pace_toast', ''))
            check('pace (Cameron: "dynamically updating time if I consistently end early"): after 3 sets in a row ended early, the 4th gets less time, and the app says so', m is not None and int(m.group(2)) == seen['pc_time'] and int(m.group(1)) == new_time and new_time < seen['pc_time'], (seen.get('pace_toast'), seen['pc_time'], new_time))
            w.run_out()      # this one ends on its own timer: logged as planned, nobody rated it
            r = w.state(); w.look(r, 'logged by the timer')
            check('a set that ended on its timer is marked Logged as planned, effort not filled in', r['jd'] and r['jdSaved'] == 'Logged as planned' and r['jdOpen'], (r['jdSaved'], r['main'][:160]))
            w.tap('#just-done .effort-chip[data-key="hard"]')
            r = w.state()
            check('tapping an effort on the card rates it: Saved, no longer open', r['jdSaved'] == 'Saved' and not r['jdOpen'] and page.locator('#just-done .effort-chip.on').get_attribute('data-key') == 'hard', r['jdSaved'])
            return True

        # ---- a superset: both lifts named, the tap comes 2:30 in ----
        if s['confirm'] and nm == 'Front squat' and k == 'set up' and 'fs_setup' not in seen:
            seen['fs_setup'] = 1
            check('superset set-up: both lifts in the header and in the voice line', s['where'] == 'Block B · Front squat + Lateral raise' and 'Set up for Front squat, set 1 of 3, 5 reps at 245 pounds. Then Lateral raise, 12 reps with two 20 pound dumbbells. 1 minute.' in w.said, (s['where'], w.said[-3:]))
            check('superset set-up: the other lift is listed with its reps and weight', 'Lateral raise | 40 lb (2 × 20) × 12' in s['upNext'] and page.locator('#up-next .tile-weight b').inner_text().strip() == '245', s['upNext'])
            w.run(150); w.confirm()
            return True
        if k == 'work' and nm == 'Front squat':
            seen['fs'] = seen.get('fs', 0) + 1
            w.run_out()      # all three left to the timer: three sets nobody rated, for the review
            return True
        if s['confirm'] and nm == 'Lateral raise' and k == 'rest + set up' and 'lr_setup' not in seen:
            seen['lr_setup'] = 1
            before = clock_secs(s['timer'])
            w.confirm()
            r = w.state(); w.look(r, 'tap during the rest')
            # 30 s of rest (Cameron approved 30 s here on Nov 20, it was 60) plus 30 s to get the dumbbells: the tap drops the set-up part
            check('a Set-up done tap during "rest + set up" drops the set-up time and keeps the rest: the pill now says Rest, with the chip', r['step'] == s['step'] and not r['confirm'] and r['kind'] == 'rest' and page.locator('#ready-note').inner_text().strip() == 'Set-up done'
                  and before - 32 <= clock_secs(r['timer']) <= before - 28 and r['primary'] == 'Skip rest' and r['fit'] == s['fit'], (r['kind'], r['timer'], before, r['fit'], s['fit'], r['main'][:200]))
            return True
        if k == 'work' and nm == 'Lateral raise' and 'lr' not in seen:
            seen['lr'] = 1
            hero = page.locator('#hero-readout').inner_text()
            check('two dumbbells: the total is the big number, "2 × 20 lb" under it', page.locator('#hero-readout .hw-num').inner_text().strip() == '40' and 'lb total' in hero and '2 × 20 lb' in hero and page.locator('.hl-reps b').inner_text().strip() == '12', hero)
            return False

        # ---- a weight with a decimal, and the boxes for typing it ----
        if k == 'work' and nm == 'Push press' and 'pp' not in seen:
            seen['pp'] = 1
            num = page.locator('#hero-readout .hw-num')
            check('162.5 lb fits whole (Cameron: "3 digits in weight cutoff")', num.inner_text().strip() == '162.5' and page.evaluate("(() => { const n = document.querySelector('#hero-readout .hero-weight'); return n.scrollWidth <= n.clientWidth + 1; })()"), num.inner_text())
            w.tap('.player-actions .secondary button:has-text("Edit")')
            e = w.state(); m = w.look(e, 'edit open')
            check('edit panel: weight box shows 162.5 whole, nothing scrolls', e['edit'] and page.locator('#in-weight').input_value() == '162.5' and not m['cut'] and m['docScroll'] <= 1 and m['mainOver'] <= 1, m)
            w.tap('.player-actions .secondary button:has-text("Hide")')
            return False

        # ---- one side at a time (Cameron: "distinguish which side I should work, make that obvious with the timer") ----
        if k == 'work' and nm == 'Dumbbell row':
            n = seen['row'] = seen.get('row', 0) + 1
            if n == 1:
                check('one arm at a time: Left and Right side by side, each with its own clock', s['sides'] and page.locator('#side-left').count() == 1 and page.locator('#side-right').count() == 1 and page.locator('#side-left-time').inner_text() == page.locator('#side-right-time').inner_text() and 'reps / side' in page.locator('#hero-readout').inner_text(), s['main'][:200])
                check('voice: Go, and which side first', w.said[-1] == 'Go. Left side.', w.said[-2:])
                w.run(6)
                a = w.state()
                left, right = rgb('#side-left'), rgb('#side-right')
                check('left side is lit sky blue while the right waits', 'active' in page.locator('#side-left').get_attribute('class') and 'later' in page.locator('#side-right').get_attribute('class') and left[2] > left[0] + 60 and page.locator('#side-left-note').inner_text() == 'now' and page.locator('#pace-text').inner_text().startswith('Left · rep'), (page.locator('#side-left').get_attribute('class'), left, page.locator('#pace-text').inner_text()))
                phases = []
                for _ in range(120):
                    w.run(1); x = w.state()
                    if x['step'] != s['step']: break
                    cls = page.locator('#sides').get_attribute('class')
                    ph = re.search(r'phase-(\w+)', cls).group(1)
                    if not phases or phases[-1] != ph: phases.append(ph)
                    if ph == 'switch' and 'switch_note' not in seen: seen['switch_note'] = page.locator('#side-right-note').inner_text()
                    if ph == 'right' and 'right_rgb' not in seen:
                        seen['right_rgb'] = rgb('#side-right'); seen['left_done'] = page.locator('#side-left-time').inner_text()
                        if KEEP: page.screenshot(path=f'{SHOTS}/w118-right-side.png')
                rr = seen.get('right_rgb', [0, 0, 0])
                check('the clock moves left, change-over, right, and says each change', phases == ['left', 'switch', 'right'] and 'Switch sides.' in w.said[-4:] and 'Right side.' in w.said[-4:] and seen.get('switch_note', '').startswith('switch sides · '), (phases, w.said[-4:], seen.get('switch_note')))
                check('right side is lit orange, the left shows a check', rr[0] > rr[2] + 60 and seen.get('left_done') == '✓', (rr, seen.get('left_done')))
                check('the set ended by itself after the right side', x['step'] != s['step'] and x['jdName'] == 'Dumbbell row', (x['kind'], x['jdName']))
                return True
            if n == 2:
                w.run(12)
                w.tap('#side-right')
                a = w.state()
                check('left side done early: a tap on Right starts it now with its full time', 'phase-right' in page.locator('#sides').get_attribute('class') and 'active' in page.locator('#side-right').get_attribute('class') and w.said[-1] == 'Right side.' and a['step'] == s['step'], (page.locator('#sides').get_attribute('class'), w.said[-2:]))
            return False

        # ---- the finisher: its exercises on top, Equipment taken inside it ----
        if s['fin'] and 'fin' not in seen:
            seen['fin'] = 1
            chips = page.locator('#fin-row .fin-ex').all_inner_texts()
            check('finisher: its four exercises are listed on top with the next one picked out, none cut off', len(chips) == 4 and page.locator('#fin-row .fin-ex.now').count() == 1 and 'Calf' in chips and s['where'].startswith('Finisher · Round 1 of 3') and page.evaluate("(() => { const f = document.querySelector('#fin-row'); return f.scrollWidth <= f.clientWidth + 1; })()"), (chips, s['where']))
        if s['confirm'] and nm == 'Standing calf raise' and 'Round 1 of 3' in s['where'] and 'calf_swap' not in seen:
            seen['calf_swap'] = 1
            check('Equipment taken is on the calf raise set-up in the finisher (Cameron: "I don\'t see equipment taken on standing calf raise finisher")', s['swap'], s['main'][:200])
            w.tap('#swap-btn'); page.wait_for_selector('.swap-choice')
            choices = [(c.get_attribute('data-kind'), c.inner_text().replace('\n', ' | ')) for c in page.locator('.swap-choice').all()]
            check('it offers the calf raise after the last round', len(choices) == 1 and choices[0][0] == 'later' and 'Do Standing calf raise after the last round' in choices[0][1] and 'Its 3 sets move to the end of the finisher' in choices[0][1], choices)
            if KEEP: page.screenshot(path=f'{SHOTS}/w118-finisher-swap.png')
            page.locator('.swap-choice').first.click(); page.wait_for_timeout(60)
            r = w.state()
            check('after the swap the round moves on without it, with Undo on offer', r['name'] == 'Dumbbell preacher curl' and 'Round 2 of 3' in r['where'] and 'Doing Standing calf raise after the last round' in r['toast'] and page.locator('#toast-action').is_visible(), (r['name'], r['where'], r['toast']))
            w.tap('#toast-action')
            r = w.state()
            check('Undo puts the calf raise back where it was', r['name'] == 'Standing calf raise' and 'Round 1 of 3' in r['where'] and r['confirm'] and r['swap'] and r['step'] == s['step'], (r['name'], r['where']))
            return True
        if nm == 'Dumbbell preacher curl' and 'Round 2 of 3' in s['where'] and s['swap'] and 'first_swap' not in seen:
            seen['first_swap'] = 1
            w.tap('#swap-btn'); page.wait_for_selector('.swap-choice')
            kinds = [c.get_attribute('data-kind') for c in page.locator('.swap-choice').all()]
            check('between rounds: another exercise of the round first, or this one after the last round', kinds == ['first', 'first', 'first', 'later'], [c.inner_text().replace('\n', ' | ') for c in page.locator('.swap-choice').all()])
            page.locator('.swap-choice[data-kind="first"]', has_text='Rope pushdown').click(); page.wait_for_timeout(60)
            r = w.state()
            check('Do Rope pushdown first: it is up next, the preacher curl comes right after', r['name'] == 'Rope pushdown' and 'Round 2 of 3' in r['where'] and 'Doing Rope pushdown first' in r['toast'], (r['name'], r['toast']))
            return True
        if k == 'hold' and nm == 'Side plank':
            n = seen['plank'] = seen.get('plank', 0) + 1
            if n == 1:
                check('a hold each side: Left then Right, 25 s each, no weight shown', s['sides'] and 'is-hold' in page.locator('#sides').get_attribute('class') and page.locator('#side-left-time').inner_text() == '0:25' and page.locator('#side-right-time').inner_text() == '0:25' and page.locator('#hero-readout .hw-num').count() == 0, s['main'][:200])
                took = w.run_out()
                w.state()      # picks up what was said meanwhile
                check('the hold runs 25 s left, a 6 s change-over, 25 s right, then logs itself', took in (55, 56, 57) and 'Switch sides.' in w.said[-6:] and 'Right side.' in w.said[-6:], (took, w.said[-6:]))
                return True
            return False

        # ---- after the last finisher set: its card is still there to rate, and the stretches wait for Ready ----
        if s['confirm'] and s['confirmText'] == 'Ready' and 'ready' not in seen:
            seen['ready'] = 1
            check('stretch block (Cameron: "do a check also to confirm I am ready"): it waits for a Ready tap', k == 'set up' and s['where'] == 'Stretch block' and nm == 'Couch stretch' and '1:00 each side' in s['upNext'] and '90/90 hip hold | 0:45 / side' in s['upNext'], (k, s['where'], s['upNext']))
            check('the last finisher set still gets its card (Cameron: no check after the last calf raise set)', s['jd'] and s['jdName'] == 'Standing calf raise' and page.locator('#just-done .effort-chip').count() == 4, s['main'][:200])
            check('voice: what the stretch block starts with, and that it waits', w.said[-1] == 'Set up for the stretch block. First: Couch stretch. 1 minute each side. Tap ready when you are set.', w.said[-2:])
            w.tap('#just-done .effort-chip[data-key="maxed"]')
            check('rating that last set from here saves it', w.state()['jdSaved'] == 'Saved' and page.locator('#just-done .effort-chip.on').get_attribute('data-key') == 'maxed')
            return False
        if k == 'stretch' and nm == 'Couch stretch' and 'couch' not in seen:
            seen['couch'] = 1
            check('a stretch each side is one screen: Left and Right, 1:00 each', s['sides'] and page.locator('#side-left-time').inner_text() in ('1:00', '0:59') and page.locator('#side-right-time').inner_text() == '1:00' and w.said[-1] == 'Go. Left side.', (s['main'][:200], w.said[-2:]))
            took = w.run_out()
            check('it runs 1:00 left, 6 s to change, 1:00 right', took in (126, 127), took)
            r = w.state()
            check('then a short change-over that names the next stretch', r['kind'] == 'change over' and r['name'] == '90/90 hip hold' and '0:45 each side' in r['upNext'] and clock_secs(r['timer']) in (7, 8) and w.said[-1] == 'Next: 90 90 hip hold. 45 seconds each side.', (r['kind'], r['upNext'], w.said[-2:]))
            return True
        if k == 'stretch' and nm == 'Calf stretch on a step' and 'calf_stretch' not in seen:
            seen['calf_stretch'] = 1
            check('the calf stretch says it is both legs at once', 'Both legs at once' in s['stepWhere'] and not s['sides'] and s['timer'] == '0:45', (s['stepWhere'], s['timer']))
        return False

    ended = w.go(on_screen)
    page.wait_for_selector('#save-session')
    check('the session ran to the review', ended and all(x in seen for x in ('pc_setup', 'fs_setup', 'lr_setup', 'pp', 'calf_swap', 'first_swap', 'ready', 'couch', 'calf_stretch')) and seen.get('row') == 3 and seen.get('plank') == 3 and seen.get('fs') == 3, seen)
    check(f'360 x 698: none of the {w.screens} screens scrolls, overflows, cuts text or runs off the screen (Cameron: "have to scroll down to see everything")', not w.bad and w.screens > 80, w.bad[:6])
    check('360 x 698: no screen had to fold the last-set steppers or drop the sets to come (fit level 2 at most)', max(int(k) for k in w.fits) <= 2, w.fits)
    print(f"    screens by kind: {', '.join(f'{k} {v}' for k, v in sorted(w.kinds.items()))}")
    print(f"    fit levels: {dict(sorted(w.fits.items()))}")

    # ---- review: the sets the timer logged are listed, they do not hold Save ----
    print('Review and summary')
    rt = page.locator('#review-time').inner_text()
    check('review header: working time against the plan, and the time in the gym', 'Lift 3' in rt and 'in the gym' in rt, rt)
    un = page.locator('#review-unchecked')
    open_items = un.locator('.open-item.unchecked').all_inner_texts() if un.count() else []
    check('review: the four sets the timer logged (three front squat, one dumbbell row) are listed as not rated, Save stays open', un.count() == 1 and '4 sets were logged by the timer' in un.inner_text() and len(open_items) == 4 and sum('Front squat' in x for x in open_items) == 3 and sum('Dumbbell row' in x for x in open_items) == 1 and not page.locator('#save-session').is_disabled(), un.inner_text() if un.count() else 'no card')
    fs_card = page.locator('.review-card', has_text='Front squat')
    check('review: those sets read "not rated" in the list', fs_card.locator('.not-rated').count() == 3, fs_card.inner_text())
    un.locator('.open-item.unchecked').first.click(); page.wait_for_selector('#edit-set-save')
    check('review: opening one says the timer logged it, and no effort is picked yet', page.locator('#unchecked-note').count() == 1 and page.locator('.modal .effort-chip.on').count() == 0, page.locator('.modal').inner_text()[:200])
    page.locator('.modal .effort-chip[data-key="hard"]').click(); page.click('#edit-set-save'); page.wait_for_timeout(150)
    check('review: rating one takes it off the list', page.locator('#review-unchecked .open-item.unchecked').count() == 3 and '3 sets were logged by the timer' in page.locator('#review-unchecked').inner_text(), page.locator('#review-unchecked').inner_text())
    page.click('#confirm-unchecked'); page.wait_for_timeout(150)
    check('review: "They all went as planned" clears the rest', page.locator('#review-unchecked').count() == 0 and page.locator('.review-card .not-rated').count() == 0)
    if page.locator('#confirm-skipped').count(): page.click('#confirm-skipped'); page.wait_for_timeout(150)
    if page.locator('#confirm-numbers').count(): page.click('#confirm-numbers'); page.wait_for_timeout(150)
    page.click('#save-session'); page.wait_for_selector('#summary-done')
    gym = page.locator('#gym-stat')
    check('summary: time in the gym beside the working time, with the pause', gym.count() == 1 and 'in the gym, 1 paused' in gym.inner_text().replace('\n', ' '), gym.inner_text() if gym.count() else page.locator('.done-stats').inner_text())
    rec = page.evaluate("import('./js/store.js').then(async m => (await m.getSessions()).find(s => s.id !== 'ses_prev'))")
    sets = rec['sets']
    by = lambda ex: [x for x in sets if x['exerciseId'] == ex and not x.get('ramp')]
    check('saved: time in the gym = working time + the 40 s pause', abs(rec['gymSeconds'] - rec['actualSeconds'] - rec['pausedSeconds']) <= 1 and 39 <= rec['pausedSeconds'] <= 42 and rec['status'] == 'complete', (rec.get('gymSeconds'), rec['actualSeconds'], rec['pausedSeconds'], rec['status']))
    check('saved: no set is left unrated; the front squat sets keep the planned numbers', not any(x.get('unconfirmed') for x in sets) and [(x['weight'], x['reps']) for x in by('front_squat')] == [(245, 5)] * 3 and by('front_squat')[0]['rpe'] == 9, [(x['weight'], x['reps'], x.get('rpe'), x.get('unconfirmed')) for x in by('front_squat')])
    check('saved: every finisher exercise got its three rounds, in whatever order', all(len([x for x in by(ex) if x['done']]) == 3 for ex in ('preacher_curl', 'rope_pushdown', 'side_plank', 'calf_raise')) and by('calf_raise')[-1]['rpe'] == 10, {ex: len([x for x in by(ex) if x['done']]) for ex in ('preacher_curl', 'rope_pushdown', 'side_plank', 'calf_raise')})
    pc = by('power_clean')
    check('saved: how long each set took against its timer (what the pace is learned from)', [x['secs']['by'] for x in pc] == ['done', 'done', 'done', 'timer'] and all(8 <= x['secs']['took'] <= 10.5 for x in pc[:3]) and pc[3]['secs']['plan'] < pc[0]['secs']['plan'], [x.get('secs') for x in pc])
    lead = by('front_squat')[0].get('lead')
    check('saved: how long the front squat set-up took until the tap', lead is not None and lead['by'] == 'tap' and lead['setup'] == 60 and 149 <= lead['tap'] <= 152, lead)
    check('saved: the plank is logged per side, the dumbbell row with its side switch', by('side_plank')[0]['reps'] == 25 and by('side_plank')[0].get('perSide') and by('db_row')[0].get('perSide') and by('db_row')[0]['secs']['by'] == 'timer', (by('side_plank')[0], by('db_row')[0].get('secs')))
    if KEEP: page.screenshot(path=f'{SHOTS}/w118-summary.png')
    page.click('#summary-done'); page.wait_for_selector('.card.accent h1')

    # ---- the next Friday: the start page says which times now follow his pace ----
    print('Next week: times that follow the pace')
    page.clock.set_system_time('2026-12-11T17:30:00')
    page.reload(); page.wait_for_selector('.card.accent h1')
    start_lift3(page)
    note = page.locator('#pacing-note')
    lines = note.locator('li').all_inner_texts() if note.count() else []
    pcl = next((x for x in lines if x.startswith('Power clean')), '')
    m = re.search(r'sets get (\d+) s \(the plan\'s tempo gives (\d+) s\)', pcl)
    check('start page: "Times set from your pace" lists the power clean with its new set time', note.count() == 1 and m is not None and int(m.group(1)) < int(m.group(2)) and int(m.group(2)) == seen['pc_time'], lines)
    check('start page: the front squat set-up is longer after two sessions in a row over it', any(x.startswith('Front squat') and 'set-up 2:35 (was 1:00)' in x for x in lines), lines)
    check('start page: lifts that ran as planned are not listed', not any(x.startswith(('Push press', 'Dumbbell row', 'Standing calf raise')) for x in lines), lines)
    if KEEP: page.screenshot(path=f'{SHOTS}/w118-pacing-note.png')
    page.click('#settings-btn'); page.wait_for_selector('#pacing-settings')
    ps = page.locator('#pacing-settings').inner_text()
    check('Settings: the switch, what was learned in plain numbers, and a way to forget it', page.locator('.toggle', has_text='Set times follow my pace').locator('input').is_checked() and 'Power clean' in ps and 's a rep' in ps and 'Front squat' in ps and '155 s to set up (was 60 s)' in ps and page.locator('#pacing-reset').count() == 1, ps)
    check('Settings: Loud beeps is on, with a button to hear the beep', page.locator('.toggle', has_text='Loud beeps').locator('input').is_checked() and page.locator('#beep-test').count() == 1)
    page.locator('.toggle', has_text='Set times follow my pace').locator('input').uncheck(); page.wait_for_timeout(200)
    page.click('.modal button:has-text("Close")'); page.wait_for_timeout(100)
    back_home(page); start_lift3(page)
    check('switch off: the start page goes back to the plan\'s times', page.locator('#pacing-note').count() == 0)
    page.click('#settings-btn'); page.wait_for_selector('#pacing-settings')
    page.locator('.toggle', has_text='Set times follow my pace').locator('input').check(); page.wait_for_timeout(200)
    page.click('#pacing-reset'); page.wait_for_selector('.modal button:has-text("Forget them")'); page.click('.modal button:has-text("Forget them")'); page.wait_for_selector('#pacing-settings')
    check('Forget the learned times: nothing is listed any more', 'Nothing has changed yet.' in page.locator('#pacing-settings').inner_text() and page.locator('#pacing-reset').count() == 0, page.locator('#pacing-settings').inner_text())
    page.click('.modal button:has-text("Close")'); page.wait_for_timeout(100)
    back_home(page); start_lift3(page)
    check('after forgetting, the start page has no pace note until it is learned again', page.locator('#pacing-note').count() == 0)
    back_home(page)

    # ---- runs on Progress (Cameron: "add runs to progress tracker") ----
    print('Progress: runs')
    page.click('#tabs button[data-view="progress"]'); page.wait_for_selector('#progress-status')
    st = page.locator('#progress-status')
    run_rows = st.locator('.adh-row.run')
    cells = lambda i: [c.get_attribute('class').replace('adh-cell', '').replace('now', '').strip() for c in run_rows.nth(i).locator('.adh-cell').all()][:4]
    check('Progress: the two planned runs sit under the lifts, week by week', run_rows.count() == 2 and run_rows.nth(0).locator('.adh-name').inner_text() == 'Intervals' and run_rows.nth(1).locator('.adh-name').inner_text() == 'Long run' and cells(0) == ['missed', 'done', 'missed', 'open'] and cells(1) == ['missed', 'done', 'missed', 'open'], (run_rows.all_inner_texts(), cells(0), cells(1)))
    check('Progress: the status line counts runs and miles, and planned runs missed', '2 runs, 8.6 mi, 4 planned runs missed' in st.locator('p.muted').inner_text(), st.locator('p.muted').inner_text())
    rp = page.locator('#run-progress')
    check('Progress: a Running card with miles per week, the longest run and the latest pace', rp.count() == 1 and '8.6' in rp.inner_text() and '5.5 mi' in rp.inner_text() and '10:00/mi' in rp.inner_text() and page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), rp.inner_text() if rp.count() else 'no card')
    page.click('#run-progress-open'); page.wait_for_timeout(200)
    check('Progress: the card opens the Runs tab', page.locator('#tabs .tab.active').get_attribute('data-view') == 'runs')

    # ---- beeps (Cameron: "make beeps louder") ----
    print('Beeps')
    beeps = page.evaluate("""async () => {
      const { playTones } = await import('./js/player.js');
      const rules = await (await fetch('./data/rules.json')).json();
      const SR = 44100;
      const measure = buf => { const d = buf.getChannelData(0); let peak = 0, best = 0, acc = 0; const w = Math.round(SR * 0.05);
        for (let i = 0; i < d.length; i++) { peak = Math.max(peak, Math.abs(d[i])); acc += d[i] * d[i]; if (i >= w) acc -= d[i - w] * d[i - w]; if (i >= w - 1) best = Math.max(best, acc / w); }
        return { peak, level: Math.sqrt(best) }; };
      const render = async (seq, voice) => { const ctx = new OfflineAudioContext(1, SR * 1.2, SR); playTones(ctx, ctx.destination, seq, voice, 0); return measure(await ctx.startRendering()); };
      // the beeps before v1.18: a sine wave that faded from its first instant
      const OLD = { warn: [[880, 0, 0.08]], tick: [[880, 0, 0.09]], go: [[1320, 0, 0.35]], setEnd: [[880, 0, 0.14], [587, 0.17, 0.3]], end: [[880, 0, 0.15], [1320, 0.18, 0.25]], pr: [[660, 0, 0.12], [880, 0.14, 0.12], [1320, 0.28, 0.3]] };
      const renderOld = async seq => { const ctx = new OfflineAudioContext(1, SR * 1.2, SR);
        seq.forEach(([f, dt, dur]) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, dt); g.gain.exponentialRampToValueAtTime(0.4, dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, dt + dur);
          o.connect(g); g.connect(ctx.destination); o.start(dt); o.stop(dt + dur + 0.05); });
        return measure(await ctx.startRendering()); };
      const out = {};
      for (const k of Object.keys(rules.cues.tones)) out[k] = { loud: await render(rules.cues.tones[k], rules.cues.loud), normal: await render(rules.cues.tones[k], rules.cues.normal), old: OLD[k] ? await renderOld(OLD[k]) : null };
      return out;
    }""")
    db = lambda a, b: 20 * math.log10(a / b)
    gains = {k: round(db(v['loud']['level'], v['old']['level']), 1) for k, v in beeps.items() if v['old']}
    check('beeps: every one is at least 10 dB louder than before v1.18', len(gains) == 6 and all(g >= 10 for g in gains.values()), gains)
    check('beeps: none clips (peak under 1.0), and the soft voice is still there for Loud beeps off', all(v['loud']['peak'] < 1.0 for v in beeps.values()) and all(db(v['loud']['level'], v['normal']['level']) >= 6 for v in beeps.values()), {k: round(v['loud']['peak'], 2) for k, v in beeps.items()})
    print(f'    louder by (dB): {gains}')
    check('no page errors (360 x 698)', not errors, errors[:5])
    browser.close()

    # ------------------------------------------------------------------------------------------------------------
    for width, height in ((360, 640), (412, 915)):
        print(f'{width} x {height}: the same session, every screen measured')
        browser, page, errors = open_app(p, width, height)
        start_lift3(page); page.click('#start-workout'); page.wait_for_selector('.player'); page.wait_for_timeout(150)
        w = Walk(page, str(width))
        opened = {}
        def with_edit(s):
            # the edit panel once on a barbell set and once inside the finisher
            key = 'finisher' if s['fin'] else 'lift'
            if s['kind'] == 'work' and key not in opened and s['name'] in ('Push press', 'Standing calf raise'):
                opened[key] = 1
                w.tap('.player-actions .secondary button:has-text("Edit")'); e = w.state(); w.look(e, 'edit open')
                w.tap('.player-actions .secondary button:has-text("Hide")')
            return False
        ended = w.go(with_edit)
        check(f'{width} x {height}: none of the {w.screens} screens scrolls, overflows, cuts text or runs off the screen', ended and not w.bad and w.screens > 80 and len(opened) == 2, (w.bad[:6], w.screens, opened))
        print(f"    fit levels: {dict(sorted(w.fits.items()))}")
        check(f'no page errors ({width} x {height})', not errors, errors[:5])
        browser.close()

server.terminate()
print('\n' + (f'{len(fails)} FAILED: {fails}' if fails else 'All workout checks passed'))
sys.exit(1 if fails else 0)
