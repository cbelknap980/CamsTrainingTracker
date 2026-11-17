// progression.js - Progression Engine: runs once after a session saves.
// Pure function. Every number comes from rules.json; this file only knows how to apply a rule.

import { roundTo, fmtWeight } from './data.js';

export function epley(weight, reps) {
  if (!weight || !reps) return null;
  return Math.round(weight * (1 + reps / 30));
}

export function incrementFor(rules, exerciseId, ex) {
  if (rules.increments.byExercise[exerciseId] != null) return rules.increments.byExercise[exerciseId];
  if (ex && !ex.mainLift) return rules.smallestJump[ex.equipment] != null ? rules.smallestJump[ex.equipment] : rules.increments.default;
  return rules.increments.default;
}

/**
 * applyProgression({ session, targets, rules, plan, settings })
 * returns { targets, lines: [{ exerciseId, name, text }], e1rms: { exerciseId: number } }
 * Does not mutate its inputs.
 */
export function applyProgression({ session, targets, rules, plan, settings }) {
  const next = JSON.parse(JSON.stringify(targets || {}));
  const lines = [];
  const e1rms = {};
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
    const done = sets.filter(s => s.done && !s.skipped && !s.baseline && !s.retest);
    const planned = sets.filter(s => !s.baseline && !s.retest);
    const baselineSet = sets.find(s => s.baseline && s.done);
    const retestSet = sets.find(s => s.retest && s.done);
    const cur = next[id] || {};
    const inc = incrementFor(rules, id, ex);
    const isBw = ex && ex.equipment === 'weighted_bw';
    const loadOf = s => (s.weight || 0) + (isBw ? bodyweight : 0);

    // e1RM for benchmark lifts
    if (ex && ex.benchmark) {
      const cands = sets.filter(s => s.done && !s.skipped && s.weight != null && s.reps);
      const best = cands.reduce((m, s) => Math.max(m, epley(loadOf(s), s.reps) || 0), 0);
      if (best > 0) { e1rms[id] = best; cur.e1rm = best; }
    }

    // retest extras (max pull-ups, max T2B)
    if (!ex) {
      const s = sets.find(x => x.done);
      if (s) lines.push({ exerciseId: id, name, text: `${name}: ${s.reps} reps.` });
      continue;
    }

    // holds (side plank etc.): nothing to progress
    if (ex.timed) {
      lines.push({ exerciseId: id, name, text: `${name}: ${done.length} of ${planned.length} ${planned.length === 1 ? 'round' : 'rounds'} done. Progress by adding seconds when it feels easy.` });
      next[id] = cur;
      continue;
    }

    // 1. baseline top set -> training weight at 90%
    if (baselineSet && baselineSet.weight != null) {
      const w = roundTo(baselineSet.weight * rules.baseline.trainingFraction, inc);
      const bottom = planned.length && planned[0].repRange ? planned[0].repRange[0] : (baselineSet.reps || 5);
      Object.assign(cur, { weight: w, reps: bottom, stall: 0, source: 'baseline', baselineWeight: baselineSet.weight, baselineE1rm: e1rms[id] || null, updated: session.endedAt, sessionId: session.id });
      lines.push({ exerciseId: id, name, text: `${name} baseline: ${fmtWeight(baselineSet.weight)} lb x ${baselineSet.reps}. Training weight ${fmtWeight(w)} lb through week 2.` });
      next[id] = cur;
      continue;
    }

    // 2. retest top set
    if (retestSet && retestSet.weight != null) {
      const e = epley(loadOf(retestSet), retestSet.reps);
      const base = cur.baselineE1rm;
      const vs = base ? `, up from ${base} in week 1` : '';
      lines.push({ exerciseId: id, name, text: `${name} retest: ${fmtWeight(retestSet.weight)} lb x ${retestSet.reps} (e1RM ${e}${vs}).` });
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
        lines.push({ exerciseId: id, name, text: `${name}: logged at ${fmtWeight(last.weight)} lb, that is your starting target.` });
      } else {
        cur.reps = clampReps(minReps(done), last.repRange);
        lines.push({ exerciseId: id, name, text: `${name}: ${done.length} ${done.length === 1 ? 'set' : 'sets'} done, bodyweight.` });
      }
      next[id] = cur;
      continue;
    }

    if (!done.length) {
      lines.push({ exerciseId: id, name, text: `${name}: no sets logged, targets unchanged.` });
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
      lines.push({ exerciseId: id, name, text: `${name}: ${detail}. Lighter week, same weight next time.` });
      next[id] = cur;
      continue;
    }

    // 4. excluded lifts (power clean)
    if (ex.autoProgress === false || rules.excludeFromAutoProgression.includes(id)) {
      lines.push({ exerciseId: id, name, text: `${name}: ${detail}. Not auto-progressed; raise the target yourself when it feels crisp.` });
      next[id] = cur;
      continue;
    }

    // 5. baseline phase without a baseline set (week 2): hold
    if (phase === 'baseline') {
      cur.reps = clampReps(minReps(done) + (rpeOk ? 1 : 0), repRange);
      lines.push({ exerciseId: id, name, text: `${name}: ${detail}. Baseline weeks, weight stays; aim for ${cur.reps} next time.` });
      next[id] = cur;
      continue;
    }

    // 6. the test
    if (ex.mainLift) {
      if (allTop && rpeOk) {
        cur.weight = roundTo(baseWeight + inc, inc);
        cur.reps = bottom; cur.stall = 0;
        lines.push({ exerciseId: id, name, text: `${name}: ${detail}, every set at ${top} with RPE ${rules.mainLiftTest.maxRpe} or under. Next time ${fmtWeight(cur.weight)} lb x ${bottom}.` });
      } else {
        cur.stall = (cur.stall || 0) + 1;
        if (cur.stall >= rules.stall.sessionsBeforeDrop) {
          cur.weight = roundTo(baseWeight * (1 - rules.stall.dropFraction), inc);
          cur.reps = bottom; cur.stall = 0;
          lines.push({ exerciseId: id, name, text: `${name}: ${detail}. ${rules.stall.message} Next time ${fmtWeight(cur.weight)} lb (down ${Math.round(rules.stall.dropFraction * 100)}%) and rebuild.` });
        } else {
          cur.weight = baseWeight;
          cur.reps = rpeOk ? clampReps(minReps(done) + rules.mainLiftTest.repNudge, repRange) : clampReps(minReps(done), repRange);
          const why = !allDone ? 'a set was skipped' : (!rpeOk ? 'RPE went over ' + rules.mainLiftTest.maxRpe : `not every set reached ${top}`);
          lines.push({ exerciseId: id, name, text: `${name}: ${detail}, ${why}. Same weight next time, aim for ${cur.reps} on every set.` });
        }
      }
    } else {
      if (allTop) {
        const jump = rules.smallestJump[ex.equipment] || 0;
        if (jump > 0 && baseWeight != null) {
          cur.weight = roundTo(baseWeight + jump, jump);
          cur.reps = bottom; cur.stall = 0;
          lines.push({ exerciseId: id, name, text: `${name}: ${detail}, all sets at ${top}. Next time ${fmtWeight(cur.weight)} lb x ${bottom}.` });
        } else {
          cur.reps = top;
          lines.push({ exerciseId: id, name, text: `${name}: ${detail}, all sets at ${top}. Bodyweight move; add load or a harder version when you can.` });
        }
      } else {
        cur.weight = baseWeight != null ? baseWeight : cur.weight;
        cur.reps = clampReps(minReps(done) + 1, repRange);
        lines.push({ exerciseId: id, name, text: `${name}: ${detail}. Same weight, aim for ${cur.reps} next time.` });
      }
    }

    // 7. moving into the heavy weeks: main lifts switch to 3-5 reps
    if (ex.mainLift && phase !== 'heavy' && nextWeekPhase === 'heavy' && cur.weight != null) {
      const w = roundTo(cur.weight * heavy.startWeightFactor, inc);
      cur.weight = w; cur.reps = heavy.mainLiftReps[0]; cur.stall = 0;
      lines.push({ exerciseId: id, name, text: `${name}: weeks 8-11 are ${heavy.mainLiftReps[0]}-${heavy.mainLiftReps[1]} reps. Starting at ${fmtWeight(w)} lb.` });
    }

    cur.source = 'engine'; cur.updated = session.endedAt; cur.sessionId = session.id;
    next[id] = cur;
  }

  return { targets: next, lines, e1rms };
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
