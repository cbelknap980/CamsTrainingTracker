// runs.js - v1.10: the numbers behind the Runs tab, and turning Garmin activities into runs.
// What each run is this week comes from plan.runs (intervals by week, long-run distance steps); which Garmin
// activities count comes from rules.garmin. Pure functions, no DOM, no storage.

import { toISODate, parseISODate, weekNumber } from './data.js';

const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;
const round = (v, places) => { const f = 10 ** places; return Math.round(v * f) / f; };
const num = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const pick = (o, ...paths) => {
  for (const p of paths) {
    const v = p.split('.').reduce((a, k) => (a === null || a === undefined ? undefined : a[k]), o);
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
};

// ---- time and pace ----

/** "28:40", "1:02:30" or "28.5" to minutes. null when it is not a time. */
export function parseMinutes(text) {
  const t = String(text === null || text === undefined ? '' : text).trim();
  if (!t) return null;
  if (t.includes(':')) {
    const parts = t.split(':').map(Number);
    if (parts.some(Number.isNaN) || parts.length > 3) return null;
    const [h, m, s] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
    return round(h * 60 + m + s / 60, 2);
  }
  return num(t);
}

/** Minutes as a clock: 28.67 -> "28:40", 62.5 -> "1:02:30". */
export function fmtDuration(minutes) {
  if (minutes === null || minutes === undefined) return '';
  const total = Math.round(minutes * 60);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export const paceOf = (distance, minutes) => (distance && minutes ? round(minutes / distance, 3) : null);

/** Types whose distance is not running miles (a bike or a ski day), from rules.runLog. */
export const countsMiles = (rules, type) => !(((rules && rules.runLog && rules.runLog.milesExclude) || []).includes(type));

/** "3.1 mi · 27:30 · 8:52/mi · HR 152" from whatever the run has. `short` leaves the heart rate off. */
export function runLine(r, rules, short = false) {
  const pace = countsMiles(rules, r.type) ? (r.pace || paceOf(r.distance, r.minutes)) : null;
  return [
    r.distance ? `${round(r.distance, 2)} mi` : null,
    r.minutes ? fmtDuration(r.minutes) : null,
    pace ? `${fmtDuration(pace)}/mi` : null,
    r.hr && !short ? `HR ${Math.round(r.hr)}` : null
  ].filter(Boolean).join(' · ');
}

// ---- the plan's runs ----

/** The plan run a logged type counts for: its own type, or one it accepts in its place (a ski day for the long run). */
export function planRunForType(plan, type) {
  return (plan.runs || []).find(r => r.type === type) || (plan.runs || []).find(r => (r.alsoCounts || []).includes(type)) || null;
}

/**
 * v1.18.1 (Cameron, Nov 21: "Maybe make me log it to take credit"): an activity that came in from Garmin counts toward
 * miles but for no planned run until he says which one it was (Count it, or its type on the run sheet). A ski day is
 * the exception the plan makes: it counts for the long run by itself (rules.garmin.types[].countsForPlan).
 */
export function needsCredit(r) {
  return !!r && String(r.id || '').startsWith('garmin-') && !r.typeLocked && !r.planId;
}

/** v1.18.1: does logged run r count for planned run `run`? Its planId says so; a run logged by hand may go by its type. */
export function countsFor(plan, r, run) {
  if (!r || !run) return false;
  if (r.planId) return r.planId === run.id;
  if (needsCredit(r)) return false;
  return planRunForType(plan, r.type) === run;
}

/** v1.18.1: the planned runs a Garmin activity of this type could be counted as (an easy run: either one). */
export function creditOptions(plan, r) {
  if (!r) return [];
  if (r.type === 'Easy run') return [...(plan.runs || [])];
  return (plan.runs || []).filter(run => run.type === r.type || (run.alsoCounts || []).includes(r.type));
}

/** v1.18.1: the record of Cameron's tap: this activity was that planned run (a bike or rower session stays one). */
export function countAs(r, run) {
  const type = r.type !== 'Easy run' && (run.alsoCounts || []).includes(r.type) ? r.type : run.type;
  return { ...r, type, planId: run.id, typeLocked: true, autoType: false, autoWhy: null };
}

/**
 * v1.18.1: his other answer, Side run: the activity was a run on the side ("just a secondary run", Nov 21). It keeps
 * counting toward miles, counts for no planned run and is not asked about again (a bike or rower session keeps its type).
 */
export function keepAsSide(r) {
  return { ...r, type: r.type || 'Easy run', planId: null, typeLocked: true, autoType: false, autoWhy: null };
}

/**
 * v1.18.1: this week's Garmin activities waiting for his tap that could be this planned run, oldest first.
 * `runs` = every logged run; `range` = { start, end } ISO dates of the week.
 */
export function countCandidates(plan, runs, run, { start, end }) {
  return (runs || []).filter(r => r.date >= start && r.date <= end && needsCredit(r) && creditOptions(plan, r).some(x => x.id === run.id))
    .sort((a, b) => (`${a.date} ${a.startTime || ''}` < `${b.date} ${b.startTime || ''}` ? -1 : 1));
}

const isLong = (run, r) => r.type === run.type || r.planId === run.id && !(run.alsoCounts || []).includes(r.type);

/** Long run: the distance to aim for next, one step past the longest one done so far, up to the cap. */
export function longRunTarget(run, runs) {
  const d = run.distance;
  if (!d) return null;
  const done = (runs || []).filter(r => isLong(run, r) && r.distance);
  const longest = done.reduce((m, r) => Math.max(m, r.distance), 0);
  const next = longest ? Math.round((longest + d.stepMiles) * 2) / 2 : d.startMiles;
  return { miles: Math.min(d.capMiles, Math.max(d.startMiles, next)), longest: longest || null, count: done.length, atCap: Math.max(d.startMiles, next) >= d.capMiles };
}

/** What a plan run asks for in a given week, as one short line plus the pieces it was built from. */
export function prescription(run, week, runs) {
  const w = Math.min(12, Math.max(1, week || 1));
  if (run.intervals) {
    const iv = run.intervals.find(i => w >= i.weeks[0] && w <= i.weeks[1]) || run.intervals[0];
    return { kind: 'intervals', ...iv, text: `${iv.reps} × ${iv.hardMin} min hard, ${iv.easyMin} min easy`, detail: `${run.warmupMin} min easy first, ${run.cooldownMin} min easy after · ${run.effort}` };
  }
  if (run.distance) {
    const t = longRunTarget(run, runs);
    return { kind: 'distance', ...t, text: `${t.miles} mi`, detail: `${run.effort}${t.longest ? ` · longest so far ${round(t.longest, 1)} mi` : ''}` };
  }
  return { kind: 'time', text: `${run.plannedMinutes} min`, detail: run.effort || '' };
}

/** The first and last day of a plan week as ISO dates. */
export function weekRange(settings, week) {
  const start = parseISODate(settings.startDate);
  start.setDate(start.getDate() + (week - 1) * 7);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return { start: toISODate(start), end: toISODate(end) };
}

/**
 * This week's planned runs with where each stands.
 * returns [{ id, name, short, day, date, type, plan: prescription, status: 'done'|'today'|'open'|'later', run }]
 * 'open' = its day has passed and it is not logged, but the week is not over.
 */
export function weekRuns({ plan, settings, runs, week, today }) {
  const { start, end } = weekRange(settings, week);
  const todayIso = toISODate(today);
  const inWeek = (runs || []).filter(r => r.date >= start && r.date <= end);
  const before = (runs || []).filter(r => r.date < start);
  return (plan.runs || []).map(run => {
    const dow = Number(Object.keys(plan.calendar || {}).find(k => plan.calendar[k] === run.id));
    const d = parseISODate(start); d.setDate(d.getDate() + ((dow + 6) % 7));
    const date = toISODate(d);
    const weekend = /weekend/i.test(run.day || '');
    const lastDay = weekend ? end : date;
    const hit = inWeek.filter(r => countsFor(plan, r, run)).sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
    const status = hit ? 'done' : (todayIso >= date && todayIso <= lastDay ? 'today' : (todayIso > lastDay ? 'open' : 'later'));
    return { id: run.id, name: run.name, short: run.name.includes(': ') ? run.name.split(': ')[1] : run.name, day: run.day, date, type: run.type, plan: prescription(run, week, before), status, run: hit };
  });
}

/** Miles and run count for each of the 12 weeks. */
export function weeklyMiles(runs, settings, rules, weeks = 12) {
  const rows = Array.from({ length: weeks }, (_, i) => ({ week: i + 1, miles: 0, runs: 0 }));
  for (const r of runs || []) {
    const w = r.week || weekNumber(parseISODate(r.date), settings.startDate);
    if (w < 1 || w > weeks || !countsMiles(rules, r.type)) continue;
    rows[w - 1].miles = round(rows[w - 1].miles + (r.distance || 0), 1);
    rows[w - 1].runs += 1;
  }
  return rows;
}

// ---- Garmin ----

/** The list of activities in a Garmin file, whatever wraps it. */
export function garminList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.activities)) return data.activities;
  const list = Object.values(data).find(v => Array.isArray(v));
  return list || [];
}

function garminStart(a) {
  const local = pick(a, 'startTimeLocal', 'summaryDTO.startTimeLocal');
  if (typeof local === 'string' && /^\d{4}-\d{2}-\d{2}/.test(local)) return { date: local.slice(0, 10), time: (local.slice(11, 16) || null) };
  const secs = num(pick(a, 'startTimeInSeconds'));
  if (secs !== null) {
    const d = new Date((secs + (num(pick(a, 'startTimeOffsetInSeconds')) || 0)) * 1000);
    return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
  }
  const ms = num(pick(a, 'beginTimestamp'));
  if (ms !== null) { const d = new Date(ms); return { date: toISODate(d), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }; }
  return null;
}

/**
 * One Garmin activity as a run record, or null when it is not one the log keeps (strength work, a walk, too short).
 * Garmin sends meters and seconds; the log keeps miles and minutes. The type is left for mergeGarmin to settle
 * (`guess: true`) when rules.garmin does not name one.
 */
export function garminToRun(a, { rules }) {
  const cfg = (rules && rules.garmin) || {};
  const id = pick(a, 'activityId', 'summaryId', 'id');
  const when = garminStart(a);
  const kindRaw = pick(a, 'activityType.typeKey', 'activityTypeDTO.typeKey', 'activityType', 'activityTypeDTO');
  const kind = String(typeof kindRaw === 'object' && kindRaw ? (kindRaw.typeKey || '') : (kindRaw || '')).toLowerCase();
  if (id === null || !when || !kind) return null;
  const rule = (cfg.types || []).find(t => new RegExp(t.match).test(kind));
  if (!rule) return null;
  const meters = num(pick(a, 'distance', 'distanceInMeters', 'summaryDTO.distance'));
  const seconds = num(pick(a, 'duration', 'durationInSeconds', 'movingDuration', 'summaryDTO.duration'));
  const minutes = seconds === null ? null : round(seconds / 60, 2);
  if (minutes !== null && minutes < (rule.minMinutes || 0)) return null;
  const distance = meters ? round(meters / METERS_PER_MILE, 2) : null;
  const climb = num(pick(a, 'elevationGain', 'totalElevationGainInMeters', 'summaryDTO.elevationGain'));
  const cadence = num(pick(a, 'averageRunningCadenceInStepsPerMinute', 'averageRunCadenceInStepsPerMinute', 'summaryDTO.averageRunCadence'));
  return {
    id: `garmin-${id}`, garminId: String(id), source: 'garmin', date: when.date, startTime: when.time,
    type: rule.type || null, guess: !rule.type, countsForPlan: !!rule.countsForPlan, garminType: kind, name: pick(a, 'activityName', 'summaryDTO.activityName') || '',
    distance, minutes, pace: paceOf(distance, minutes),
    hr: num(pick(a, 'averageHR', 'averageHeartRateInBeatsPerMinute', 'summaryDTO.averageHR')),
    maxHr: num(pick(a, 'maxHR', 'maxHeartRateInBeatsPerMinute', 'summaryDTO.maxHR')),
    climbFt: climb === null ? null : Math.round(climb * FEET_PER_METER),
    cadence: cadence === null ? null : Math.round(cadence),
    intervalLike: intervalSignal(a, (cfg.assign || {}))
  };
}

/**
 * v1.12: does the activity look like an interval session? true / false from whatever Garmin sent, null when it sent
 * nothing to judge by. Garmin's training-effect label or anaerobic effect when present, else max speed against average.
 */
function intervalSignal(a, cfg) {
  const label = String(pick(a, 'trainingEffectLabel', 'summaryDTO.trainingEffectLabel') || '').toUpperCase();
  const anaerobic = num(pick(a, 'anaerobicTrainingEffect', 'summaryDTO.anaerobicTrainingEffect'));
  const avg = num(pick(a, 'averageSpeed', 'averageSpeedInMetersPerSecond', 'summaryDTO.averageSpeed'));
  const max = num(pick(a, 'maxSpeed', 'maxSpeedInMetersPerSecond', 'summaryDTO.maxSpeed'));
  if (label) return (cfg.intervalLabels || []).includes(label);
  if (anaerobic !== null) return anaerobic >= (cfg.anaerobicEffectAtLeast || 99);
  if (avg && max) return max / avg >= (cfg.speedRatioAtLeast || 99);
  return null;
}

const MEASURED = ['date', 'startTime', 'distance', 'minutes', 'pace', 'hr', 'maxHr', 'climbFt', 'cadence', 'garminType', 'name', 'intervalLike'];

/**
 * Work out what the log needs from a Garmin file.
 * - an activity already in the log has its measured numbers refreshed (type, effort and notes stay as Cameron set them)
 * - a run typed in by hand on the same day takes the activity's numbers instead of being logged twice
 * - anything else is a new run. v1.18.1: a run lands as an Easy run and counts for no planned run until Cameron taps
 *   Count it (it used to take the planned run it most likely was, and took the intervals for an easy run on Nov 18).
 *   Ski days and bike or rower sessions keep the type rules.garmin gives them; only a ski day counts by itself.
 * `ignored` = Garmin ids Cameron deleted; they stay out.
 * returns { put: [run records to save], added, updated, seen }
 */
export function mergeGarmin(runs, activities, { plan, rules, settings, ignored = [], appVersion }) {
  const cfg = (rules && rules.garmin) || {};
  const all = (runs || []).map(r => ({ ...r }));
  const put = new Map();
  let added = 0, updated = 0, seen = 0;
  const mapped = garminList(activities).map(a => garminToRun(a, { rules })).filter(Boolean)
    .filter(g => g.date >= settings.startDate && !ignored.includes(g.garminId))
    .sort((a, b) => (`${a.date} ${a.startTime || ''}` < `${b.date} ${b.startTime || ''}` ? -1 : 1));
  const running = type => !(cfg.types || []).some(t => t.type === type);
  for (const g of mapped) {
    seen += 1;
    const week = weekNumber(parseISODate(g.date), settings.startDate);
    const known = all.find(r => r.garminId === g.garminId);
    if (known) {
      if (MEASURED.some(k => (known[k] === undefined ? null : known[k]) !== (g[k] === undefined ? null : g[k]))) {
        MEASURED.forEach(k => { known[k] = g[k]; });
        known.week = week;
        put.set(known.id, known); updated += 1;
      }
      continue;
    }
    const typed = all.find(r => !r.garminId && r.date === g.date && (g.guess ? running(r.type) : r.type === g.type));
    if (typed) {
      MEASURED.forEach(k => { if (g[k] !== null && g[k] !== undefined) typed[k] = g[k]; });
      Object.assign(typed, { garminId: g.garminId, source: 'garmin', week });
      put.set(typed.id, typed); updated += 1;
      continue;
    }
    const type = g.guess ? 'Easy run' : g.type;
    // v1.18.1: a run, or a bike or rower session, waits for Cameron's tap; a ski day counts for the long run by itself
    const planRun = g.countsForPlan ? planRunForType(plan, type) : null;
    const rec = { ...g, type, planId: planRun ? planRun.id : null, week, rpe: null, notes: '', appVersion, autoType: !!g.guess };
    if (g.guess) rec.autoWhy = WHY.garmin;
    delete rec.guess; delete rec.countsForPlan;
    all.push(rec); put.set(rec.id, rec); added += 1;
  }
  const weeks = [...new Set(all.filter(isAuto).map(r => r.week || weekNumber(parseISODate(r.date), settings.startDate)))];
  for (const w of weeks) for (const r of settleWeek(all, w, { plan, rules, settings })) put.set(r.id, r);
  return { put: [...put.values()], added, updated, seen };
}

// ---- v1.12: which planned run each run counts as (v1.18.1: only the one Cameron taps) ----

/**
 * A run whose type the app chose and may change again: a Garmin run Cameron has not re-typed. A run logged by hand,
 * or one whose type he tapped (typeLocked), is fixed. A Garmin run saved before v1.12 counts as automatic only while
 * it still has the old default type, Easy run.
 */
export function isAuto(r) {
  if (!r || r.typeLocked) return false;
  if (r.autoType !== undefined) return !!r.autoType;
  return String(r.id || '').startsWith('garmin-') && r.type === 'Easy run';
}

const WHY = {
  garmin: 'a run from Garmin counts for a planned run only when you say which one it was'
};

/**
 * v1.18.1: every automatic run in a week is an Easy run that counts for no planned run (Cameron, Nov 21: "dont
 * automatically count the Garmin run as intervals ... Maybe make me log it to take credit"). Until v1.18.0 this
 * guessed the planned run from the day, the distance and Garmin's interval signs. Runs he typed or counted stay as
 * they are. Returns the records that changed (edited in place).
 */
export function settleWeek(all, week, { rules, settings }) {
  const { start, end } = weekRange(settings, week);
  return all.filter(x => x.date >= start && x.date <= end && settleRun(x, rules));
}

/**
 * v1.18.1: one Garmin activity put right: an automatic run becomes an Easy run for no planned run; a bike or rower
 * session the old app counted by itself loses that credit (a ski day keeps it). A type he chose is never touched.
 * Returns true when it changed (edited in place). Also the one-time upgrade of runs saved before v1.18.1.
 */
export function settleRun(r, rules) {
  if (!r || r.typeLocked) return false;
  if (isAuto(r)) {
    if (r.type === 'Easy run' && (r.planId || null) === null && r.autoWhy === WHY.garmin && r.autoType === true) return false;
    Object.assign(r, { type: 'Easy run', planId: null, autoWhy: WHY.garmin, autoType: true });
    return true;
  }
  // a type from rules.garmin (not his), with credit the old app gave by itself
  const rule = rules && rules.garmin && String(r.id || '').startsWith('garmin-') && r.autoType === false ? (rules.garmin.types || []).find(t => t.type && t.type === r.type) : null;
  if (rule && !rule.countsForPlan && r.planId) { r.planId = null; return true; }
  return false;
}

/**
 * v1.12: where an open run can still go this week. rules.runSchedule.moveTo lists, per plan run, the days it can move
 * to (0 = Sunday). Days already past and lift days are left out. Returns weekday names in week order.
 */
export function openRunDays({ plan, rules, settings, runId, week, today }) {
  const days = ((rules && rules.runSchedule && rules.runSchedule.moveTo) || {})[runId] || [];
  const { start } = weekRange(settings, week);
  const todayIso = toISODate(today);
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const lift = id => (plan.sessions || []).some(s => s.id === id);
  return days.map(d => {
    const at = parseISODate(start); at.setDate(at.getDate() + ((d + 6) % 7));
    return { d, iso: toISODate(at) };
  }).filter(x => x.iso >= todayIso && !lift(plan.calendar[x.d])).sort((a, b) => (a.iso < b.iso ? -1 : 1)).map(x => ({ name: names[x.d], iso: x.iso, today: x.iso === todayIso }));
}
