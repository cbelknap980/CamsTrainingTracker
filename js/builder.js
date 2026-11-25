// builder.js - Session Builder: expands a plan session into a flat timeline of timed steps.
// Pure functions, no DOM, no storage. Tested in tests/builder.test.mjs.

import { effortText, effortToRpe, roundTo, equipmentFor, easyLoad, snapLoad } from './data.js';
import { effectiveTarget } from './progression.js';

/**
 * v1.9: coach check-ins move rest times in small steps. restAdjust = { exerciseId | 'session:<id>': seconds }.
 * An exercise's rests (or its finisher's round rest) move by its own number plus the session's. Returns a copy.
 */
export function applyRestAdjust(session, restAdjust) {
  if (!restAdjust || !Object.keys(restAdjust).length) return session;
  const s = JSON.parse(JSON.stringify(session));
  const whole = restAdjust[`session:${s.id}`] || 0;
  const move = v => Math.max(15, v);
  for (const b of s.blocks) {
    let roundDelta = null;
    for (const it of b.items || []) {
      if (!it.exercise) continue;
      const d = (restAdjust[it.exercise] || 0) + whole;
      if (it.restSeconds) it.restSeconds = move(it.restSeconds + d);
      else if (b.roundRestSeconds && d && (roundDelta === null || Math.abs(d) > Math.abs(roundDelta))) roundDelta = d;
    }
    if (roundDelta) b.roundRestSeconds = move(b.roundRestSeconds + roundDelta);
  }
  return s;
}

/**
 * buildTimeline({ plan, rules, settings, sessionId, week, targets })
 * returns { session, week, phase, steps: [...], plannedSeconds }
 *
 * A step:
 * { idx, kind, blockId, blockName, blockType, name, cue,
 *   exerciseId, setIndex, setCount, round, roundCount,
 *   target: { weight, reps } | null, repRange, effort, effortText, rpeDefault,
 *   seconds, countdown, perSide, holdSeconds,
 *   ramp, baseline, retest, fillFromBaseline, iftime,
 *   trimKind: 'rest' | 'finisherRound' | 'iftime' | null, protectedBlock,
 *   v1.4: auto (the set ends on its own timer), startSeconds, repSeconds, tips, equipment,
 *         setupSeconds / setupFor (on the rest or transition before an exercise's first set), lead (inserted set-up step)
 *   v1.18: sideSeconds (a stretch done one side at a time: one step, left then right), change (the short change-over
 *         before the next stretch), where (a line under the name, "Both legs at once"), setupExercise, learned
 *         (the set's time follows Cameron's pace, see pacing.js) }
 * `pacing` (v1.18) = { exerciseId: { repSeconds, setupSeconds } } from pacing.js; left out, every time comes from the rules.
 */
export function buildTimeline({ plan, rules, settings, sessionId, session: custom, week, targets, history, pacing }) {
  // v1.8: `session` can be passed in directly (the catch-up session is built on the fly, it is not in plan.json)
  const raw = custom || plan.sessions.find(s => s.id === sessionId);
  if (!raw) throw new Error(`Unknown session ${sessionId}`);
  // v1.9: rest offsets from coach check-ins
  const session = applyRestAdjust(raw, settings && settings.restAdjust);
  const phase = phaseFor(plan, week);
  const t = rules.timing;
  const transitionSeconds = (settings && settings.transitionSeconds) || t.transitionSeconds;
  const steps = [];
  const ctx = { plan, rules, settings, week, phase, targets: targets || {}, history: history || {}, steps, transitionSeconds, exactSets: !!session.catchUp, pacing: pacing || null };

  const blocks = session.blocks;
  blocks.forEach((block, bi) => {
    const before = steps.length;
    switch (block.type) {
      case 'warmup': addWarmup(ctx, block); break;
      case 'straight': addStraight(ctx, block); break;
      case 'superset': addSuperset(ctx, block); break;
      case 'finisher': addFinisher(ctx, block); break;
      case 'stretch': addStretch(ctx, block); break;
      case 'iftime': addIfTime(ctx, block); break;
      case 'emom': addEmom(ctx, block); break;
      default: throw new Error(`Unknown block type ${block.type}`);
    }
    // retest extras for week 12, upper day
    if (phase.id === 'retest' && session.id === 'lift2' && block.id === 'B') addRetestExtras(ctx, block);
    const isLast = bi === blocks.length - 1;
    const added = steps.length > before;
    if (added && !isLast && blocks[bi + 1].type !== 'iftime') {
      const next = blocks[bi + 1];
      push(ctx, {
        kind: 'transition', blockId: block.id, blockName: block.name, blockType: block.type,
        name: `Set up for ${nextBlockLabel(plan, next)}`, seconds: transitionSeconds, countdown: true, trimKind: null
      });
    }
  });

  const withLeads = leadIns(ctx, steps);
  steps.length = 0; steps.push(...withLeads);
  steps.forEach((s, i) => { s.idx = i; });
  const plannedSeconds = steps.reduce((a, s) => a + (s.seconds || 0), 0);
  return { sessionId: session.id, sessionName: session.name, logName: session.logName, week, phase, planVersion: plan.planVersion,
    plannedMinutes: session.plannedMinutes, plannedSeconds, steps, ...(session.catchUp ? { catchUp: true, catchUpInfo: session.catchUpInfo || {} } : {}) };
}

export function phaseFor(plan, week) {
  return plan.phases.find(p => p.weeks.includes(week)) || { id: week > 12 ? 'after' : 'before', name: week > 12 ? 'After the block' : 'Before the block' };
}

export function blankStep() {
  return { target: null, repRange: null, effort: null, effortText: '', rpeDefault: null, cue: '', exerciseId: null, last: null,
    setIndex: null, setCount: null, round: null, roundCount: null, perSide: false, holdSeconds: null, sideSeconds: null,
    ramp: false, baseline: false, retest: false, fillFromBaseline: false, iftime: false, trimKind: null, protectedBlock: false,
    countdown: false, seconds: 0 };
}

function push(ctx, step) {
  const s = { target: null, repRange: null, effort: null, effortText: '', rpeDefault: null, cue: '', exerciseId: null, last: null,
    setIndex: null, setCount: null, round: null, roundCount: null, perSide: false, holdSeconds: null, sideSeconds: null,
    ramp: false, baseline: false, retest: false, fillFromBaseline: false, iftime: false, trimKind: null, protectedBlock: false,
    countdown: false, seconds: 0, ...step };
  ctx.steps.push(s);
  return s;
}

function nextBlockLabel(plan, block) {
  if (block.type === 'stretch') return 'the stretch block';
  if (block.type === 'emom') return `${block.name.toLowerCase()}${block.room ? ` (${block.room.toLowerCase()})` : ''}`;
  if (block.type === 'finisher') return `${block.name.toLowerCase()}: ${block.items.map(i => plan.exercises[i.exercise].name).join(', ')}`;
  if (block.items && block.items.length) return block.items.map(i => plan.exercises[i.exercise].name).join(' + ');
  return block.name;
}

function setsFor(ctx, n) {
  if (ctx.exactSets) return n; // catch-up: the owed count is already what the week asked for
  const light = ctx.rules.phases.light;
  if (ctx.phase.id === 'light' && n) return Math.max(1, Math.ceil(n * light.setFactor));
  return n;
}

function repRangeFor(ctx, item, ex) {
  const heavy = ctx.rules.phases.heavy;
  if (ctx.phase.id === 'heavy' && ex && ex.mainLift && ex.autoProgress !== false && item.reps) return [...heavy.mainLiftReps];
  return item.reps ? [...item.reps] : null;
}

function targetFor(ctx, exerciseId, repRange) {
  // v1.18.1 (rules R4 rule 7): a main lift's first heavy-week session shows its heavy start (5% over, 3 reps)
  const t = effectiveTarget({ rules: ctx.rules, plan: ctx.plan, settings: ctx.settings, exerciseId, target: ctx.targets[exerciseId], phaseId: ctx.phase.id });
  // v1.18.5: a dumbbell weight the rack can't make (2 x 27.5) shows as the nearest one it can
  let weight = t && t.weight != null ? snapLoad(ctx.rules, ctx.plan.exercises[exerciseId], t.weight) : null;
  let reps = t && t.reps != null ? t.reps : (repRange ? repRange[0] : null);
  if (repRange && reps != null) reps = Math.min(Math.max(reps, repRange[0]), repRange[1]);
  return { weight, reps };
}

// ---- v1.4 set timing: start-of-set seconds + reps x tempo, plus a margin ----
export function repSecondsFor(rules, ex) {
  const tempo = (ex && ex.tempo) || rules.timing.defaultTempo;
  return tempo.reduce((a, b) => a + b, 0);
}

/** v1.18: `learned` = { repSeconds } from pacing.js replaces the tempo's seconds per rep when Cameron's pace differs. */
export function setTiming(rules, ex, reps, perSide, learned) {
  const t = rules.timing;
  const tempoSeconds = repSecondsFor(rules, ex);
  const isLearned = !!(learned && learned.repSeconds > 0);
  const repSeconds = isLearned ? learned.repSeconds : tempoSeconds;
  const startSeconds = (t.setStartSeconds && t.setStartSeconds[ex && ex.equipment]) || 3;
  const sides = perSide ? 2 : 1;
  const work = (reps || 8) * repSeconds * sides + (perSide ? t.sideSwitchSeconds : 0);
  const seconds = Math.round(startSeconds + work * (1 + t.setMarginFraction));
  return { seconds, repSeconds, startSeconds, tempoSeconds, learned: isLearned };
}

function timedSet(ctx, ex, reps, perSide, exerciseId) {
  const tm = setTiming(ctx.rules, ex, reps, perSide, ctx.pacing && exerciseId ? ctx.pacing[exerciseId] : null);
  return { seconds: tm.seconds, repSeconds: tm.repSeconds, startSeconds: tm.startSeconds, auto: true,
    ...(tm.learned ? { learned: true } : {}), tips: (ex && ex.tips) || [], equipment: equipmentFor(ex) };
}

/** v1.18: set-up seconds before an exercise's first set: by equipment, or what pacing.js learned for that exercise. */
export function setupSecondsFor(rules, ex, learned) {
  const t = rules.timing;
  if (learned && learned.setupSeconds > 0) return learned.setupSeconds;
  return (t.firstSetSetupSeconds && t.firstSetSetupSeconds[ex && ex.equipment]) || t.switchSeconds;
}

/**
 * Every set gets a countdown step in front of it, so there is always a get-ready count and room to set up.
 * The first set of each exercise gets set-up time by equipment: added to the rest before it, or used as the
 * length of the transition before it. A set that follows another set directly (finisher rounds) gets a short
 * switch step.
 * v1.18: exported and safe to run again on part of a timeline (the Equipment taken swaps reorder sets and then
 * rebuild the lead-ins): inserted steps that are not done are dropped and set-up time is taken back out of rests
 * and transitions first. `seenBefore` = exercises whose first set comes earlier in the session.
 */
export function leadIns(env, steps, seenBefore) {
  const { plan, rules, pacing } = env;
  const t = rules.timing;
  const out = [];
  const seen = new Set(seenBefore || []);
  for (const s of steps) {
    if (s.lead && !s.done && !s.skipped) continue;
    if ((s.kind === 'rest' || s.kind === 'transition') && !s.lead && !s.done && !s.skipped && s.setupFor != null) {
      if (s.kind === 'transition') { if (s.baseSeconds != null) s.seconds = s.baseSeconds; }
      else s.seconds = Math.max(10, s.seconds - (s.setupSeconds || 0));
      s.setupFor = null; s.setupSeconds = 0; s.setupExercise = null;
    }
    if (s.kind === 'set' && s.exerciseId) {
      const ex = plan.exercises[s.exerciseId];
      const first = !seen.has(s.exerciseId);
      seen.add(s.exerciseId);
      const setup = first ? setupSecondsFor(rules, ex, pacing && pacing[s.exerciseId]) : 0;
      const prev = out[out.length - 1];
      const label = `${s.name}${ex && equipmentFor(ex) ? ' (' + equipmentFor(ex).toLowerCase() + ')' : ''}`;
      if (prev && (prev.kind === 'rest' || prev.kind === 'transition') && !prev.lead && !prev.change && !prev.done && !prev.skipped) {
        if (first) {
          if (prev.kind === 'transition') { prev.baseSeconds = prev.baseSeconds != null ? prev.baseSeconds : prev.seconds; prev.seconds = Math.max(prev.seconds, setup); prev.setupSeconds = prev.seconds; }
          else { prev.seconds += setup; prev.setupSeconds = setup; }
          prev.setupFor = label; prev.setupExercise = s.exerciseId;
        }
      } else {
        const seconds = first ? Math.max(setup, t.switchSeconds) : t.switchSeconds;
        out.push({ ...blankStep(), kind: 'transition', blockId: s.blockId, blockName: s.blockName, blockType: s.blockType,
          name: first ? `Set up: ${label}` : `Switch to ${s.name}`, seconds,
          countdown: true, lead: true, setupFor: first ? label : null, setupSeconds: first ? seconds : 0, setupExercise: first ? s.exerciseId : null,
          round: s.round, roundCount: s.roundCount,
          iftime: s.iftime, trimKind: s.iftime ? 'iftime' : null, protectedBlock: s.protectedBlock });
      }
    }
    out.push(s);
  }
  return out;
}

// ---- warm-up ----
function addWarmup(ctx, block) {
  block.items.forEach(item => {
    const sets = item.sets || 1;
    for (let k = 0; k < sets; k++) {
      push(ctx, { kind: 'timed', blockId: block.id, blockName: block.name, blockType: 'warmup',
        name: item.name, setIndex: sets > 1 ? k + 1 : null, setCount: sets > 1 ? sets : null,
        seconds: item.seconds, countdown: true, cue: item.cue || '' });
      if (item.restSeconds && k < sets - 1) {
        push(ctx, { kind: 'rest', blockId: block.id, blockName: block.name, blockType: 'warmup', name: 'Rest',
          seconds: item.restSeconds, countdown: true, trimKind: null });
      }
    }
  });
}

// ---- main-lift entry: baseline top set, retest top set, or ramp-up ----
function addMainLiftEntry(ctx, block, item, ex, target, repRange) {
  const r = ctx.rules;
  const isBaseline = ctx.phase.id === 'baseline' && ex.mainLift && target.weight == null;
  const isRetest = ctx.phase.id === 'retest' && ex.mainLift && ex.autoProgress !== false;
  if (isBaseline) {
    const reps = item.exercise === 'power_clean' ? r.baseline.cleanTopSetReps : r.baseline.topSetReps;
    const label = item.exercise === 'power_clean'
      ? 'Baseline: work up in doubles to a crisp, fast weight'
      : `Baseline: work up to a set of ${reps} with ${r.baseline.topSetRir} reps left`;
    push(ctx, { kind: 'set', blockId: block.id, blockName: block.name, blockType: block.type, name: ex.name,
      exerciseId: item.exercise, setIndex: 0, setCount: null, baseline: true,
      target: { weight: null, reps }, repRange: [reps, reps], effort: { kind: 'rir', min: r.baseline.topSetRir, max: r.baseline.topSetRir },
      effortText: label, rpeDefault: 10 - r.baseline.topSetRir, seconds: item.rampUp ? 240 : 150, cue: ex.cue || '',
      tips: ex.tips || [], equipment: equipmentFor(ex) });
    push(ctx, { kind: 'rest', blockId: block.id, blockName: block.name, blockType: block.type, name: 'Rest',
      seconds: item.restSeconds, countdown: true, trimKind: 'rest' });
    return { derived: true };
  }
  if (isRetest) {
    push(ctx, { kind: 'set', blockId: block.id, blockName: block.name, blockType: block.type, name: ex.name,
      exerciseId: item.exercise, setIndex: 0, setCount: null, retest: true,
      target: { weight: target.weight, reps: 5 }, repRange: [5, 5], effort: { kind: 'rpe', min: 8, max: 9 },
      effortText: 'Retest: work up to a 5-rep set with 1-2 reps left', rpeDefault: 8.5, seconds: item.rampUp ? 240 : 150, cue: ex.cue || '',
      tips: ex.tips || [], equipment: equipmentFor(ex) });
    push(ctx, { kind: 'rest', blockId: block.id, blockName: block.name, blockType: block.type, name: 'Rest',
      seconds: item.restSeconds, countdown: true, trimKind: 'rest' });
    return { derived: false };
  }
  if (item.rampUp && target.weight != null && target.weight >= r.rampUp.skipBelowLb) {
    const bar = r.rampUp.barWeightLb;
    // v1.18.5: easy plate loads (135 = bar + a 45 a side, not 130); a step that lands on the one before it is left out
    const steps = [];
    for (const rs of r.rampUp.steps) {
      const w = rs.fraction === 0 ? bar : easyLoad(r, target.weight * rs.fraction, target.weight);
      if (!steps.length || steps[steps.length - 1].w !== w) steps.push({ ...rs, w });
    }
    steps.forEach((rs, i) => {
      const w = rs.w;
      push(ctx, { kind: 'set', blockId: block.id, blockName: block.name, blockType: block.type, name: ex.name,
        exerciseId: item.exercise, setIndex: null, setCount: null, ramp: true,
        target: { weight: w, reps: rs.reps }, repRange: [rs.reps, rs.reps], effort: null,
        effortText: rs.label ? `Ramp-up: ${rs.label.toLowerCase()}` : `Ramp-up ${i} of ${steps.length - 1}`, rpeDefault: null,
        cue: '', ...timedSet(ctx, ex, rs.reps, false, null), tips: [] });
      push(ctx, { kind: 'rest', blockId: block.id, blockName: block.name, blockType: block.type, name: 'Rest',
        seconds: r.rampUp.restSeconds, countdown: true, trimKind: 'rest' });
    });
  }
  return { derived: false };
}

function workSet(ctx, block, item, ex, k, sets, target, repRange, derived, extra) {
  const last = ctx.history[item.exercise] || null;
  return push(ctx, {
    last,
    kind: 'set', blockId: block.id, blockName: block.name, blockType: block.type, name: ex.name,
    exerciseId: item.exercise, setIndex: k + 1, setCount: sets,
    target: { weight: derived ? null : target.weight, reps: target.reps }, repRange,
    effort: item.effort, effortText: effortText(item.effort), rpeDefault: effortToRpe(item.effort),
    ...timedSet(ctx, ex, target.reps, !!ex.perSide, item.exercise), perSide: !!ex.perSide, fillFromBaseline: derived,
    cue: ex.cue || '', protectedBlock: !!block.protected, ...(extra || {})
  });
}

function rest(ctx, block, seconds, trimKind = 'rest', extra) {
  return push(ctx, { kind: 'rest', blockId: block.id, blockName: block.name, blockType: block.type, name: 'Rest',
    seconds, countdown: true, trimKind, ...(extra || {}) });
}

// ---- straight block (A: one exercise) ----
function addStraight(ctx, block) {
  block.items.forEach(item => {
    const ex = ctx.plan.exercises[item.exercise];
    const repRange = repRangeFor(ctx, item, ex);
    const target = targetFor(ctx, item.exercise, repRange);
    const { derived } = addMainLiftEntry(ctx, block, item, ex, target, repRange);
    const sets = setsFor(ctx, item.sets);
    for (let k = 0; k < sets; k++) {
      workSet(ctx, block, item, ex, k, sets, target, repRange, derived);
      if (k < sets - 1) rest(ctx, block, item.restSeconds);
    }
  });
}

// ---- superset (B1/B2): alternate, short rest after B1, longer after B2 ----
function addSuperset(ctx, block) {
  const [i1, i2] = block.items;
  const ex1 = ctx.plan.exercises[i1.exercise];
  const ex2 = ctx.plan.exercises[i2.exercise];
  const rr1 = repRangeFor(ctx, i1, ex1);
  const rr2 = repRangeFor(ctx, i2, ex2);
  const t1 = targetFor(ctx, i1.exercise, rr1);
  const t2 = targetFor(ctx, i2.exercise, rr2);
  const e1 = addMainLiftEntry(ctx, block, i1, ex1, t1, rr1);
  const e2 = addMainLiftEntry(ctx, block, i2, ex2, t2, rr2);
  const s1 = setsFor(ctx, i1.sets);
  const s2 = setsFor(ctx, i2.sets);
  const n = Math.max(s1, s2);
  for (let k = 0; k < n; k++) {
    const last1 = k >= s1 - 1;
    const last2 = k >= s2 - 1;
    if (k < s1) {
      workSet(ctx, block, i1, ex1, k, s1, t1, rr1, e1.derived);
      if (last1 && i1.afterLastSet) pushAfter(ctx, block, i1.afterLastSet);
      if (k < s2 || !last1) rest(ctx, block, i1.restSeconds);
    }
    if (k < s2) {
      workSet(ctx, block, i2, ex2, k, s2, t2, rr2, e2.derived);
      if (last2 && i2.afterLastSet) pushAfter(ctx, block, i2.afterLastSet);
      const moreToCome = (k + 1 < s1) || (k + 1 < s2);
      if (moreToCome) rest(ctx, block, i2.restSeconds);
    }
  }
}

function pushAfter(ctx, block, item) {
  push(ctx, { kind: 'timed', blockId: block.id, blockName: block.name, blockType: block.type,
    name: item.name, seconds: item.seconds, countdown: true, cue: item.cue || '' });
}

// ---- finisher: rounds of items back to back, round rest between ----
function addFinisher(ctx, block) {
  const rounds = setsFor(ctx, block.rounds);
  for (let r = 1; r <= rounds; r++) {
    block.items.forEach(item => {
      if (item.rounds && !item.rounds.includes(r)) return;
      const ex = ctx.plan.exercises[item.exercise];
      const repRange = item.reps ? [...item.reps] : null;
      const target = item.seconds ? { weight: null, reps: item.seconds } : targetFor(ctx, item.exercise, repRange);
      const perSide = !!(item.perSide || (ex && ex.perSide));
      // v1.18: a hold done one side at a time is left, a short change-over, then right (the player splits the clock)
      const holdPlan = perSide ? item.seconds * 2 + (ctx.rules.timing.holdSwitchSeconds || 0) + 4 : item.seconds + 10;
      push(ctx, {
        kind: 'set', blockId: block.id, blockName: block.name, blockType: 'finisher', name: ex.name,
        exerciseId: item.exercise, setIndex: r, setCount: rounds, round: r, roundCount: rounds,
        target, repRange: item.seconds ? [item.seconds, item.seconds] : repRange,
        effort: item.effort, effortText: effortText(item.effort), rpeDefault: effortToRpe(item.effort),
        holdSeconds: item.seconds || null, perSide,
        ...(item.seconds
          ? { seconds: holdPlan, tips: (ex && ex.tips) || [], equipment: equipmentFor(ex) }
          : timedSet(ctx, ex, target.reps, perSide, item.exercise)),
        countdown: !!item.seconds, cue: ex.cue || '', protectedBlock: !!block.protected
      });
    });
    if (r < rounds) rest(ctx, block, block.roundRestSeconds, 'finisherRound', { round: r, roundCount: rounds, name: `Rest, round ${r} of ${rounds} done` });
  }
}

// ---- stretch block ----
// ---- v1.11 EMOM (the Engine): one 60 s timed step per minute, stations in rotation ----
// block.schedule = [{ weeks, minutes } | { weeks, test: { name, seconds, cue } }]; weeks not listed use block.minutes.
export function emomMinutesFor(block, week) {
  const row = (block.schedule || []).find(r => r.weeks.includes(week));
  if (row && row.test) return { minutes: 0, test: row.test };
  return { minutes: row ? row.minutes : block.minutes, test: null };
}
function addEmom(ctx, block) {
  const { minutes, test } = emomMinutesFor(block, ctx.week);
  if (test) {
    push(ctx, { kind: 'timed', blockId: block.id, blockName: block.name, blockType: 'emom',
      name: test.name, seconds: test.seconds, countdown: true, cue: test.cue || '' });
    return;
  }
  const stations = block.stations || [];
  if (!minutes || !stations.length) return;
  const n = stations.length;
  const rounds = Math.ceil(minutes / n);
  for (let m = 0; m < minutes; m++) {
    const st = stations[m % n];
    push(ctx, { kind: 'timed', blockId: block.id, blockName: block.name, blockType: 'emom',
      name: `Min ${m + 1} of ${minutes}: ${st.name}`, seconds: 60, countdown: true,
      cue: st.cue || block.cue || '', setIndex: m + 1, setCount: minutes,
      round: Math.floor(m / n) + 1, roundCount: rounds });
  }
}

// v1.18: a stretch done one side at a time is one step (left, a short change-over, right) so the screen can show
// both sides; a short change-over step sits between two stretches so each hold gets its full time.
function addStretch(ctx, block) {
  const sb = ctx.plan.stretchBlock;
  const t = ctx.rules.timing;
  sb.items.forEach((item, i) => {
    const base = { blockId: block.id, blockName: block.name, blockType: 'stretch' };
    if (i > 0 && t.stretchSwitchSeconds) {
      push(ctx, { ...base, kind: 'transition', name: `Next: ${item.name}`, seconds: t.stretchSwitchSeconds, countdown: true, change: true });
    }
    push(ctx, { ...base, kind: 'stretch', name: item.name, countdown: true, cue: item.cue || '', where: item.where || '',
      ...(item.perSide
        ? { perSide: true, sideSeconds: item.seconds, seconds: item.seconds * 2 + (t.holdSwitchSeconds || 0) }
        : { seconds: item.seconds }) });
  });
}

// ---- if time: a decision, then the sets ----
function addIfTime(ctx, block) {
  const item = block.items[0];
  const ex = ctx.plan.exercises[item.exercise];
  const repRange = repRangeFor(ctx, item, ex);
  const target = targetFor(ctx, item.exercise, repRange);
  const sets = setsFor(ctx, item.sets);
  push(ctx, { kind: 'decision', blockId: block.id, blockName: block.name, blockType: 'iftime', iftime: true, trimKind: 'iftime',
    name: `If time: ${ex.name} ${sets} x ${repRange[0]}-${repRange[1]}`, seconds: 0,
    cue: `About ${block.minutes} minutes. Do it only if you are ahead of plan.` });
  for (let k = 0; k < sets; k++) {
    workSet(ctx, block, item, ex, k, sets, target, repRange, false, { iftime: true, trimKind: 'iftime' });
    if (k < sets - 1) rest(ctx, block, item.restSeconds, 'iftime', { iftime: true });
  }
}

// ---- retest extras (week 12, upper day) ----
function addRetestExtras(ctx, block) {
  push(ctx, { kind: 'set', blockId: 'retest', blockName: 'Retest', blockType: 'straight', name: 'Max strict pull-ups',
    exerciseId: 'max_pullups', setIndex: 1, setCount: 1, retest: true, target: { weight: null, reps: null }, repRange: null,
    effortText: 'One set, as many strict reps as you can', rpeDefault: 10, seconds: 60, cue: '' });
  rest(ctx, { id: 'retest', name: 'Retest', type: 'straight' }, 120);
  push(ctx, { kind: 'set', blockId: 'retest', blockName: 'Retest', blockType: 'straight', name: 'Max unbroken toes-to-bar',
    exerciseId: 'max_t2b', setIndex: 1, setCount: 1, retest: true, target: { weight: null, reps: null }, repRange: null,
    effortText: 'One set, unbroken', rpeDefault: 10, seconds: 60, cue: '' });
}

// ---- trim to fit: returns a new step list and a description of what was cut ----
export function trimToFit({ steps, fromIdx, overBySeconds, rules }) {
  const tr = rules.trim;
  const out = steps.map(s => ({ ...s }));
  const notes = [];
  let saved = 0;
  const remaining = () => out.slice(fromIdx).filter(s => !s.done);

  // 1. rests
  if (tr.order.includes('rests') && saved < overBySeconds) {
    let cut = 0;
    for (const s of remaining()) {
      if (s.kind !== 'rest' || s.trimKind == null) continue;
      if (s.seconds <= tr.minRestSeconds) continue;
      const newSec = Math.max(tr.minRestSeconds, Math.round(s.seconds * (1 - tr.restCutFraction) / 5) * 5);
      cut += s.seconds - newSec;
      s.seconds = newSec;
      s.trimmed = true;
    }
    if (cut > 0) { saved += cut; notes.push(`Shortened remaining rests by up to 25% (saves ${Math.round(cut / 60)} min)`); }
  }
  // 2. finisher rounds, last round first, keep minFinisherRounds
  if (tr.order.includes('finisherRounds') && saved < overBySeconds) {
    // v1.11: Engine (EMOM) rounds trim the same way, a round = one pass through its stations
    const roundTypes = ['finisher', 'emom'];
    const blockIds = [...new Set(remaining().filter(s => roundTypes.includes(s.blockType)).map(s => s.blockId))];
    for (const bid of blockIds) {
      if (saved >= overBySeconds) break;
      const blockSteps = () => out.filter(s => s.blockId === bid && roundTypes.includes(s.blockType) && !s.removed);
      let roundsLeft = Math.max(...blockSteps().map(s => s.roundCount || 1));
      const minRounds = tr.minFinisherRounds;
      while (roundsLeft > minRounds && saved < overBySeconds) {
        const lastRound = roundsLeft;
        const victims = blockSteps().filter(s => s.round === lastRound && s.idx > fromIdx && !s.done);
        if (!victims.length) break;
        let cut = 0;
        victims.forEach(s => { cut += s.seconds; s.removed = true; });
        // the rest step before the removed round carried round = lastRound-1; drop it too
        const priorRest = blockSteps().find(s => s.kind === 'rest' && s.round === lastRound - 1 && s.idx > fromIdx && !s.done);
        if (priorRest) { cut += priorRest.seconds; priorRest.removed = true; }
        saved += cut;
        roundsLeft -= 1;
        const bname = victims[0].blockName;
        notes.push(`Dropped ${bname.toLowerCase()} round ${lastRound} (saves ${Math.round(cut / 60)} min)`);
      }
    }
  }
  // 3. if-time block
  if (tr.order.includes('ifTime') && saved < overBySeconds) {
    const victims = remaining().filter(s => s.iftime && !s.removed && s.idx > fromIdx);
    if (victims.length) {
      let cut = 0;
      victims.forEach(s => { cut += s.seconds; s.removed = true; });
      saved += cut;
      notes.push(`Dropped the if-time block (saves ${Math.round(cut / 60)} min)`);
    }
  }
  const kept = out.filter(s => !s.removed);
  kept.forEach((s, i) => { s.idx = i; });
  const stillOver = overBySeconds - saved;
  if (stillOver > 60) notes.push(`Still about ${Math.round(stillOver / 60)} min over the cap after trimming; the rest is your call.`);
  return { steps: kept, notes, savedSeconds: saved };
}

/**
 * lastResults(sessions) -> { exerciseId: { date, sessionName, sets: [{ weight, reps, rpe }] } }
 * The most recent session's work sets per exercise (ramp-ups and skipped sets excluded). sessions newest first.
 */
export function lastResults(sessions) {
  const out = {};
  for (const s of sessions || []) {
    for (const set of s.sets || []) {
      if (set.ramp || !set.done || set.skipped || !set.exerciseId) continue;
      if (!out[set.exerciseId]) out[set.exerciseId] = { date: s.date, sessionName: s.sessionName, sets: [], topSet: null };
      const o = out[set.exerciseId];
      if (o.date !== s.date) continue;
      if (set.baseline || set.retest) o.topSet = { weight: set.weight, reps: set.reps, rpe: set.rpe };
      else o.sets.push({ weight: set.weight, reps: set.reps, rpe: set.rpe });
    }
  }
  return out;
}

// Projected remaining seconds from a step index (skipping done/removed).
export function remainingSeconds(steps, fromIdx) {
  return steps.slice(fromIdx).reduce((a, s) => a + (s.done ? 0 : (s.seconds || 0)), 0);
}
