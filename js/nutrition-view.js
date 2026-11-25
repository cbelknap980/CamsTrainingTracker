// nutrition-view.js - v1.20 the Nutrition tab and its Home line. Protein only for now (Cameron, Nov 25: "very simple
// and intuitive to use with a simple user interface... little buttons... to easily add things that I consistently
// eat"). One tap on a food adds one serving, with Undo; today's list below (tap a line to change how much, swipe to
// delete); the last 7 days at the bottom. The goal is settings.proteinGoalG (160 g). Numbers come from
// js/nutrition.js and the starting buttons from data/foods.json. A computer set to Only views shows the numbers
// without the buttons.

import { toISODate, fmtDate, fmtTime } from './data.js';
import { getFoodLog, setFoodLog, getFoods, setFoods, getSettings, saveSettings, newId } from './store.js';
import { entryG, dayEntries, dayTotal, lastDays, addDays, amountText, makeEntry, checkProtein, checkFood, recentRepeat, applyFoodEdit, foodsList, foodId, progressOf } from './nutrition.js';
import { el, toast, showModal, closeModal, haptic, infoBtn, swipeToDelete, confirmDialog } from './ui.js';
import { icon } from './icons.js';

const noonOf = date => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d, 12).toISOString(); };
const dayLabel = (date, today) => (date === today ? `Today, ${fmtDate(date)}` : date === addDays(today, -1) ? `Yesterday, ${fmtDate(date)}` : fmtDate(date));

/** The Nutrition tab. ctx: { foodsData (data/foods.json), canWrite, date (optional, 'YYYY-MM-DD') }. */
export async function renderNutritionTab(view, ctx) {
  const today = toISODate(new Date());
  const date = ctx.date && ctx.date <= today ? ctx.date : today;
  const settings = await getSettings();
  const goal = Number(settings.proteinGoalG) || 160;
  const log = await getFoodLog();
  const foods = foodsList(await getFoods(), ctx.foodsData);
  const check = ctx.foodsData.check;
  const amounts = ctx.foodsData.amounts || [0.5, 1, 1.5, 2, 3];
  const canWrite = ctx.canWrite !== false;
  // a change on the same day keeps the page where it was; another day starts at the top
  const again = (d = date) => renderNutritionTab(view, { ...ctx, date: d, keepScroll: d === date });
  const y = window.scrollY;
  view.innerHTML = '';

  // ---- today's number ----
  const total = dayTotal(log, date);
  const p = progressOf(total, goal);
  view.appendChild(el('div', { class: 'card accent nut-top', id: 'nut-top', 'data-date': date }, [
    el('div', { class: 'nut-day' }, [
      el('button', { type: 'button', class: 'nut-arrow', id: 'nut-prev', 'aria-label': 'Day before', onclick: () => again(addDays(date, -1)) }, '‹'),
      el('h3', { class: 'nut-date', id: 'nut-date' }, [dayLabel(date, today), infoBtn('Protein', [
        `Your goal is ${goal} g of protein a day, about 1 g per lb of bodyweight. That sits at the top of the range where studies still see extra muscle from more protein (about 120 to 165 g a day for you).`,
        'Spread it over 3 or 4 meals of 30 to 40 g, and have one of them within about 2 hours after lifting. On an evening lift, dinner is that meal.',
        'Tap a food to add one serving. Tap a line in the list to change how much, or swipe it left to delete it. Use the arrows to fill in a day you missed.'
      ])]),
      date === today ? el('span', { class: 'nut-arrow ghost' }) : el('button', { type: 'button', class: 'nut-arrow', id: 'nut-next', 'aria-label': 'Next day', onclick: () => again(addDays(date, 1)) }, '›')
    ]),
    el('div', { class: 'nut-total' }, [
      el('span', { class: 'nut-big', id: 'nut-total' }, String(total)),
      el('span', { class: 'nut-unit' }, 'g'),
      canWrite
        ? el('button', { type: 'button', class: 'nut-goal', id: 'nut-goal', onclick: () => goalSheet(goal, again) }, `of ${goal} g protein`)
        : el('span', { class: 'nut-goal' }, `of ${goal} g protein`)
    ]),
    el('div', { class: 'nut-bar' + (p.hit ? ' hit' : ''), role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(goal), 'aria-valuenow': String(total) }, el('span', { style: `width:${p.pct}%` })),
    el('p', { class: 'nut-left' + (p.hit ? ' hit' : ''), id: 'nut-left' }, p.hit ? (total > goal ? `Goal hit, ${total - goal} g over` : 'Goal hit') : `${p.left} g to go`),
    date !== today ? el('button', { type: 'button', class: 'link-btn', id: 'nut-today', onclick: () => again(today) }, 'Back to today') : null
  ]));

  // ---- the buttons ----
  if (canWrite) {
    const add = async (food) => {
      const at = date === today ? new Date().toISOString() : noonOf(date);
      const entry = makeEntry(food, { date, at, servings: 1, id: newId('food') });
      if (date !== today) entry.later = true;
      const fresh = await getFoodLog();
      const rep = date === today ? recentRepeat(fresh, food.id, at, check) : null;
      fresh.push(entry);
      await setFoodLog(fresh);
      haptic('press');
      await again();
      toast(rep ? `${food.name} added twice in a minute. Meant to?` : `${food.name} +${entryG(entry)} g${date !== today ? ` on ${fmtDate(date)}` : ''}`, null, {
        action: 'Undo', onAction: async () => { await setFoodLog((await getFoodLog()).filter(e => e.id !== entry.id)); again(); }
      });
    };
    const grid = el('div', { class: 'nut-grid', id: 'nut-grid' }, [
      ...foods.map(f => el('button', { type: 'button', class: 'nut-food' + (f.source === 'estimate' ? ' est' : ''), 'data-food': f.id, onclick: () => add(f) }, [
        el('b', {}, f.name),
        el('span', { class: 'nut-g' }, `+${f.g} g`),
        el('small', {}, f.source === 'estimate' ? `${amountText(f)} · est.` : amountText(f))
      ])),
      el('button', { type: 'button', class: 'nut-food other', id: 'nut-other', onclick: () => otherSheet({ date, today, check, again, defaults: ctx.foodsData }) }, [icon('plus'), el('b', {}, 'Other')])
    ]);
    view.appendChild(el('div', { class: 'card', id: 'nut-add' }, [
      el('div', { class: 'nut-head' }, [
        el('h3', {}, date === today ? 'Tap what you ate' : `Add to ${fmtDate(date)}`),
        el('button', { type: 'button', class: 'link-btn', id: 'nut-edit', onclick: () => foodsSheet({ ctx, check, again, today }) }, 'Edit buttons')
      ]),
      grid,
      foods.some(f => f.source === 'estimate') ? el('p', { class: 'muted nut-est-note' }, 'est. means a typical number. Check the label once in Edit buttons and it goes away.') : null
    ]));
  } else {
    view.appendChild(el('div', { class: 'card', id: 'nut-viewonly' }, [el('p', { class: 'muted', style: 'margin:0' }, 'This computer only views. Log food on your phone and it shows here after it uploads.')]));
  }

  // ---- the day's list ----
  const entries = dayEntries(log, date);
  const list = el('div', { class: 'nut-list', id: 'nut-list' });
  if (!entries.length) list.appendChild(el('p', { class: 'muted', style: 'margin:0' }, canWrite ? 'Nothing logged yet. Tap a food above.' : 'Nothing logged.'));
  for (const e of entries.slice().reverse()) {
    const row = el('div', { class: 'nut-row' + (canWrite ? ' tappable' : ''), 'data-entry': e.id, role: canWrite ? 'button' : null, tabindex: canWrite ? '0' : null, onclick: canWrite ? () => entrySheet(e, { amounts, check, again }) : null }, [
      el('span', { class: 'nut-time' }, e.later ? 'added later' : fmtTime(e.at)),
      el('span', { class: 'nut-name' }, [e.name, el('small', {}, amountText(e, e.servings))]),
      el('b', { class: 'nut-row-g' }, `${entryG(e)} g`)
    ]);
    list.appendChild(canWrite ? swipeToDelete(row, () => removeEntry(e, again)) : row);
  }
  view.appendChild(el('div', { class: 'card', id: 'nut-day-list' }, [
    el('h3', {}, entries.length ? `${date === today ? 'Today' : fmtDate(date)} · ${entries.length} ${entries.length === 1 ? 'item' : 'items'}` : (date === today ? 'Today' : fmtDate(date))),
    list
  ]));

  // ---- the last 7 days ----
  const days = lastDays(log, today, goal, 7);
  const logged = days.filter(d => d.logged);
  const top = Math.max(goal * 1.25, ...days.map(d => d.total));
  view.appendChild(el('div', { class: 'card', id: 'nut-week' }, [
    el('h3', {}, 'Last 7 days'),
    el('p', { class: 'muted nut-week-sum', id: 'nut-week-sum' }, logged.length ? `Hit ${goal} g on ${logged.filter(d => d.hit).length} of the ${logged.length} ${logged.length === 1 ? 'day' : 'days'} you logged.` : 'Your days show here once you log food.'),
    el('div', { class: 'nut-days', style: `--goal:${Math.round((goal / top) * 100)}%` }, days.map(d => {
      const wd = new Date(noonOf(d.date)).toLocaleDateString(undefined, { weekday: 'narrow' });
      return el('button', { type: 'button', class: 'nut-daycol' + (d.hit ? ' hit' : '') + (d.date === date ? ' on' : ''), 'data-date': d.date, 'aria-label': `${fmtDate(d.date)}: ${d.total} g`, onclick: () => again(d.date) }, [
        el('span', { class: 'nut-daynum' }, d.logged ? String(d.total) : '–'),
        el('span', { class: 'nut-daybar' }, el('span', { style: `height:${Math.round((d.total / top) * 100)}%` })),
        el('span', { class: 'nut-dayname' }, wd)
      ]);
    }))
  ]));
  if (ctx.keepScroll) window.scrollTo(0, y);
}

async function removeEntry(e, again) {
  const before = await getFoodLog();
  await setFoodLog(before.filter(x => x.id !== e.id));
  await again();
  toast(`${e.name} deleted`, null, { action: 'Undo', onAction: async () => { const l = await getFoodLog(); l.push(e); await setFoodLog(l); again(); } });
}

/** A line in the list: how much (½, 1, 1½, 2, 3 servings, or grams for an Other), or delete. */
function entrySheet(e, { amounts, check, again }) {
  let servings = e.servings;
  let warned = false;
  const isOther = !e.foodId;
  const gIn = isOther ? el('input', { type: 'number', inputmode: 'decimal', id: 'nut-entry-g', value: String(entryG(e)), 'aria-label': 'Grams of protein' }) : null;
  const sum = el('p', { class: 'nut-sheet-sum', id: 'nut-entry-sum' });
  const msg = el('p', { class: 'nut-msg', id: 'nut-entry-msg', hidden: true });
  const save = el('button', { class: 'btn primary', id: 'nut-entry-save' }, 'Save');
  const grams = () => (isOther ? Number(gIn.value) : Math.round(e.g * servings));
  const show = () => { sum.textContent = isOther ? '' : `${amountText(e, servings)} · ${grams()} g protein`; seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', Number(b.dataset.s) === servings)); msg.hidden = true; warned = false; save.textContent = 'Save'; };
  const seg = el('div', { class: 'nut-amounts', id: 'nut-amounts' }, isOther ? [] : amounts.map(a => el('button', { type: 'button', 'data-s': String(a), onclick: () => { servings = a; show(); } }, amountText(e, a))));
  save.addEventListener('click', async () => {
    const r = checkProtein(grams(), check, 'entry');
    if (r.refuse || (r.warn && !warned)) { msg.textContent = r.text; msg.hidden = false; if (r.warn) { warned = true; save.textContent = 'Save anyway'; } return; }
    const l = await getFoodLog();
    const i = l.findIndex(x => x.id === e.id);
    if (i >= 0) l[i] = isOther ? { ...l[i], g: grams(), servings: 1 } : { ...l[i], servings };
    await setFoodLog(l);
    closeModal(); again();
    toast(`${e.name}: ${grams()} g`);
  });
  if (gIn) gIn.addEventListener('input', () => { msg.hidden = true; warned = false; save.textContent = 'Save'; });
  showModal(el('div', { class: 'nut-sheet' }, [
    el('h2', {}, e.name),
    isOther ? el('div', { class: 'field' }, [el('label', { for: 'nut-entry-g' }, 'Grams of protein'), gIn]) : el('p', { class: 'muted', style: 'margin:0 0 8px' }, `How much? One serving is ${amountText(e)}, ${e.g} g.`),
    seg, sum, msg,
    save,
    el('button', { class: 'btn ghost', id: 'nut-entry-delete', onclick: () => { closeModal(); removeEntry(e, again); } }, 'Delete')
  ]));
  show();
}

/** Other: grams of protein, a name if he wants one, and an option to keep it as a button. */
function otherSheet({ date, today, check, again, defaults }) {
  const name = el('input', { type: 'text', id: 'nut-other-name', placeholder: 'Other', autocomplete: 'off', 'aria-label': 'Name' });
  const g = el('input', { type: 'number', inputmode: 'decimal', id: 'nut-other-g', placeholder: 'g', 'aria-label': 'Grams of protein' });
  const keep = el('input', { type: 'checkbox', id: 'nut-other-keep' });
  const msg = el('p', { class: 'nut-msg', id: 'nut-other-msg', hidden: true });
  const addBtn = el('button', { class: 'btn primary', id: 'nut-other-add' }, 'Add');
  let warned = false;
  g.addEventListener('input', () => { msg.hidden = true; warned = false; addBtn.textContent = 'Add'; });
  addBtn.addEventListener('click', async () => {
    const r = checkProtein(g.value, check, keep.checked ? 'serving' : 'entry');
    if (r.refuse || (r.warn && !warned)) { msg.textContent = r.text; msg.hidden = false; if (r.warn) { warned = true; addBtn.textContent = 'Add anyway'; } return; }
    const nm = name.value.trim() || 'Other';
    let food = { name: nm, g: Number(g.value), qty: 1, unit: 'serving', units: 'servings' };
    if (keep.checked && name.value.trim()) {
      const list = foodsList(await getFoods(), defaults);
      food = { ...food, id: foodId(nm, list), source: 'you' };
      list.push(food);
      await setFoods(list);
    }
    const at = date === today ? new Date().toISOString() : noonOf(date);
    const entry = makeEntry(food, { date, at, servings: 1, id: newId('food') });
    if (date !== today) entry.later = true;
    const l = await getFoodLog(); l.push(entry); await setFoodLog(l);
    closeModal(); await again();
    toast(`${nm} +${entryG(entry)} g`, null, { action: 'Undo', onAction: async () => { await setFoodLog((await getFoodLog()).filter(e => e.id !== entry.id)); again(); } });
  });
  showModal(el('div', { class: 'nut-sheet' }, [
    el('h2', {}, 'Other food'),
    el('div', { class: 'field' }, [el('label', { for: 'nut-other-g' }, 'Grams of protein'), g]),
    el('div', { class: 'field' }, [el('label', { for: 'nut-other-name' }, 'What was it (optional)'), name]),
    el('label', { class: 'toggle nut-keep', for: 'nut-other-keep' }, [el('span', {}, 'Make it a button (needs a name)'), keep]),
    msg, addBtn
  ]));
  setTimeout(() => g.focus(), 50);
}

/** Edit buttons: his list, tap one to change it, add one, or go back to the starting list. */
async function foodsSheet({ ctx, check, again, today }) {
  const list = foodsList(await getFoods(), ctx.foodsData);
  const own = !!(await getFoods());
  const reopen = () => foodsSheet({ ctx, check, again, today });
  showModal(el('div', { class: 'nut-sheet', id: 'nut-foods' }, [
    el('h2', {}, 'Your buttons'),
    el('p', { class: 'muted', style: 'margin:0 0 8px' }, 'Tap one to change its name or grams, or to remove it.'),
    el('div', { class: 'nut-foods-list' }, list.map(f => el('button', { type: 'button', class: 'nut-foods-row', 'data-food': f.id, onclick: () => foodSheet(f, { ctx, check, again, today, reopen }) }, [
      el('span', {}, [el('b', {}, f.name), el('small', {}, amountText(f) + (f.source === 'estimate' ? ' · est.' : ''))]),
      el('b', {}, `${f.g} g`)
    ]))),
    el('button', { class: 'btn', id: 'nut-food-new', onclick: () => foodSheet(null, { ctx, check, again, today, reopen }) }, [icon('plus'), 'Add a button']),
    own ? el('button', { class: 'btn ghost', id: 'nut-foods-reset', onclick: async () => {
      if (!(await confirmDialog('Go back to the starting buttons?', 'Your own buttons and changes are removed. What you logged stays.', 'Reset'))) { reopen(); return; }
      await setFoods(null); closeModal(); again(); toast('Back to the starting buttons');
    } }, 'Back to the starting buttons') : null
  ]));
}

/** One button: name, grams of protein per serving, and what a serving is. */
function foodSheet(food, { ctx, check, again, today, reopen }) {
  const isNew = !food;
  const f = food ? { ...food } : { name: '', g: '', qty: 1, unit: 'serving', units: 'servings' };
  const name = el('input', { type: 'text', id: 'nut-food-name', value: f.name, autocomplete: 'off', 'aria-label': 'Name' });
  const g = el('input', { type: 'number', inputmode: 'decimal', id: 'nut-food-g', value: f.g === '' ? '' : String(f.g), 'aria-label': 'Grams of protein per serving' });
  const qty = el('input', { type: 'number', inputmode: 'decimal', id: 'nut-food-qty', value: String(f.qty), step: '0.25', 'aria-label': 'Serving amount' });
  const unit = el('input', { type: 'text', id: 'nut-food-unit', value: f.unit, autocomplete: 'off', 'aria-label': 'Serving unit' });
  const msg = el('p', { class: 'nut-msg', id: 'nut-food-msg', hidden: true });
  const save = el('button', { class: 'btn primary', id: 'nut-food-save' }, 'Save');
  let warned = false;
  [name, g, qty, unit].forEach(i => i.addEventListener('input', () => { msg.hidden = true; warned = false; save.textContent = 'Save'; }));
  save.addEventListener('click', async () => {
    const u = unit.value.trim() || 'serving';
    const next = { ...f, name: name.value.trim(), g: g.value === '' ? '' : Number(g.value), qty: Number(qty.value), unit: u, units: u === f.unit && f.units ? f.units : (/(s|lb|oz|g)$/.test(u) ? u : u + 's'), source: 'you' };
    const r = checkFood(next, check);
    if (r.refuse || (r.warn && !warned)) { msg.textContent = r.text; msg.hidden = false; if (r.warn) { warned = true; save.textContent = 'Save anyway'; } return; }
    const list = foodsList(await getFoods(), ctx.foodsData);
    if (isNew) { next.id = foodId(next.name, list); list.push(next); } else { const i = list.findIndex(x => x.id === f.id); if (i >= 0) list[i] = next; }
    await setFoods(list);
    let note = '';
    if (!isNew && (next.g !== food.g || next.qty !== food.qty)) {
      const l = await getFoodLog();
      const n = l.filter(e => e.foodId === next.id && e.date === today).length;
      if (n) { await setFoodLog(applyFoodEdit(l, next, today)); note = ` Today's ${n === 1 ? 'entry uses' : `${n} entries use`} it too.`; }
    }
    await again();
    toast(`${next.name}: ${next.g} g a serving.${note}`, 3500);
    reopen();
  });
  showModal(el('div', { class: 'nut-sheet', id: 'nut-food' }, [
    el('h2', {}, isNew ? 'New button' : f.name),
    food && food.note ? el('p', { class: 'muted', style: 'margin:0 0 8px;font-size:var(--t-small)' }, food.note) : null,
    el('div', { class: 'field' }, [el('label', { for: 'nut-food-name' }, 'Name'), name]),
    el('div', { class: 'field' }, [el('label', { for: 'nut-food-g' }, 'Grams of protein in one serving'), g]),
    el('div', { class: 'nut-serving' }, [
      el('div', { class: 'field' }, [el('label', { for: 'nut-food-qty' }, 'One serving is'), qty]),
      el('div', { class: 'field' }, [el('label', { for: 'nut-food-unit' }, 'Unit'), unit])
    ]),
    msg, save,
    !isNew ? el('button', { class: 'btn ghost', id: 'nut-food-remove', onclick: async () => {
      const list = foodsList(await getFoods(), ctx.foodsData).filter(x => x.id !== f.id);
      await setFoods(list); await again(); toast(`${f.name} removed. What you logged stays.`); reopen();
    } }, 'Remove this button') : null,
    el('button', { class: 'btn ghost', onclick: reopen }, 'Back')
  ]));
  if (isNew) setTimeout(() => name.focus(), 50);
}

/** The daily goal. */
function goalSheet(goal, again) {
  const g = el('input', { type: 'number', inputmode: 'numeric', id: 'nut-goal-g', value: String(goal), 'aria-label': 'Daily protein goal in grams' });
  const msg = el('p', { class: 'nut-msg', id: 'nut-goal-msg', hidden: true });
  showModal(el('div', { class: 'nut-sheet' }, [
    el('h2', {}, 'Daily protein goal'),
    el('div', { class: 'field' }, [el('label', { for: 'nut-goal-g' }, 'Grams a day'), g]),
    msg,
    el('button', { class: 'btn primary', id: 'nut-goal-save', onclick: async () => {
      const v = Math.round(Number(g.value));
      if (!Number.isFinite(v) || v < 60 || v > 300) { msg.textContent = 'Pick a goal between 60 and 300 g.'; msg.hidden = false; return; }
      await saveSettings({ proteinGoalG: v }); closeModal(); again(); toast(`Goal: ${v} g a day`);
    } }, 'Save')
  ]));
}

/** Home: one line with today's protein; a tap opens the tab. */
export async function proteinHomeCard(onOpen) {
  const settings = await getSettings();
  const goal = Number(settings.proteinGoalG) || 160;
  const today = toISODate(new Date());
  const total = dayTotal(await getFoodLog(), today);
  const p = progressOf(total, goal);
  return el('button', { type: 'button', class: 'card nut-home' + (p.hit ? ' hit' : ''), id: 'nut-home', onclick: onOpen }, [
    el('span', { class: 'nut-home-row' }, [
      el('span', { class: 'nut-home-label' }, 'Protein today'),
      el('span', { class: 'nut-home-num', id: 'nut-home-num' }, [el('b', {}, String(total)), ` / ${goal} g`]),
      el('span', { class: 'nut-home-go', 'aria-hidden': 'true' }, '›')
    ]),
    el('span', { class: 'nut-bar small' + (p.hit ? ' hit' : '') }, el('span', { style: `width:${p.pct}%` }))
  ]);
}
