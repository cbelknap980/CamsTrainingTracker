// session-hooks.js - v1.19: what the workout screen (player.js) shows for the notes, the all-out set and the knee
// check. Kept here so player.js only makes small calls at its hook points (upNext, justDone, heroReadout,
// spokenTarget, baseRecord, the edit panel).

import { el, toast } from './ui.js';
import { getExNotes } from './store.js';
import { noteText, noteLine } from './notes.js';
import { amrapRepsText } from './amrap.js';
import { askIdx, applyKneeSwap, undoKneeSwap } from './knee.js';
import { askKnee } from './knee-ui.js';

// ---- notes: loaded once when a session starts or resumes ----
let notes = {};
export async function primeNotes() { try { notes = await getExNotes(); } catch (e) { notes = {}; } return notes; }
/** The sticky note for the lift a step belongs to, as a line for the Up next card (null when there is none). */
export function upNextNote(step) {
  return step && step.exerciseId ? noteLine(noteText(notes, step.exerciseId), 'ex-note upnext-note') : null;
}

// ---- the all-out set ----
/** The pill over the readout: 'All-out' for an all-out set, else null (the player keeps its own label). */
export function allOutLabel(step) { return step && step.kind === 'set' && step.amrap ? 'All-out' : null; }
/** Reps as shown on the readout: '5+' for an all-out set, else null. */
export function allOutReps(step) { return amrapRepsText(step); }
/** The spoken target: 'at least 5 reps, then as many good reps as you can', else null. */
export function allOutSpoken(step) {
  return step && step.amrap ? `at least ${step.amrapFloor} reps, then as many good reps as you can` : null;
}
/** An all-out set opens the reps box by itself, so the real count gets typed before Done. */
export function opensEdit(step) { return !!(step && step.amrap); }
/** Flags a set's record keeps for the Progression Engine (spread into baseRecord). */
export function recordFlags(step) {
  return { ...(step && step.amrap ? { amrap: true, amrapFloor: step.amrapFloor } : {}), ...(step && step.kneeSwap ? { kneeSwap: true } : {}) };
}

// ---- the knee check: one row under the last-set card after the first squat or RDL work set ----
/**
 * player: the Player (uses steps, rules, plan, s.idx, s.startedISO, persist(), renderStep()). idx: the set the
 * last-set card shows. Returns a button, or null when this set is not the one to ask after.
 */
export function kneeAskRow(player, idx) {
  const { rules, plan, steps } = player;
  if (!rules.knee || idx !== askIdx(rules, steps)) return null;
  const st = steps[idx];
  if (!st || !st.done || !st.record) return null;
  const cur = st.record.knee;
  const onSaved = entry => {
    st.record.knee = entry.score;
    const from = player.s.idx;
    if (entry.score >= rules.knee.swapAt) {
      const changed = applyKneeSwap(steps, rules, plan, { fromIdx: from });
      if (changed.length) toast(`Switched to ${changed.map(c => c.to.toLowerCase()).join(' and ')} for the rest of today`, 3500);
    } else if (undoKneeSwap(steps, { fromIdx: from })) toast('Back to the regular lift');
    player.persist(); player.renderStep();
  };
  return el('button', { type: 'button', class: 'knee-ask' + (cur != null ? ' done' : ''), id: 'knee-ask',
    onclick: () => askKnee({ rules, when: 'set', title: 'Knee after that set?', current: cur, extra: { exerciseId: st.exerciseId, stepKey: `${player.s.startedISO}:${idx}` }, onSaved })
  }, cur != null ? `Knee ${cur}/10 · tap to change` : 'Knee? Tap to rate 0-10');
}
