// sanity.js (v1.16) - numbers that look wrong. Cameron, Nov 19: "For any number you think doesn't make sense, flag it
// for me to review. Don't want bad number impacting plan." (His squat was saved as 5 lb when he lifted 195.)
// A flagged set waits for a fix or an OK: in the workout (Done a second time keeps it), on the review screen (Save waits)
// and on Home for anything already saved. A set marked numberOk is never flagged again. Rules: rules.json numberCheck.
// Pure functions, no DOM, no storage.

import { applyProgression, epley } from './progression.js';
import { fmtWeight } from './data.js';

/**
 * v1.18: a number that cannot be right, refused where it is typed (the workout's Edit and fix sheets, Review): reps
 * below 0 or part of a rep, seconds below 0, a weight below 0. Added weight on a pull-up may be below 0 (assistance).
 * Returns what to tell him, or ''.
 */
export function impossibleNumber({ weight, reps } = {}, ex, { hold = false } = {}) {
  if (reps != null && (!Number.isFinite(reps) || reps < 0)) return hold ? 'Seconds can\'t be below 0' : 'Reps can\'t be below 0';
  if (reps != null && !hold && !Number.isInteger(reps)) return 'Reps are whole numbers';
  if (weight != null && (!Number.isFinite(weight) || (weight < 0 && !(ex && ex.equipment === 'weighted_bw')))) return 'Weight can\'t be below 0';
  return '';
}

/** Why a logged set looks wrong: { code, text, short } or null. Ramp-ups, skipped sets, holds and confirmed sets pass. */
export function numberFlag(st, ex, rules) {
  if (!st || !ex || st.ramp || st.skipped || st.numberOk || st.holdSeconds || ex.timed) return null;
  const c = (rules && rules.numberCheck) || {};
  const w = st.weight;
  const t = st.target && st.target.weight != null ? st.target.weight : null;
  const bar = rules && rules.rampUp ? rules.rampUp.barWeightLb : null;
  if (w != null && ex.equipment === 'barbell' && bar && w < bar) {
    return { code: 'under-bar', short: 'under the empty bar', text: `${fmtWeight(w)} lb is less than the empty bar (${bar} lb)` };
  }
  // v1.18: below 0 (on a pull-up that would be assistance, which the plan never asks for)
  if (w != null && w < 0) return { code: 'negative', short: 'below 0 lb', text: `${fmtWeight(w)} lb is below 0` };
  // v1.18: a dumbbell, machine or cable lift at 0 lb or under the lightest real weight (with no target, or a small
  // one, nothing caught it, and the next target would have started from it)
  const minLoad = c.minLoadLb != null ? c.minLoadLb : 2.5;
  if (w != null && w < minLoad && ['dumbbell', 'machine', 'cable'].includes(ex.equipment)) {
    return { code: 'light', short: 'too light', text: w === 0 ? '0 lb on a lift that uses weight' : `${fmtWeight(w)} lb is lighter than any ${ex.equipment === 'dumbbell' ? 'dumbbell' : 'stack setting'}` };
  }
  if (st.reps != null && st.reps < 0) return { code: 'reps', short: 'below 0', text: `${st.reps} reps is below 0` };
  if (st.reps != null && !Number.isInteger(st.reps)) return { code: 'reps', short: 'part of a rep', text: `${st.reps} reps is not a whole number` };
  if (w != null && t != null && t > 0 && ex.equipment !== 'bodyweight' && Math.abs(w - t) >= (c.minGapLb != null ? c.minGapLb : 15)) {
    if (w <= t * (c.lighterThan != null ? c.lighterThan : 0.5)) {
      const one = ex.pair && w * 2 === t;
      return { code: 'light', short: one ? 'one dumbbell?' : 'far under target', text: `${fmtWeight(w)} lb is half the ${fmtWeight(t)} lb target or less${one ? '. Two-dumbbell lifts take the total of both' : ''}` };
    }
    if (w >= t * (c.heavierThan != null ? c.heavierThan : 1.5)) return { code: 'heavy', short: 'far over target', text: `${fmtWeight(w)} lb is half again the ${fmtWeight(t)} lb target or more` };
  }
  if (w != null && t == null && c.maxLb && w > c.maxLb) return { code: 'heavy', short: `over ${c.maxLb} lb`, text: `${fmtWeight(w)} lb is more than ${c.maxLb} lb` };
  const top = st.repRange ? st.repRange[1] : null;
  if (st.reps != null && top != null && st.reps > Math.max(top * 2, top + (c.extraReps != null ? c.extraReps : 10))) {
    return { code: 'reps', short: 'odd reps', text: `${st.reps} reps is far more than the ${top} planned` };
  }
  if (st.reps === 0 && st.done) return { code: 'reps', short: '0 reps', text: '0 reps on a set marked done' };
  return null;
}

/**
 * Saved sets still waiting for a look, one group per session and exercise, in the order the sessions come:
 * [{ recordId, date, sessionName, exerciseId, name, flagged: [{ index, flag }], sets: [index] }]
 * `sets` lists every done work set of that exercise in the session (all of them can be corrected together).
 */
export function flaggedGroups(sessions, plan, rules) {
  const out = [];
  for (const s of sessions || []) {
    const by = {};
    (s.sets || []).forEach((st, index) => {
      if (!st.done) return;
      const f = numberFlag(st, plan.exercises[st.exerciseId], rules);
      if (f) (by[st.exerciseId] = by[st.exerciseId] || []).push({ index, flag: f });
    });
    for (const [id, flagged] of Object.entries(by)) {
      const ex = plan.exercises[id];
      const sets = (s.sets || []).map((st, i) => (st.exerciseId === id && st.done && !st.ramp ? i : -1)).filter(i => i >= 0);
      out.push({ recordId: s.id, date: s.date, sessionName: s.sessionName, exerciseId: id, name: ex ? ex.name : id, flagged, sets });
    }
  }
  return out;
}

const workOf = (s, id) => (s.sets || []).filter(st => st.exerciseId === id && st.done && !st.skipped && !st.ramp && st.weight != null && st.reps && !st.holdSeconds);
const when = s => String(s.startedAt || s.date || '');
// v1.18.1: a set the timer logged that nobody rated (as logger.js isUnchecked; this file stays free of the DOM)
const notRated = st => !!(st && st.unconfirmed && st.done && !st.skipped && !st.ramp);
const loggedLift = (s, id) => (s.sets || []).some(st => st.exerciseId === id && st.done && !st.skipped && !st.ramp);

/** True when `record` is the newest session that logged this lift: only that one sets its next target. */
function isLatestFor(all, id, record) {
  const latest = all.filter(s => loggedLift(s, id)).sort((a, b) => when(b).localeCompare(when(a)))[0];
  return !!latest && latest.id === record.id;
}

/**
 * A target set after this session stays as it was set, and a late rating or a number fix changes the session only:
 * one he set himself (on this session's Review or since) gives 'hand', one the coach set since (coach.json from the
 * nightly review, or a Plan check-in) gives 'coach'. Otherwise ''.
 */
function setSince(cur, record) {
  if (!cur || !cur.updated || cur.updated < (record.endedAt || '')) return '';
  return cur.source === 'you' ? 'hand' : (cur.source === 'coach' ? 'coach' : '');
}

/**
 * v1.18.1 (rules R4, rule 12): one lift of a saved session worked out again from the target it had going into that
 * session, not from what the session already produced (that counted the session twice). Sessions saved from v1.18.1
 * on keep that target on the record (targetsBefore, with the flat count and any heavy-start mark). Older ones start
 * from the target the screen showed, at count 0; in a heavy week that already was the heavy start, so it is marked
 * and not added again. Returns { going, target, line }.
 */
export function rerunLift({ record, exerciseId, plan, rules, settings }) {
  const id = exerciseId;
  let going;
  if (record.targetsBefore && Object.prototype.hasOwnProperty.call(record.targetsBefore, id)) {
    going = record.targetsBefore[id] ? JSON.parse(JSON.stringify(record.targetsBefore[id])) : {};
  } else {
    const first = (record.sets || []).find(st => st.exerciseId === id && !st.ramp && !st.baseline && !st.retest);
    going = first && first.target && first.target.weight != null ? { weight: first.target.weight, reps: first.target.reps, stall: 0 } : {};
    if (going.weight != null && record.phase && record.phase.id === 'heavy') going.heavyStart = { week: record.week };
  }
  const res = applyProgression({ session: { ...record, sets: (record.sets || []).filter(st => st.exerciseId === id) }, targets: { [id]: going }, rules, plan, settings });
  return { going, target: res.targets[id] || {}, line: res.lines.find(l => l.exerciseId === id) || null };
}

// what a re-run decides about the target; bests and e1RM are worked out over every session instead. A heavy-start
// mark the re-run did not keep is taken off, so the next heavy-week screen applies it from the corrected target.
const RERUN_KEYS = ['weight', 'reps', 'stall', 'heavyStart', 'source', 'baselineWeight', 'baselineE1rm', 'updated', 'sessionId'];
function takeRerun(cur, t) {
  for (const k of RERUN_KEYS) {
    if (k in t) cur[k] = t[k] && typeof t[k] === 'object' ? JSON.parse(JSON.stringify(t[k])) : t[k];
    else if (k === 'heavyStart') delete cur.heavyStart;
  }
}

/** The session's what-changed line for this lift replaced by the re-run's, with a note on why it changed. */
function putLine(record, id, line, note) {
  if (!line) return;
  const fixed = note ? { ...line, text: `${line.text} (${note})` } : { ...line };
  const lines = [...(record.whatChanged || [])];
  const at = lines.findIndex(l => l.exerciseId === id);
  if (at >= 0) lines.splice(at, 1, fixed); else lines.push(fixed);
  record.whatChanged = lines.filter((l, i) => l.exerciseId !== id || i === (at >= 0 ? at : lines.length - 1));
}

/**
 * A saved session corrected: new weights for some of its sets (by index), every listed set marked checked, then that
 * exercise's records, e1RM and, when this was its latest session and no hand-set target since, its next target and
 * what-changed line worked out again from the right numbers (v1.18.1: from the target it had going in, rule 12).
 * Returns { record, target, retargeted, line } (new objects; the inputs are not changed).
 */
export function applyNumberFix({ sessions, targets, recordId, exerciseId, weights, checked, plan, rules, settings }) {
  const id = exerciseId;
  const ex = plan.exercises[id];
  const src = sessions.find(s => s.id === recordId);
  const record = JSON.parse(JSON.stringify(src));
  for (const [i, w] of Object.entries(weights || {})) if (record.sets[i] && w != null && !Number.isNaN(w)) record.sets[i].weight = w;
  for (const i of checked || []) if (record.sets[i]) record.sets[i].numberOk = true;
  const all = sessions.map(s => (s.id === recordId ? record : s));
  const bw = ex && ex.equipment === 'weighted_bw' ? ((settings && settings.bodyweightLb) || 0) : 0;
  const bestOf = list => list.reduce((m, s) => {
    for (const st of workOf(s, id)) { m.e1rm = Math.max(m.e1rm, epley(st.weight + bw, st.reps) || 0); m.weight = Math.max(m.weight, st.weight); }
    return m;
  }, { e1rm: 0, weight: 0 });

  // records: this session's e1RM and PRs against the sessions before it
  const mine = bestOf([record]);
  if (ex && ex.benchmark && mine.e1rm) record.e1rms = { ...(record.e1rms || {}), [id]: mine.e1rm };
  const before = bestOf(all.filter(s => s.id !== recordId && when(s) < when(record)));
  record.prs = (record.prs || []).filter(p => p.exerciseId !== id);
  if (before.e1rm && mine.e1rm > before.e1rm) record.prs.push({ exerciseId: id, name: ex ? ex.name : id, kind: 'e1rm', value: mine.e1rm, prev: before.e1rm });
  if (before.weight && mine.weight > before.weight) record.prs.push({ exerciseId: id, name: ex ? ex.name : id, kind: 'weight', value: mine.weight, prev: before.weight });

  // the target: bests over every session; the next weight only when this session is the one that set it
  const best = bestOf(all);
  const cur = { ...((targets || {})[id] || {}) };
  if (best.e1rm) cur.bestE1rm = best.e1rm;
  if (best.weight) cur.bestWeight = best.weight;
  let retargeted = false, line = null;
  if (isLatestFor(all, id, record) && !setSince(cur, record)) {
    const run = rerunLift({ record, exerciseId: id, plan, rules, settings });
    takeRerun(cur, run.target);
    if (ex && ex.benchmark && mine.e1rm) cur.e1rm = mine.e1rm;
    line = run.line;
    putLine(record, id, line, 'numbers corrected');
    retargeted = true;
  }
  return { record, target: cur, retargeted, line };
}

/**
 * v1.18.1: the effort picked for a set the timer logged, after the session was saved (the summary or Progress). The
 * set counts from then on. When this is the lift's latest session and he has not set its target by hand since, the
 * next target is worked out again from where the lift started that session (rule 12); another set of that lift
 * still not rated keeps it where it is (rule 1).
 * Returns { record, target, retargeted, why, line, stillUnrated }: why is 'latest', 'later' (a later session set the
 * target), 'hand' (he set it himself) or 'coach' (the coach set it since). New objects; the inputs are not changed.
 */
export function rateSavedSet({ sessions, targets, recordId, index, rpe, plan, rules, settings }) {
  const src = sessions.find(s => s.id === recordId);
  const record = JSON.parse(JSON.stringify(src));
  const st = record.sets[index];
  const id = st && st.exerciseId;
  const cur = { ...((targets || {})[id] || {}) };
  if (!st || rpe == null) return { record, target: cur, retargeted: false, why: 'none', line: null, stillUnrated: 0 };
  st.rpe = rpe;
  delete st.unconfirmed;
  const all = sessions.map(s => (s.id === recordId ? record : s));
  const stillUnrated = record.sets.filter(x => x.exerciseId === id && notRated(x)).length;
  const why = !isLatestFor(all, id, record) ? 'later' : (setSince(cur, record) || 'latest');
  let retargeted = false, line = null;
  if (why === 'latest') {
    const run = rerunLift({ record, exerciseId: id, plan, rules, settings });
    takeRerun(cur, run.target);
    line = run.line;
    putLine(record, id, line, stillUnrated ? '' : 'rated after saving');
    retargeted = true;
  }
  return { record, target: cur, retargeted, why, line, stillUnrated };
}
