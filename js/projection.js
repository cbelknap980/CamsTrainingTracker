// projection.js (v1.18.5) - where one exercise could be by week 12, worked out by running the app's own progression
// rules (progression.js, rules R4) over every session still to come. Cameron, Nov 24: "In plan show what you would
// estimate my growth to be over the 12 weeks per exercise when I click in."
// v1.18.8 (Cameron, Nov 24: "What happens if I struggle vs if I do well"): three runs. Main lifts on the weekly rule:
// "well" (every session Solid or easier, so a step every week), "steady" (every other session Hard, which holds) and
// "struggle" (a rep short two sessions in three, so a step every third week and no reset). Accessories: "well" (last set
// Solid, two reps a session), "steady" (last set Hard, one rep) and "struggle" (every other session a rep short).
// Pure functions, no DOM, no storage.

import { applyProgression, effectiveTarget, epley, bodyweightOf, isExcluded, weeklyFor, incrementFor } from './progression.js';
import { weekNumber, phaseForWeek, parseISODate, toISODate, snapLoad } from './data.js';

const SOLID = 8;
// v1.18.7: accessories are planned at 0-2 reps left, so their lines assume a Hard last set (one more rep a session);
// a Solid or Easy last set moves them faster than either line (rules.lastSetRating).
const HARD = 9;

/** Every session from `today` to the end of week 12 that has this exercise and is not logged yet, in order. */
export function occurrences({ plan, settings, sessions, exerciseId, today }) {
  const out = [];
  const start = parseISODate(settings.startDate);
  const end = new Date(start); end.setDate(start.getDate() + 12 * 7);
  const d = parseISODate(toISODate(today));
  for (; d < end; d.setDate(d.getDate() + 1)) {
    const id = plan.calendar[String(d.getDay())];
    const s = id && plan.sessions.find(x => x.id === id);
    if (!s) continue;
    const week = weekNumber(d, settings.startDate);
    if (week < 1 || week > 12) continue;
    if ((sessions || []).some(x => x.sessionId === id && x.week === week)) continue;
    for (const b of s.blocks) {
      const item = (b.items || []).find(it => it.exercise === exerciseId);
      if (item) { out.push({ week, date: toISODate(d), sessionId: id, item, block: b }); break; }
    }
  }
  return out;
}

function rangeFor(rules, ex, item, phaseId) {
  if (phaseId === 'heavy' && ex.mainLift && ex.autoProgress !== false && item.reps) return [...rules.phases.heavy.mainLiftReps];
  return item.reps ? [...item.reps] : null;
}

/** The three cases: for session i of the lift, the effort on every set and whether the last set falls a rep short. */
export function scenarios(weekly) {
  return weekly
    ? { well: { rpe: () => SOLID, short: () => false }, steady: { rpe: i => (i % 2 === 1 ? HARD : SOLID), short: () => false }, struggle: { rpe: () => SOLID, short: i => i % 3 !== 2 } }
    : { well: { rpe: () => SOLID, short: () => false }, steady: { rpe: () => HARD, short: () => false }, struggle: { rpe: () => HARD, short: i => i % 2 === 1 } };
}

/** One run of the rules over the sessions left. sc = { rpe(i), short(i) }. Returns { week: { weight, reps } }. */
function run({ plan, rules, settings, exerciseId, target, occ, sc }) {
  const ex = plan.exercises[exerciseId];
  // no line runs past rules.projection.maxGain over today's estimated max: straight-line steps never last 12 weeks
  const gain = ((rules.projection || {}).maxGain || {})[ex.mainLift ? 'main' : 'accessory'];
  const e0 = e1rmOf(ex, target, settings);
  const cap = gain != null && e0 ? e0 * (1 + gain) : Infinity;
  let targets = { [exerciseId]: { ...target } };
  const byWeek = {};
  occ.forEach((o, i) => {
    const ph = phaseForWeek(plan, o.week);
    if (ph.id === 'retest' && ex.mainLift) return;                     // week 12 is the retest, not a training session
    const range = rangeFor(rules, ex, o.item, ph.id);
    const t = effectiveTarget({ rules, plan, settings, exerciseId, target: targets[exerciseId], phaseId: ph.id }) || {};
    let reps = t.reps != null ? t.reps : (range ? range[0] : null);
    if (range && reps != null) reps = Math.min(Math.max(reps, range[0]), range[1]);
    let n = o.item.sets || o.block.rounds || 3;
    if (ph.id === 'light') n = Math.max(1, Math.round(n * rules.phases.light.setFactor));
    const sets = Array.from({ length: n }, (_, k) => ({
      exerciseId, setIndex: k + 1, weight: t.weight != null ? t.weight : null,
      reps: reps != null && sc.short(i) && k === n - 1 ? Math.max(0, reps - 1) : reps,
      target: { weight: t.weight, reps }, repRange: range, rpe: sc.rpe(i), done: true
    }));
    const res = applyProgression({ session: { id: `p${i}`, week: o.week, phase: { id: ph.id }, endedAt: `${o.date}T20:00:00Z`, sets }, targets, rules, plan, settings });
    const got = res.targets[exerciseId] || {};
    const e = e1rmOf(ex, got, settings);
    if (!(e != null && e > cap && e > (e1rmOf(ex, targets[exerciseId], settings) || 0))) targets = res.targets;
    const nt = targets[exerciseId] || {};
    byWeek[o.week] = { weight: nt.weight != null ? nt.weight : null, reps: nt.reps != null ? nt.reps : null };
  });
  return byWeek;
}

/** An estimated 1RM for a target (bodyweight in for the pull-up), or null for a lift with no weight. */
export function e1rmOf(ex, t, settings) {
  if (!t || t.weight == null || !t.reps) return null;
  const add = ex && ex.equipment === 'weighted_bw' ? bodyweightOf(settings) : 0;
  return epley(t.weight + add, t.reps);
}

export const CASES = ['well', 'steady', 'struggle'];

/**
 * projectExercise -> null when there is nothing to project (no target yet, nothing left on the calendar), else
 * { kind: 'weight' | 'reps', now, weeks: [{ week, phase, well, steady, struggle }], end: { well, steady, struggle },
 *   sessionsLeft, mainLift, weekly }. Every target is { weight, reps, e1rm, max }: max is the estimated best single
 * as the lift is loaded (added weight on the pull-up), the number the chart draws; fiveRep is the weight that max
 * gives for 5 reps (the week-12 retest), rounded to the lift's step.
 * `weeks` holds the current week and every week after it; a week with no session repeats the one before.
 */
export function projectExercise({ plan, rules, settings, sessions, targets, exerciseId, today }) {
  const ex = plan.exercises[exerciseId];
  const stored = targets && targets[exerciseId];
  if (!ex || !stored || (stored.weight == null && stored.reps == null)) return null;
  // the power clean follows the doubles he picks (rules R4 rule 9): nothing to run forward
  if (isExcluded(rules, exerciseId, ex)) return { kind: 'self', now: { weight: stored.weight, reps: stored.reps, e1rm: e1rmOf(ex, stored, settings) } };
  const target = { ...stored, weight: snapLoad(rules, ex, stored.weight) };
  const occ = occurrences({ plan, settings, sessions, exerciseId, today });
  if (!occ.length) return null;
  const kind = target.weight != null ? 'weight' : 'reps';
  const weekly = !!(ex.mainLift && weeklyFor(rules, exerciseId));
  const add = ex.equipment === 'weighted_bw' ? bodyweightOf(settings) : 0;
  const inc = incrementFor(rules, exerciseId, ex) || 5;
  const withE = t => {
    if (!t) return null;
    const e1rm = e1rmOf(ex, t, settings);
    return { ...t, e1rm, max: e1rm != null ? Math.round(e1rm - add) : null, fiveRep: e1rm != null ? Math.floor((e1rm / (1 + 5 / 30) - add) / inc + 1e-9) * inc : null };
  };
  const sc = scenarios(weekly);
  const runs = {};
  for (const c of CASES) runs[c] = run({ plan, rules, settings, exerciseId, target, occ, sc: sc[c] });
  const now = withE({ weight: target.weight != null ? target.weight : null, reps: target.reps });
  const weeks = [];
  const last = { well: now, steady: now, struggle: now };
  for (let w = occ[0].week; w <= 12; w++) {
    for (const c of CASES) if (runs[c][w]) last[c] = withE(runs[c][w]);
    weeks.push({ week: w, phase: phaseForWeek(plan, w).id, ...last });
  }
  return { kind, now, weeks, end: { ...last }, sessionsLeft: occ.length, mainLift: !!ex.mainLift, weekly, oldBest: ex.oldBest && ex.oldBest.lb ? ex.oldBest.lb : null, standard: ex.standard && ex.standard.lb ? { lb: ex.standard.lb, label: ex.standard.label || 'Benchmark' } : null };
}
