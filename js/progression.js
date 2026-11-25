// progression.js - Progression Engine: runs once after a session saves.
// Pure function. Every number comes from rules.json; this file only knows how to apply a rule.
// v1.18.1: the rules are R4 from the Nov 20 plan review, approved by Cameron (rules_R4.txt and its reference
// ref4.mjs are in the project files; diff_engine4.mjs checks this file against them on random sessions). A session is
// read against its planned sets; a flat session is a miss at the target weight, or a Hard or Maxed set when
// rules.stall.flatAtRpe says so; rules.stall.sessionsBeforeDrop flat sessions in a row take dropFraction off.

import { roundTo, fmtWeight, snapLoad } from './data.js';

/** data/settings.json's bodyweight: the pull-up's percentages use it when Settings has none (R4 rule 8, never 0). */
const DEFAULT_BODYWEIGHT = 165;
const EPS = 1e-9;
const okNum = x => typeof x === 'number' && Number.isFinite(x);
/** A set the rules can read: reps and a weight (0 is a weight: a pull-up at bodyweight). */
const usable = s => !!s && okNum(s.reps) && okNum(s.weight);
const clampTo = (r, [lo, hi]) => Math.max(lo, Math.min(hi, r));

/** The power clean (and any lift the plan marks autoProgress false): the app never raises it. */
export function isExcluded(rules, exerciseId, ex) {
  return !!((ex && ex.autoProgress === false) || ((rules && rules.excludeFromAutoProgression) || []).includes(exerciseId));
}

/** v1.18.6 (rules R5): the weekly-step settings for a main lift listed in rules.mainLiftTest.weekly, else null. */
export function weeklyFor(rules, exerciseId) {
  const w = rules && rules.mainLiftTest && rules.mainLiftTest.weekly;
  return w && Array.isArray(w.exercises) && w.exercises.includes(exerciseId) ? w : null;
}

/** v1.18.7: rules.lastSetRating when it is switched on (decides: true), else null. */
export function lastSetRule(rules) {
  const r = rules && rules.lastSetRating;
  return r && r.decides ? r : null;
}

/**
 * v1.18.11 (Cameron, Nov 25: "Allow me to edit and override as an option if I want to push towards a goal"): extra
 * pounds on a weekly main lift's step up while he pushes toward a goal he set in Plan (settings.liftGoals[id] =
 * { weight, reps, push }). 0 when there is no goal, it does not push, the lift is not on the weekly rule, or the target
 * already reaches the goal's estimated max (then the lift is back on its normal step). A Hard set or a missed rep
 * still holds the weight; only the size of a clean session's step changes.
 */
export function goalPushFor(rules, exerciseId, ex, settings, target) {
  const g = settings && settings.liftGoals && settings.liftGoals[exerciseId];
  if (!g || !(g.push > 0) || !okNum(g.weight) || !okNum(g.reps) || g.reps < 1) return 0;
  if (!ex || !ex.mainLift || isExcluded(rules, exerciseId, ex) || !weeklyFor(rules, exerciseId)) return 0;
  if (!target || !okNum(target.weight) || !okNum(target.reps) || target.reps < 1) return 0;
  const add = ex.equipment === 'weighted_bw' ? bodyweightOf(settings) : 0;
  return goalMax(g.weight + add, g.reps) > (epley(target.weight + add, target.reps) || 0) ? g.push : 0;
}

/** A goal's estimated max on the load moved: a single is its own weight, more reps go through epley. */
export function goalMax(load, reps) {
  return reps === 1 ? load : epley(load, reps);
}

/** Share of a week-1 benchmark a lift trains at. v1.18.1 (R4 rule 9): the power clean trains at the weight itself. */
export function trainingFractionFor(rules, exerciseId, ex) {
  return isExcluded(rules, exerciseId, ex) ? 1 : rules.baseline.trainingFraction;
}

/** v1.18.1: the reset rule in words, from rules.stall ("Three flat sessions in a row (...) take 5% off."). */
export function flatWords(rules) {
  const st = (rules && rules.stall) || {};
  const n = ['', 'One', 'Two', 'Three', 'Four', 'Five'][st.sessionsBeforeDrop] || String(st.sessionsBeforeDrop);
  const how = st.flatAtRpe == null ? 'short of the target reps' : (st.flatAtRpe >= 10 ? 'short of the target reps, or a Maxed set to make them' : 'short of the target reps, or a Hard or Maxed set to make them');
  return `${n} flat sessions in a row (${how}) take ${Math.round((st.dropFraction || 0) * 100)}% off.`;
}

/** Bodyweight for the pull-up's percentages (R4 rule 8): Settings, else data/settings.json's 165, never 0. */
export function bodyweightOf(settings) {
  const b = Number(settings && settings.bodyweightLb);
  return b > 0 ? b : DEFAULT_BODYWEIGHT;
}

/**
 * Targets from a benchmark entered by hand: "a set of 5 with 2 reps left" (the clean: a crisp, fast double).
 * Training weight = benchmark x the lift's training fraction, rounded to the lift's increment; reps = bottom of the
 * lift's rep range (passed in). Also seeds the bests so PR checks work from day one.
 */
export function targetFromBenchmark({ rules, exerciseId, ex, benchmark, repRange, bodyweightAdd, existing }) {
  const inc = incrementFor(rules, exerciseId, ex);
  const w = roundTo(benchmark * trainingFractionFor(rules, exerciseId, ex), inc);
  const e = epley(benchmark + (bodyweightAdd || 0), isExcluded(rules, exerciseId, ex) ? rules.baseline.cleanTopSetReps : rules.baseline.topSetReps);
  const cur = { ...(existing || {}) };
  cur.weight = w;
  cur.reps = repRange ? repRange[0] : (cur.reps != null ? cur.reps : 5);
  cur.stall = 0;
  cur.source = 'benchmark';
  cur.benchmarkWeight = benchmark;
  cur.benchmarkDate = new Date().toISOString();
  if (cur.baselineE1rm == null) cur.baselineE1rm = e;
  if (cur.bestE1rm == null || e > cur.bestE1rm) cur.bestE1rm = e;
  if (cur.bestWeight == null || benchmark > cur.bestWeight) cur.bestWeight = benchmark;
  cur.updated = new Date().toISOString();
  return cur;
}

/** Live check used by the Player as a set is logged. Returns [] or a list of PR kinds. */
export function checkPR(target, weight, reps, bodyweightAdd) {
  const kinds = [];
  if (!target || weight == null || !reps) return kinds;
  const e = epley(weight + (bodyweightAdd || 0), reps);
  if (target.bestE1rm != null && e > target.bestE1rm) kinds.push('e1rm');
  if (target.bestWeight != null && weight > target.bestWeight) kinds.push('weight');
  return kinds;
}

export function epley(weight, reps) {
  if (!weight || !reps) return null;
  return Math.round(weight * (1 + reps / 30));
}

/** Weight step for an exercise. v1.5: a two-dumbbell lift (ex.pair) is stored as a total, so its step is doubled. */
export function incrementFor(rules, exerciseId, ex) {
  if (rules.increments.byExercise[exerciseId] != null) return rules.increments.byExercise[exerciseId];
  if (ex && !ex.mainLift) {
    const j = rules.smallestJump[ex.equipment] != null ? rules.smallestJump[ex.equipment] : rules.increments.default;
    return ex.pair ? j * pairCount(rules) : j;
  }
  return rules.increments.default;
}
export function pairCount(rules) { return (rules.dumbbellPairs && rules.dumbbellPairs.count) || 2; }

// ---- v1.18.1: R4, reading a session against its target ----

/** The next weight on the lift's grid above w: w + inc on the grid, the nearest grid weight off it (27.5 -> 30). */
export const stepUp = (w, inc) => (Math.floor(w / inc + EPS) + 1) * inc;
/** The next weight on the lift's grid below w (187.5 -> 185 on a 5 lb grid). */
export const stepDown = (w, inc) => (Math.ceil(w / inc - EPS) - 1) * inc;
/** A percentage change on the load moved (R4 rule 8): the pull-up's bodyweight goes in, then comes back out. */
export const scaleLoad = (weight, factor, inc, add = 0) => roundTo((weight + add) * factor - add, inc);

/**
 * Read one lift's session against its target (W, R) and range [lo, hi] (R4, "Reading the session").
 * planned: how many work sets the session planned. sets: the done work sets.
 * Returns { kind: 'heavier' | 'target' | 'lighter', weight, reps, full, missed, effortSets }
 *   heavier: more than half the planned sets (2 of 3, 3 of 4) were done heavier than W with reps in the range;
 *            weight = the lower median of the planned sets, reps = the fewest reps on a set at that weight, and a set
 *            heavier still counts as done when it matched those reps (or the top of the range).
 *   target:  the same, at W. Sets at W all count; a heavier set counts as done when it reached R.
 *   lighter: neither (a lighter day, or too few sets done at W or above).
 * Sets with no reps or no weight, and heavier sets below the range, read as not done. A miss is a set at exactly W
 * with fewer than R reps, whatever kind of day it was.
 */
export function readSession(sets, planned, W, R, [lo, hi]) {
  const good = sets.filter(usable);
  const counts = s => s.weight === W || (s.weight > W && s.reps >= lo);           // a lighter set never counts
  const list = good.filter(counts).map(s => s.weight);
  while (list.length < planned) list.push(-Infinity);                            // a set not done is below everything
  list.sort((a, b) => a - b);
  const median = list[Math.floor((list.length - 1) / 2)];
  const atW = good.filter(s => s.weight === W);
  const missed = atW.some(s => s.reps < R);
  if (median > W) {
    const core = good.filter(s => s.weight === median);
    const reps = Math.min(...core.map(s => s.reps));
    const above = good.filter(s => s.weight > median && s.reps >= Math.min(reps, hi));
    return { kind: 'heavier', weight: median, reps, full: core.length + above.length, missed, effortSets: core };
  }
  if (median === W) {
    const done = atW.concat(good.filter(s => s.weight > W && s.reps >= R));
    return { kind: 'target', weight: W, reps: Math.min(...done.map(s => s.reps)), full: done.length, missed, effortSets: atW };
  }
  return { kind: 'lighter', weight: null, reps: null, full: 0, missed, effortSets: atW };
}

/** R4 rule 7: a main lift's target that has not had its heavy start yet, in a heavy-week session. */
export function heavyStartDue(rules, exerciseId, ex, target, phaseId) {
  return phaseId === 'heavy' && !!(ex && ex.mainLift) && !isExcluded(rules, exerciseId, ex) && !!target && target.weight != null && !target.heavyStart;
}

/**
 * R4 rule 7: the first heavy-week session of each main lift starts at the target going into the heavy weeks
 * x rules.phases.heavy.startWeightFactor (on the load moved, rule 8), rounded to the grid, at the bottom of the heavy
 * rep range, flat count 0, whether or not the lighter week was logged. It is applied once: from then on the target
 * carries heavyStart = { week, from: { weight, reps } }.
 */
export function heavyStartTarget(rules, exerciseId, ex, target, settings) {
  const heavy = rules.phases.heavy;
  const add = ex && ex.equipment === 'weighted_bw' ? bodyweightOf(settings) : 0;
  return { weight: scaleLoad(target.weight, heavy.startWeightFactor, incrementFor(rules, exerciseId, ex), add), reps: heavy.mainLiftReps[0], stall: 0 };
}

/** The target a session in phase `phaseId` asks for: the stored one, or its heavy start while that is due. */
export function effectiveTarget({ rules, plan, settings, exerciseId, target, phaseId }) {
  const ex = plan && plan.exercises ? plan.exercises[exerciseId] : null;
  if (!heavyStartDue(rules, exerciseId, ex, target, phaseId)) return target;
  return { ...target, ...heavyStartTarget(rules, exerciseId, ex, target, settings) };
}

/**
 * R4 rules 1 to 6 for one main lift, one session. target = { weight, reps, stall }; sets = the done work sets
 * ({ weight, reps, rpe, unconfirmed, amrap }); o = { phase, range, planned, inc, add (bodyweight on the pull-up),
 * floor (the empty bar, or 0), stall: rules.stall, maxRpe }.
 * Returns the next { weight, reps, stall } with verdict ('up' | 'hold' | 'drop') and key (the rule that decided).
 */
export function mainLiftNext(target, sets, o) {
  const { phase, range, planned, inc, add = 0, floor = 0, maxRpe = 8 } = o;
  // v1.18.6 (rules R5, Cameron Nov 24: "not ramping up enough... I want to be pushed"): a lift listed in
  // rules.mainLiftTest.weekly steps up after every session whose sets all made the reps at Solid or easier, and the
  // reps stay at weekly.reps (the bottom of the range in the heavy weeks) instead of climbing 4, 5, 6 first.
  const weekly = o.weekly || null;
  // v1.18.11: a goal he set adds this much to a clean session's step (goalPushFor); only on the weekly rule
  const push = weekly && okNum(o.push) && o.push > 0 ? o.push : 0;
  const st = o.stall || {};
  const resetAfter = st.sessionsBeforeDrop, resetFraction = st.dropFraction, resetReps = st.resetReps || 'keep';
  const flatAtRpe = st.flatAtRpe == null ? null : st.flatAtRpe;
  const [lo, hi] = range;
  const cur = { weight: target.weight, reps: target.reps, stall: target.stall || 0 };
  const out = (verdict, key, extra) => ({ ...cur, reps: clampTo(cur.reps, range), verdict, key, ...(extra || {}) });  // reps always in the range
  if (!sets.filter(usable).length) return out('hold', 'nothing');
  if (phase === 'light') return out('hold', 'light');                                                 // rule 6
  if (sets.some(s => s.unconfirmed)) return out('hold', 'unrated');                                 // rule 1
  const W = cur.weight;
  const R = clampTo(cur.reps, range);
  const S = readSession(sets, planned, W, R, range);
  const allDone = S.full >= planned;
  // an all-out set (v1.19) is left out of every effort test; its reps count like any other set's
  const worst = Math.max(0, ...S.effortSets.filter(s => !s.amrap).map(s => (okNum(s.rpe) ? s.rpe : 0)));
  const clean = worst <= maxRpe;
  const week2 = phase === 'baseline' && !weekly;                                                      // rule 5 (R5: a weekly lift moves in week 2 too)
  const want = weekly ? clampTo(phase === 'heavy' ? lo : (weekly.reps || R), range) : hi;             // the reps a step up asks for
  const base = { W, R, S, lo, hi, resetAfter, resetFraction };
  const flat = key => {                                                                               // rules 3c, 3d, 4
    if (week2) return out('hold', key, { ...base, week2: true });
    cur.stall += 1;
    if (cur.stall < resetAfter) return out('hold', key, { ...base, flat: cur.stall });
    const down = Math.max(floor, Math.min(scaleLoad(W, 1 - resetFraction, inc, add), stepDown(W, inc)));
    const atFloor = !(down < W);
    if (!atFloor) { cur.weight = down; cur.reps = resetReps === 'bottom' ? lo : R; }
    else cur.reps = lo;                                                                               // at the floor: reps come down instead
    cur.stall = 0;
    return out('drop', 'reset', { ...base, because: key, atFloor });
  };
  if (S.kind === 'heavier') {                                                                         // rule 2
    const up = !week2 && allDone && S.reps >= want && clean;
    const extra = up && weekly ? push : 0;
    if (up) { cur.weight = stepUp(S.weight, inc) + extra; cur.reps = weekly ? want : lo; } else { cur.weight = S.weight; cur.reps = Math.min(S.reps, hi); }
    cur.stall = 0;
    return out('up', up ? (weekly ? 'heavierWeekly' : 'heavierTop') : 'heavier', { ...base, ...(extra ? { pushed: extra } : {}) });
  }
  if (S.kind === 'lighter') return S.missed ? flat('miss') : out('hold', 'lighter', base);            // rule 2, lighter
  if (S.missed) return flat('miss');                                                                  // 3d
  if (!allDone) return out('hold', 'notAll', base);                                                   // 3e
  if (weekly && clean) {                                                                              // R5: 3a and 3b for a weekly lift
    cur.stall = 0;
    if (S.reps >= want) { cur.weight = stepUp(W, inc) + push; cur.reps = want; return out('up', 'weekly', { ...base, ...(push ? { pushed: push } : {}) }); }
    cur.reps = Math.min(S.reps + 1, want);
    return out('up', 'oneMore', base);
  }
  if (clean && S.reps >= hi) {                                                                        // 3a
    cur.stall = 0;
    if (week2) { cur.reps = hi; return out('hold', 'week2Top', base); }
    cur.weight = stepUp(W, inc); cur.reps = lo;
    return out('up', 'top', base);
  }
  if (clean) { cur.reps = Math.min(S.reps + 1, hi); cur.stall = 0; return out('up', 'oneMore', base); }   // 3b
  if (S.reps > R) { cur.reps = Math.min(S.reps, hi); cur.stall = 0; return out('up', 'moreReps', base); }  // 3c, first half
  if (flatAtRpe != null && worst >= flatAtRpe) return flat('hardFlat');                               // 3c, the switch
  return out('hold', 'hard', base);
}

/**
 * R4 rule 9: the power clean. The app never raises it; the target mirrors the weight he used (the lower median of
 * the doubles done against the planned sets), up or down. Reps stay at the range (2). Rules 1 and 6 apply.
 */
export function cleanNext(target, sets, o) {
  const { phase, range, planned } = o;
  const cur = { weight: target.weight, reps: target.reps, stall: target.stall || 0 };
  const out = (verdict, key, extra) => ({ ...cur, reps: clampTo(cur.reps, range), verdict, key, ...(extra || {}) });
  if (!sets.filter(usable).length) return out('hold', 'nothing');
  if (phase === 'light') return out('hold', 'light');
  if (sets.some(s => s.unconfirmed)) return out('hold', 'unrated');
  const ws = sets.filter(s => usable(s) && s.reps >= range[0]).map(s => s.weight);                   // singles never count
  while (ws.length < planned) ws.push(-Infinity);
  ws.sort((a, b) => a - b);
  const med = ws[Math.floor((ws.length - 1) / 2)];
  if (Number.isFinite(med) && med !== cur.weight) {
    const from = cur.weight;
    cur.weight = med; cur.stall = 0;
    return out(med > from ? 'up' : 'drop', 'cleanFollows', { W: from });
  }
  return out('hold', 'cleanHold', { W: cur.weight });
}

/**
 * R4 rule 10: an accessory, one session. Same reading of the session (a lighter day holds); then reps to the top,
 * then the smallest jump. Bodyweight moves (no weight, or no increment) move reps only. No flat count.
 */
export function accessoryNext(target, sets, o) {
  const { phase, range, planned, inc, maxRpe = 8 } = o;
  const [lo, hi] = range;
  const cur = { weight: target.weight == null ? null : target.weight, reps: target.reps == null ? lo : target.reps };
  const out = (verdict, key, extra) => ({ ...cur, reps: clampTo(cur.reps, range), verdict, key, ...(extra || {}) });
  const bw = cur.weight == null || !inc;
  const good = sets.filter(s => s && okNum(s.reps) && (bw || okNum(s.weight)));
  if (!good.length) return out('hold', 'nothing');
  if (phase === 'light') return out('hold', 'light');
  if (sets.some(s => s.unconfirmed)) return out('hold', 'unrated');
  // v1.18.7 (rules.lastSetRating): the effort he picked on the last set sets the pace. Easy: add weight now.
  // Solid: solidReps more reps. Hard or Maxed, or no rating: one more rep, as before. Week 2 no longer holds the weight.
  const L = o.lastSet || null;
  const lastRpe = L && okNum(good[good.length - 1].rpe) && !good[good.length - 1].unconfirmed ? good[good.length - 1].rpe : null;
  const easy = lastRpe != null && lastRpe <= (L.easyUpTo != null ? L.easyUpTo : 6.9);
  const solid = lastRpe != null && !easy && lastRpe <= (L.solidUpTo != null ? L.solidUpTo : 8.7);
  const more = solid ? (L.solidReps || 2) : 1;
  const week2 = phase === 'baseline' && !L;
  const clean = good.every(s => !okNum(s.rpe) || s.rpe <= maxRpe);
  if (bw) {
    const rs = Math.min(...good.map(s => s.reps));
    const allTop = good.length >= planned && rs >= hi;
    cur.reps = allTop ? hi : Math.min(rs + (easy ? Math.max(more, L.solidReps || 2) : more), hi);
    return out(cur.reps > (target.reps || 0) ? 'up' : 'hold', 'bodyweight', { allTop, lo, hi });
  }
  const W = cur.weight;
  const S = readSession(good, planned, W, clampTo(cur.reps, range), range);
  if (S.kind === 'lighter') return out('hold', 'lighter', { W });
  cur.weight = S.weight;
  if (week2) { cur.reps = Math.min(S.reps + (clean ? 1 : 0), hi); return out(cur.weight > W ? 'up' : 'hold', 'week2', { W }); }
  if (S.full >= planned && S.reps >= hi) { cur.weight = stepUp(cur.weight, inc); cur.reps = lo; return out('up', 'top', { W, lo, hi }); }
  if (easy && S.full >= planned && !S.missed) { cur.weight = stepUp(cur.weight, inc); cur.reps = lo; return out('up', 'easyUp', { W, lo, hi }); }
  cur.reps = Math.min(S.reps + (S.missed ? 1 : more), hi);
  return out(cur.weight > W ? 'up' : 'hold', more > 1 && !S.missed ? 'solidMore' : 'oneMore', { W });
}

/**
 * applyProgression({ session, targets, rules, plan, settings })
 * returns { targets, lines: [{ exerciseId, name, text, verdict, reason, next }], e1rms: { exerciseId: number },
 *           prs: [{ exerciseId, name, kind, value, prev }], before: { exerciseId: { weight, reps, stall, heavyStart } | null } }
 * Personal records: best estimated 1RM and heaviest weight per exercise, kept on the target record
 * (bestE1rm, bestWeight). A PR is only reported when a previous best existed.
 * `before` (v1.18.1, R4 rule 12): each lift's stored target as the session found it (null: it had none). The session
 * record keeps it as targetsBefore, so a correction later re-runs the session from there instead of from what the
 * session already produced (sanity.js rerunLift).
 * Does not mutate its inputs.
 */
export function applyProgression({ session, targets, rules, plan, settings }) {
  const next = JSON.parse(JSON.stringify(targets || {}));
  const lines = [];
  const e1rms = {};
  const prs = [];
  const before = {};
  const bodyweight = (settings && settings.bodyweightLb) || 0;
  const week = session.week;
  const phase = session.phase && session.phase.id ? session.phase.id : phaseIdFor(plan, week);
  const heavy = rules.phases.heavy;
  const stallRules = rules.stall || {};

  // group work sets by exercise, in order of appearance
  const order = [];
  const groups = {};
  for (const s of session.sets || []) {
    if (s.ramp) continue;
    if (!groups[s.exerciseId]) { groups[s.exerciseId] = []; order.push(s.exerciseId); }
    groups[s.exerciseId].push(s);
  }

  for (const id of order) {
    const sets = groups[id];
    const ex = plan.exercises[id];
    const name = ex ? ex.name : (sets[0].name || id);
    // verdict: 'up' | 'hold' | 'drop' | 'set' | 'none'; reason: short phrase for the review screen
    const say = (text, verdict, reason) => lines.push({ exerciseId: id, name, text, verdict, reason: reason || '' });
    const done = sets.filter(s => s.done && !s.skipped && !s.baseline && !s.retest);
    const planned = sets.filter(s => !s.baseline && !s.retest);
    const baselineSet = sets.find(s => s.baseline && s.done);
    const retestSet = sets.find(s => s.retest && s.done);
    const cur = next[id] || {};
    // null: the lift had no target going in (a re-run then starts it from what was logged, as the save did)
    const t0 = targets && targets[id];
    before[id] = t0 ? { weight: t0.weight != null ? t0.weight : null, reps: t0.reps != null ? t0.reps : null, stall: t0.stall || 0, ...(t0.heavyStart ? { heavyStart: { ...t0.heavyStart } } : {}) } : null;
    const inc = incrementFor(rules, id, ex);
    // v1.18.5: a dumbbell target the rack can't make (2 x 27.5) is read, and kept, as the nearest one it can
    if (cur.weight != null) cur.weight = snapLoad(rules, ex, cur.weight);
    const isBw = ex && ex.equipment === 'weighted_bw';
    const loadOf = s => (s.weight || 0) + (isBw ? bodyweight : 0);

    // e1RM and personal records for any weighted exercise (benchmark lifts show e1RM on the summary)
    if (ex && !ex.timed) {
      const cands = sets.filter(s => s.done && !s.skipped && s.weight != null && s.reps);
      const best = cands.reduce((m, s) => Math.max(m, epley(loadOf(s), s.reps) || 0), 0);
      const heaviest = cands.reduce((m, s) => Math.max(m, s.weight || 0), 0);
      if (best > 0) {
        if (ex.benchmark) { e1rms[id] = best; cur.e1rm = best; }
        if (cur.bestE1rm != null && best > cur.bestE1rm) prs.push({ exerciseId: id, name, kind: 'e1rm', value: best, prev: cur.bestE1rm });
        if (cur.bestE1rm == null || best > cur.bestE1rm) cur.bestE1rm = best;
      }
      if (heaviest > 0) {
        if (cur.bestWeight != null && heaviest > cur.bestWeight) prs.push({ exerciseId: id, name, kind: 'weight', value: heaviest, prev: cur.bestWeight });
        if (cur.bestWeight == null || heaviest > cur.bestWeight) cur.bestWeight = heaviest;
      }
    }

    // retest extras (max pull-ups, max T2B)
    if (!ex) {
      const s = sets.find(x => x.done);
      if (s) say(`${name}: ${s.reps} reps.`, 'none', 'retest');
      continue;
    }

    // holds (side plank etc.): nothing to progress
    if (ex.timed) {
      say(`${name}: ${done.length} of ${planned.length} ${planned.length === 1 ? 'round' : 'rounds'} done. Progress by adding seconds when it feels easy.`, 'none', 'timed hold');
      next[id] = cur;
      continue;
    }

    // 1. baseline top set -> training weight (90%; the power clean trains at the weight itself, R4 rule 9).
    //    A new baseline starts a new block, so the heavy start (rule 7) is due again in its heavy weeks.
    if (baselineSet && baselineSet.weight != null) {
      const fraction = trainingFractionFor(rules, id, ex);
      const w = roundTo(baselineSet.weight * fraction, inc);
      const bottom = planned.length && planned[0].repRange ? planned[0].repRange[0] : (baselineSet.reps || 5);
      Object.assign(cur, { weight: w, reps: bottom, stall: 0, source: 'baseline', baselineWeight: baselineSet.weight, baselineE1rm: e1rms[id] || null, updated: session.endedAt, sessionId: session.id });
      delete cur.heavyStart;
      say(fraction === 1
        ? `${name} baseline: ${fmtWeight(baselineSet.weight)} lb x ${baselineSet.reps}. That is the target through week 2.`
        : `${name} baseline: ${fmtWeight(baselineSet.weight)} lb x ${baselineSet.reps}. Training weight ${fmtWeight(w)} lb through week 2.`,
      'set', fraction === 1 ? `baseline ${fmtWeight(baselineSet.weight)} x ${baselineSet.reps}` : `baseline ${fmtWeight(baselineSet.weight)} x ${baselineSet.reps}, train at ${Math.round(fraction * 100)}%`);
      next[id] = cur;
      continue;
    }

    // 2. retest top set
    if (retestSet && retestSet.weight != null) {
      const e = epley(loadOf(retestSet), retestSet.reps);
      const base = cur.baselineE1rm;
      const vs = base ? `, up from ${base} in week 1` : '';
      say(`${name} retest: ${fmtWeight(retestSet.weight)} lb x ${retestSet.reps} (e1RM ${e}${vs}).`, 'none', 'retest');
      cur.retestE1rm = e;
      next[id] = cur;
      continue;
    }

    // first time this exercise is logged with a weight and no target: adopt what was used
    if (cur.weight == null && done.length && done[done.length - 1].weight != null) {
      const last = done[done.length - 1];
      cur.weight = last.weight;
      cur.reps = clampReps(minReps(done), last.repRange);
      cur.stall = 0; cur.source = 'engine'; cur.updated = session.endedAt; cur.sessionId = session.id;
      say(`${name}: logged at ${fmtWeight(last.weight)} lb, that is your starting target.`, 'set', 'first time logged');
      next[id] = cur;
      continue;
    }

    if (!done.length) {
      say(`${name}: no sets logged, targets unchanged.`, 'hold', 'nothing logged');
      next[id] = cur;
      continue;
    }

    const range = (planned.find(s => s.repRange) || done[done.length - 1]).repRange || [done[0].reps, done[0].reps];
    const detail = describe(done);

    // v1.8 catch-up: when the session these sets came from already logged this exercise, it set the next target.
    // The made-up sets are logged (and count for records) but do not move the target a second time. v1.18.1 (R4
    // rule 11): they take nothing off the flat count either, since a skipped set never added to it.
    const cu = session.catchUpInfo && session.catchUpInfo[id];
    if (cu && cu.hadDone) {
      say(`${name}: ${detail} made up. Next target stays as the session it came from set it.`, 'hold', 'catch-up sets');
      next[id] = cur;
      continue;
    }

    // 3. lighter week: nothing changes, the flat count neither rises nor clears (R4 rule 6)
    if (phase === 'light') {
      say(`${name}: ${detail}. Lighter week, same weight next time.`, 'hold', 'lighter week');
      next[id] = cur;
      continue;
    }

    // v1.18.1 (R4 rule 7): the first heavy-week session of a main lift starts 5% over the target it had going in,
    // at 3 reps, and this session is read against that. It is applied once (the target keeps heavyStart).
    let heavyNote = '';
    if (heavyStartDue(rules, id, ex, cur, phase) && done.some(usable)) {
      const from = { weight: cur.weight, reps: cur.reps };
      Object.assign(cur, heavyStartTarget(rules, id, ex, cur, settings), { heavyStart: { week, from } });
      heavyNote = ` Heavy weeks are ${heavy.mainLiftReps[0]}-${heavy.mainLiftReps[1]} reps: this lift started at ${fmtWeight(cur.weight)} lb x ${cur.reps}, ${Math.round((heavy.startWeightFactor - 1) * 100)}% over ${fmtWeight(from.weight)} lb.`;
    }

    // v1.18 (rules R4, rule 1; Cameron: bad numbers must not move the plan): a set the timer logged before an effort
    // was picked carries the app's guess. Saved without a rating, the target and the flat count stay as they are for
    // the next session (v1.18.1: rating it later, on the saved session, re-runs this).
    // v1.18.7 (rules.lastSetRating, Cameron Nov 24: "You should be taking into account how i rates the... Last set"):
    // when the last work set of the lift has an effort he picked, it stands for the lift: the app's guesses on earlier
    // unrated sets are dropped, and they no longer hold the target. An unrated last set still holds it.
    const lastRule = lastSetRule(rules);
    const lastWork = done[done.length - 1];
    let judged = done;
    if (lastRule && lastWork && !lastWork.unconfirmed && done.some(s => s.unconfirmed)) judged = done.map(s => (s.unconfirmed ? { ...s, unconfirmed: false, rpe: null } : s));
    const unrated = judged.filter(s => s.unconfirmed).length;
    if (unrated) {
      say(`${name}: ${detail}. ${unrated === 1 ? 'One set had' : `${unrated} sets had`} no effort picked, so the target stays the same next time.${heavyNote}`, 'hold', 'effort not rated');
      if (heavyNote) { cur.source = 'engine'; cur.updated = session.endedAt; cur.sessionId = session.id; }
      next[id] = cur;
      continue;
    }

    const target = { weight: cur.weight, reps: cur.reps, stall: cur.stall || 0 };
    const opts = { phase, range, planned: planned.length, inc, maxRpe: rules.mainLiftTest.maxRpe, weekly: weeklyFor(rules, id) };
    let outcome;
    if (isExcluded(rules, id, ex)) outcome = cleanNext(target, judged, opts);                                      // rule 9
    else if (ex.mainLift) outcome = mainLiftNext(target, judged, { ...opts, add: isBw ? bodyweightOf(settings) : 0, floor: ex.equipment === 'barbell' ? rules.rampUp.barWeightLb : 0, stall: stallRules, push: goalPushFor(rules, id, ex, settings, target) });
    else outcome = accessoryNext(target, judged, { ...opts, lastSet: lastRule });                                   // rule 10
    // R4 rule 13: the v1.19 all-out check goes here, on `outcome`, after these rules and before the target is written.

    const text = lineFor(outcome, { name, detail, stall: stallRules });
    say(`${text.text}${heavyNote}`, outcome.verdict, text.reason);
    cur.weight = snapLoad(rules, ex, outcome.weight);
    cur.reps = outcome.reps;
    if (ex.mainLift) cur.stall = outcome.stall;
    if (outcome.key !== 'nothing') { cur.source = 'engine'; cur.updated = session.endedAt; cur.sessionId = session.id; }
    next[id] = cur;
  }

  for (const l of lines) { const t = next[l.exerciseId] || {}; l.next = { weight: t.weight != null ? t.weight : null, reps: t.reps != null ? t.reps : null }; }
  return { targets: next, lines, e1rms, prs, before };
}

/** The what-changed line for one R4 outcome: { text, reason }. */
function lineFor(o, { name, detail, stall }) {
  const lb = w => `${fmtWeight(w)} lb`;
  const nextTime = `Next time ${o.weight != null ? `${lb(o.weight)} x ` : ''}${o.reps}.`;
  const flatCount = n => ` Flat sessions in a row: ${n} of ${stall.sessionsBeforeDrop}.`;
  const pushed = o.pushed ? ` That includes ${lb(o.pushed)} extra toward your goal.` : '';
  switch (o.key) {
    case 'nothing': return { text: `${name}: no sets with a weight and reps, target unchanged.`, reason: 'nothing logged' };
    case 'light': return { text: `${name}: ${detail}. Lighter week, same weight next time.`, reason: 'lighter week' };
    case 'unrated': return { text: `${name}: ${detail}. A set had no effort picked, so the target stays the same next time.`, reason: 'effort not rated' };
    case 'heavierTop': return { text: `${name}: ${detail}, heavier than the ${lb(o.W)} target with every set at ${o.hi}, Solid or easier. ${nextTime}`, reason: 'lifted more, every set at the top' };
    case 'heavier': return { text: `${name}: ${detail}, heavier than the ${lb(o.W)} target. ${nextTime}`, reason: 'lifted more than the target' };
    case 'lighter': return { text: `${name}: ${detail}, lighter than the ${lb(o.W)} target or ended early. Same target next time.`, reason: 'lighter day: target holds' };
    case 'notAll': return { text: `${name}: ${detail}, a set was skipped or done lighter. Same target next time.`, reason: 'a set was skipped or done lighter' };
    case 'weekly': return { text: `${name}: ${detail}, every set made at Solid effort or easier. ${nextTime}${pushed}`, reason: o.pushed ? 'all sets made: a bigger step toward your goal' : 'all sets made, Solid or easier' };
    case 'heavierWeekly': return { text: `${name}: ${detail}, heavier than the ${lb(o.W)} target with every set made, Solid or easier. ${nextTime}${pushed}`, reason: o.pushed ? 'lifted more: a bigger step toward your goal' : 'lifted more, every set made' };
    case 'easyUp': return { text: `${name}: ${detail}, last set Easy. ${nextTime}`, reason: 'last set Easy: more weight' };
    case 'solidMore': return { text: `${name}: ${detail}, last set Solid. ${o.weight > o.W ? `Next time ${lb(o.weight)}, the weight you used` : 'Same weight'}, aim for ${o.reps} next time.`, reason: `last set Solid: aim for ${o.reps} reps` };
    case 'top': return { text: `${name}: ${detail}, every set at ${o.hi}${o.R != null ? ' at Solid effort or easier' : ''}. ${nextTime}`, reason: `all sets at ${o.hi}${o.R != null ? ', Solid or easier' : ''}` };
    case 'week2Top': return { text: `${name}: ${detail}, every set at ${o.hi}. Baseline weeks, weight stays; ${o.hi} again next time.`, reason: 'baseline weeks, weight stays' };
    case 'oneMore': return o.R != null
      ? { text: `${name}: ${detail}, target met at Solid effort or easier. ${nextTime}`, reason: 'target met, one more rep' }
      : { text: `${name}: ${detail}. ${o.weight > o.W ? `Next time ${lb(o.weight)}, the weight you used` : 'Same weight'}, aim for ${o.reps} next time.`, reason: `aim for ${o.reps} reps` };
    case 'moreReps': return { text: `${name}: ${detail}, more reps than asked, with a Hard or Maxed set. ${nextTime}`, reason: 'more reps than asked' };
    case 'hard': return { text: `${name}: ${detail}, a set was Hard or Maxed. Same target next time.`, reason: 'a set was Hard or Maxed' };
    case 'miss': case 'hardFlat': {
      const what = o.key === 'miss' ? `short of ${o.R} at ${lb(o.W)}` : 'made the reps, but a set was Hard or Maxed';
      if (o.week2) return { text: `${name}: ${detail}, ${what}. Baseline weeks: same target, and nothing counts toward a reset yet.`, reason: 'baseline weeks, weight stays' };
      return { text: `${name}: ${detail}, ${what}. Same target next time.${flatCount(o.flat)}`, reason: o.key === 'miss' ? 'short of the target reps' : 'made the reps, but a set was Hard or Maxed' };
    }
    case 'reset': return o.atFloor
      ? { text: `${name}: ${detail}. ${o.resetAfter} flat sessions in a row, already at the lightest weight. ${stall.message || ''} Next time ${lb(o.weight)} x ${o.reps}.`.replace(/\s+/g, ' '), reason: 'flat sessions reached the limit' }
      : { text: `${name}: ${detail}. ${o.resetAfter} flat sessions in a row. ${stall.message || ''} Next time ${lb(o.weight)} x ${o.reps} (down from ${lb(o.W)}) and build back up.`.replace(/\s+/g, ' '), reason: 'flat sessions reached the limit' };
    case 'cleanFollows': return { text: `${name}: ${detail}. The target follows the weight you used: ${lb(o.weight)} next time.`, reason: 'follows the weight used' };
    case 'cleanHold': return { text: `${name}: ${detail}. The app never raises the clean; add weight yourself when every double is fast.`, reason: 'your call: raise when crisp' };
    case 'bodyweight': return o.allTop
      ? { text: `${name}: ${detail}, all sets at ${o.hi}. Bodyweight move; add load or a harder version when you can.`, reason: `all sets at ${o.hi}; add load` }
      : { text: `${name}: ${detail}. Aim for ${o.reps} next time.`, reason: `aim for ${o.reps} reps` };
    case 'week2': return { text: `${name}: ${detail}. Baseline weeks, weight stays${o.weight > o.W ? ` at the ${lb(o.weight)} you used` : ''}; aim for ${o.reps} next time.`, reason: 'baseline weeks, weight stays' };
    default: return { text: `${name}: ${detail}. ${nextTime}`, reason: o.key || '' };
  }
}

function phaseIdFor(plan, week) {
  const p = plan.phases.find(ph => ph.weeks.includes(week));
  return p ? p.id : (week > 12 ? 'after' : 'before');
}

function minReps(done) {
  return done.reduce((m, s) => Math.min(m, s.reps == null ? 0 : s.reps), Infinity);
}

function clampReps(r, range) {
  if (!range) return r;
  if (!isFinite(r)) return range[0];
  return Math.min(Math.max(r, range[0]), range[1]);
}

function summarizeReps(done) {
  const reps = done.map(s => s.reps == null ? '?' : s.reps);
  const uniq = [...new Set(reps)];
  return uniq.length === 1 ? `${uniq[0]}` : reps.join('/');
}

/** "3 x 5 at 185 lb", "3 x 6/6/5 at 185 lb", or each set when the weights differ ("185 x 5, 195 x 4"). */
function describe(done) {
  const ws = done.filter(s => s.weight != null);
  if (!ws.length) return `${done.length} x ${summarizeReps(done)}`;
  if (ws.length === done.length && ws.every(s => s.weight === ws[0].weight)) return `${done.length} x ${summarizeReps(done)} at ${fmtWeight(ws[0].weight)} lb`;
  return done.map(s => `${s.weight != null ? fmtWeight(s.weight) : 'bw'} x ${s.reps == null ? '?' : s.reps}`).join(', ');
}

/**
 * v1.4: a rough first-session weight for an exercise with no target, from rules.startingEstimates
 * (a fraction of a main lift's training weight, or of bodyweight). Returns null when there is no rule
 * or nothing to base it on.
 */
export function estimateStart(rules, exerciseId, targets, settings, ex) {
  const se = rules.startingEstimates;
  const r = se && se.byExercise && se.byExercise[exerciseId];
  if (!r) return null;
  const base = r.of === 'bodyweight' ? (settings && settings.bodyweightLb) : (targets && targets[r.of] && targets[r.of].weight);
  if (!base) return null;
  const step = se.roundTo || 5;
  const one = Math.max(step, roundTo(base * r.fraction, step));
  // v1.5: the fraction is per dumbbell; a two-dumbbell lift shows the total
  return snapLoad(rules, ex, ex && ex.pair ? one * pairCount(rules) : one);
}
