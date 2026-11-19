# sync-test.py - v1.7 sync, end to end against a stand-in for the GitHub API (no real network, no real token).
# A phone uploads after each saved change; a computer opened with the set-up link shows the phone's data.
# Run: python3 tests/sync-test.py
import base64, json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8083
BASE = f'http://localhost:{PORT}/'
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

# ---- the stand-in for GitHub: one private repo holding at most one file ----
remote = {'text': None, 'sha': 0, 'puts': 0, 'offline': False, 'messages': []}
def github(route):
    req = route.request
    if remote['offline']: return route.abort()
    path = req.url.split('api.github.com')[1]
    def send(status, body): route.fulfill(status=status, content_type='application/json', body=body if isinstance(body, str) else json.dumps(body), headers={'access-control-allow-origin': '*'})
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'})
    if req.headers.get('authorization') != 'Bearer good-token': return send(401, {'message': 'Bad credentials'})
    if path == '/repos/cam/public-repo': return send(200, {'private': False, 'permissions': {'push': True}})
    if not path.startswith('/repos/cam/training-data'): return send(404, {'message': 'Not Found'})
    if path == '/repos/cam/training-data': return send(200, {'private': True, 'permissions': {'push': True}})
    if path == '/repos/cam/training-data/contents/coach.json' and req.method == 'GET':
        return send(200, remote['coach']) if remote.get('coach') else send(404, {'message': 'Not Found'})
    if path != '/repos/cam/training-data/contents/tracker-data.json': return send(404, {'message': 'Not Found'})
    if req.method == 'GET':
        if remote['text'] is None: return send(404, {'message': 'Not Found'})
        if 'raw' in req.headers.get('accept', ''): return send(200, remote['text'])
        return send(200, {'sha': str(remote['sha']), 'content': base64.b64encode(remote['text'].encode()).decode()})
    if req.method == 'PUT':
        body = json.loads(req.post_data)
        if remote['text'] is not None and body.get('sha') != str(remote['sha']): return send(409, {'message': 'sha mismatch'})
        remote['text'] = base64.b64decode(body['content']).decode(); remote['sha'] += 1; remote['puts'] += 1; remote['messages'].append(body['message'])
        return send(200, {'content': {'sha': str(remote['sha'])}})
    send(405, {})
def remote_data(): return json.loads(remote['text']) if remote['text'] else None

def work_set(ex, w, r): return {'exerciseId': ex, 'name': ex, 'ramp': False, 'weight': w, 'reps': r, 'done': True, 'skipped': False, 'holdSeconds': None}
SESSIONS = [
    {'id': 's1', 'sessionId': 'lift1', 'sessionName': 'Lift 1: Legs', 'week': 1, 'date': '2026-11-16', 'startedAt': '2026-11-16T13:00:00.000Z', 'status': 'complete', 'plannedSeconds': 3600, 'actualSeconds': 3500, 'sets': [work_set('back_squat', 185, 5), work_set('rdl', 155, 8), work_set('leg_curl', 80, 10)], 'whatChanged': [], 'e1rms': {}, 'prs': [], 'trims': []},
    {'id': 's2', 'sessionId': 'lift2', 'sessionName': 'Lift 2: Upper', 'week': 1, 'date': '2026-11-18', 'startedAt': '2026-11-18T13:00:00.000Z', 'status': 'complete', 'plannedSeconds': 3600, 'actualSeconds': 3500, 'sets': [work_set('strict_press', 95, 5), work_set('weighted_pullup', 20, 5)], 'whatChanged': [], 'e1rms': {}, 'prs': [], 'trims': []},
]
BACKUP = {'app': 'CamsTrainingTracker', 'appVersion': 'test', 'planVersion': 'test', 'exportedAt': '2026-11-18T14:00:00.000Z', 'targets': {}, 'sessions': SESSIONS, 'runs': [], 'settings': {}, 'pairTotals': 'none'}

def open_sync(page):
    page.click('#settings-btn'); page.wait_for_selector('#sync-open'); page.click('#sync-open'); page.wait_for_selector('#sync-save')
def log_run(page, miles):
    page.click('#tabs button[data-view="runs"]'); page.click('button:has-text("Log a run")'); page.wait_for_selector('.modal')
    page.fill('#run-distance', str(miles)); page.fill('#run-time', '30')
    page.click('.modal button:has-text("Save run")'); page.wait_for_selector('.run-item')
def wait_until(page, fn, seconds=8):
    # page.wait_for_timeout (not time.sleep) so the stand-in API keeps answering while we wait
    end = time.time() + seconds
    while time.time() < end:
        if fn(): return True
        page.wait_for_timeout(100)
    return fn()

with sync_playwright() as p:
    chrome = os.environ.get('CHROME_PATH') or next((c for c in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium') if os.path.exists(c)), None)
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    errors = []

    # ---- the phone ----
    print('Phone: set-up and upload')
    phone = browser.new_context(viewport={'width': 393, 'height': 851}, reduced_motion='reduce', is_mobile=True, has_touch=True)
    phone.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE.rstrip('/'))
    phone.route('https://api.github.com/**', github)
    page = phone.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE); page.wait_for_selector('.card.accent h1')
    log_run(page, 3.1); page.wait_for_timeout(3000)
    check('sync is off until it is set up: nothing sent', remote['puts'] == 0 and remote['text'] is None)
    open_sync(page)
    check('sheet starts off, with this device set to log workouts', 'Off' in page.locator('#sync-state').inner_text() and page.locator('#sync-role button.on').get_attribute('data-role') == 'phone', page.locator('#sync-state').inner_text())
    page.fill('#sync-repo', 'training-data'); page.fill('#sync-token', 'good-token'); page.click('#sync-save'); page.wait_for_timeout(200)
    check('a repo without an owner is refused', 'owner/name' in page.locator('#sync-state').inner_text(), page.locator('#sync-state').inner_text())
    page.fill('#sync-repo', 'cam/training-data'); page.fill('#sync-token', 'wrong-token'); page.click('#sync-save')
    page.wait_for_function("document.querySelector('#sync-state').textContent.includes('token')")
    check('a bad token is explained and nothing is saved', remote['puts'] == 0 and page.evaluate("import('./js/sync.js').then(m => m.getSync())") is None, page.locator('#sync-state').inner_text())
    page.fill('#sync-repo', 'cam/public-repo'); page.fill('#sync-token', 'good-token'); page.click('#sync-save')
    page.wait_for_function("document.querySelector('#sync-state').textContent.includes('public')")
    check('a public repo is refused', remote['puts'] == 0, page.locator('#sync-state').inner_text())
    page.fill('#sync-repo', 'https://github.com/cam/training-data'); page.click('#sync-save')
    page.wait_for_function("document.querySelector('#sync-state').textContent.includes('Last upload')")
    d = remote_data()
    check('Save and test uploads the log to the private repo', remote['puts'] == 1 and d['app'] == 'CamsTrainingTracker' and len(d['runs']) == 1, remote['puts'])
    check('the uploaded file holds no token and no repo name', 'good-token' not in remote['text'] and 'training-data' not in remote['text'])
    check('commit message carries a timestamp only', remote['messages'][0].startswith('Tracker data 20'), remote['messages'])
    page.click('.modal button:has-text("Close")')

    print('Phone: automatic upload, offline retry')
    log_run(page, 4.0)
    check('a saved run uploads on its own a few seconds later', wait_until(page, lambda: remote['puts'] == 2) and len(remote_data()['runs']) == 2, remote['puts'])
    remote['offline'] = True
    log_run(page, 5.0); page.wait_for_timeout(3500)
    cfg = page.evaluate("import('./js/sync.js').then(m => m.getSync())")
    check('with no connection the upload is remembered for later', cfg['dirty'] is True and remote['puts'] == 2 and 'connection' in cfg['lastError'], cfg)
    remote['offline'] = False
    page.evaluate("window.dispatchEvent(new Event('online'))")
    check('it uploads when the connection returns', wait_until(page, lambda: remote['puts'] == 3) and len(remote_data()['runs']) == 3, remote['puts'])
    page.evaluate("b => import('./js/store.js').then(m => m.importAll(b))", BACKUP)
    check('restoring a backup on the phone uploads it too', wait_until(page, lambda: remote['puts'] == 4) and len(remote_data()['sessions']) == 2, remote['puts'])
    open_sync(page)
    check('once set up the sheet offers Sync now, the link and Turn off', page.locator('#sync-now').count() == 1 and page.locator('#sync-off').count() == 1 and 'Last upload' in page.locator('#sync-state').inner_text(), page.locator('#sync-state').inner_text())
    page.screenshot(path=os.path.join(ROOT, 'tests', 'shots', 'sync-sheet.png'))
    page.click('#sync-link'); page.wait_for_timeout(300)
    link = page.evaluate('navigator.clipboard.readText()')
    check('set-up link keeps the token out of plain sight and after the #', '#sync=' in link and 'good-token' not in link and link.startswith(BASE), link)
    page.click('.modal button:has-text("Close")')

    # ---- the computer ----
    print('Computer: opens with the link, shows the phone data, never uploads')
    desk = browser.new_context(viewport={'width': 1280, 'height': 900}, reduced_motion='reduce')
    desk.route('https://api.github.com/**', github)
    dpage = desk.new_page(); dpage.on('pageerror', lambda e: errors.append(str(e)))
    dpage.goto(link); dpage.wait_for_selector('.card.accent h1')
    check('the link is removed from the address bar after set-up', '#sync' not in dpage.url, dpage.url)
    dcfg = dpage.evaluate("import('./js/sync.js').then(m => m.getSync())")
    check('the computer is set to only view', dcfg['role'] == 'viewer' and dcfg['repo'] == 'cam/training-data', dcfg)
    dpage.click('#tabs button[data-view="progress"]'); dpage.wait_for_selector('#progress-status')
    check('Progress on the computer shows the phone sessions', dpage.locator('#progress-status .adh-row .adh-cell.done').count() == 2 and dpage.locator('.strength-card').count() == 4, [dpage.locator('#progress-status .adh-row .adh-cell.done').count(), dpage.locator('.strength-card').count()])
    check('the header says how fresh the copy is, and there is no Load backup file', 'From phone' in dpage.locator('#sync-chip-text').inner_text() and dpage.locator('#load-backup').count() == 0, dpage.locator('#sync-chip-text').inner_text())
    dpage.screenshot(path=os.path.join(ROOT, 'tests', 'shots', 'sync-computer.png'))
    before = remote['puts']
    dpage.evaluate("import('./js/store.js').then(m => m.saveSettings({ bodyweightLb: 170 }))"); dpage.wait_for_timeout(3500)
    check('a change made on the computer is never uploaded', remote['puts'] == before, remote['puts'])
    log_run(page, 6.0)
    wait_until(page, lambda: remote['puts'] == before + 1)
    dpage.click('#sync-chip'); dpage.wait_for_function("document.querySelector('#progress-status p').textContent.includes('1 run')")
    check('Refresh picks up what the phone logged since', '1 run' in dpage.locator('#progress-status p').inner_text(), dpage.locator('#progress-status p').inner_text())
    # ---- v1.9 coach file ----
    remote['coach'] = json.dumps({'updatedAt': '2026-11-19T03:00:00Z', 'messages': [{'id': 'm1', 'at': '2099-01-01T03:00:00Z', 'text': 'Strong first week. Curl goes to 50 next time.'}], 'adjustments': [{'id': 'a1', 'exerciseId': 'curl', 'weight': 50, 'reason': 'test'}, {'id': 'a2', 'sessionId': 'lift1', 'restDelta': -15}]})
    page.reload(); page.wait_for_selector('.card.accent h1'); page.wait_for_timeout(1500)
    tg = page.evaluate("import('./js/store.js').then(m => m.getTargets())")
    st = page.evaluate("import('./js/store.js').then(m => m.getSettings())")
    check('v1.9 the phone applies the coach adjustments once', tg.get('curl', {}).get('weight') == 50 and tg['curl'].get('source') == 'coach' and st.get('restAdjust', {}).get('session:lift1') == -15, [tg.get('curl'), st.get('restAdjust')])
    page.evaluate("import('./js/store.js').then(m => m.setTarget('curl', { weight: 45, source: 'you' }))")
    page.reload(); page.wait_for_selector('.card.accent h1'); page.wait_for_timeout(1500)
    tg = page.evaluate("import('./js/store.js').then(m => m.getTargets())")
    check('v1.9 an applied adjustment is not applied again', tg['curl']['weight'] == 45, tg.get('curl'))
    dpage.click('#sync-chip'); dpage.wait_for_timeout(1500)
    dpage.click('#tabs button[data-view="plan"]'); dpage.wait_for_selector('#checkin')
    check('v1.9 the computer shows the coach reply and has no box to write in', 'Strong first week' in dpage.locator('.msg.coach').inner_text() and dpage.locator('#checkin-send').count() == 0, dpage.locator('#checkin').inner_text()[:200])
    dtg = dpage.evaluate("import('./js/store.js').then(m => m.getTargets())")
    check('v1.9 the computer never applies coach adjustments itself', (dtg.get('curl') or {}).get('source') != 'coach' or (dtg.get('curl') or {}).get('weight') == 45, dtg.get('curl'))
    dpage.reload(); dpage.wait_for_selector('.card.accent h1'); dpage.click('#tabs button[data-view="runs"]'); dpage.wait_for_selector('h1:has-text("Runs")'); dpage.wait_for_selector('.run-item')
    check('after a reload the computer still has the data', dpage.locator('.run-item').count() == 1, dpage.locator('.run-item').count())

    # ---- a new, empty phone ----
    print('New phone: loads the copy instead of wiping it')
    phone2 = browser.new_context(viewport={'width': 393, 'height': 851}, reduced_motion='reduce', is_mobile=True, has_touch=True)
    phone2.route('https://api.github.com/**', github)
    p2 = phone2.new_page(); p2.on('pageerror', lambda e: errors.append(str(e)))
    p2.goto(BASE); p2.wait_for_selector('.card.accent h1')
    before = remote['puts']
    open_sync(p2); p2.fill('#sync-repo', 'cam/training-data'); p2.fill('#sync-token', 'good-token'); p2.click('#sync-save')
    p2.wait_for_function("document.querySelector('#sync-state').textContent.includes('loaded')")
    n = p2.evaluate("import('./js/store.js').then(async m => [(await m.getSessions()).length, (await m.getRuns()).length])")
    check('an empty phone loads the copy from GitHub and uploads nothing', remote['puts'] == before and n == [2, 1] and len(remote_data()['sessions']) == 2, [remote['puts'], n])
    p2.click('#sync-off'); p2.click('.modal button:has-text("Turn off")'); p2.wait_for_selector('#sync-save')
    check('Turn off removes the repo and token from the device', p2.evaluate("import('./js/sync.js').then(m => m.getSync())") is None)

    check('no page errors', not errors, errors[:5])
    browser.close()

server.terminate()
print('\n' + (f'{len(fails)} FAILED: {fails}' if fails else 'All sync checks passed'))
sys.exit(1 if fails else 0)
