// projection.js (v1.18.5) - where one exercise could be by week 12, worked out by running the app's own progression
// rules (progression.js, rules R4) over every session still to come. Cameron, Nov 24: "In plan show what you would
// estimate my growth to be over the 12 weeks per exercise when I click in."
// Two runs: "on plan" (every set makes its reps at Solid or easier) and "slower" (every other session falls a rep
// short on its last set, so the lift moves about half as often). Pure functions, no DOM, no storage.

import { applyProgression, effectiveTarget, epley, bodyweightOf, isExcluded, weeklyFor } from './progression.js';
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

/** One run of the rules: short(i) says whether occurrence i falls a rep short on its last set. */
function run({ plan, rules, settings, exerciseId, target, occ, short }) {
  const ex = plan.exercises[exerciseId];
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
      reps: reps != null && short(i) && k === n - 1 ? Math.max(0, reps - 1) : reps,
      target: { weight: t.weight, reps }, repRange: range, rpe: ex.mainLift ? SOLID : HARD, done: true
    }));
    const res = applyProgression({ session: { id: `p${i}`, week: o.week, phase: { id: ph.id }, endedAt: `${o.date}T20:00:00Z`, sets }, targets, rules, plan, settings });
    targets = res.targets;
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

/**
 * projectExercise -> null when there is nothing to project (no target yet, nothing left on the calendar), else
 * { kind: 'weight' | 'reps', now: { weight, reps, e1rm }, weeks: [{ week, phase, plan: { weight, reps, e1rm },
 *   slower: { ... } }], end: { plan, slower }, sessionsLeft }
 * `weeks` holds week 'now' (the current week, before anything left in it) and every week after with a session.
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
  const onPlan = run({ plan, rules, settings, exerciseId, target, occ, short: () => false });
  const slower = run({ plan, rules, settings, exerciseId, target, occ, short: i => i % 2 === 1 });
  const withE = t => (t ? { ...t, e1rm: e1rmOf(ex, t, settings) } : null);
  const now = withE({ weight: target.weight != null ? target.weight : null, reps: target.reps });
  const weeks = [];
  let lastP = now, lastS = now;
  const first = occ[0].week;
  for (let w = first; w <= 12; w++) {
    if (onPlan[w]) lastP = withE(onPlan[w]);
    if (slower[w]) lastS = withE(slower[w]);
    weeks.push({ week: w, phase: phaseForWeek(plan, w).id, plan: lastP, slower: lastS });
  }
  return { kind, now, weeks, end: { plan: lastP, slower: lastS }, sessionsLeft: occ.length, mainLift: !!ex.mainLift, weekly: !!(ex.mainLift && weeklyFor(rules, exerciseId)) };
}
