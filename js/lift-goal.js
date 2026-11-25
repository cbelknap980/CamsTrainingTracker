// lift-goal.js (v1.18.11) - a goal or a hand-set target for one lift, checked before it can move anything, and the
// week-by-week numbers the Plan chart draws. Cameron, Nov 25: "Allow me to edit and override as an option if I want
// to push towards a goal." His rule from Nov 19 holds here too: a number that doesn't make sense is flagged for him to
// look at, and it can't change the plan until he says it is right.
// Pure functions, no DOM, no storage.

import { epley, goalMax, incrementFor, isExcluded, weeklyFor, bodyweightOf } from './progression.js';
import { numberFlag, impossibleNumber } from './sanity.js';
import { fmtWeight, dumbbellOk } from './data.js';

/** A goal more than this far over today's estimated max (on the load moved) reads as a typo and can't be saved. */
export const GOAL_TYPO = 0.5;
/** Reps a goal can be set for: past 12 an estimated max says little. */
export const GOAL_REPS = [1, 12];

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
 * The points the Plan chart draws, from projection.js projectExercise. mode 'weight': the target for the week (the bar
 * weight, or reps on a bodyweight lift); mode 'max': the estimated max. One entry per column: the "now" column, then
 * every week to 12. A main lift's week 12 is the retest: in weight mode it is the 5-rep weight its max gives, drawn on
 * its own (retest: true).
 * Returns [{ week, now, phase, retest, v: { well, steady, struggle }, t: { well, steady, struggle } }].
 */
export function chartColumns(p, mode) {
  const C = ['well', 'steady', 'struggle'];
  const reps = p.kind === 'reps';
  const cols = [{ week: p.weeks[0].week - 1, now: true, phase: null, retest: false, t: { well: p.now, steady: p.now, struggle: p.now } }];
  for (const w of p.weeks) {
    const retest = !!(p.mainLift && !reps && w.phase === 'retest');
    cols.push({ week: w.week, now: false, phase: w.phase, retest, t: { well: w.well, steady: w.steady, struggle: w.struggle } });
  }
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

/** The first week whose estimated max reaches `max` in case c, or null. */
export function weekReaching(p, c, max) {
  if (max == null || p.kind !== 'weight') return null;
  const w = p.weeks.find(x => x[c] && x[c].max != null && x[c].max >= max);
  return w ? w.week : null;
}
