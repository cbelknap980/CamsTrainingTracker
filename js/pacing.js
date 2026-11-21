// pacing.js - v1.18: set times and set-up times that follow Cameron's pace.
// Cameron, Nov 20: "confirm you are dynamically updating time if I consistently (multiple times in a row) end a
// workout early or pause". Nothing did, so this does. Pure functions over the saved sessions: no DOM, no storage,
// nothing extra to sync. The numbers that decide it are in rules.json > pacing.
//
// What is learned, per exercise:
//   - seconds per rep, from sets he ended early with Done, or had to extend (+15 s) or pause;
//   - set-up seconds before the first set, from how long he took until the Set-up done tap.
// Rest times are never touched here: they are part of the training plan.

import { repSecondsFor, setupSecondsFor } from './builder.js';

const DEFAULTS = {
  inARow: 3, earlySeconds: 5, earlyFraction: 0.15, pausedLateSeconds: 5, pauseCapSeconds: 30, minRepSeconds: 0.8,
  cushion: 0.08, minFactor: 0.5, maxFactor: 1.75, deadband: 0.07,
  setup: { inARow: 2, moreSeconds: 15, lessSeconds: 10, fraction: 0.25, minSeconds: 10, maxSeconds: 300, pauseCapSeconds: 60 }
};

export function pacingConfig(rules) {
  const p = (rules && rules.pacing) || {};
  return { ...DEFAULTS, ...p, setup: { ...DEFAULTS.setup, ...(p.setup || {}) } };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * What one logged set says about the time its timer gave it.
 * rec.secs = { plan, took, by: 'timer' | 'done' | 'manual', ext, paused } is written by the player (v1.18).
 * Returns { dir: 'early' | 'late' | 'fit', used, allot, at } (seconds per rep he took / the timer allowed),
 * or null when the set says nothing: ramp-up, baseline, retest, hold and all-out sets, sets typed in by hand,
 * skipped sets, and a Done so fast it was a tap by mistake.
 */
export function setObservation(rec, plan, rules) {
  const x = rec && rec.secs;
  if (!x || !rec.done || rec.skipped || rec.ramp || rec.baseline || rec.retest || rec.holdSeconds || rec.amrap) return null;
  if (x.by === 'manual' || !(x.plan > 0) || !(x.took > 0)) return null;
  const ex = plan.exercises[rec.exerciseId];
  const targetReps = rec.target && rec.target.reps;
  const reps = rec.reps;
  if (!ex || !(targetReps > 0) || !(reps > 0)) return null;
  const cfg = pacingConfig(rules);
  const t = rules.timing;
  const m = t.setMarginFraction || 0;
  const start = (t.setStartSeconds && t.setStartSeconds[ex.equipment]) || 3;
  const sides = rec.perSide ? 2 : 1;
  const sw = rec.perSide ? (t.sideSwitchSeconds || 0) : 0;
  const allot = ((x.plan - start) / (1 + m) - sw) / (targetReps * sides);
  if (!(allot > 0)) return null;
  const paused = x.paused || 0;
  // early: Done with time to spare for the reps he did, counting only the seconds the clock ran
  const planForReps = start + (reps * allot * sides + sw) * (1 + m);
  const early = x.by === 'done' && planForReps - x.took >= Math.max(cfg.earlySeconds, cfg.earlyFraction * planForReps);
  // v1.18: a pause makes a set late only when the set still used its time. A pause and an early Done is a break, not
  // slow reps (it read as late when Done came after Resume, and as early when Done came during the pause).
  const late = (x.ext || 0) > 0 || (paused >= cfg.pausedLateSeconds && !early);
  const need = x.took + (late ? Math.min(paused, cfg.pauseCapSeconds) : 0);
  const used = (need - start - sw) / (reps * sides);
  if (!(used >= cfg.minRepSeconds)) return null;
  const dir = late ? 'late' : (early ? 'early' : 'fit');
  return { dir, used, allot, at: rec.at || null };
}

/**
 * What the countdown before an exercise's first set says about its set-up time.
 * rec.lead = { plan, setup, took, paused, by: 'tap' | 'timer' | 'skip', tap } is written by the player (v1.18):
 * plan = the countdown's length, setup = the set-up seconds in it (the rest of it is rest), tap = seconds from the
 * start of the countdown to the Set-up done tap. Returns { dir: 'more' | 'less' | 'fit', need, allot, at } or null.
 */
export function setupObservation(rec, rules) {
  const l = rec && rec.lead;
  // setup > 0 only on the countdown before an exercise's first set (a main lift's first set is its first ramp-up)
  if (!l || !(l.setup > 0)) return null;
  const cfg = pacingConfig(rules).setup;
  const g = (rules.timing && rules.timing.getReadySeconds) || 0;
  const rest = Math.max(0, (l.plan || 0) - l.setup);
  // v1.18: of a pause, only the first cfg.pauseCapSeconds count as set-up time (a 10-minute pause made it 300 s)
  const cap = p => Math.min(p || 0, cfg.pauseCapSeconds);
  const raw = l.by === 'tap' && l.tap != null ? l.tap - (l.tapPaused || 0) + cap(l.tapPaused) - rest + g : (l.took || 0) + cap(l.paused) - rest;
  const need = clamp(Math.max(g, raw), cfg.minSeconds, cfg.maxSeconds);
  let dir = 'fit';
  if (need >= l.setup + Math.max(cfg.moreSeconds, cfg.fraction * l.setup)) dir = 'more';
  else if (l.by !== 'timer' && need <= l.setup - Math.max(cfg.lessSeconds, cfg.fraction * l.setup)) dir = 'less';
  return { dir, need, allot: l.setup, at: rec.at || null };
}

/**
 * Walk an exercise's set observations in order. After cfg.inARow sets in a row the same way, the seconds per rep
 * become the slowest of those sets (plus a cushion when shortening). Returns { repSeconds (null = the plan's tempo),
 * changes, run (the streak under way), nudge (early streaks on a keep-tempo lift, which is never shortened) }.
 */
export function learnRep(obs, tempoSeconds, cfg, keepTempo) {
  let rep = null;
  let run = [];
  let nudge = 0;
  const changes = [];
  for (const o of obs || []) {
    if (o.dir === 'fit') { run = []; continue; }
    if (run.length && run[0].dir !== o.dir) run = [];
    run.push(o);
    if (run.length < cfg.inARow) continue;
    const cur = rep != null ? rep : tempoSeconds;
    const slow = Math.max(...run.map(x => x.used));
    let next;
    if (o.dir === 'early') {
      next = Math.min(cur, slow * (1 + cfg.cushion));
      if (keepTempo) next = Math.max(next, Math.min(cur, tempoSeconds));
    } else next = Math.max(cur, slow);
    const lo = tempoSeconds * cfg.minFactor, hi = tempoSeconds * cfg.maxFactor;
    next = clamp(next, lo, hi);
    // rounded to a tenth without going past the limits (7.875 used to round up to 7.9)
    const tenth = Math.min(Math.floor(hi * 10 + 1e-9) / 10, Math.max(Math.ceil(lo * 10 - 1e-9) / 10, Math.round(next * 10) / 10));
    const value = Math.abs(next - tempoSeconds) <= cfg.deadband * tempoSeconds ? null : tenth;
    const curValue = rep;
    if (value !== curValue) { changes.push({ at: o.at, dir: o.dir, from: cur, to: value != null ? value : tempoSeconds }); rep = value; }
    else if (o.dir === 'early' && keepTempo) nudge += 1;
    run = [];
  }
  return { repSeconds: rep, changes, run: run.length ? { dir: run[0].dir, n: run.length } : null, nudge };
}

/** Set-up seconds: after cfg.setup.inARow sessions in a row off the same way, the average of what he took. */
export function learnSetup(obs, defaultSeconds, cfg) {
  const c = cfg.setup;
  let setup = null;
  let run = [];
  const changes = [];
  for (const o of obs || []) {
    if (o.dir === 'fit') { run = []; continue; }
    if (run.length && run[0].dir !== o.dir) run = [];
    run.push(o);
    if (run.length < c.inARow) continue;
    const mean = run.reduce((a, x) => a + x.need, 0) / run.length;
    const next = clamp(Math.round(mean / 5) * 5, c.minSeconds, c.maxSeconds);
    const value = Math.abs(next - defaultSeconds) < 5 ? null : next;
    if (value !== setup) { changes.push({ at: o.at, dir: o.dir, from: setup != null ? setup : defaultSeconds, to: next }); setup = value; }
    run = [];
  }
  return { setupSeconds: setup, changes, run: run.length ? { dir: run[0].dir, n: run.length } : null };
}

/**
 * Everything learned so far: { exerciseId: { repSeconds?, setupSeconds?, tempoSeconds, defaultSetup, nudge?, run? } }.
 * sessions = saved sessions in any order; extra = set records of the session under way (the player passes its own).
 * Settings: adaptTiming false switches it off; pacingSince (ISO time) forgets everything before it.
 */
export function learnPacing({ sessions, plan, rules, settings, extra }) {
  if (settings && settings.adaptTiming === false) return {};
  const cfg = pacingConfig(rules);
  const since = settings && settings.pacingSince ? String(settings.pacingSince) : null;
  const when = s => String(s.startedAt || s.date || '');
  const list = [...(sessions || [])].filter(s => s && Array.isArray(s.sets) && (!since || when(s) >= since)).sort((a, b) => when(a).localeCompare(when(b)));
  const sets = {};
  const leads = {};
  const take = rec => {
    if (!rec || !rec.exerciseId) return;
    const a = setObservation(rec, plan, rules);
    if (a) (sets[rec.exerciseId] = sets[rec.exerciseId] || []).push(a);
    const b = setupObservation(rec, rules);
    if (b) (leads[rec.exerciseId] = leads[rec.exerciseId] || []).push(b);
  };
  for (const s of list) for (const rec of s.sets) take(rec);
  for (const rec of extra || []) take(rec);
  const out = {};
  for (const id of new Set([...Object.keys(sets), ...Object.keys(leads)])) {
    const ex = plan.exercises[id];
    if (!ex) continue;
    const tempoSeconds = repSecondsFor(rules, ex);
    const defaultSetup = setupSecondsFor(rules, ex, null);
    const r = learnRep(sets[id], tempoSeconds, cfg, !!ex.keepTempo);
    const u = learnSetup(leads[id], defaultSetup, cfg);
    const e = { tempoSeconds, defaultSetup };
    if (r.repSeconds != null) e.repSeconds = r.repSeconds;
    if (u.setupSeconds != null) e.setupSeconds = u.setupSeconds;
    if (r.nudge) e.nudge = r.nudge;
    if (r.run) e.run = r.run;
    if (e.repSeconds != null || e.setupSeconds != null || e.nudge || e.run) out[id] = e;
  }
  return out;
}

const clock = sec => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/**
 * Plain lines for the start page: what differs between a timeline built from the rules alone (`plain`) and the
 * one built with the learned times (`paced`). [{ exerciseId, name, text }]
 */
export function pacingLines(plain, paced) {
  const pick = tl => {
    const m = {};
    for (const s of tl.steps) {
      if (s.kind === 'set' && s.exerciseId && s.auto && !s.ramp && !s.holdSeconds) {
        const e = m[s.exerciseId] = m[s.exerciseId] || { name: s.name };
        if (e.set == null) e.set = s.seconds;
      }
      if (s.setupExercise && s.setupSeconds) {
        const e = m[s.setupExercise] = m[s.setupExercise] || { name: (s.setupFor || '').replace(/\s*\(.*\)$/, '') };
        if (e.setup == null) e.setup = s.kind === 'rest' ? s.setupSeconds : s.seconds;
      }
    }
    return m;
  };
  const a = pick(plain);
  const b = pick(paced);
  const out = [];
  for (const id of Object.keys(b)) {
    if (!a[id]) continue;
    const bits = [];
    if (a[id].set != null && b[id].set != null && a[id].set !== b[id].set) bits.push(`sets get ${b[id].set} s (the plan's tempo gives ${a[id].set} s)`);
    if (a[id].setup != null && b[id].setup != null && a[id].setup !== b[id].setup) bits.push(`set-up ${clock(b[id].setup)} (was ${clock(a[id].setup)})`);
    if (bits.length) out.push({ exerciseId: id, name: b[id].name || a[id].name, text: bits.join(', ') });
  }
  return out;
}
