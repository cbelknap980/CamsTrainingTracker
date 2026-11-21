// amrap.js - v1.19 (idea 7): the all-out last set on the main lifts, every other week (rules.amrap).
// Pure functions, no DOM. The builder marks the set; the Progression Engine reads it back with amrapCheck.

import { roundTo } from './data.js';

/** True when this week has all-out sets (rules.amrap.weeks). */
export function isAmrapWeek(rules, week) {
  const a = rules && rules.amrap;
  return !!(a && a.weeks && a.weeks.includes(week));
}

/**
 * Marks the last work set of each listed main lift as all-out. Called by buildTimeline before the lead-in steps are
 * added. setTiming is passed in (builder.js) so this file does not import the builder. Catch-up sessions are left as
 * they are: they only make up owed sets. Returns the same array.
 * A marked step gets: amrap true, auto false (it ends on Done, not on its timer), amrapFloor (the target reps, the
 * least it asks for), the all-out wording, a longer planned time, and the stop rule as its first tip.
 */
export function markAmrap({ rules, plan, week, exactSets }, steps, setTiming) {
  const a = rules && rules.amrap;
  if (!a || exactSets || !isAmrapWeek(rules, week)) return steps;
  const last = {};
  steps.forEach((s, i) => {
    if (s.kind !== 'set' || s.ramp || s.baseline || s.retest || s.iftime || s.holdSeconds || !s.exerciseId) return;
    if (a.exercises.includes(s.exerciseId)) last[s.exerciseId] = i;
  });
  for (const i of Object.values(last)) {
    const s = steps[i];
    const ex = plan.exercises[s.exerciseId];
    const floor = s.target && s.target.reps != null ? s.target.reps : (s.repRange ? s.repRange[0] : null);
    const top = s.repRange ? s.repRange[1] : floor;
    s.amrap = true;
    s.auto = false;
    s.amrapFloor = floor;
    s.effortText = `${a.label || 'All-out set'}: at least ${floor}, then as many good reps as you can`;
    if (a.rpeDefault != null) s.rpeDefault = a.rpeDefault;
    if (setTiming) s.seconds = setTiming(rules, ex, (top || floor || 5) + (a.extraRepsForTiming || 0), !!s.perSide).seconds;
    s.tips = [a.stopWhen, ...(s.tips || [])].filter(Boolean);
  }
  return steps;
}

/** Text for the reps of an all-out set: "5+" (the player and the start page use it). */
export function amrapRepsText(step) {
  return step && step.amrap && step.amrapFloor != null ? `${step.amrapFloor}+` : null;
}

/**
 * What the all-out set says about the next target. Called by applyProgression after the main-lift test.
 * set: the logged all-out set. top/bottom: the rep range. baseWeight: the weight the sets were done at.
 * up: the test already raised the weight. bwAdd: bodyweight for a weighted pull-up (its e1RM counts it).
 * Returns null when the set changes nothing, else { kind: 'hold' | 'jump' | 'note', weight, reps, text, reason }.
 */
export function amrapCheck({ rules, set, top, bottom, baseWeight, inc, bwAdd = 0, up }) {
  const a = rules && rules.amrap;
  if (!a || !set || !set.reps || set.weight == null || !top) return null;
  const reps = set.reps;
  // "good reps" stop about one short of failure, so the reps that were left at the top of the range:
  const reserve = reps + 1 - top;
  if (reserve <= a.holdBelowReserve) {
    if (!up) return { kind: 'note', reserve, text: reserve > 0 ? `All-out set: ${reps} reps, about ${reserve} left at ${top}.` : `All-out set: ${reps} reps.` };
    return { kind: 'hold', reserve, weight: baseWeight, reps: top,
      text: `All-out set: ${reps} reps, so the sets at ${top} were harder than they felt. Same weight next time.`,
      reason: `all-out set only ${reps}` };
  }
  if (reserve >= a.bigReserve && inc > 0) {
    const e1 = Math.round((set.weight + bwAdd) * (1 + (reps + 1) / 30));
    const implied = e1 / (1 + (top + (a.solidReserve || 2)) / 30) - bwAdd;
    const floorTo = Math.floor(implied / inc) * inc;
    const w = Math.min(baseWeight + (a.maxSteps || 3) * inc, Math.max(baseWeight + inc, floorTo));
    return { kind: 'jump', reserve, weight: roundTo(w, inc), reps: bottom,
      text: `All-out set: ${reps} reps, about ${reserve} left at ${top}. More in the tank than the effort taps said.`,
      reason: `all-out set: ${reps} reps` };
  }
  return { kind: 'note', reserve, text: `All-out set: ${reps} reps, about ${reserve} left at ${top}, in line with your effort taps.` };
}

/**
 * R4 rule 13 (v1.18.1 engine): the all-out check on a main lift's outcome, after mainLiftNext and before the target
 * is written. outcome = { weight, reps, stall, verdict, key, ... }; target = { weight, reps, stall } going in;
 * done = the done work sets; range = [lo, hi]. Returns null when there is no all-out set or it changes nothing,
 * else { outcome, text, reason } (text without the "Name: detail." start), or { note } to add to the usual line.
 * - reserve <= holdBelowReserve turns an 'up' into a hold at the same weight, flat count unchanged;
 * - reserve >= bigReserve, with every other set at its target weight and reps, raises the weight to what the
 *   all-out set says (amrapCheck), when that is more than the outcome already gives.
 */
export function allOutOutcome({ rules, outcome, target, done, range, inc, bwAdd = 0 }) {
  const set = (done || []).find(s => s.amrap && s.done !== false && !s.skipped);
  if (!set || !outcome || ['nothing', 'light', 'unrated'].includes(outcome.key)) return null;
  const [lo, hi] = range;
  const up = outcome.verdict === 'up';
  const c = amrapCheck({ rules, set, top: hi, bottom: lo, baseWeight: set.weight != null ? set.weight : target.weight, inc, bwAdd, up });
  if (!c) return null;
  if (c.kind === 'hold') {
    const reps = outcome.key === 'top' ? hi : Math.min(Math.max(target.reps != null ? target.reps : lo, lo), hi);
    return { outcome: { ...outcome, weight: target.weight, reps, stall: target.stall || 0, verdict: 'hold', key: 'allOutHold' },
      text: `${c.text.replace(' Same weight next time.', '')} Same target next time.`, reason: c.reason };
  }
  if (c.kind === 'jump') {
    const others = done.filter(s => s !== set && !s.amrap);
    const met = others.every(s => s.done !== false && !s.skipped && (!s.target || ((s.target.reps == null || (s.reps || 0) >= s.target.reps) && (s.target.weight == null || s.weight == null || s.weight >= s.target.weight))));
    if (!met || outcome.verdict === 'drop') return { note: `All-out set: ${set.reps} reps. That raises the weight further only on a day every other set reaches its target.` };
    if (outcome.weight != null && c.weight <= outcome.weight) return { note: c.text };
    return { outcome: { ...outcome, weight: c.weight, reps: lo, stall: 0, verdict: 'up', key: 'allOutJump' },
      text: `${c.text} Next time ${fmtW(c.weight)} lb x ${lo}.`, reason: c.reason };
  }
  return { note: c.text };
}

function fmtW(w) { return Number.isInteger(w) ? `${w}` : w.toFixed(1); }
