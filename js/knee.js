// knee.js - v1.19 (idea 1): the knee check. Pure functions, no DOM (the cards and the 0-10 picker are in knee-ui.js).
// Rules in rules.knee. A score is { id, at (ISO), date (YYYY-MM-DD), score 0-10, when: 'set' | 'morning' | 'before',
// sessionId?, exerciseId? }, kept in the kv store under 'knee' (store.js getKneeLog / addKneeScore).

import { toISODate, parseISODate } from './data.js';

const DAY = 86400000;

export function kneeRules(rules) { return (rules && rules.knee) || null; }

/** Newest score first. */
export function sortedLog(log) { return [...(log || [])].sort((a, b) => String(b.at).localeCompare(String(a.at))); }

/** The newest score within rules.knee.carryDays of now, or null. */
export function latestScore(rules, log, now = new Date()) {
  const k = kneeRules(rules);
  if (!k) return null;
  const last = sortedLog(log)[0];
  if (!last) return null;
  const age = (startOfDay(now) - startOfDay(new Date(last.at))) / DAY;
  return age <= (k.carryDays != null ? k.carryDays : 4) ? last : null;
}

/** The score that turns the knee swaps on for a new session (newest score, recent, at swapAt or more), or null. */
export function swapScore(rules, log, now = new Date()) {
  const k = kneeRules(rules);
  const last = latestScore(rules, log, now);
  return k && last && last.score >= k.swapAt ? last : null;
}

/** True when a step's lift has a knee fallback. */
export function hasFallback(rules, exerciseId) {
  const k = kneeRules(rules);
  return !!(k && k.fallbacks && k.fallbacks[exerciseId]);
}

/** The lifts in a timeline that the swaps would change, in order, as { id, from, to }. */
export function swappable(rules, plan, steps) {
  const out = [];
  for (const s of steps || []) {
    if (s.kind !== 'set' || !hasFallback(rules, s.exerciseId) || out.some(o => o.id === s.exerciseId)) continue;
    out.push({ id: s.exerciseId, from: (plan.exercises[s.exerciseId] || {}).name || s.name, to: rules.knee.fallbacks[s.exerciseId].name });
  }
  return out;
}

/**
 * Swaps the sets of every lift with a fallback, from step fromIdx on: the name, cue and tips change and the set is
 * marked kneeSwap (the Progression Engine holds that lift's weight and leaves the set out of its records). The set-up
 * steps in front of those sets are renamed too. Mutates the steps; returns the lifts it changed ({ id, from, to }).
 * onlyIds limits it to some lifts.
 */
export function applyKneeSwap(steps, rules, plan, { fromIdx = 0, onlyIds = null } = {}) {
  const k = kneeRules(rules);
  if (!k || !k.fallbacks) return [];
  const changed = [];
  for (let i = fromIdx; i < steps.length; i++) {
    const s = steps[i];
    const fb = s.exerciseId && k.fallbacks[s.exerciseId];
    if (!fb || (onlyIds && !onlyIds.includes(s.exerciseId)) || s.kind !== 'set' || s.kneeSwap || s.done) continue;
    const from = (plan.exercises[s.exerciseId] || {}).name || s.name;
    s.kneeOrig = { name: s.name, cue: s.cue, tips: s.tips };
    s.kneeSwap = true;
    s.name = fb.name;
    s.cue = fb.cue || s.cue;
    if (fb.tips && !s.ramp) s.tips = s.amrap ? [s.tips[0], ...fb.tips] : [...fb.tips];
    if (!changed.some(c => c.id === s.exerciseId)) changed.push({ id: s.exerciseId, from, to: fb.name });
  }
  // set-up and switch steps name the lift that comes next
  for (let i = fromIdx; i < steps.length; i++) {
    const s = steps[i];
    for (const c of changed) {
      if (typeof s.name === 'string' && s.kind !== 'set' && s.name.includes(c.from)) { s.kneeOrigName = s.kneeOrigName || s.name; s.name = s.name.split(c.from).join(c.to); }
      if (typeof s.setupFor === 'string' && s.setupFor.includes(c.from)) { s.kneeOrigSetup = s.kneeOrigSetup || s.setupFor; s.setupFor = s.setupFor.split(c.from).join(c.to); }
    }
  }
  return changed;
}

/** Puts the regular lift back on the sets still to come (a lower score in the middle of a session). Returns how many. */
export function undoKneeSwap(steps, { fromIdx = 0 } = {}) {
  let n = 0;
  for (let i = fromIdx; i < steps.length; i++) {
    const s = steps[i];
    if (s.kneeSwap && !s.done && s.kneeOrig) { Object.assign(s, s.kneeOrig); delete s.kneeOrig; s.kneeSwap = false; n++; }
    else if (!s.done && (s.kneeOrigName || s.kneeOrigSetup)) {
      if (s.kneeOrigName) { s.name = s.kneeOrigName; delete s.kneeOrigName; }
      if (s.kneeOrigSetup) { s.setupFor = s.kneeOrigSetup; delete s.kneeOrigSetup; }
    }
  }
  return n;
}

/** Index of the work set after which the session asks for a knee score: the first work set of the first askAfter lift. */
export function askIdx(rules, steps) {
  const k = kneeRules(rules);
  if (!k) return -1;
  return (steps || []).findIndex(s => s.kind === 'set' && !s.ramp && !s.baseline && !s.holdSeconds && k.askAfter.includes(s.exerciseId));
}

/**
 * The Home prompt for the day after: the newest saved session that has an askAfter lift, if it was yesterday and no
 * morning score is logged today. Returns { session } or null.
 */
export function morningDue(rules, log, sessions, now = new Date()) {
  const k = kneeRules(rules);
  if (!k) return null;
  const today = toISODate(now);
  const yesterday = toISODate(new Date(startOfDay(now) - DAY / 2));
  if ((log || []).some(e => e.when === 'morning' && e.date === today)) return null;
  const leg = (sessions || []).filter(s => (s.sets || []).some(x => x.done && k.askAfter.includes(x.exerciseId)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  return leg && leg.date === yesterday ? { session: leg } : null;
}

/**
 * Whether a lift's weight holds after this session: a set swapped to the knee fallback, or a knee score at swapAt
 * or more taken on this lift. Returns { text, reason } or null. sets: the logged sets of one exercise.
 */
export function kneeHeld(rules, sets) {
  const k = kneeRules(rules);
  if (!k) return null;
  const swapped = sets.filter(s => s.kneeSwap && s.done && !s.skipped);
  const scored = sets.filter(s => s.knee != null).map(s => s.knee);
  const worst = scored.length ? Math.max(...scored) : null;
  if (swapped.length) {
    const fb = k.fallbacks && k.fallbacks[swapped[0].exerciseId];
    return { text: `Knee${worst != null ? ` ${worst}/10` : ''}: ${swapped.length} ${swapped.length === 1 ? 'set' : 'sets'} done as ${fb ? fb.name.toLowerCase() : 'the knee version'}.`, reason: `knee${worst != null ? ` ${worst}/10` : ''}: ${fb ? fb.name.split(',')[0].toLowerCase() : 'knee version'}` };
  }
  if (worst != null && worst >= k.swapAt) return { text: `Knee ${worst}/10 today.`, reason: `knee ${worst}/10` };
  return null;
}

/** Scores per day for the trend, oldest first: the highest score each day. */
export function kneeTrend(log, days = 84, now = new Date()) {
  const from = startOfDay(now) - days * DAY;
  const byDay = {};
  for (const e of log || []) {
    if (!e.date || parseISODate(e.date).getTime() < from) continue;
    byDay[e.date] = Math.max(byDay[e.date] != null ? byDay[e.date] : -1, e.score);
  }
  return Object.keys(byDay).sort().map(date => ({ date, score: byDay[date] }));
}

/** A new log entry (the caller saves it). */
export function kneeEntry(score, when, extra = {}, now = new Date()) {
  return { id: `knee_${now.getTime().toString(36)}`, at: now.toISOString(), date: toISODate(now), score: Math.max(0, Math.min(10, Math.round(score))), when, ...extra };
}

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
