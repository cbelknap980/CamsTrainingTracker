// nutrition.js - v1.20 the Nutrition tab's numbers: protein only for now (Cameron, Nov 25: "a very simple nutrition
// tracking app to mainly focus on protein intake... little buttons... for things that I consistently eat").
// Pure helpers, tested in node. The tab itself is js/nutrition-view.js; the starting buttons and the number checks are
// data/foods.json; the goal is settings.proteinGoalG (160 g, his pick: "closer to 1 gram per pound").
//
// A food: { id, name, qty, unit, units, g, source: 'label' | 'estimate' | 'you', note? } where g is the protein in one
// serving and qty + unit say what a serving is (0.5 lb of chicken, 1 bar).
// An entry in the food log: { id, date: 'YYYY-MM-DD', at: ISO time, foodId (null for Other), name, g (protein per
// serving when it was logged), qty, unit, units, servings }.

import { toISODate } from './data.js';

/** Grams of protein in one entry, to a whole gram. */
export function entryG(e) {
  return Math.round((Number(e.g) || 0) * (Number(e.servings) || 0));
}

export function dayEntries(log, date) {
  return (log || []).filter(e => e.date === date).sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

export function dayTotal(log, date) {
  return dayEntries(log, date).reduce((s, e) => s + entryG(e), 0);
}

/** The n days ending on endDate (oldest first), each with its total and whether it reached the goal. */
export function lastDays(log, endDate, goal, n = 7) {
  const out = [];
  const end = parseDate(endDate);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end); d.setDate(end.getDate() - i);
    const date = toISODate(d);
    const total = dayTotal(log, date);
    out.push({ date, total, hit: goal > 0 && total >= goal, logged: (log || []).some(e => e.date === date) });
  }
  return out;
}

export function addDays(date, n) {
  const d = parseDate(date); d.setDate(d.getDate() + n);
  return toISODate(d);
}

function parseDate(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

/** 0.5 -> '½', 1.5 -> '1½', 0.25 -> '¼', 2 -> '2'. */
export function fmtQty(q) {
  const r = Math.round(Number(q) * 100) / 100;
  const whole = Math.floor(r);
  const frac = Math.round((r - whole) * 100);
  if (!frac) return String(whole);
  const sym = { 25: '¼', 50: '½', 75: '¾' }[frac];
  if (sym) return whole ? `${whole}${sym}` : sym;
  return String(r);
}

/** What an amount of a food is in words: '2 bars', '½ lb', '1 lb', '1 scoop'. */
export function amountText(food, servings = 1) {
  const q = (Number(food.qty) || 1) * servings;
  const unit = food.unit || 'serving';
  const plural = food.units || (unit + 's');
  return `${fmtQty(q)} ${q > 1 ? plural : unit}`;
}

/** A new log entry for a food (or an Other entry: food = { name, g }). */
export function makeEntry(food, { date, at, servings = 1, id }) {
  return {
    id, date, at,
    foodId: food.id || null,
    name: food.name || 'Other',
    g: Number(food.g),
    qty: food.qty != null ? Number(food.qty) : 1,
    unit: food.unit || 'serving',
    units: food.units || null,
    servings
  };
}

/**
 * Is a protein number believable? Returns { ok, refuse, warn, text }.
 * refuse: not a number, 0 or less, or over check.refuseG. warn (Save anyway): over servingWarnG for one serving
 * (kind 'serving') or over entryWarnG for what is being added (kind 'entry').
 */
export function checkProtein(g, check, kind = 'entry') {
  const n = Number(g);
  if (g === '' || g === null || g === undefined || !Number.isFinite(n)) return { ok: false, refuse: true, text: 'Type the grams of protein as a number.' };
  if (n <= 0) return { ok: false, refuse: true, text: 'Protein has to be more than 0 g.' };
  if (n > check.refuseG) return { ok: false, refuse: true, text: `${Math.round(n)} g can't be right for one item. Check the label.` };
  const lim = kind === 'serving' ? check.servingWarnG : check.entryWarnG;
  if (n > lim) return { ok: false, warn: true, text: kind === 'serving' ? `${Math.round(n)} g in one serving is a lot. Is that right?` : `${Math.round(n)} g in one go is a lot. Is that right?` };
  return { ok: true };
}

/** Checks a food typed on the edit sheet. */
export function checkFood(food, check) {
  if (!String(food.name || '').trim()) return { ok: false, refuse: true, text: 'Give it a name.' };
  const q = Number(food.qty);
  if (!Number.isFinite(q) || q <= 0) return { ok: false, refuse: true, text: 'The serving amount has to be a number above 0.' };
  return checkProtein(food.g, check, 'serving');
}

/** The last entry of this food within repeatSeconds of `at`, if any (a likely double tap). */
export function recentRepeat(log, foodId, at, check) {
  if (!foodId) return null;
  const t = new Date(at).getTime();
  return (log || []).filter(e => e.foodId === foodId && t - new Date(e.at).getTime() >= 0 && t - new Date(e.at).getTime() < check.repeatSeconds * 1000).pop() || null;
}

/**
 * A food's protein changed (a label checked, an estimate fixed): entries of it on `date` take the new number too,
 * so today's total is right; older days keep what they were logged with.
 */
export function applyFoodEdit(log, food, date) {
  return (log || []).map(e => (e.foodId === food.id && e.date === date ? { ...e, g: Number(food.g), qty: Number(food.qty), unit: food.unit, units: food.units || null, name: food.name } : e));
}

/** His buttons: his own saved list, or the starting list from foods.json. */
export function foodsList(saved, defaults) {
  const list = Array.isArray(saved) && saved.length ? saved : (defaults && defaults.foods) || [];
  return list.map(f => ({ ...f }));
}

/** A short id for a food he adds: its name as a slug, made unique. */
export function foodId(name, list) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'food';
  let id = base, i = 2;
  while ((list || []).some(f => f.id === id)) id = `${base}_${i++}`;
  return id;
}

/** "86 of 160 g" style numbers for Home and the tab: total, goal, left, percent (0 to 100). */
export function progressOf(total, goal) {
  const left = Math.max(0, goal - total);
  return { total, goal, left, pct: goal > 0 ? Math.min(100, Math.round((total / goal) * 100)) : 0, hit: goal > 0 && total >= goal };
}

/**
 * v1.20.2 (Cameron, Nov 25: "I should be able to tap these on my phone or computer"). The computer never writes the
 * phone's file; it writes what it did as a list of steps (food-from-computer.json) and the phone applies them.
 * A step: { id, at, type: 'add', entry } | { id, at, type: 'remove', entryId } | { id, at, type: 'set', entryId, servings?, g? }.
 * Each step can be applied twice with no harm (an add whose entry is already there is skipped), so the computer can
 * lay the same steps over the phone's copy until the phone has them.
 */
export function validFoodOp(op, check = { refuseG: 300 }) {
  if (!op || typeof op !== 'object' || !op.id) return false;
  const gOk = g => Number.isFinite(Number(g)) && Number(g) > 0 && Number(g) <= check.refuseG;
  const sOk = s => Number.isFinite(Number(s)) && Number(s) > 0 && Number(s) <= 10;
  if (op.type === 'add') {
    const e = op.entry;
    return !!(e && e.id && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date)) && gOk(e.g) && sOk(e.servings) && Number(e.g) * Number(e.servings) <= check.refuseG);
  }
  if (op.type === 'remove') return !!op.entryId;
  if (op.type === 'set') return !!op.entryId && (op.servings == null || sOk(op.servings)) && (op.g == null || gOk(op.g)) && (op.servings != null || op.g != null);
  return false;
}

/** The log with the steps applied in order. Returns { log, applied: [step ids], bad: [step ids] }. */
export function applyFoodOps(log, ops, check) {
  let out = (log || []).map(e => ({ ...e }));
  const applied = [], bad = [];
  for (const op of ops || []) {
    if (!validFoodOp(op, check)) { if (op && op.id) bad.push(op.id); continue; }
    if (op.type === 'add') { if (!out.some(e => e.id === op.entry.id)) out.push({ ...op.entry, fromComputer: true }); }
    else if (op.type === 'remove') out = out.filter(e => e.id !== op.entryId);
    else if (op.type === 'set') out = out.map(e => (e.id === op.entryId ? { ...e, ...(op.servings != null ? { servings: Number(op.servings) } : {}), ...(op.g != null ? { g: Number(op.g) } : {}) } : e));
    applied.push(op.id);
  }
  return { log: out, applied, bad };
}
