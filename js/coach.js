// coach.js - v1.9 coach check-ins. Cameron writes how things feel, with optional quick tags. Tags tied to an
// exercise nudge the next target or the rest time right away (small steps only); everything is kept, synced with
// the rest of the log, and read by a scheduled coach review that answers in coach.json in his private repo.
// The helpers at the top are pure (tested in node).

import { roundTo, fmtWeight, snapLoad } from './data.js';
import { incrementFor } from './progression.js';

/** Quick tags. `needs`: 'exercise' (weight tags), 'any' (an exercise or a whole session). */
export const TAGS = [
  { id: 'too_heavy', label: 'Too heavy', needs: 'exercise' },
  { id: 'too_light', label: 'Too light', needs: 'exercise' },
  { id: 'rest_long', label: 'Rest too long', needs: 'any' },
  { id: 'rest_short', label: 'Need more rest', needs: 'any' },
  { id: 'pain', label: 'Pain or tweak' },
  { id: 'tired', label: 'Slept badly' },
  { id: 'good', label: 'Felt good' }
];
export const REST_STEP = 15;      // seconds per rest tag
export const REST_LIMIT = 45;     // the most a check-in can move one rest, either way, in total
export const REST_FLOOR = 15;     // no rest goes below this

/** Rest seconds an item has in the plan, or the round rest of the finisher it sits in. */
function planRests(plan, key) {
  const out = [];
  for (const s of plan.sessions) {
    if (key.startsWith('session:') && `session:${s.id}` !== key) continue;
    for (const b of s.blocks) for (const it of b.items || []) {
      if (!it.exercise) continue;
      if (!key.startsWith('session:') && it.exercise !== key) continue;
      if (it.restSeconds) out.push(it.restSeconds);
      else if (b.roundRestSeconds) out.push(b.roundRestSeconds);
    }
  }
  return out;
}

/**
 * What a check-in changes. Returns [{ kind: 'weight', exerciseId, from, to, reps } | { kind: 'rest', key, from, to }].
 * Weight: one increment of that lift, only when there is a target to move. Rest: 15 s a tag, at most 45 s from the plan.
 */
export function changesFor(checkin, { plan, rules, targets, restAdjust }) {
  const out = [];
  const tags = checkin.tags || [];
  const id = checkin.exerciseId;
  const ex = id ? plan.exercises[id] : null;
  if (ex && (tags.includes('too_heavy') || tags.includes('too_light'))) {
    const t = (targets || {})[id];
    if (t && t.weight != null) {
      const inc = incrementFor(rules, id, ex);
      const dir = tags.includes('too_heavy') ? -1 : 1;
      const to = Math.max(0, snapLoad(rules, ex, roundTo(t.weight + dir * inc, inc)));
      if (to !== t.weight) out.push({ kind: 'weight', exerciseId: id, from: t.weight, to, reps: t.reps });
    }
  }
  const restDir = tags.includes('rest_long') ? -1 : (tags.includes('rest_short') ? 1 : 0);
  const key = id || (checkin.sessionId ? `session:${checkin.sessionId}` : null);
  if (restDir && key) {
    const cur = (restAdjust || {})[key] || 0;
    const next = Math.max(-REST_LIMIT, Math.min(REST_LIMIT, cur + restDir * REST_STEP));
    const base = planRests(plan, key);
    // never take any rest of this exercise below the floor
    const floorOk = !base.length || Math.min(...base) + next >= REST_FLOOR;
    if (next !== cur && floorOk) out.push({ kind: 'rest', key, from: cur, to: next });
  }
  return out;
}

/** The app's own answer to a check-in, in plain words. */
export function replyFor(checkin, changes, plan) {
  const name = k => (k.startsWith('session:') ? (plan.sessions.find(s => `session:${s.id}` === k) || {}).name || 'that session' : (plan.exercises[k] || {}).name || k);
  // one sentence per lift or session: "Incline dumbbell press: next time 80 lb × 8 (was 90), and rests 15 s shorter than the plan."
  const byKey = new Map();
  for (const c of changes) {
    const k = c.kind === 'weight' ? c.exerciseId : c.key;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(c.kind === 'weight'
      ? `next time ${fmtWeight(c.to)} lb${c.reps != null ? ' × ' + c.reps : ''} (was ${fmtWeight(c.from)})`
      : `rests ${c.to === 0 ? 'back to the plan' : (c.to > 0 ? `${c.to} s longer` : `${-c.to} s shorter`) + ' than the plan'}`);
  }
  const lines = [...byKey].map(([k, parts]) => `${name(k)}: ${parts.join(', and ')}.`);
  const tags = checkin.tags || [];
  if ((tags.includes('too_heavy') || tags.includes('too_light')) && !changes.some(c => c.kind === 'weight')) {
    lines.push(checkin.exerciseId ? 'No target for that lift yet, so nothing to move. The first logged session sets one.' : 'Pick the lift it was about and the target moves one step.');
  }
  if ((tags.includes('rest_long') || tags.includes('rest_short')) && !changes.some(c => c.kind === 'rest')) {
    lines.push(checkin.exerciseId || checkin.sessionId ? 'Rest is already as far from the plan as a check-in moves it. The coach review can look at it.' : 'Pick the lift or session and the rest moves 15 s.');
  }
  if (tags.includes('pain')) lines.push('Noted for the coach review. If it is sharp or gets worse set to set, stop that lift today and use the knee swaps from the plan.');
  if (tags.includes('tired')) lines.push('On under 6 hours of sleep, still go but do the short version: blocks A and B at normal weights minus one set, and one finisher round.');
  if (!lines.length) lines.push(tags.includes('good') ? 'Good to hear. Logged.' : 'Logged. The coach review reads every check-in.');
  return lines.join(' ');
}

/**
 * v1.18.12: a target he set by hand since his last logged session of the lift (on the lift page, Home, the start page
 * or Review) stays when the coach file has a new weight or reps for that lift, unless he saved it past a warning
 * (flagged). True when the coach's weight and reps are left out; a rest change in the same adjustment still applies.
 */
export function keepsOwnTarget(target, sessions, exerciseId) {
  if (!target || target.source !== 'you' || target.flagged || !target.updated) return false;
  let last = '';
  for (const s of sessions || []) {
    if (!(s.sets || []).some(st => st.exerciseId === exerciseId && st.done && !st.skipped && !st.ramp)) continue;
    const t = String(s.endedAt || s.startedAt || '');
    if (t > last) last = t;
  }
  return String(target.updated) >= last;
}

/** Coach file adjustments not applied yet, valid ones only. */
export function pendingAdjustments(coachFile, appliedIds, plan) {
  const done = new Set(appliedIds || []);
  return ((coachFile && coachFile.adjustments) || []).filter(a => a && a.id && !done.has(a.id) && (
    (a.exerciseId && plan.exercises[a.exerciseId] && (a.weight != null || a.reps != null || a.restDelta != null)) ||
    (a.sessionId && plan.sessions.some(s => s.id === a.sessionId) && a.restDelta != null)
  ));
}

/** Rest map with a coach adjustment applied, inside the same limits as a check-in. */
export function withRest(restAdjust, key, delta) {
  const next = { ...(restAdjust || {}) };
  next[key] = Math.max(-REST_LIMIT, Math.min(REST_LIMIT, delta));
  if (!next[key]) delete next[key];
  return next;
}

/** One list of messages, oldest first: Cameron's check-ins with the app's answers, and the coach's replies. */
export function thread(checkins, coachFile) {
  const items = [];
  for (const c of checkins || []) {
    items.push({ ...c, from: 'you' });
    if (c.reply) items.push({ id: c.id + ':app', at: c.at, from: 'app', text: c.reply, replyTo: c.id });
  }
  for (const m of (coachFile && coachFile.messages) || []) if (m && m.text) items.push({ id: m.id, at: m.at, from: 'coach', text: m.text, replyTo: m.replyTo || null });
  return items.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
