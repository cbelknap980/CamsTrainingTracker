# runs-test.py - v1.10 Runs tab and Garmin, end to end with stand-ins (no real Garmin, no real GitHub, no real key).
# Part 1 runs the job from data/garmin-job.yml against a stand-in for Garmin's personal API and checks the file it writes.
# Part 2 opens the app in a phone-sized browser with a stand-in for the GitHub API holding that file: runs are added,
# a run typed by hand takes the watch's numbers, effort is added, a deleted run stays out, a bad key is explained.
# Run: python3 tests/runs-test.py
import base64, json, os, subprocess, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'tests', 'shots'); os.makedirs(SHOTS, exist_ok=True)
PORT = 8085
BASE = f'http://localhost:{PORT}/'
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

def act(i, kind, start, meters, seconds, hr=None, name=''):
    return {'activityId': i, 'activityName': name or kind, 'startTimeLocal': start, 'startTimeGMT': start, 'activityType': {'typeId': 1, 'typeKey': kind},
            'distance': meters, 'duration': seconds, 'averageHR': hr, 'maxHR': hr + 14 if hr else None, 'elevationGain': 31.0, 'averageRunningCadenceInStepsPerMinute': 166.4,
            'startLatitude': 39.7, 'startLongitude': -105.0, 'locationName': 'Home town', 'ownerId': 4242, 'ownerFullName': 'A Person'}
ACTIVITIES = [
    act(906, 'running', '2026-11-21 08:05:10', 5800.0, 2160.0, 141, 'Morning Run'),          # Saturday: the long run
    act(905, 'running', '2026-11-20 17:00:00', 400.0, 170.0, 120),                            # too short to count
    act(904, 'strength_training', '2026-11-19 06:00:00', 0.0, 3300.0, 110),                   # a lift: not a run
    act(903, 'indoor_cycling', '2026-11-18 18:10:00', 9000.0, 1500.0, 133, 'Spin'),          # bike in place of a run
    act(902, 'running', '2026-11-17 06:12:33', 5100.0, 1720.0, 158, 'Track intervals'),      # Tuesday: intervals
    act(901, 'running', '2026-11-14 09:00:00', 8000.0, 2700.0, 150),                          # before the block started
]

# ---------------- part 1: the job ----------------
print('The job that runs in the private repo')
garmin = {'key_ok': True, 'calls': []}
class Garmin(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def answer(self, status, text):
        self.send_response(status); self.end_headers(); self.wfile.write(text.encode())
    def do_POST(self):
        garmin['calls'].append(('POST', self.path, self.headers.get('Authorization')))
        if self.path != '/personalapitoken-service/personal-api/personal-api-key/token': return self.answer(404, '')
        if self.headers.get('Authorization') != 'ApiKey test-key' or not garmin['key_ok']: return self.answer(401, 'no')
        self.answer(200, 'bearer.jwt.value\n')
    def do_GET(self):
        garmin['calls'].append(('GET', self.path, self.headers.get('Authorization')))
        if self.headers.get('Authorization') != 'Bearer bearer.jwt.value': return self.answer(401, 'no')
        if not self.path.startswith('/activitylist-service/activities/search/activities?'): return self.answer(404, '')
        self.answer(200, json.dumps(ACTIVITIES))
gsrv = HTTPServer(('127.0.0.1', 8086), Garmin); threading.Thread(target=gsrv.serve_forever, daemon=True).start()

import yaml
job = yaml.safe_load(open(os.path.join(ROOT, 'data', 'garmin-job.yml')))
script = job['jobs']['pull']['steps'][1]['run']
py = script.split("<<'PY'\n", 1)[1].rsplit('\nPY', 1)[0]
work = tempfile.mkdtemp()
def run_job(asked='true', key='test-key'):
    env = {**os.environ, 'GARMIN_BASE': 'http://127.0.0.1:8086', 'GARMIN_PERSONAL_API_KEY': key, 'ASKED': asked, 'NO_PROXY': '127.0.0.1', 'no_proxy': '127.0.0.1'}
    r = subprocess.run([sys.executable, '-I', '-c', py], cwd=work, env=env, capture_output=True, text=True)
    path = os.path.join(work, 'garmin-activities.json')
    return r, (json.load(open(path)) if os.path.exists(path) else None)
check('the job triggers: every two hours, when asked, and by hand', set(job[True].keys()) == {'schedule', 'push', 'workflow_dispatch'} and job[True]['push']['paths'] == ['garmin-request.json'], job[True])
check('the key comes from a repo secret, nothing else', '${{ secrets.GARMIN_PERSONAL_API_KEY }}' in json.dumps(job) and 'test-key' not in open(os.path.join(ROOT, 'data', 'garmin-job.yml')).read())
r, out = run_job()
check('the job runs clean', r.returncode == 0, r.stderr[-400:])
check('it trades the key for a token, then asks for activities with the token', [c[0] for c in garmin['calls']] == ['POST', 'GET'] and garmin['calls'][0][2] == 'ApiKey test-key' and garmin['calls'][1][2] == 'Bearer bearer.jwt.value' and 'startDate=' in garmin['calls'][1][1], garmin['calls'])
check('the file holds every activity and says when it was pulled', out and out['ok'] and len(out['activities']) == 6 and out['fetchedAt'].endswith('Z'), out and {k: out[k] for k in ('ok', 'status', 'fetchedAt')})
flat = json.dumps(out)
check('location and account fields are dropped before saving', 'atitude' not in flat and 'locationName' not in flat and 'owner' not in flat and 'test-key' not in flat and 'bearer.jwt' not in flat)
first_at = out['fetchedAt']
time.sleep(1.1); r, out2 = run_job(asked='false')
check('a scheduled run with nothing new leaves the file alone', out2['fetchedAt'] == first_at, [out2['fetchedAt'], first_at])
garmin['key_ok'] = False; r, bad = run_job()
check('a refused key is written down as such, and the old activities are kept', r.returncode == 0 and bad['ok'] is False and bad['status'] == 401 and len(bad['activities']) == 6, bad and {k: bad[k] for k in ('ok', 'status', 'error')})
r, none = run_job(key='')
check('a missing secret is named', none['ok'] is False and 'GARMIN_PERSONAL_API_KEY' in none['error'], none['error'])
gsrv.shutdown()

# ---------------- part 2: the app ----------------
# the stand-in for GitHub: one private repo holding a few files. Saving garmin-request.json "runs the job".
remote = {'files': {}, 'sha': {}, 'requests': 0, 'job_answer': None}
def github(route):
    req = route.request
    path = req.url.split('api.github.com')[1]
    def send(status, body): route.fulfill(status=status, content_type='application/json', body=body if isinstance(body, str) else json.dumps(body), headers={'access-control-allow-origin': '*'})
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'})
    if req.headers.get('authorization') != 'Bearer good-token': return send(401, {'message': 'Bad credentials'})
    if path == '/repos/cam/training-data': return send(200, {'private': True, 'default_branch': 'trunk', 'permissions': {'push': True}})
    if not path.startswith('/repos/cam/training-data/contents/'): return send(404, {'message': 'Not Found'})
    name = path.split('/contents/')[1]
    if req.method == 'GET':
        if name not in remote['files']: return send(404, {'message': 'Not Found'})
        if 'raw' in req.headers.get('accept', ''): return send(200, remote['files'][name])
        return send(200, {'sha': str(remote['sha'].get(name, 0)), 'content': base64.b64encode(remote['files'][name].encode()).decode()})
    if req.method == 'PUT':
        body = json.loads(req.post_data)
        if name in remote['files'] and body.get('sha') != str(remote['sha'].get(name, 0)): return send(409, {'message': 'sha mismatch'})
        remote['files'][name] = base64.b64decode(body['content']).decode(); remote['sha'][name] = remote['sha'].get(name, 0) + 1
        if name == 'garmin-request.json':
            remote['requests'] += 1
            if remote['job_answer']: remote['files']['garmin-activities.json'] = json.dumps(remote['job_answer'](remote['requests']))
        return send(200, {'content': {'sha': str(remote['sha'][name])}})
    send(405, {})
def answer_ok(n): return {**out, 'fetchedAt': f'2026-11-22T15:0{n}:00Z'}
def answer_bad(n): return {**bad, 'fetchedAt': f'2026-11-22T15:1{n}:00Z'}
# v1.12: Thursday of week 2, a run after Tuesday's intervals were missed
def answer_wk2(n): return {**out, 'activities': [act(907, 'running', '2026-11-26 17:30:00', 4600.0, 1750.0, 160, 'Evening Run')] + out['activities'], 'fetchedAt': f'2026-11-26T23:3{n}:00Z'}
def tracker(): return json.loads(remote['files']['tracker-data.json']) if 'tracker-data.json' in remote['files'] else None
def runs_in(page): return page.evaluate("import('./js/store.js').then(m => m.getRuns())")
def wait_until(page, fn, seconds=8):
    end = time.time() + seconds
    while time.time() < end:
        if fn(): return True
        page.wait_for_timeout(100)
    return fn()
def check_now(page, selector):
    """Tap a Check now button and let the app's five-second waits pass."""
    page.click(selector)
    for _ in range(12):
        page.clock.run_for(5200); page.wait_for_timeout(150)
        if page.locator('#garmin-check:not([disabled])').count() or page.locator('#garmin-check-now:not([disabled])').count(): break

with sync_playwright() as p:
    chrome = os.environ.get('CHROME_PATH') or next((c for c in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium') if os.path.exists(c)), None)
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    errors = []
    phone = browser.new_context(viewport={'width': 393, 'height': 851}, reduced_motion='reduce', device_scale_factor=2, is_mobile=True, has_touch=True)
    phone.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE.rstrip('/'))
    phone.route('https://api.github.com/**', github)
    page = phone.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
    page.clock.install(time='2026-11-22T08:00:00')   # Sunday of week 1
    page.goto(BASE); page.wait_for_selector('.card.accent h1')
    page.evaluate("import('./js/store.js').then(m => m.setPairTotals('none'))")

    print('Runs tab, before Garmin')
    page.click('#tabs button[data-view="runs"]'); page.wait_for_selector('#runs-week')
    week = page.locator('#runs-week').inner_text()
    check('this week shows what each run asks for', '5 × 2 min hard, 2 min easy' in week and '3.5 mi' in week and '0 of 2 planned runs done' in week, week)
    check('the plan notes are one tap away, not in the way', page.locator('.run-notes[open]').count() == 0 and page.locator('.run-notes summary').count() == 1)
    check('Garmin is offered', 'Connect Garmin' in page.locator('#garmin-row').inner_text())
    page.click('#garmin-setup'); page.wait_for_selector('#garmin-sheet')
    check('without sync, the sheet says to turn sync on first', 'Turn sync on first' in page.locator('#garmin-sheet').inner_text())
    page.click('#garmin-sheet button:has-text("Close")')

    page.click('#runs-week .run-plan[data-run="run1"] button:has-text("Log")'); page.wait_for_selector('#run-distance')
    check('Log on a planned run starts the form on that type', page.locator('#run-type').input_value() == 'Intervals')
    page.fill('.modal input[type="date"]', '2026-11-17'); page.fill('#run-distance', '3'); page.fill('#run-time', '28:00'); page.fill('#run-rpe', '8')
    check('pace shows while typing', '9:20/mi' in page.locator('#run-pace').inner_text(), page.locator('#run-pace').inner_text())
    page.click('.modal button:has-text("Save run")'); page.wait_for_selector('.run-item')
    check('the typed run is listed with pace', '3 mi · 28:00 · 9:20/mi' in page.locator('.run-item').first.inner_text(), page.locator('.run-item').first.inner_text())
    check('and counts for Tuesday', '✓ done' in page.locator('.run-plan[data-run="run1"]').inner_text() and '1 of 2 planned runs done' in page.locator('#runs-week-total').inner_text())

    print('Connect Garmin')
    page.evaluate("import('./js/sync.js').then(m => m.saveSync({ repo: 'cam/training-data', token: 'good-token', role: 'phone' }))")
    page.click('#garmin-setup'); page.wait_for_selector('.setup-steps')
    wait_until(page, lambda: '/new/trunk' in (page.locator('#garmin-open-job').get_attribute('href') or ''))
    sheet = page.locator('#garmin-sheet').inner_text()
    check('four steps, in order', all(s in sheet for s in ('1. Make the key', '2. Save it in your repo as a secret', '3. Add the job', '4. Check it')))
    check('step 1 opens Garmin\'s key page', page.locator('#garmin-open-key').get_attribute('href') == 'https://connect.garmin.com/app/settings/personalApiToken')
    check('step 2 opens the repo\'s new-secret page and names the secret', page.locator('#garmin-open-secret').get_attribute('href') == 'https://github.com/cam/training-data/settings/secrets/actions/new' and 'GARMIN_PERSONAL_API_KEY' in sheet)
    href = page.locator('#garmin-open-job').get_attribute('href')
    check('step 3 opens a new file in the repo with the job filled in', href.startswith('https://github.com/cam/training-data/new/trunk?filename=.github%2Fworkflows%2Fgarmin.yml&value=') and 'personal.connectapi.garmin.com' in href and len(href) < 7500, [href[:120], len(href)])
    page.click('#garmin-copy-job'); page.wait_for_timeout(150)
    check('the job text can be copied instead', page.evaluate('navigator.clipboard.readText()') == open(os.path.join(ROOT, 'data', 'garmin-job.yml')).read())
    page.screenshot(path=f'{SHOTS}/runs-garmin-setup.png', full_page=False)

    remote['job_answer'] = answer_ok
    check_now(page, '#garmin-check-now'); page.wait_for_selector('#garmin-say')
    wait_until(page, lambda: 'Connected' in page.locator('#garmin-say').inner_text())
    said = page.locator('#garmin-say').inner_text()
    check('Check Garmin now asks the job, waits for its answer and reports', remote['requests'] == 1 and 'Garmin sent 6 activities' in said and '2 runs were added' in said, [remote['requests'], said])
    page.click('#garmin-sheet button:has-text("Close")'); page.wait_for_selector('#garmin-check')
    runs = {r['id']: r for r in runs_in(page)}
    tue = next(r for r in runs.values() if r['date'] == '2026-11-17')
    check('the run typed on Tuesday took the watch\'s numbers and kept its effort', len([r for r in runs.values() if r['date'] == '2026-11-17']) == 1 and tue['garminId'] == '902' and tue['distance'] == 3.17 and tue['minutes'] == 28.67 and tue['hr'] == 158 and tue['rpe'] == 8 and tue['type'] == 'Intervals', tue)
    sat = runs.get('garmin-906')
    check('Saturday\'s run was added as the long run, in miles and minutes', sat and sat['type'] == 'Long run' and sat['planId'] == 'run2' and sat['distance'] == 3.6 and sat['minutes'] == 36 and sat['pace'] == 10 and sat['climbFt'] == 102 and sat['cadence'] == 166 and sat['week'] == 1, sat)
    check('the bike session came in as a sub', runs.get('garmin-903', {}).get('type') == 'Bike/rower sub', runs.get('garmin-903'))
    check('the lift, the three-minute jog and the run before the block were left out', len(runs) == 3, list(runs))
    check('no location in what the phone saved', 'atitude' not in json.dumps(list(runs.values())))
    week = page.locator('#runs-week').inner_text()
    check('both planned runs show done with their numbers', '2 of 2 planned runs done' in week and '3.17 mi · 28:40 · 9:03/mi' in week and '3.6 mi · 36:00 · 10:00/mi' in week, week)
    check('the status line says Garmin is connected', 'Garmin is connected' in page.locator('#garmin-status').inner_text(), page.locator('#garmin-status').inner_text())
    check('miles by week is drawn', page.locator('#runs-miles .viz-bar').count() == 1 and '6.8 mi this week' in week, week)
    long_item = page.locator('.run-item[data-id="garmin-906"]')
    check('a run from the watch is tagged, and asks for effort', 'Garmin' in long_item.inner_text() and 'Add effort' in long_item.inner_text(), long_item.inner_text())
    page.evaluate("document.getElementById('tabs').style.display = 'none'")   # the fixed tab bar would sit across the middle of a full-page picture
    page.screenshot(path=f'{SHOTS}/runs-phone.png', full_page=True)
    page.evaluate("document.getElementById('tabs').style.display = ''")

    print('The run sheet')
    long_item.click(); page.wait_for_selector('#run-sheet')
    sheet = page.locator('#run-sheet').inner_text()
    check('the sheet shows the watch\'s numbers', all(s in sheet for s in ('From Garmin · Morning Run · started 8:05 am', '3.6 mi', '36:00', '10:00/mi', '141', '155', '102 ft', '166 spm')), sheet)
    page.screenshot(path=f'{SHOTS}/runs-sheet.png')
    page.click('#run-effort-row button[data-rpe="5"]'); page.wait_for_timeout(200)
    check('effort is one tap', next(r for r in runs_in(page) if r['id'] == 'garmin-906')['rpe'] == 5 and page.locator('#run-effort-row button.on').inner_text() == '5')
    page.click('#run-type-row button:has-text("Easy run")'); page.wait_for_timeout(200)
    r906 = next(r for r in runs_in(page) if r['id'] == 'garmin-906')
    check('what it counts as can be changed', r906['type'] == 'Easy run' and r906['planId'] is None, r906)
    page.click('#run-sheet button:has-text("Close")')
    check('the week follows the change', '1 of 2 planned runs done' in page.locator('#runs-week-total').inner_text(), page.locator('#runs-week-total').inner_text())

    print('Check now, deletes, and a bad key')
    check_now(page, '#garmin-check'); page.wait_for_timeout(300)
    r906 = next(r for r in runs_in(page) if r['id'] == 'garmin-906')
    check('a second pull changes nothing Cameron set', remote['requests'] == 2 and len(runs_in(page)) == 3 and r906['type'] == 'Easy run' and r906['rpe'] == 5, [remote['requests'], r906])
    page.locator('.run-item[data-id="garmin-903"]').click(); page.wait_for_selector('#run-sheet')
    page.click('#run-sheet button:has-text("Delete")'); page.click('.modal button.danger:has-text("Delete")'); page.wait_for_timeout(300)
    check_now(page, '#garmin-check'); page.wait_for_timeout(300)
    check('a deleted Garmin run stays deleted', [r['id'] for r in runs_in(page) if r['id'] == 'garmin-903'] == [] and len(runs_in(page)) == 2, [r['id'] for r in runs_in(page)])
    page.clock.run_for(4000); wait_until(page, lambda: tracker() and len(tracker()['runs']) == 2)
    t = tracker()
    check('the upload for the computer carries the runs and the delete', t and len(t['runs']) == 2 and t['garminIgnored'] == ['903'] and any(r.get('garminId') == '906' for r in t['runs']), t and [len(t['runs']), t.get('garminIgnored')])
    check('the token and the Garmin state are not in the upload', 'good-token' not in remote['files']['tracker-data.json'])
    remote['job_answer'] = answer_bad
    check_now(page, '#garmin-check'); page.wait_for_timeout(300)
    check('a refused key is explained on the Runs tab', 'did not accept the key' in page.locator('#garmin-status').inner_text() and len(runs_in(page)) == 2, page.locator('#garmin-status').inner_text())
    remote['job_answer'] = answer_ok
    check_now(page, '#garmin-check'); page.wait_for_timeout(300)
    check('and clears once the job works again', 'Garmin is connected' in page.locator('#garmin-status').inner_text(), page.locator('#garmin-status').inner_text())

    print('Home on a run day')
    page.evaluate("import('./js/store.js').then(async m => { const r = (await m.getRuns()).find(x => x.id === 'garmin-906'); await m.putRun({ ...r, type: 'Long run', planId: 'run2' }); })")
    page.clock.set_system_time('2026-11-21T10:00:00')
    page.click('#tabs button[data-view="home"]'); page.wait_for_selector('#run-ask')
    home = page.locator('.card.accent').inner_text()
    check('Saturday\'s Home card shows the ask and that it is done', '3.5 mi' in home and '✓ Done · 3.6 mi · 36:00' in home and page.locator('.card.accent button:has-text("Log this run")').count() == 0, home)
    page.screenshot(path=f'{SHOTS}/runs-home.png')
    page.clock.set_system_time('2026-11-24T06:00:00')   # Tuesday of week 2, nothing logged yet
    page.reload(); page.wait_for_selector('#run-ask')
    home = page.locator('.card.accent').inner_text()
    check('next Tuesday asks for the intervals and offers to log', '5 × 2 min hard, 2 min easy' in home and page.locator('.card.accent button:has-text("Log this run")').count() == 1, home)
    page.click('#tabs button[data-view="runs"]'); page.wait_for_selector('#runs-week')
    check('the long run target moves up half a mile after 3.6', '4 mi' in page.locator('.run-plan[data-run="run2"]').inner_text() and 'longest so far 3.6 mi' in page.locator('.run-plan[data-run="run2"]').inner_text(), page.locator('.run-plan[data-run="run2"]').inner_text())

    print('Off schedule (v1.12)')
    page.clock.set_system_time('2026-11-25T07:00:00')   # Wednesday of week 2: Tuesday's intervals were not run
    page.click('#tabs button[data-view="home"]'); page.wait_for_selector('#runs-open-card')
    card = page.locator('#runs-open-card').inner_text()
    check('Wednesday: Home lists the intervals as still to run, and the days that still work', 'Run 1: Intervals' in card and 'Thursday, Saturday or Sunday works' in card, card)
    page.clock.set_system_time('2026-11-26T07:00:00')   # Thursday, a free day
    page.reload(); page.wait_for_selector('#moved-run-card')
    card = page.locator('#moved-run-card').inner_text()
    check('Thursday: the intervals are offered today, moved from Tuesday; lifts are not moved', 'Run 1: Intervals' in card and 'Moved here from Tuesday' in card and page.locator('#moved-run-card button:has-text("Log this run")').count() == 1 and page.locator('#runs-open-card').count() == 0, card)
    page.screenshot(path=f'{SHOTS}/runs-moved-home.png')   # top of Home only: the today card and the moved run
    page.click('#tabs button[data-view="runs"]'); page.wait_for_selector('#runs-week')
    check('the Runs tab says the same', 'Not done Tue. Today, Saturday or Sunday works.' in page.locator('.run-plan[data-run="run1"]').inner_text(), page.locator('.run-plan[data-run="run1"]').inner_text())
    remote['job_answer'] = answer_wk2
    check_now(page, '#garmin-check'); page.wait_for_timeout(300)
    r907 = next((r for r in runs_in(page) if r['id'] == 'garmin-907'), None)
    check('Thursday\'s Garmin run counts as the missed intervals', r907 and r907['type'] == 'Intervals' and r907['planId'] == 'run1' and r907['week'] == 2, r907)
    row = page.locator('.run-plan[data-run="run1"]').inner_text()
    check('the week shows the intervals done on Thursday', '✓ done Thu' in row and 'Not done' not in row, row)
    page.screenshot(path=f'{SHOTS}/runs-moved-week.png', full_page=False)
    page.locator('.run-item[data-id="garmin-907"]').click(); page.wait_for_selector('#run-sheet')
    check('the run says why the app counted it that way', "counted it as Intervals because the week's intervals were still open" in page.locator('#run-auto-why').inner_text(), page.locator('#run-auto-why').inner_text() if page.locator('#run-auto-why').count() else 'none')
    page.screenshot(path=f'{SHOTS}/runs-moved-sheet.png')
    page.click('#run-type-row button:has-text("Easy run")'); page.wait_for_timeout(250)
    check('a type Cameron picks sticks, and the intervals open up again', next(r for r in runs_in(page) if r['id'] == 'garmin-907')['typeLocked'] is True and page.locator('#run-auto-why').count() == 0, next(r for r in runs_in(page) if r['id'] == 'garmin-907'))
    page.click('#run-type-row button:has-text("Intervals")'); page.wait_for_timeout(250)
    page.click('#run-sheet button:has-text("Close")')
    page.click('#tabs button[data-view="home"]'); page.wait_for_selector('.card.accent h1')
    check('Home: the intervals card now shows done', page.locator('#moved-run-card').count() == 0 and page.locator('#runs-open-card').count() == 0, page.locator('#view').inner_text()[:400])
    page.clock.run_for(4000); wait_until(page, lambda: tracker() and len(tracker()['runs']) == 3)

    print('The computer')
    comp = browser.new_context(viewport={'width': 1366, 'height': 900}, reduced_motion='reduce', device_scale_factor=1)
    comp.route('https://api.github.com/**', github)
    page2 = comp.new_page(); page2.on('pageerror', lambda e: errors.append(str(e)))
    page2.clock.install(time='2026-11-22T09:00:00')
    page2.goto(BASE); page2.wait_for_selector('.card.accent h1')
    page2.evaluate("import('./js/sync.js').then(m => m.saveSync({ repo: 'cam/training-data', token: 'good-token', role: 'viewer', lastPulledExport: null }))")
    page2.reload(); page2.wait_for_selector('.card.accent h1')
    page2.click('#tabs button[data-view="runs"]'); page2.wait_for_selector('#runs-week')
    wait_until(page2, lambda: 'Garmin is connected' in page2.locator('#garmin-row').inner_text())
    text = page2.locator('#view').inner_text()
    check('the computer shows the phone\'s runs and that Garmin is connected', page2.locator('.run-item').count() == 3 and 'Garmin is connected' in text and 'after your phone opens the app' in text, text[:300])
    check('the computer only views: no Log, no Check now', page2.locator('#log-run').count() == 0 and page2.locator('#garmin-check').count() == 0 and remote['requests'] == 6, remote['requests'])
    cols = page2.evaluate("getComputedStyle(document.querySelector('.runs-cols')).gridTemplateColumns.split(' ').length")
    check('two columns on a wide screen', cols == 2, cols)
    page2.screenshot(path=f'{SHOTS}/runs-computer.png', full_page=True)
    page2.click('#garmin-setup'); page2.wait_for_selector('.setup-steps')
    check('set-up works from the computer, where pasting the key is easier', page2.locator('#garmin-open-secret').count() == 1 and page2.locator('#garmin-check-now').count() == 0 and 'The job is already in the repo' not in page2.locator('#garmin-sheet').inner_text())
    page2.screenshot(path=f'{SHOTS}/runs-garmin-setup-computer.png')

    check('no page errors', not errors, errors[:5])
    browser.close()

server.terminate()
print('\n' + (f'{len(fails)} FAILED: {fails}' if fails else 'All runs checks passed'))
sys.exit(1 if fails else 0)
