// data.js - loads the data files and provides plan helpers (week number, phase, today's session).

export const APP_VERSION = '1.1.0';

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

export function repsText(reps) {
  if (!reps) return '';
  return reps[0] === reps[1] ? `${reps[0]}` : `${reps[0]}-${reps[1]}`;
}

export function fmtWeight(w) {
  if (w === null || w === undefined || w === '') return '';
  const n = Number(w);
  return Number.isInteger(n) ? `${n}` : `${n.toFixed(1)}`;
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
