# food-sync-test.py - v1.20.2, Cameron (Nov 25): "I should be able to tap these on my phone or computer."
# A computer set to Only views logs food: it saves the change on itself and adds a step to food-from-computer.json in
# the private repo; the phone applies the steps when it opens, uploads, and takes them out. End to end against a
# stand-in for the GitHub API (no real network, no real token). Denver time, made-up data.
# Run: python3 tests/food-sync-test.py   (serves the repo on :8098)   SHOTS=dir keeps screenshots (2x).
import base64, json, os, subprocess, sys, time, datetime
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8098
BASE = f'http://localhost:{PORT}/'
SHOTS = os.environ.get('SHOTS')
INBOX = 'food-from-computer.json'
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

# ---- the stand-in for GitHub: one private repo, any number of files, writes checked against the sha ----
repo = {'files': {}, 'sha': 0, 'offline': False, 'conflict_once': None, 'puts': []}
def github(route):
    req = route.request
    if repo['offline']: return route.abort()
    path = req.url.split('api.github.com')[1].split('?')[0]
    def send(status, body): route.fulfill(status=status, content_type='application/json', body=body if isinstance(body, str) else json.dumps(body), headers={'access-control-allow-origin': '*'})
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'})
    if req.headers.get('authorization') != 'Bearer good-token': return send(401, {'message': 'Bad credentials'})
    if path == '/repos/cam/training-data': return send(200, {'private': True, 'permissions': {'push': True}})
    pre = '/repos/cam/training-data/contents/'
    if not path.startswith(pre): return send(404, {'message': 'Not Found'})
    name = path[len(pre):]
    f = repo['files'].get(name)
    if req.method == 'GET':
        if f is None: return send(404, {'message': 'Not Found'})
        if 'raw' in req.headers.get('accept', ''): return send(200, f['text'])
        return send(200, {'sha': f['sha'], 'content': base64.encodebytes(f['text'].encode()).decode()})
    if req.method == 'PUT':
        body = json.loads(req.post_data)
        if repo['conflict_once'] == name:
            repo['conflict_once'] = None
            return send(409, {'message': 'is at a newer sha'})
        if f is not None and body.get('sha') != f['sha']: return send(409, {'message': 'sha mismatch'})
        if f is None and body.get('sha'): return send(422, {'message': 'sha given for a new file'})
        repo['sha'] += 1
        repo['files'][name] = {'text': base64.b64decode(body['content']).decode(), 'sha': f'sha{repo["sha"]}'}
        repo['puts'].append(name)
        return send(200, {'content': {'sha': f'sha{repo["sha"]}'}})
    send(405, {})
def file_json(name):
    f = repo['files'].get(name)
    return json.loads(f['text']) if f else None
def inbox_ops(): return (file_json(INBOX) or {}).get('ops', [])

def entry(i, food, name, g, qty, unit, units, date, at, servings=1):
    return {'id': f'f{i}', 'date': date, 'at': at, 'foodId': food, 'name': name, 'g': g, 'qty': qty, 'unit': unit, 'units': units, 'servings': servings}
LOG = [
    entry(4, 'oikos', 'Oikos Triple Zero', 15, 1, 'cup', 'cups', '2026-11-25', '2026-11-25T14:30:00.000Z'),
    entry(5, 'canned_chicken', 'Canned chicken', 50, 1, 'can', 'cans', '2026-11-25', '2026-11-25T18:10:00.000Z'),
]
DATA = {'app': 'CamsTrainingTracker', 'appVersion': '1.20.1', 'exportedAt': '2026-11-25T22:00:00.000Z', 'pairTotals': 'none',
        'settings': {'startDate': '2026-11-16', 'bodyweightLb': 165}, 'targets': {}, 'sessions': [], 'runs': [], 'foodLog': LOG}
NOW = '2026-11-25T16:50:00-07:00'

def open_device(browser, errors, role, size, seed=None, scale=1):
    phone = role == 'phone'
    ctx = browser.new_context(viewport=size, reduced_motion='reduce', device_scale_factor=scale, is_mobile=phone, has_touch=phone, timezone_id='America/Denver')
    ctx.route('https://api.github.com/**', github)
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.clock.install(time=datetime.datetime.fromisoformat(NOW))
    pg.goto(BASE); pg.wait_for_selector('#view')
    if seed: pg.evaluate("b => import('./js/store.js').then(m => m.importAll(b))", seed)
    pg.evaluate("r => import('./js/sync.js').then(m => m.saveSync({ repo: 'cam/training-data', token: 'good-token', role: r, lastPulledExport: null }))", role)
    pg.reload(); pg.wait_for_timeout(900)
    pg.evaluate("() => import('./js/ui.js').then(m => m.hideToast())")
    return ctx, pg

def wait_until(pg, fn, seconds=8):
    end = time.time() + seconds
    while time.time() < end:
        if fn(): return True
        pg.wait_for_timeout(150)
    return fn()
total = lambda pg: int(pg.inner_text('#nut-total'))
def nutrition(pg):
    pg.click('button[data-view="nutrition"]'); pg.wait_for_timeout(400)
def shot(pg, name):
    if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=f'{SHOTS}/{name}.png')
def hide_toast(pg): pg.evaluate("() => import('./js/ui.js').then(m => m.hideToast())")

try:
  with sync_playwright() as p:
    chrome = os.environ.get('CHROME_PATH') or next((c for c in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium') if os.path.exists(c)), None)
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    errors = []

    print('The phone uploads its copy (an Oikos and a can of chicken today, 65 g)')
    pctx, phone = open_device(browser, errors, 'phone', {'width': 393, 'height': 851}, seed=DATA)
    phone.evaluate("() => import('./js/sync.js').then(m => m.pushNow('1.20.2', 'test'))")
    check('the phone\'s file is in the repo with its food', len((file_json('tracker-data.json') or {}).get('foodLog', [])) == 2)

    print('The computer (Only views) logs food')
    cctx, desk = open_device(browser, errors, 'viewer', {'width': 1366, 'height': 768}, scale=2 if SHOTS else 1)
    nutrition(desk)
    check('the computer shows the phone\'s 65 g', total(desk) == 65, total(desk))
    btns = desk.evaluate("[...document.querySelectorAll('#nut-grid .nut-food')].map(b => [b.dataset.food || b.id, b.disabled])")
    check('the computer has live buttons (ten foods and Other, none greyed)', len(btns) == 11 and not any(d for _, d in btns), btns)
    check('...but no Edit and no goal button (those stay on the phone)', desk.locator('#nut-edit').count() == 0 and desk.locator('button#nut-goal').count() == 0)
    check('...and a line saying where the taps go', 'shows on your phone the next time' in desk.inner_text('#nut-remote'), desk.inner_text('#nut-remote'))
    desk.click('[data-food="whey"]'); desk.wait_for_timeout(300)
    check('a click adds a scoop on the computer: 89 g', total(desk) == 89, total(desk))
    check('...and the step lands in the repo', wait_until(desk, lambda: len(inbox_ops()) == 1) and inbox_ops()[0]['type'] == 'add' and inbox_ops()[0]['entry']['g'] == 24, inbox_ops())
    check('...the phone\'s own file is untouched', 'tracker-data.json' not in repo['puts'][1:], repo['puts'])
    hide_toast(desk)
    desk.click('#nut-list .nut-row[data-entry="f5"]'); desk.wait_for_timeout(300)
    desk.click('#nut-amounts button[data-s="0.5"]'); desk.click('#nut-entry-save'); desk.wait_for_timeout(300)
    desk.click('#nut-list .nut-row[data-entry="f4"]'); desk.wait_for_timeout(300)
    desk.click('#nut-entry-delete'); desk.wait_for_timeout(300)
    hide_toast(desk)
    check('half a can and the Oikos deleted: 65 + 24 - 25 - 15 = 49', total(desk) == 49, total(desk))
    check('three steps in the repo: add, change, delete', wait_until(desk, lambda: [o['type'] for o in inbox_ops()] == ['add', 'set', 'remove']), [o['type'] for o in inbox_ops()])
    shot(desk, 'computer-logs-food')
    desk.reload(); desk.wait_for_timeout(900); nutrition(desk)
    check('a reload of the computer keeps them (49, one whey)', total(desk) == 49 and desk.locator('#nut-list .nut-row').count() == 2, total(desk))

    print('The phone opens and takes them in')
    phone.reload(); phone.wait_for_timeout(1200)
    check('the phone says what came from the computer', 'Food from your computer: 1 added, 1 changed, 1 deleted' in phone.inner_text('#toast'), phone.inner_text('#toast'))
    ring = phone.inner_text('#week-rings [data-ring="protein"] .wk-ring-num').replace('\n', '').replace(' ', '')
    check('the phone\'s Home ring shows 49/160', ring == '49/160', ring)
    check('the phone uploads, then takes the steps out of the computer\'s file', wait_until(phone, lambda: len((file_json('tracker-data.json') or {}).get('foodLog', [])) == 2 and inbox_ops() == [], 10), [len((file_json('tracker-data.json') or {}).get('foodLog', [])), inbox_ops()])
    nutrition(phone)
    check('the phone\'s tab: 49 g, whey from the computer in the list', total(phone) == 49 and 'Gold Standard whey' in phone.inner_text('#nut-list'), total(phone))
    phone.reload(); phone.wait_for_timeout(1000)
    phone.evaluate("() => import('./js/sync.js').then(m => m.pullFoodInbox())")
    nutrition(phone)
    check('opening again adds nothing twice (49)', total(phone) == 49, total(phone))

    print('Back on the computer')
    desk.click('#sync-chip'); desk.wait_for_timeout(1200); nutrition(desk)
    check('the computer loads the phone\'s new copy: 49 g, no doubles', total(desk) == 49 and desk.locator('#nut-list .nut-row').count() == 2, [total(desk), desk.locator('#nut-list .nut-row').count()])
    whey_id = phone.evaluate("import('./js/store.js').then(m => m.getFoodLog()).then(l => l.find(e => e.foodId === 'whey').id)")
    phone.evaluate("id => import('./js/store.js').then(m => m.getFoodLog().then(l => m.setFoodLog(l.filter(e => e.id !== id))))", whey_id)
    check('the phone deletes the computer\'s whey and uploads (25 g)', wait_until(phone, lambda: len((file_json('tracker-data.json') or {}).get('foodLog', [])) == 1, 8))
    desk.click('#sync-chip'); desk.wait_for_timeout(1200); nutrition(desk)
    check('the computer follows: 25 g (the whey does not come back)', total(desk) == 25, total(desk))

    print('No signal on the computer')
    repo['offline'] = True
    hide_toast(desk)
    desk.click('[data-food="chomps"]'); desk.wait_for_timeout(300)
    check('a click still counts on the computer (35 g)', total(desk) == 35, total(desk))
    check('...and it says the change is waiting to send', wait_until(desk, lambda: 'waiting to send' in desk.inner_text('#nut-remote')), desk.inner_text('#nut-remote'))
    shot(desk, 'computer-offline')
    repo['offline'] = False
    repo['conflict_once'] = INBOX
    desk.evaluate("() => window.dispatchEvent(new Event('online'))")
    check('back online it sends, even past a write that crossed (409, read again)', wait_until(desk, lambda: [o['type'] for o in inbox_ops()] == ['add'] and inbox_ops()[0]['entry']['foodId'] == 'chomps'), inbox_ops())
    check('...and the waiting line goes back to normal by itself', wait_until(desk, lambda: 'shows on your phone the next time' in desk.inner_text('#nut-remote')), desk.inner_text('#nut-remote'))
    phone.reload(); phone.wait_for_timeout(1200); nutrition(phone)
    check('the phone gets the Chomps: 35 g', total(phone) == 35, total(phone))

    print('A step with a number that cannot be right')
    repo['files'][INBOX] = {'text': json.dumps({'ops': [{'id': 'bad1', 'type': 'add', 'entry': {'id': 'x', 'date': '2026-11-25', 'at': '2026-11-25T23:00:00Z', 'g': 900, 'servings': 1, 'name': 'Typo'}}]}), 'sha': 'shaX'}
    r = phone.evaluate("() => import('./js/sync.js').then(m => m.pullFoodInbox())")
    nutrition(phone)
    check('900 g from the computer is left out on the phone (still 35)', total(phone) == 35 and r.get('bad') == 1, [total(phone), r])

    pctx.close(); cctx.close()
    check('no page errors', not errors, errors)
    browser.close()
finally:
  server.terminate()
print(f'\n{len(fails)} FAILED' if fails else '\nAll food sync checks passed')
sys.exit(1 if fails else 0)
