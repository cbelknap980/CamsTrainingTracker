// builder.js - Session Builder: expands a plan session into a flat timeline of timed steps.
// Pure functions, no DOM, no storage. Tested in tests/builder.test.mjs.

import { effortText, effortToRpe, roundTo } from './data.js';

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
 *   trimKind: 'rest' | 'finisherRound' | 'iftime' | null, protectedBlock }
 */
export function buildTimeline({ plan, rules, settings, sessionId, week, targets, history }) {
  const session = plan.sessions.find(s => s.id === sessionId);
  if (!session) throw new Error(`Unknown session ${sessionId}`);
  const phase = phaseFor(plan, week);
  const t = rules.timing;
  const transitionSeconds = (settings && settings.transitionSeconds) || t.transitionSeconds;
  const steps = [];
  const ctx = { plan, rules, settings, week, phase, targets: targets || {}, history: history || {}, steps, transitionSeconds };

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

  steps.forEach((s, i) => { s.idx = i; });
  const plannedSeconds = steps.reduce((a, s) => a + (s.seconds || 0), 0);
  return { sessionId: session.id, sessionName: session.name, logName: session.logName, week, phase, planVersion: plan.planVersion,
    plannedMinutes: session.plannedMinutes, plannedSeconds, steps };
}

export function phaseFor(plan, week) {
  return plan.phases.find(p => p.weeks.includes(week)) || { id: week > 12 ? 'after' : 'before', name: week > 12 ? 'After the block' : 'Before the block' };
}

function push(ctx, step) {
  const s = { target: null, repRange: null, effort: null, effortText: '', rpeDefault: null, cue: '', exerciseId: null, last: null,
    setIndex: null, setCount: null, round: null, roundCount: null, perSide: false, holdSeconds: null,
    ramp: false, baseline: false, retest: false, fillFromBaseline: false, iftime: false, trimKind: null, protectedBlock: false,
    countdown: false, seconds: 0, ...step };
  ctx.steps.push(s);
  return s;
}

function nextBlockLabel(plan, block) {
  if (block.type === 'stretch') return 'the stretch block';
  if (block.type === 'finisher') return `${block.name.toLowerCase()}: ${block.items.map(i => plan.exercises[i.exercise].name).join(', ')}`;
  if (block.items && block.items.length) return block.items.map(i => plan.exercises[i.exercise].name).join(' + ');
  return block.name;
}

function setsFor(ctx, n) {
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
  const t = ctx.targets[exerciseId];
  let weight = t && t.weight != null ? t.weight : null;
  let reps = t && t.reps != null ? t.reps : (repRange ? repRange[0] : null);
  if (repRange && reps != null) reps = Math.min(Math.max(reps, repRange[0]), repRange[1]);
  return { weight, reps };
}

function secondsForSet(ctx, ex, finisher) {
  const t = ctx.rules.timing;
  if (finisher) return t.finisherItemSeconds;
  return ex && ex.mainLift ? t.mainSetSeconds : t.accessorySetSeconds;
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
      effortText: label, rpeDefault: 10 - r.baseline.topSetRir, seconds: item.rampUp ? 240 : 150, cue: ex.cue || '' });
    push(ctx, { kind: 'rest', blockId: block.id, blockName: block.name, blockType: block.type, name: 'Rest',
      seconds: item.restSeconds, countdown: true, trimKind: 'rest' });
    return { derived: true };
  }
  if (isRetest) {
    push(ctx, { kind: 'set', blockId: block.id, blockName: block.name, blockType: block.type, name: ex.name,
      exerciseId: item.exercise, setIndex: 0, setCount: null, retest: true,
      target: { weight: target.weight, reps: 5 }, repRange: [5, 5], effort: { kind: 'rpe', min: 8, max: 9 },
      effortText: 'Retest: work up to a 5-rep set at RPE 8-9', rpeDefault: 8.5, seconds: item.rampUp ? 240 : 150, cue: ex.cue || '' });
    push(ctx, { kind: 'rest', blockId: block.id, blockName: block.name, blockType: block.type, name: 'Rest',
      seconds: item.restSeconds, countdown: true, trimKind: 'rest' });
    return { derived: false };
  }
  if (item.rampUp && target.weight != null && target.weight >= r.rampUp.skipBelowLb) {
    const bar = r.rampUp.barWeightLb;
    r.rampUp.steps.forEach((rs, i) => {
      const w = rs.fraction === 0 ? bar : Math.max(bar, roundTo(target.weight * rs.fraction, 5));
      push(ctx, { kind: 'set', blockId: block.id, blockName: block.name, blockType: block.type, name: ex.name,
        exerciseId: item.exercise, setIndex: null, setCount: null, ramp: true,
        target: { weight: w, reps: rs.reps }, repRange: [rs.reps, rs.reps], effort: null,
        effortText: rs.label ? `Ramp-up: ${rs.label.toLowerCase()}` : `Ramp-up ${i} of ${r.rampUp.steps.length - 1}`, rpeDefault: null,
        seconds: 30, cue: '' });
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
    seconds: secondsForSet(ctx, ex, false), perSide: !!ex.perSide, fillFromBaseline: derived,
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
      push(ctx, {
        kind: 'set', blockId: block.id, blockName: block.name, blockType: 'finisher', name: ex.name,
        exerciseId: item.exercise, setIndex: r, setCount: rounds, round: r, roundCount: rounds,
        target, repRange: item.seconds ? [item.seconds, item.seconds] : repRange,
        effort: item.effort, effortText: effortText(item.effort), rpeDefault: effortToRpe(item.effort),
        holdSeconds: item.seconds || null, perSide: !!(item.perSide || (ex && ex.perSide)),
        seconds: item.seconds ? item.seconds * ((item.perSide || (ex && ex.perSide)) ? 2 : 1) + 10 : secondsForSet(ctx, ex, true),
        countdown: !!item.seconds, cue: ex.cue || '', protectedBlock: !!block.protected
      });
    });
    if (r < rounds) rest(ctx, block, block.roundRestSeconds, 'finisherRound', { round: r, roundCount: rounds, name: `Rest, round ${r} of ${rounds} done` });
  }
}

// ---- stretch block ----
function addStretch(ctx, block) {
  const sb = ctx.plan.stretchBlock;
  sb.items.forEach(item => {
    const sides = item.perSide ? ['Left', 'Right'] : [null];
    sides.forEach(side => {
      push(ctx, { kind: 'stretch', blockId: block.id, blockName: block.name, blockType: 'stretch',
        name: side ? `${item.name}, ${side.toLowerCase()}` : item.name, seconds: item.seconds, countdown: true, cue: item.cue || '' });
    });
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
    const blockIds = [...new Set(remaining().filter(s => s.blockType === 'finisher').map(s => s.blockId))];
    for (const bid of blockIds) {
      if (saved >= overBySeconds) break;
      const blockSteps = () => out.filter(s => s.blockId === bid && s.blockType === 'finisher' && !s.removed);
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
