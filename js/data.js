// data.js - loads the data files and provides plan helpers (week number, phase, today's session).

export const APP_VERSION = '1.18.12';

let cache = null;

export async function loadData() {
  if (cache) return cache;
  const [plan, rules, settingsDefaults, architecture, muscles, goals] = await Promise.all([
    fetchJSON('data/plan.json'),
    fetchJSON('data/rules.json'),
    fetchJSON('data/settings.json'),
    fetchJSON('data/architecture.json'),
    fetchJSON('data/muscles.json'),
    fetchJSON('data/goals.json')
  ]);
  cache = { plan, rules, settingsDefaults, architecture, muscles, goals };
  return cache;
}

async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json();
}

export function getData() {
  if (!cache) throw new Error('Data not loaded yet');
  return cache;
}

// ---- dates and weeks ----
export function toISODate(d) {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${x.getFullYear()}-${m}-${day}`;
}

export function parseISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Week 1 starts on startDate (a Monday). Days before it are week 0.
export function weekNumber(date, startDate) {
  const start = parseISODate(startDate);
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((d - start) / 86400000);
  if (days < 0) return 0;
  return Math.floor(days / 7) + 1;
}

export function phaseForWeek(plan, week) {
  const p = plan.phases.find(ph => ph.weeks.includes(week));
  return p || (week > 12 ? { id: 'after', name: 'After the block' } : { id: 'before', name: 'Before the block' });
}

export function sessionById(plan, id) {
  return plan.sessions.find(s => s.id === id) || null;
}

export function todaysSessionId(plan, date) {
  const dow = String(date.getDay());
  return plan.calendar[dow] || null;
}

export function exerciseName(plan, id) {
  const ex = plan.exercises[id];
  return ex ? ex.name : id;
}

export function effortText(effort) {
  if (!effort) return '';
  if (effort.label) return effort.label;
  if (effort.kind === 'rpe') return effort.min === effort.max ? `RPE ${effort.min}` : `RPE ${effort.min}-${effort.max}`;
  if (effort.kind === 'rir') {
    const n = effort.min === effort.max ? `${effort.min}` : `${effort.min}-${effort.max}`;
    return `${n} left`;
  }
  return '';
}

// Target RPE used for the pre-filled RPE field: RIR converts as 10 - RIR (midpoint of the range).
export function effortToRpe(effort) {
  if (!effort) return 8;
  if (effort.kind === 'rpe') return effort.max;
  if (effort.kind === 'rir') return 10 - (effort.min + effort.max) / 2;
  return 8;
}

// ---- v1.4 effort in plain words ----
// Reps left in the tank for an effort target: RPE converts as 10 - RPE.
export function effortRir(effort) {
  if (!effort) return null;
  if (effort.kind === 'rir') return [effort.min, effort.max];
  if (effort.kind === 'rpe') return [10 - effort.max, 10 - effort.min];
  return null;
}

export function effortPlain(effort) {
  const r = effortRir(effort);
  if (!r) return '';
  const n = r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`;
  const lead = effort.label && /fast/i.test(effort.label) ? 'Fast. ' : '';
  if (r[1] <= 1) return `${lead}Push close: ${n} left`;
  return `${lead}Leave ${n} in the tank`;
}

/** The effort level (from rules.effortScale) a stored RPE number falls in. */
export function effortLevel(rules, rpe) {
  if (rpe == null || !rules || !rules.effortScale) return null;
  const levels = rules.effortScale.levels;
  return levels.find(l => rpe <= l.upTo) || levels[levels.length - 1];
}

export function effortLabel(rules, rpe) {
  const l = effortLevel(rules, rpe);
  return l ? l.label : '';
}

const EQUIPMENT = { barbell: 'Barbell', dumbbell: 'Dumbbells', machine: 'Machine', cable: 'Cable', weighted_bw: 'Weighted', bodyweight: 'Bodyweight' };
export function equipmentLabel(eq) { return EQUIPMENT[eq] || ''; }
/** v1.5: "Dumbbells" only for lifts that use two; a one-dumbbell lift reads "Dumbbell". */
export function equipmentFor(ex) {
  if (!ex) return '';
  if (ex.equipment === 'dumbbell' && !ex.pair) return 'Dumbbell';
  return equipmentLabel(ex.equipment);
}

/** "2 minutes 45 seconds" for the voice prompts. */
export function spokenDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  const parts = [];
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (r || !m) parts.push(`${r} second${r === 1 ? '' : 's'}`);
  return parts.join(' ');
}

export function repsText(reps) {
  if (!reps) return '';
  return reps[0] === reps[1] ? `${reps[0]}` : `${reps[0]}-${reps[1]}`;
}

export function fmtWeight(w) {
  if (w === null || w === undefined || w === '') return '';
  const n = Number(w);
  return Number.isInteger(n) ? `${n}` : `${n.toFixed(1)}`;
}

// ---- v1.5 two-dumbbell lifts: weights are the total of both ----
export function isPair(ex) { return !!(ex && ex.pair); }
/** "2 × 40" for a pair total of 80; '' for anything else. */
export function pairText(ex, total) {
  if (!isPair(ex) || total == null || total === '') return '';
  return `2 × ${fmtWeight(Number(total) / 2)}`;
}
/** "80 lb (2 × 40)" for pairs, "135 lb" otherwise. */
export function weightWithPair(ex, w) {
  if (w == null || w === '') return '';
  const p = pairText(ex, w);
  return `${fmtWeight(w)} lb${p ? ' (' + p + ')' : ''}`;
}

// ---- v1.18.5: weights he can load (Cameron, Nov 24) ----

const perHandOf = (rules, ex, w) => (ex && ex.pair ? w / ((rules.dumbbellPairs && rules.dumbbellPairs.count) || 2) : w);
const near = (a, b) => Math.abs(a - b) < 1e-6;

/** False for a size his gym does not have (rules.dumbbells.notAvailableLb; a two-dumbbell total is checked per hand). */
export function dumbbellOk(rules, ex, w) {
  const d = rules && rules.dumbbells;
  if (!d || !ex || ex.equipment !== 'dumbbell' || w == null || w <= 0) return true;
  const per = perHandOf(rules, ex, w);
  return !(d.notAvailableLb || []).some(x => near(x, per));
}

/** v1.18.10: the nearest multiple of step, the lower one on a tie (97.5 -> 95, 98 -> 100). */
export function snapTo(w, step) {
  if (w == null || !step) return w;
  return Math.ceil(w / step - 0.5 - 1e-9) * step;
}
/** v1.18.10: an estimated max as shown, on rules.loads.estimateStepLb (248 -> 250, 242 -> 240). */
export function roundEst(v, rules) {
  if (v == null || !Number.isFinite(v)) return v;
  const step = (rules && rules.loads && rules.loads.estimateStepLb) || 5;
  return Math.round(v / step) * step;
}

/**
 * A weight he can load: barbell, machine, cable and added pull-up weight on rules.loads.stepLb (5 lb: 92.5 -> 90),
 * dumbbells on the rack's per-hand steps without the sizes the gym does not have (2 x 27.5 -> 2 x 25). The nearest,
 * the lighter on a tie. Bodyweight lifts and anything without a weight are left as they are.
 */
export function snapLoad(rules, ex, w) {
  if (w == null || !ex || !rules) return w;
  if (ex.equipment !== 'dumbbell') {
    const step = rules.loads && rules.loads.stepLb;
    return ['barbell', 'machine', 'cable', 'weighted_bw'].includes(ex.equipment) && step ? snapTo(w, step) : w;
  }
  const d = rules.dumbbells;
  if (!d) return w;
  const onStep = per => near(per / (d.perHandStepLb || 5), Math.round(per / (d.perHandStepLb || 5)));
  if (dumbbellOk(rules, ex, w) && onStep(perHandOf(rules, ex, w))) return w;
  const step = d.perHandStepLb || 5;
  const per = perHandOf(rules, ex, w);
  const count = ex.pair ? w / per : 1;
  const ok = x => x > 0 && !(d.notAvailableLb || []).some(n => near(n, x));
  let best = null;
  for (let k = Math.max(1, Math.floor(per / step) - 3); k <= Math.ceil(per / step) + 3; k++) {
    const x = k * step;
    if (!ok(x)) continue;
    const gap = Math.abs(x - per);
    if (best == null || gap < Math.abs(best - per) - 1e-6) best = x;
  }
  return best == null ? w : best * count;
}

/**
 * A ramp-up weight as an easy load: the bar plus 45s and at most one more plate a side (rules.rampUp.easyPlatesLb).
 * `below`: the load has to stay under this weight (the work sets).
 */
export function easyLoad(rules, w, below) {
  const r = rules.rampUp;
  const bar = r.barWeightLb, big = r.bigPlateLb || 45;
  const extra = [0, ...(r.easyPlatesLb || [])];
  const loads = [];
  for (let n = 0; bar + 2 * n * big <= Math.max(w, below || 0) + 2 * big; n++) for (const e of extra) loads.push(bar + 2 * (n * big + e));
  const ok = [...new Set(loads)].filter(x => below == null || x < below - 1e-6).sort((a, b) => a - b);
  if (!ok.length) return bar;
  return ok.reduce((b, x) => (Math.abs(x - w) < Math.abs(b - w) - 1e-6 ? x : b), ok[0]);
}

export function roundTo(value, step) {
  if (!step) return Math.round(value);
  return Math.round(value / step) * step;
}

export function fmtClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function fmtMinutes(seconds) {
  const m = Math.round(seconds / 60);
  return `${m} min`;
}

export function fmtTime(ts) {
  const d = new Date(ts);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

export function fmtDate(iso) {
  const d = typeof iso === 'string' && iso.length === 10 ? parseISODate(iso) : new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
