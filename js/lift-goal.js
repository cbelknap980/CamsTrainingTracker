// lift-goal.js (v1.18.11) - a goal or a hand-set target for one lift, checked before it can move anything, and the
// week-by-week numbers the Plan chart draws. Cameron, Nov 25: "Allow me to edit and override as an option if I want
// to push towards a goal." His rule from Nov 19 holds here too: a number that doesn't make sense is flagged for him to
// look at, and it can't change the plan until he says it is right.
// Pure functions, no DOM, no storage.

import { epley, goalMax, incrementFor, isExcluded, weeklyFor, bodyweightOf, effectiveTarget } from './progression.js';
import { numberFlag, impossibleNumber } from './sanity.js';
import { fmtWeight, dumbbellOk, snapLoad, weekNumber } from './data.js';

/** A goal more than this far over today's estimated max (on the load moved) reads as a typo and can't be saved. */
export const GOAL_TYPO = 0.5;
/** Reps a goal can be set for: past 12 an estimated max says little. */
export const GOAL_REPS = [1, 12];

/** The week the session next comes round from today (not logged yet), for its phase: lighter week, heavier weeks. */
export function nextWeekOf(plan, settings, sessions, sessionId, today) {
  for (let i = 0; i < 7 * 13; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    if (plan.calendar[String(d.getDay())] !== sessionId) continue;
    const w = weekNumber(d, settings.startDate);
    if (w > 12) break;
    if (w >= 1 && !(sessions || []).some(x => x.sessionId === sessionId && x.week === w)) return w;
  }
  return Math.max(1, Math.min(12, weekNumber(today, settings.startDate)));
}

/**
 * What a plan item asks for the next time its session comes round, the way the workout builds it (builder.js setsFor,
 * repRangeFor, targetFor): sets cut on the lighter week, reps held inside the item's range (3 to 5 on a main lift in
 * the heavier weeks), the heavier weeks' start, and a weight the rack can make.
 * Returns { sets, reps, range, weight, hold } (hold: seconds on a timed item).
 */
export function nextNumbers({ plan, rules, settings }, it, b, t, phaseId) {
  const ex = plan.exercises[it.exercise] || { name: it.exercise };
  const light = rules && rules.phases && rules.phases.light;
  const cut = n => (n && phaseId === 'light' && light ? Math.max(1, Math.ceil(n * light.setFactor)) : n);
  let sets;
  if (b.type === 'finisher') { const rounds = cut(b.rounds); sets = it.rounds ? it.rounds.filter(r => r <= rounds).length : rounds; }
  else sets = cut(it.sets || null);
  const heavy = phaseId === 'heavy' && ex.mainLift && ex.autoProgress !== false && it.reps && rules ? rules.phases.heavy.mainLiftReps : null;
  const range = heavy ? [...heavy] : (it.reps ? [...it.reps] : null);
  if (it.seconds) return { sets, reps: null, range, weight: null, hold: it.seconds };
  const eff = t && rules ? (effectiveTarget({ rules, plan, settings, exerciseId: it.exercise, target: t, phaseId }) || t) : t;
  const weight = eff && eff.weight != null ? snapLoad(rules, ex, eff.weight) : null;
  let reps = eff && eff.reps != null ? eff.reps : null;
  if (range && reps != null) reps = Math.min(Math.max(reps, range[0]), range[1]);
  return { sets, reps, range, weight, hold: null };
}

const num = x => (x === '' || x == null ? null : Number(x));
const pct = x => `${Math.round(x * 100)}%`;
const addOf = (ex, settings) => (ex && ex.equipment === 'weighted_bw' ? bodyweightOf(settings) : 0);

/** True when the lift can push: a main lift on the weekly rule that the app raises (not the power clean). */
export function canPush(rules, exerciseId, ex) {
  return !!(ex && ex.mainLift && !isExcluded(rules, exerciseId, ex) && weeklyFor(rules, exerciseId));
}

/** The extra pounds a push adds to each clean session's step: one more of the lift's steps (5 + 5 on the squat). */
export function pushStep(rules, exerciseId, ex) {
  return incrementFor(rules, exerciseId, ex) || 5;
}

/**
 * A goal's estimated max as the lift is loaded (added weight on the pull-up), the unit the chart and the projection
 * use: a single is its own weight.
 */
export function goalShownMax(ex, goal, settings) {
  if (!goal || !(goal.weight != null) || !goal.reps) return null;
  const add = addOf(ex, settings);
  return Math.round(goalMax(goal.weight + add, goal.reps) - add);
}

/** The weight a goal's estimated max gives for `reps` (the week-12 retest's 5), on the lift's step. */
export function goalAtReps(ex, goal, reps, settings, step = 5) {
  const add = addOf(ex, settings);
  const m = goalMax(goal.weight + add, goal.reps);
  return Math.floor((m / (1 + reps / 30) - add) / step + 1e-9) * step;
}

/**
 * Check a goal before it is saved. goal = { weight, reps }; now = { weight, reps } (today's target).
 * Returns { level: 'block' | 'flag' | 'ok', text, max (shown, added weight on the pull-up), gain (share over today) }.
 * block: can't be saved (not a number, already past it, or so far over today it looks like a typo).
 * flag: past what the research says a block like this adds; saved only after he says so.
 */
export function checkGoal({ rules, plan, settings, exerciseId, goal, now }) {
  const ex = plan.exercises[exerciseId];
  const w = num(goal && goal.weight), r = num(goal && goal.reps);
  if (w == null || Number.isNaN(w)) return { level: 'block', text: 'Enter the weight you want to lift.' };
  if (r == null || Number.isNaN(r)) return { level: 'block', text: 'Enter the reps.' };
  const bad = impossibleNumber({ weight: w, reps: r }, ex);
  if (bad) return { level: 'block', text: `${bad}.` };
  if (r < GOAL_REPS[0] || r > GOAL_REPS[1]) return { level: 'block', text: `Pick ${GOAL_REPS[0]} to ${GOAL_REPS[1]} reps. Past ${GOAL_REPS[1]}, an estimated max says little.` };
  const bar = rules.rampUp && rules.rampUp.barWeightLb;
  if (ex && ex.equipment === 'barbell' && bar && w < bar) return { level: 'block', text: `${fmtWeight(w)} lb is less than the empty bar (${bar} lb).` };
  if (!now || now.weight == null || !now.reps) return { level: 'block', text: 'This lift needs a target first. It gets one from the first session you log.' };
  const add = addOf(ex, settings);
  const m0 = epley(now.weight + add, now.reps);
  const m = goalMax(w + add, r);
  const shown = Math.round(m - add), shown0 = Math.round(m0 - add);
  const gain = m / m0 - 1;
  const unit = ex && ex.equipment === 'weighted_bw' ? ' added' : '';
  if (!(m > m0)) return { level: 'block', max: shown, gain, text: `You're already there: today's ${fmtWeight(now.weight)} × ${now.reps} works out to an estimated max of ${fmtWeight(shown0)} lb${unit}. Pick a bigger number.` };
  if (gain > GOAL_TYPO) return { level: 'block', max: shown, gain, text: `That works out to ${pct(gain)} over today's estimated max of ${fmtWeight(shown0)} lb${unit}. That looks like a typo, so it can't be saved.` };
  const capShare = ((rules.projection || {}).maxGain || {})[ex && ex.mainLift ? 'main' : 'accessory'];
  const lead = `Estimated max ${fmtWeight(shown)} lb${unit}, ${fmtWeight(shown - shown0)} lb (${pct(gain)}) over today's ${fmtWeight(shown0)}.`;
  if (capShare != null && gain > capShare + 1e-9) {
    return { level: 'flag', max: shown, gain, text: `${lead} That's past the ${pct(capShare)} a trained lifter adds at best in a block this long (about 17.5 kg on the squat in 8 to 12 weeks, Androulakis-Korakakis 2020), so no line on the chart reaches it.` };
  }
  return { level: 'ok', max: shown, gain, text: lead };
}

/**
 * Check a next target typed by hand before it is saved. Returns { level: 'block' | 'flag' | 'ok', text }.
 * The same tests as a logged set (sanity.js numberFlag) against the target it replaces, plus reps outside the plan's
 * range and a barbell weight that isn't a 5 lb step.
 */
export function checkTarget({ rules, plan, exerciseId, current, weight, reps, range }) {
  const ex = plan.exercises[exerciseId];
  const w = num(weight), r = num(reps);
  const needsWeight = current && current.weight != null;
  if (needsWeight && (w == null || Number.isNaN(w))) return { level: 'block', text: 'Enter a weight.' };
  if (r == null || Number.isNaN(r) || r < 1) return { level: 'block', text: 'Enter the reps (1 or more).' };
  const bad = impossibleNumber({ weight: w, reps: r }, ex);
  if (bad) return { level: 'block', text: `${bad}.` };
  const flag = numberFlag({ weight: w, reps: r, target: { weight: current ? current.weight : null }, repRange: range || null, done: true }, ex, rules);
  if (flag && ['under-bar', 'negative'].includes(flag.code)) return { level: 'block', text: `${flag.text}.` };
  if (flag) return { level: 'flag', text: `${flag.text}. Is that right?` };
  if (range && (r < range[0] || r > range[1])) return { level: 'flag', text: `The plan has ${range[0]} to ${range[1]} reps here. Keep ${r}?` };
  if (w != null && ex && ex.equipment === 'barbell' && Math.abs(w / 5 - Math.round(w / 5)) > 1e-9) return { level: 'flag', text: `${fmtWeight(w)} lb isn't a 5 lb step. Keep it?` };
  if (w != null && !dumbbellOk(rules, ex, w)) return { level: 'flag', text: 'Your gym has no dumbbell that size. Keep it?' };
  return { level: 'ok', text: '' };
}

/**
 * The points the Plan chart draws, from projection.js projectExercise: one column per week from the next session's
 * week to 12, each with what that week's session asks for (week.lift), so week 3 is the target he has now.
 * mode 'weight': the weight on the bar (reps on a bodyweight lift); mode 'max': its estimated max. A main lift's week
 * 12 is the retest: the strength the block built (the target after week 11), shown as the 5-rep weight it gives
 * (retest: true).
 * Returns [{ week, phase, retest, v: { well, steady, struggle }, t: { well, steady, struggle } }].
 */
export function chartColumns(p, mode) {
  const C = ['well', 'steady', 'struggle'];
  const reps = p.kind === 'reps';
  const cols = p.weeks.map(w => {
    const retest = !!(p.mainLift && !reps && w.phase === 'retest');
    return { week: w.week, phase: w.phase, retest, t: retest ? { well: p.end.well, steady: p.end.steady, struggle: p.end.struggle } : { ...(w.lift || { well: w.well, steady: w.steady, struggle: w.struggle }) } };
  });
  const seen = {};
  for (const col of cols) {
    col.v = {};
    for (const c of C) {
      const t = col.t[c];
      let v = null;
      if (t) {
        if (reps) v = t.reps;
        else if (mode === 'max') v = t.max;
        else v = col.retest ? t.fiveRep : t.weight;
      }
      // estimated max: the first heavier week trades reps for weight and can read a few pounds lower; draw it level
      // (a real fall, a 5% reset, is bigger and still shows)
      if (mode === 'max' && v != null && seen[c] != null && v < seen[c] && seen[c] - v <= 5) v = seen[c];
      if (mode === 'max' && v != null) seen[c] = v;
      col.v[c] = v;
    }
  }
  return cols;
}

/**
 * The first week whose session works out to `max` or more in case c (estimated max of what that week asks for), or
 * null. A main lift's week 12 counts the retest: the strength the block built.
 */
export function weekReaching(p, c, max) {
  if (max == null || p.kind !== 'weight') return null;
  const col = chartColumns(p, 'max').find(x => x.t[c] && x.t[c].max != null && x.t[c].max >= max);
  return col ? col.week : null;
}
