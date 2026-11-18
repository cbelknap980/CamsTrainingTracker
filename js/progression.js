// progression.js - Progression Engine: runs once after a session saves.
// Pure function. Every number comes from rules.json; this file only knows how to apply a rule.

import { roundTo, fmtWeight } from './data.js';

/**
 * Targets from a benchmark entered by hand: "a set of 5 with 2 reps left".
 * Training weight = benchmark x baseline.trainingFraction, rounded to the lift's increment; reps = bottom of the
 * lift's rep range (passed in). Also seeds the bests so PR checks work from day one.
 */
export function targetFromBenchmark({ rules, exerciseId, ex, benchmark, repRange, bodyweightAdd, existing }) {
  const inc = incrementFor(rules, exerciseId, ex);
  const w = roundTo(benchmark * rules.baseline.trainingFraction, inc);
  const e = epley(benchmark + (bodyweightAdd || 0), rules.baseline.topSetReps);
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

/**
 * applyProgression({ session, targets, rules, plan, settings })
 * returns { targets, lines: [{ exerciseId, name, text }], e1rms: { exerciseId: number }, prs: [{ exerciseId, name, kind, value, prev }] }
 * Personal records: best estimated 1RM and heaviest weight per exercise, kept on the target record
 * (bestE1rm, bestWeight). A PR is only reported when a previous best existed.
 * Does not mutate its inputs.
 */
export function applyProgression({ session, targets, rules, plan, settings }) {
  const next = JSON.parse(JSON.stringify(targets || {}));
  const lines = [];
  const e1rms = {};
  const prs = [];
  const bodyweight = (settings && settings.bodyweightLb) || 0;
  const week = session.week;
  const phase = session.phase && session.phase.id ? session.phase.id : phaseIdFor(plan, week);
  const nextWeekPhase = phaseIdFor(plan, week + 1);
  const heavy = rules.phases.heavy;

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
    const inc = incrementFor(rules, id, ex);
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

    // 1. baseline top set -> training weight at 90%
    if (baselineSet && baselineSet.weight != null) {
      const w = roundTo(baselineSet.weight * rules.baseline.trainingFraction, inc);
      const bottom = planned.length && planned[0].repRange ? planned[0].repRange[0] : (baselineSet.reps || 5);
      Object.assign(cur, { weight: w, reps: bottom, stall: 0, source: 'baseline', baselineWeight: baselineSet.weight, baselineE1rm: e1rms[id] || null, updated: session.endedAt, sessionId: session.id });
      say(`${name} baseline: ${fmtWeight(baselineSet.weight)} lb x ${baselineSet.reps}. Training weight ${fmtWeight(w)} lb through week 2.`, 'set', `baseline ${fmtWeight(baselineSet.weight)} x ${baselineSet.reps}, train at 90%`);
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

    // first time this exercise is logged with no target: adopt what was used
    if (cur.weight == null && done.length) {
      const last = done[done.length - 1];
      if (last.weight != null) {
        cur.weight = last.weight;
        cur.reps = clampReps(minReps(done), last.repRange);
        cur.stall = 0; cur.source = 'engine'; cur.updated = session.endedAt; cur.sessionId = session.id;
        say(`${name}: logged at ${fmtWeight(last.weight)} lb, that is your starting target.`, 'set', 'first time logged');
      } else {
        cur.reps = clampReps(minReps(done), last.repRange);
        say(`${name}: ${done.length} ${done.length === 1 ? 'set' : 'sets'} done, bodyweight.`, 'none', 'bodyweight');
      }
      next[id] = cur;
      continue;
    }

    if (!done.length) {
      say(`${name}: no sets logged, targets unchanged.`, 'hold', 'nothing logged');
      next[id] = cur;
      continue;
    }

    const last = done[done.length - 1];
    const repRange = last.repRange || [last.reps, last.reps];
    const top = repRange[1];
    const bottom = repRange[0];
    const baseWeight = last.weight != null ? last.weight : cur.weight;
    const allDone = done.length >= planned.length;
    const allTop = allDone && done.every(s => (s.reps || 0) >= top);
    const rpeOk = done.every(s => s.rpe == null || s.rpe <= rules.mainLiftTest.maxRpe);
    const detail = `${done.length} x ${summarizeReps(done)} at ${fmtWeight(baseWeight)} lb`;

    // 3. lighter week: nothing changes
    if (phase === 'light') {
      say(`${name}: ${detail}. Lighter week, same weight next time.`, 'hold', 'lighter week');
      next[id] = cur;
      continue;
    }

    // 4. excluded lifts (power clean)
    if (ex.autoProgress === false || rules.excludeFromAutoProgression.includes(id)) {
      say(`${name}: ${detail}. Not auto-progressed; raise the target yourself when it feels crisp.`, 'hold', 'your call: raise when crisp');
      next[id] = cur;
      continue;
    }

    // 5. baseline phase without a baseline set (week 2): hold
    if (phase === 'baseline') {
      cur.reps = clampReps(minReps(done) + (rpeOk ? 1 : 0), repRange);
      say(`${name}: ${detail}. Baseline weeks, weight stays; aim for ${cur.reps} next time.`, 'hold', 'baseline weeks, weight stays');
      next[id] = cur;
      continue;
    }

    // 6. the test
    if (ex.mainLift) {
      if (allTop && rpeOk) {
        cur.weight = roundTo(baseWeight + inc, inc);
        cur.reps = bottom; cur.stall = 0;
        say(`${name}: ${detail}, every set at ${top} at Solid effort or easier. Next time ${fmtWeight(cur.weight)} lb x ${bottom}.`, 'up', `all sets at ${top}, Solid or easier`);
      } else {
        cur.stall = (cur.stall || 0) + 1;
        if (cur.stall >= rules.stall.sessionsBeforeDrop) {
          cur.weight = roundTo(baseWeight * (1 - rules.stall.dropFraction), inc);
          cur.reps = bottom; cur.stall = 0;
          say(`${name}: ${detail}. ${rules.stall.message} Next time ${fmtWeight(cur.weight)} lb (down ${Math.round(rules.stall.dropFraction * 100)}%) and rebuild.`, 'drop', 'second miss in a row');
        } else {
          cur.weight = baseWeight;
          cur.reps = rpeOk ? clampReps(minReps(done) + rules.mainLiftTest.repNudge, repRange) : clampReps(minReps(done), repRange);
          const why = !allDone ? 'a set was skipped' : (!rpeOk ? 'a set was Hard or Maxed' : `not every set reached ${top}`);
          say(`${name}: ${detail}, ${why}. Same weight next time, aim for ${cur.reps} on every set.`, 'hold', why);
        }
      }
    } else {
      if (allTop) {
        const jump = incrementFor(rules, id, ex) || 0;
        if (jump > 0 && baseWeight != null) {
          cur.weight = roundTo(baseWeight + jump, jump);
          cur.reps = bottom; cur.stall = 0;
          say(`${name}: ${detail}, all sets at ${top}. Next time ${fmtWeight(cur.weight)} lb x ${bottom}.`, 'up', `all sets at ${top}`);
        } else {
          cur.reps = top;
          say(`${name}: ${detail}, all sets at ${top}. Bodyweight move; add load or a harder version when you can.`, 'up', `all sets at ${top}; add load`);
        }
      } else {
        cur.weight = baseWeight != null ? baseWeight : cur.weight;
        cur.reps = clampReps(minReps(done) + 1, repRange);
        say(`${name}: ${detail}. Same weight, aim for ${cur.reps} next time.`, 'hold', `aim for ${cur.reps} reps`);
      }
    }

    // 7. moving into the heavy weeks: main lifts switch to 3-5 reps
    if (ex.mainLift && phase !== 'heavy' && nextWeekPhase === 'heavy' && cur.weight != null) {
      const w = roundTo(cur.weight * heavy.startWeightFactor, inc);
      cur.weight = w; cur.reps = heavy.mainLiftReps[0]; cur.stall = 0;
      say(`${name}: weeks 8-11 are ${heavy.mainLiftReps[0]}-${heavy.mainLiftReps[1]} reps. Starting at ${fmtWeight(w)} lb.`, 'up', 'heavy weeks start');
    }

    cur.source = 'engine'; cur.updated = session.endedAt; cur.sessionId = session.id;
    next[id] = cur;
  }

  for (const l of lines) { const t = next[l.exerciseId] || {}; l.next = { weight: t.weight != null ? t.weight : null, reps: t.reps != null ? t.reps : null }; }
  return { targets: next, lines, e1rms, prs };
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
  return ex && ex.pair ? one * pairCount(rules) : one;
}
