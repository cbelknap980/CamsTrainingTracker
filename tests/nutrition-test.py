# nutrition-test.py - v1.20, Cameron (Nov 25): "a very simple nutrition tracking app to mainly focus on protein intake
# for now... little buttons... for things that I consistently eat", goal 160 g, protein only, chicken and turkey as one
# serving of a 1 lb pack. The Nutrition tab: one tap adds a serving with Undo, the day's list (change how much, delete),
# Other, Edit buttons, the goal, earlier days, the last 7 days, the Home line, numbers that look wrong held for a look,
# backup and sync, and a computer that only views. v1.20.1: protein is the fourth ring on Home's week card, the
# buttons are just the food and its grams, and the computer shows the buttons greyed.
# Denver time, made-up data. Run: python3 tests/nutrition-test.py   (serves the repo on :8097)
# SHOTS=dir to keep screenshots (2x, for Cameron).
import os, subprocess, sys, time, datetime
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8097
BASE = f'http://localhost:{PORT}/'
SHOTS = os.environ.get('SHOTS')
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

def entry(i, food, name, g, qty, unit, units, date, at, servings=1):
    return {'id': f'f{i}', 'date': date, 'at': at, 'foodId': food, 'name': name, 'g': g, 'qty': qty, 'unit': unit, 'units': units, 'servings': servings}

LOG = [
    entry(1, 'whey', 'Gold Standard whey', 24, 1, 'scoop', 'scoops', '2026-11-24', '2026-11-24T15:00:00.000Z', 2),
    entry(2, 'chicken', 'Chicken', 50, 0.5, 'lb', 'lb', '2026-11-24', '2026-11-24T19:00:00.000Z', 2),
    entry(3, 'oikos', 'Oikos Triple Zero', 15, 1, 'cup', 'cups', '2026-11-23', '2026-11-23T19:00:00.000Z'),
    entry(4, 'oikos', 'Oikos Triple Zero', 15, 1, 'cup', 'cups', '2026-11-25', '2026-11-25T14:30:00.000Z'),
    entry(5, 'canned_chicken', 'Canned chicken', 50, 1, 'can', 'cans', '2026-11-25', '2026-11-25T18:10:00.000Z'),
]
DATA = {'app': 'CamsTrainingTracker', 'appVersion': '1.18.16', 'pairTotals': 'none',
        'settings': {'startDate': '2026-11-16', 'bodyweightLb': 165}, 'targets': {}, 'sessions': [], 'runs': [], 'foodLog': LOG}
NOW = '2026-11-25T15:20:00-07:00'

def open_app(browser, errors, size=None, scale=1, viewer=False, data=DATA):
    phone = size is None
    ctx = browser.new_context(viewport=size or {'width': 393, 'height': 851}, reduced_motion='reduce', device_scale_factor=scale, is_mobile=phone, has_touch=phone, timezone_id='America/Denver')
    ctx.route('https://api.github.com/**', lambda r: r.abort())
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.clock.install(time=datetime.datetime.fromisoformat(NOW))
    pg.goto(BASE); pg.wait_for_selector('#view')
    pg.evaluate("b => import('./js/store.js').then(m => m.importAll(b))", data)
    if viewer: pg.evaluate("import('./js/sync.js').then(m => m.saveSync({ repo: 'cam/training-data', token: 'x', role: 'viewer', lastPulledExport: null }))")
    pg.reload(); pg.wait_for_timeout(700)
    pg.evaluate("() => import('./js/ui.js').then(m => m.hideToast())")
    return ctx, pg

total = lambda pg: int(pg.inner_text('#nut-total'))
hide_toast = lambda pg: pg.evaluate("() => import('./js/ui.js').then(m => m.hideToast())")
def shot(pg, name, full=False):
    if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=f'{SHOTS}/{name}.png', full_page=full)

try:
  with sync_playwright() as p:
    chrome = os.environ.get('CHROME_PATH') or next((c for c in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium') if os.path.exists(c)), None)
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])

    print('Phone, Wednesday Nov 25 at 3:20 pm (an Oikos and a can of chicken logged today)')
    errors = []
    ctx, pg = open_app(browser, errors, scale=2 if SHOTS else 1)
    tabs = pg.evaluate("[...document.querySelectorAll('#tabs .tab')].filter(t => t.offsetParent).map(t => t.dataset.view)")
    check('the tab bar has five tabs, Nutrition last', tabs == ['home', 'progress', 'plan', 'runs', 'nutrition'], tabs)
    clipped = pg.evaluate("[...document.querySelectorAll('#tabs .tab')].filter(t => t.offsetParent && t.scrollWidth > t.clientWidth + 1).length")
    check('no tab label is cut off', clipped == 0, clipped)
    # v1.20.1: in weeks 1 to 12 protein is the fourth ring on the Week so far card (Cameron: "I don't see nutrition added here")
    labels = [x.strip() for x in pg.locator('#week-rings .wk-ring-label').all_inner_texts()]
    check('the week card has four rings, Protein today last', labels == ['Lifts', 'Runs', 'Hard efforts', 'Protein today'], labels)
    ring = pg.inner_text('#week-rings [data-ring="protein"] .wk-ring-num').replace('\n', '').replace(' ', '')
    check('...it reads 65/160', ring == '65/160', ring)
    check('...and the separate Protein today line is gone', pg.locator('#nut-home').count() == 0)
    fit = pg.evaluate("[...document.querySelectorAll('#week-rings .ring-btn')].map(b => [Math.round(b.getBoundingClientRect().width), b.scrollWidth > b.clientWidth + 1, b.querySelector('.wk-ring-num').scrollWidth > b.querySelector('.wk-ring-wrap').clientWidth + 1])")
    check('...the four rings fit side by side, nothing cut off', all(w >= 70 and not a and not b for w, a, b in fit), fit)
    shot(pg, '1-home-protein-ring')
    pg.click('#week-rings [data-ring="protein"]'); pg.wait_for_timeout(400)
    check('tapping the ring opens the Nutrition tab', pg.locator('#nut-top').count() == 1 and pg.locator('#tabs .tab.active').get_attribute('data-view') == 'nutrition')
    check('today: 65 g of 160 g, 95 g to go', total(pg) == 65 and pg.inner_text('#nut-goal') == 'of 160 g protein' and pg.inner_text('#nut-left') == '95 g to go', [total(pg), pg.inner_text('#nut-left')])
    check('today\'s heading', pg.inner_text('#nut-date').startswith('Today, Wed, Nov 25'), pg.inner_text('#nut-date'))
    names = pg.evaluate("[...document.querySelectorAll('#nut-grid .nut-food[data-food]')].map(b => b.dataset.food)")
    check('his ten buttons in order, then Other', names == ['whey', 'chicken', 'turkey', 'canned_chicken', 'oikos', 'pure_protein', 'think_bar', 'fitcrunch', 'chomps', 'rice'] and pg.locator('#nut-other').count() == 1, names)
    check('the card says Add food, with Edit', pg.inner_text('#nut-add h3') == 'Add food' and pg.inner_text('#nut-edit') == 'Edit', pg.inner_text('#nut-add h3'))
    wb = pg.inner_text('[data-food="whey"]').replace('\n', ' ')
    check('a button is the food and its grams: Gold Standard whey +24 g', wb == 'Gold Standard whey +24 g', wb)
    ck = pg.inner_text('[data-food="chicken"]').replace('\n', ' ')
    check('chicken shows its amount, ½ lb a tap, and no est.', ck == 'Chicken +50 g ½ lb', ck)
    check('no est. anywhere on the buttons', 'est.' not in pg.inner_text('#nut-add'), pg.inner_text('#nut-add'))
    sizes = pg.evaluate("[...document.querySelectorAll('#nut-grid .nut-food')].map(b => [Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height)])")
    check('buttons are thumb-sized (at least 100 x 72 px)', all(w >= 100 and h >= 72 for w, h in sizes), sizes)
    rows = pg.evaluate("[...document.querySelectorAll('#nut-list .nut-row')].map(r => r.innerText.replace(/\\n/g, ' '))")
    check('today\'s list, newest first, with times', rows == ['11:10 am Canned chicken 1 can 50 g', '7:30 am Oikos Triple Zero 1 cup 15 g'], rows)

    pg.click('[data-food="whey"]'); pg.wait_for_timeout(300)
    check('one tap adds a scoop: 89 g, 71 g to go', total(pg) == 89 and pg.inner_text('#nut-left') == '71 g to go', total(pg))
    check('...with a toast that has Undo', 'Gold Standard whey +24 g' in pg.inner_text('#toast') and pg.locator('#toast-action').is_visible(), pg.inner_text('#toast'))
    pg.click('#toast-action'); pg.wait_for_timeout(300)
    check('Undo takes it back off (65)', total(pg) == 65, total(pg))
    pg.click('[data-food="whey"]'); pg.wait_for_timeout(250)
    pg.click('[data-food="whey"]'); pg.wait_for_timeout(250)
    check('the same food twice inside a minute says so (a double tap?)', 'added twice in a minute' in pg.inner_text('#toast') and total(pg) == 113, [pg.inner_text('#toast'), total(pg)])
    pg.click('#toast-action'); pg.wait_for_timeout(300)
    check('...and Undo removes just the second one (89)', total(pg) == 89, total(pg))
    hide_toast(pg)
    shot(pg, '2-nutrition-tab')
    if SHOTS: shot(pg, '2b-nutrition-tab-full', full=True)

    print('Change how much, delete, numbers that look wrong')
    pg.click('#nut-list .nut-row[data-entry="f5"]'); pg.wait_for_timeout(300)
    amts = pg.evaluate("[...document.querySelectorAll('#nut-amounts button')].map(b => b.innerText)")
    check('a line opens how much: ½ can to 3 cans', amts == ['½ can', '1 can', '1½ cans', '2 cans', '3 cans'], amts)
    pg.click('#nut-amounts button[data-s="0.5"]')
    check('...the sum says ½ can · 25 g', pg.inner_text('#nut-entry-sum') == '½ can · 25 g protein', pg.inner_text('#nut-entry-sum'))
    shot(pg, '3-how-much')
    pg.click('#nut-entry-save'); pg.wait_for_timeout(300)
    check('half a can saves: 89 - 25 = 64', total(pg) == 64, total(pg))
    pg.click('#nut-list .nut-row[data-entry="f5"]'); pg.wait_for_timeout(300)
    pg.click('#nut-amounts button[data-s="3"]'); pg.click('#nut-entry-save'); pg.wait_for_timeout(200)
    msg = pg.inner_text('#nut-entry-msg')
    check('3 cans (150 g at once) is held: a lot in one go, Save anyway', pg.locator('#nut-entry-msg').is_visible() and '150 g in one go' in msg and pg.inner_text('#nut-entry-save') == 'Save anyway' and total(pg) == 64, msg)
    pg.click('#nut-amounts button[data-s="1"]'); pg.click('#nut-entry-save'); pg.wait_for_timeout(300)
    check('picking 1 can clears the hold and saves (89)', total(pg) == 89, total(pg))
    pg.click('#nut-list .nut-row[data-entry="f4"]'); pg.wait_for_timeout(300)
    pg.click('#nut-entry-delete'); pg.wait_for_timeout(300)
    check('Delete takes the Oikos off (74), with Undo', total(pg) == 74 and 'deleted' in pg.inner_text('#toast'), total(pg))
    pg.click('#toast-action'); pg.wait_for_timeout(300)
    check('Undo puts it back (89)', total(pg) == 89, total(pg))
    hide_toast(pg)

    print('Other, and making it a button')
    pg.click('#nut-other'); pg.wait_for_timeout(300)
    pg.fill('#nut-other-g', '0'); pg.click('#nut-other-add'); pg.wait_for_timeout(150)
    check('0 g is refused', pg.locator('#nut-other-msg').is_visible() and 'more than 0' in pg.inner_text('#nut-other-msg') and total(pg) == 89)
    pg.fill('#nut-other-g', '450'); pg.click('#nut-other-add'); pg.wait_for_timeout(150)
    check('450 g is refused (can\'t be right)', "can't be right" in pg.inner_text('#nut-other-msg') and total(pg) == 89, pg.inner_text('#nut-other-msg'))
    pg.fill('#nut-other-g', '19'); pg.fill('#nut-other-name', 'Eggs'); pg.check('#nut-other-keep')
    shot(pg, '4-other')
    pg.click('#nut-other-add'); pg.wait_for_timeout(400)
    check('Eggs 19 g added (108)', total(pg) == 108, total(pg))
    check('...and Eggs is a button now', pg.locator('#nut-grid [data-food="eggs"]').count() == 1 and '+19 g' in pg.inner_text('[data-food="eggs"]'))
    hide_toast(pg)

    print('Edit buttons')
    pg.click('#nut-edit'); pg.wait_for_timeout(300)
    check('the list shows every button with its grams', pg.locator('#nut-foods .nut-foods-row').count() == 11, pg.locator('#nut-foods .nut-foods-row').count())
    check('...estimates say to check the label there', 'estimate, check the label' in pg.inner_text('#nut-foods .nut-foods-row[data-food="chicken"]'), pg.inner_text('#nut-foods .nut-foods-row[data-food="chicken"]'))
    pg.click('#nut-foods .nut-foods-row[data-food="canned_chicken"]'); pg.wait_for_timeout(300)
    check('an estimate shows how to check it', 'Check the can' in pg.inner_text('#nut-food'), pg.inner_text('#nut-food'))
    pg.fill('#nut-food-g', '95'); pg.click('#nut-food-save'); pg.wait_for_timeout(200)
    check('95 g in one serving is held (Save anyway)', pg.inner_text('#nut-food-save') == 'Save anyway' and '95 g in one serving' in pg.inner_text('#nut-food-msg'))
    pg.fill('#nut-food-g', '54')
    shot(pg, '5-edit-button')
    pg.click('#nut-food-save'); pg.wait_for_timeout(400)
    check('saving 54 g updates today\'s can too (108 - 50 + 54 = 112)', total(pg) == 112 and "Today's entry uses it too" in pg.inner_text('#toast'), [total(pg), pg.inner_text('#toast')])
    pg.evaluate("() => import('./js/ui.js').then(m => m.closeModal())"); pg.wait_for_timeout(200)
    cc = pg.inner_text('[data-food="canned_chicken"]').replace('\n', ' ')
    check('the button now reads +54 g', cc == 'Canned chicken +54 g', cc)
    old = pg.evaluate("import('./js/store.js').then(m => m.getFoodLog()).then(l => l.find(e => e.id === 'f2').g)")
    check('older days keep what they were logged with', old == 50, old)
    hide_toast(pg)

    print('The goal, earlier days, the last 7 days')
    pg.click('#nut-goal'); pg.wait_for_timeout(300)
    pg.fill('#nut-goal-g', '20'); pg.click('#nut-goal-save'); pg.wait_for_timeout(150)
    check('a goal of 20 g is refused', pg.locator('#nut-goal-msg').is_visible())
    pg.fill('#nut-goal-g', '170'); pg.click('#nut-goal-save'); pg.wait_for_timeout(300)
    check('goal 170 saves', pg.inner_text('#nut-goal') == 'of 170 g protein' and pg.inner_text('#nut-left') == '58 g to go', pg.inner_text('#nut-left'))
    pg.click('#nut-goal'); pg.fill('#nut-goal-g', '160'); pg.click('#nut-goal-save'); pg.wait_for_timeout(300)
    hide_toast(pg)
    cols = pg.evaluate("[...document.querySelectorAll('.nut-daycol')].map(c => [c.dataset.date, c.querySelector('.nut-daynum').innerText])")
    check('last 7 days: Nov 19 to 25, totals on the days logged', cols[0] == ['2026-11-19', '–'] and cols[4] == ['2026-11-23', '15'] and cols[5] == ['2026-11-24', '148'] and cols[6] == ['2026-11-25', '112'], cols)
    check('summary: hit 160 g on 0 of the 3 days logged', pg.inner_text('#nut-week-sum') == 'Hit 160 g on 0 of the 3 days you logged.', pg.inner_text('#nut-week-sum'))
    pg.click('#nut-prev'); pg.wait_for_timeout(300)
    check('the arrow goes to yesterday: 148 g', pg.inner_text('#nut-date').startswith('Yesterday, Tue, Nov 24') and total(pg) == 148, [pg.inner_text('#nut-date'), total(pg)])
    check('...the add card says Add to Tue, Nov 24 and there is a way back', 'Add to Tue, Nov 24' in pg.inner_text('#nut-add') and pg.locator('#nut-today').count() == 1)
    pg.click('[data-food="chomps"]'); pg.wait_for_timeout(300)
    check('a tap there fills in yesterday (158), marked added later', total(pg) == 158 and 'added later' in pg.inner_text('#nut-list'), total(pg))
    check('...the toast names the day', 'on Tue, Nov 24' in pg.inner_text('#toast'), pg.inner_text('#toast'))
    hide_toast(pg)
    pg.click('#nut-today'); pg.wait_for_timeout(300)
    check('Back to today', pg.inner_text('#nut-date').startswith('Today') and total(pg) == 112)
    pg.click('.nut-daycol[data-date="2026-11-23"]'); pg.wait_for_timeout(300)
    check('tapping a day in the strip opens it (Mon: 15 g)', total(pg) == 15 and pg.locator('.nut-daycol.on').get_attribute('data-date') == '2026-11-23')
    pg.click('#nut-today'); pg.wait_for_timeout(300)
    check('there is no next arrow on today', pg.locator('#nut-next').count() == 0)

    print('Backup and sync carry it')
    b = pg.evaluate("import('./js/store.js').then(m => m.exportAll('1.20.0', 'x'))")
    check('the backup has the food log and his buttons', len(b['foodLog']) == 8 and any(f['id'] == 'eggs' for f in b['foods']), [len(b['foodLog']), b['foods'] and len(b['foods'])])
    pg.click('button[data-view="home"]'); pg.wait_for_timeout(400)
    ring = pg.inner_text('#week-rings [data-ring="protein"] .wk-ring-num').replace('\n', '').replace(' ', '')
    check('the Home ring now says 112/160', ring == '112/160', ring)
    narrow_errors = []
    ctx.close()

    print('Phone 360 px wide (no sideways scroll)')
    ctx, pg = open_app(browser, narrow_errors, size=None)
    pg.set_viewport_size({'width': 360, 'height': 698})
    pg.click('button[data-view="nutrition"]'); pg.wait_for_timeout(400)
    sw = pg.evaluate("document.scrollingElement.scrollWidth")
    check('the tab fits 360 px', sw <= 360, sw)
    first = pg.evaluate("Math.round(document.querySelector('#nut-grid').getBoundingClientRect().top)")
    check('the first row of buttons is on the first screen', first < 420, first)
    ctx.close()

    print('Before week 1 (no week rings): the one-line Protein today card')
    ctx, pg = open_app(browser, narrow_errors, data={**DATA, 'settings': {'startDate': '2026-12-07', 'bodyweightLb': 165}})
    home = pg.inner_text('#nut-home').replace('\n', ' ') if pg.locator('#nut-home').count() else ''
    check('Home has the Protein today line: 65 / 160 g, right under the today card', 'Protein today' in home and '65 / 160 g' in home and pg.evaluate("document.querySelector('#today-card').nextElementSibling.id") == 'nut-home', home)
    check('...and no rings', pg.locator('#week-rings').count() == 0)
    ctx.close()

    print('Computer set to Only views')
    ctx, pg = open_app(browser, errors, size={'width': 1366, 'height': 768}, viewer=True, data={**DATA, 'foods': None}, scale=2 if SHOTS else 1)
    labels = [x.strip() for x in pg.locator('#week-rings .wk-ring-label').all_inner_texts()]
    check('the computer\'s week card has the Protein today ring too', labels[-1:] == ['Protein today'] and '65' in pg.inner_text('#week-rings [data-ring="protein"]'), labels)
    shot(pg, '6-computer-home')
    pg.click('#week-rings [data-ring="protein"]'); pg.wait_for_timeout(400)
    check('the numbers show (65 g)', total(pg) == 65, total(pg))
    btns = pg.evaluate("[...document.querySelectorAll('#nut-grid .nut-food')].map(b => [b.dataset.food, b.disabled])")
    check('his foods show, greyed: the ten buttons, all disabled, no Other', len(btns) == 10 and all(d for _, d in btns) and pg.locator('#nut-other').count() == 0, btns)
    check('...under Your foods, with a note to tap them on the phone', pg.inner_text('#nut-add h3') == 'Your foods' and 'Tap these on your phone' in pg.inner_text('#nut-viewonly') and pg.locator('#nut-edit').count() == 0, pg.inner_text('#nut-add'))
    pg.click('[data-food="whey"]', force=True); pg.wait_for_timeout(300)
    check('...a click adds nothing (still 65)', total(pg) == 65, total(pg))
    shot(pg, '7-computer-nutrition')
    check('...no goal button either', pg.locator('button#nut-goal').count() == 0)
    check('...lines do not open', pg.locator('#nut-list .nut-row.tappable').count() == 0)
    ctx.close()

    check('no page errors', not errors and not narrow_errors, errors + narrow_errors)
    browser.close()
finally:
  server.terminate()
print(f'\n{len(fails)} FAILED' if fails else '\nAll nutrition checks passed')
sys.exit(1 if fails else 0)
