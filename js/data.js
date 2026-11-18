// data.js - loads the data files and provides plan helpers (week number, phase, today's session).

export const APP_VERSION = '1.5.0';

let cache = null;

export async function loadData() {
  if (cache) return cache;
  const [plan, rules, settingsDefaults, architecture] = await Promise.all([
    fetchJSON('data/plan.json'),
    fetchJSON('data/rules.json'),
    fetchJSON('data/settings.json'),
    fetchJSON('data/architecture.json')
  ]);
  cache = { plan, rules, settingsDefaults, architecture };
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
