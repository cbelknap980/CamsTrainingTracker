// logger.js - Logger: turns a finished timeline into a session record, runs the Progression Engine,
// saves everything, and renders the summary.

import { applyProgression, incrementFor } from './progression.js';
import { getTargets, setTargets, putSession, putRun, newId, getSettings } from './store.js';
import { APP_VERSION, toISODate, fmtWeight, fmtMinutes, fmtDate, weekNumber, effortLabel, getData, weightWithPair, isPair } from './data.js';
import { el, toast, closeModal, showModal, effortChips, countUp } from './ui.js';
import { ringsCard } from './rings.js';
import { sessionNumbers, drawShareCard, shareOrSave } from './share-card.js';
import { icon } from './icons.js';
import { numberFlag, impossibleNumber } from './sanity.js';

/** Build the (unsaved) session record from the Player's draft and run the engine without saving. */
export async function previewSession(draft, { plan, rules }) {
  const settings = await getSettings();
  const record = buildRecord(draft, plan);
  const targets = await getTargets();
  const result = applyProgression({ session: record, targets, rules, plan, settings });
  return { record, result, targets, settings };
}

/**
 * Save the session: run the engine, then apply any next-target overrides from the Review screen
 * (overrides = { exerciseId: { weight, reps } }, tagged 'set by you'), then store everything.
 */
export async function saveSession(draft, { plan, rules, overrides }) {
  const settings = await getSettings();
  const record = buildRecord(draft, plan);
  const targets = await getTargets();
  const result = applyProgression({ session: record, targets, rules, plan, settings });
  const ov = overrides || {};
  for (const [id, o] of Object.entries(ov)) {
    const t = result.targets[id] || (result.targets[id] = {});
    const changed = (o.weight != null && o.weight !== t.weight) || (o.reps != null && o.reps !== t.reps);
    if (!changed) continue;
    if (o.weight != null) t.weight = o.weight;
    if (o.reps != null) t.reps = o.reps;
    t.source = 'you'; t.updated = record.endedAt; t.sessionId = record.id;
    const line = result.lines.find(l => l.exerciseId === id);
    const txt = ` You set next time to ${fmtWeight(t.weight)} lb${t.reps != null ? ' x ' + t.reps : ''}.`;
    if (line) { line.text += txt; line.verdict = 'you'; line.next = { weight: t.weight, reps: t.reps }; }
    else result.lines.push({ exerciseId: id, name: plan.exercises[id] ? plan.exercises[id].name : id, text: txt.trim(), verdict: 'you', reason: 'set by you', next: { weight: t.weight, reps: t.reps } });
  }
  record.whatChanged = result.lines;
  record.e1rms = result.e1rms;
  record.prs = result.prs || [];
  await setTargets(result.targets);
  await putSession(record);
  return record;
}

function buildRecord(draft, plan) {
  const tl = draft.timeline;
  const record = {
    id: newId('ses'),
    sessionId: tl.sessionId, sessionName: tl.sessionName, logName: tl.logName,
    week: tl.week, phase: tl.phase, planVersion: tl.planVersion, appVersion: APP_VERSION,
    date: toISODate(draft.startedAt), startedAt: draft.startedAt, endedAt: draft.endedAt,
    plannedSeconds: draft.plannedSeconds, actualSeconds: draft.actualSeconds, pausedSeconds: draft.pausedSeconds,
    trims: draft.trims || [], status: draft.status, engineMinutes: draft.engineMinutes || 0,
    // same objects as the draft, so edits on the Review screen stick across re-renders
    sets: draft.sets.map(s => Object.assign(s, { logName: plan.exercises[s.exerciseId] ? (plan.exercises[s.exerciseId].logName || plan.exercises[s.exerciseId].name) : s.name })),
    whatChanged: [], e1rms: {}, prs: []
  };
  // v1.18: start to finish with the pauses in it (Cameron: "I want to see total time in gym")
  if (draft.gymSeconds != null) record.gymSeconds = draft.gymSeconds;
  if (tl.catchUp) { record.catchUp = true; record.catchUpInfo = tl.catchUpInfo || {}; }
  if (!record.id || draft.recordId) record.id = draft.recordId || record.id;
  return record;
}

/** v1.18: seconds in the gym, start to finish. Sessions saved before v1.18 have working time and paused time only. */
export const gymSecondsOf = r => (r && r.gymSeconds != null ? r.gymSeconds : ((r && r.actualSeconds) || 0) + ((r && r.pausedSeconds) || 0));
/** v1.18: seconds paused while in the gym (a long gap with the app closed is neither gym time nor a pause in it). */
export const pausedInGym = r => Math.max(0, gymSecondsOf(r) - ((r && r.actualSeconds) || 0));
/** v1.18: a set the timer logged as planned that nobody has checked since (the player sets `unconfirmed`). */
export const isUnchecked = st => !!(st && st.unconfirmed && st.done && !st.skipped && !st.ramp);
/** "1 h 33 min" past the hour, "47 min" under it. */
export function fmtLong(seconds) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

export const VERDICT = {
  up: { label: 'Up', arrow: '↑', cls: 'up' },
  hold: { label: 'Hold', arrow: '→', cls: 'hold' },
  drop: { label: 'Drop', arrow: '↓', cls: 'drop' },
  set: { label: 'Set', arrow: '•', cls: 'set' },
  none: { label: '', arrow: '', cls: 'none' },
  you: { label: 'You', arrow: '✎', cls: 'you' }
};

/**
 * End-of-session Review (v1.3): every exercise with its sets (tap to edit), the engine's verdict and reason,
 * and the next weight/reps as editable fields. Save runs the engine on the edited sets and applies overrides.
 */
/** v1.5: what still needs a look on a set before the session can be saved ('' when it is fine). */
export function setIssue(st, ex) {
  if (st.ramp) return '';
  if (st.skipped) return st.skipOk ? '' : 'skipped';
  const needsWeight = ex && ex.equipment !== 'bodyweight' && !st.holdSeconds;
  if (needsWeight && st.weight == null) return 'no weight';
  if (st.reps == null) return st.holdSeconds ? 'no time' : 'no reps';
  return '';
}

export async function renderReview(container, draft, ctx, { onSave, onCancel, onPaint, onDiscard }) {
  const { plan, rules } = ctx;
  const gate = !(rules.review && rules.review.blockSaveOnOpenItems === false);
  // v1.18: next-time numbers he changed live on the draft, so they are kept with it (it is stored until Save)
  const overrides = draft.overrides && typeof draft.overrides === 'object' ? draft.overrides : (draft.overrides = {});
  draft.recordId = draft.recordId || newId('ses');
  const settings = await getSettings();

  async function paint() {
    const { record, result } = await previewSession(draft, { plan, rules });
    container.innerHTML = '';
    const over = record.actualSeconds - record.plannedSeconds;
    container.appendChild(el('div', { class: 'card' }, [
      el('h1', {}, 'Review and save'),
      el('p', { class: 'muted', id: 'review-time' }, `${record.sessionName} · week ${record.week} · ${fmtMinutes(record.actualSeconds)} (plan ${fmtMinutes(record.plannedSeconds)}, ${over >= 0 ? '+' : '−'}${Math.round(Math.abs(over) / 60)})${pausedInGym(record) > 30 ? ` · ${fmtLong(gymSecondsOf(record))} in the gym` : ''}${record.status !== 'complete' ? ' · ended early' : ''}`),
      el('p', { class: 'muted', style: 'margin:0' }, 'Tap a set to correct it. The arrow is the plan’s verdict for next time; change the next weight if you disagree.')
    ]));

    // v1.5: skipped sets and missing numbers come first, and Save waits for them.
    // v1.16: so do numbers that look wrong (Cameron: "flag it for me to review"), until fixed or confirmed.
    const open = record.sets.map(st => {
      const ex = plan.exercises[st.exerciseId];
      const issue = setIssue(st, ex);
      const flag = issue ? null : (st.done ? numberFlag(st, ex, rules) : null);
      // v1.18: a flag about reps names the reps (a bodyweight set read " lb: 0 reps")
      const flagWhy = f => (f.code === 'reps' ? (f.short === `${st.reps} reps` ? f.short : `${st.reps} reps: ${f.short}`) : `${fmtWeight(st.weight)} lb: ${f.short}`);
      return { st, ex, why: issue || (flag ? flagWhy(flag) : ''), flag };
    }).filter(x => x.why);
    const skippedOpen = open.filter(x => x.why === 'skipped');
    const flaggedOpen = open.filter(x => x.flag);
    if (open.length) {
      container.appendChild(el('div', { class: 'card review-open', id: 'review-open' }, [
        el('h2', {}, `${open.length} ${open.length === 1 ? 'set needs' : 'sets need'} a look`),
        el('p', { class: 'muted', style: 'margin:0 0 6px' }, flaggedOpen.length ? 'Fix any number that looks wrong, or confirm it is right, so a typo never moves your targets. Then you can save.' : (gate ? 'Fill each one in, or confirm you skipped it. Then you can save.' : 'Fill each one in, or confirm you skipped it.')),
        ...open.map(({ st, ex, why, flag }) => el('div', { class: 'open-item' + (flag ? ' num' : ''), onclick: () => editSet(st, ex) }, [
          el('span', {}, `${ex ? ex.name : st.name}${st.round ? ', round ' + st.round : (st.setIndex ? ', set ' + st.setIndex : (st.baseline ? ', baseline' : ''))}`),
          el('span', { class: 'why' }, `${why} ›`)
        ])),
        skippedOpen.length ? el('button', { class: 'btn', id: 'confirm-skipped', style: 'margin-top:10px', onclick: () => { skippedOpen.forEach(x => { x.st.skipOk = true; }); paint(); } }, skippedOpen.length === 1 ? 'Yes, I skipped that set' : `Yes, I skipped those ${skippedOpen.length} sets`) : null,
        flaggedOpen.length ? el('button', { class: 'btn', id: 'confirm-numbers', style: 'margin-top:10px', onclick: () => { flaggedOpen.forEach(x => { x.st.numberOk = true; }); paint(); } }, flaggedOpen.length === 1 ? 'That number is right' : `Those ${flaggedOpen.length} numbers are right`) : null
      ]));
    } else {
      container.appendChild(el('div', { class: 'card review-open clear', id: 'review-clear' }, [el('b', {}, '✓ Every set is filled in or marked skipped.')]));
    }

    // v1.18: sets whose timer ran out before an effort was picked. Nobody confirmed them, so they are listed here.
    // Saving does not wait for them, but a lift saved with one unrated keeps its target for the next session (rules R4,
    // rule 1). This page is the only place to rate them: a saved session has no rating control.
    const unchecked = record.sets.filter(st => isUnchecked(st) && !open.some(x => x.st === st));
    if (unchecked.length) {
      const one = unchecked.length === 1;
      const oneLift = new Set(unchecked.map(st => st.exerciseId)).size === 1;
      container.appendChild(el('div', { class: 'card review-unchecked', id: 'review-unchecked' }, [
        el('h2', {}, `${unchecked.length} ${one ? 'set was' : 'sets were'} logged by the timer`),
        el('p', { class: 'muted', style: 'margin:0 0 6px' }, `The clock ran out before an effort was picked. Saved without a rating, ${oneLift ? 'that lift keeps its' : 'those lifts keep their'} target next time. Tap one to rate it or correct it.`),
        ...unchecked.map(st => {
          const ex = plan.exercises[st.exerciseId];
          return el('div', { class: 'open-item unchecked', onclick: () => editSet(st, ex) }, [
            el('span', {}, `${ex ? ex.name : st.name}${st.round ? ', round ' + st.round : (st.setIndex ? ', set ' + st.setIndex : '')}`),
            el('span', { class: 'why' }, `${st.weight != null ? weightWithPair(ex, st.weight) + ' × ' : ''}${st.reps != null ? st.reps : '?'} ›`)
          ]);
        }),
        el('button', { class: 'btn', id: 'confirm-unchecked', style: 'margin-top:10px', onclick: () => { unchecked.forEach(st => { delete st.unconfirmed; }); paint(); } }, unchecked.length === 1 ? 'It went as planned' : 'They all went as planned')
      ]));
    }

    const order = [];
    const groups = {};
    for (const st of record.sets) { if (st.ramp) continue; if (!groups[st.exerciseId]) { groups[st.exerciseId] = []; order.push(st.exerciseId); } groups[st.exerciseId].push(st); }
    for (const id of order) {
      const sets = groups[id];
      const ex = plan.exercises[id];
      const line = result.lines.find(l => l.exerciseId === id) || { verdict: 'none', reason: '', next: { weight: null, reps: null } };
      const v = VERDICT[line.verdict] || VERDICT.none;
      const ov = overrides[id];
      const nextW = ov && ov.weight != null ? ov.weight : line.next.weight;
      const nextR = ov && ov.reps != null ? ov.reps : line.next.reps;
      const curW = sets.find(x => x.done && x.weight != null && !x.baseline) ? sets.filter(x => x.done && x.weight != null && !x.baseline).slice(-1)[0].weight : null;
      const delta = curW != null && nextW != null ? nextW - curW : null;
      const card = el('div', { class: 'card review-card' });
      card.appendChild(el('div', { class: 'row' }, [
        el('div', {}, [el('b', {}, ex ? ex.name : (sets[0].name || id)), el('div', { class: 'muted', style: 'font-size:var(--t-small)' }, line.reason || '')]),
        v.label ? el('span', { class: 'verdict ' + (ov ? 'you' : v.cls) }, ov ? '✎ set by you' : `${v.arrow} ${v.label}${delta != null && delta !== 0 ? ` ${delta > 0 ? '+' : ''}${fmtWeight(delta)}` : ''}`) : null
      ]));
      const rows = sets.map((st, i) => el('div', { class: 'review-set' + (st.skipped ? ' skipped' : '') + (setIssue(st, ex) || (st.done && numberFlag(st, ex, rules)) ? ' flag' : ''), onclick: () => editSet(st, ex) }, [
        el('span', { class: 'muted' }, st.baseline ? 'Base' : (st.retest ? 'Test' : (st.round ? `R${st.round}` : `${st.setIndex || i + 1}`))),
        setIssue(st, ex) ? el('span', { class: 'flag-text' }, st.skipped ? 'skipped: confirm or fill in' : `${setIssue(st, ex)}: tap to add`) : el('span', {}, st.skipped ? 'skipped' : `${st.weight != null ? weightWithPair(ex, st.weight) : (st.holdSeconds ? '' : (ex && ex.equipment === 'bodyweight' ? 'bw' : '? lb'))} × ${st.reps != null ? st.reps : '?'}${st.holdSeconds ? ' s' : ''}`),
        el('span', { class: 'muted' + (isUnchecked(st) ? ' not-rated' : '') }, isUnchecked(st) ? 'not rated' : (st.rpe != null && !st.skipped ? effortLabel(rules, st.rpe) : '')),
        st.pr && st.pr.length ? el('span', { class: 'pr-badge' }, 'PR') : el('span', { class: 'muted' }, '›')
      ]));
      card.appendChild(el('div', { class: 'review-sets' }, rows));
      if (line.verdict !== 'none' && (nextW != null || (ex && ex.equipment !== 'bodyweight'))) {
        const wIn = el('input', { type: 'number', step: String(incrementFor(rules, id, ex) || 5), value: nextW == null ? '' : nextW, inputmode: 'decimal', onchange: e => { overrides[id] = { ...(overrides[id] || {}), weight: e.target.value === '' ? null : Number(e.target.value) }; paint(); } });
        const rIn = el('input', { type: 'number', step: '1', value: nextR == null ? '' : nextR, inputmode: 'numeric', onchange: e => { overrides[id] = { ...(overrides[id] || {}), reps: e.target.value === '' ? null : Number(e.target.value) }; paint(); } });
        card.appendChild(el('div', { class: 'review-next' }, [
          el('div', { class: 'field' }, [el('label', {}, isPair(ex) ? 'Next total (lb)' : 'Next weight (lb)'), wIn]),
          el('div', { class: 'field' }, [el('label', {}, 'Next reps'), rIn]),
          ov ? el('button', { class: 'btn small ghost', onclick: () => { delete overrides[id]; paint(); } }, 'Reset') : el('div')
        ]));
      }
      container.appendChild(card);
    }
    if (result.prs && result.prs.length) container.appendChild(el('div', { class: 'card pr-card' }, [el('h2', {}, 'Personal records'), el('ul', { class: 'lines' }, result.prs.map(p => el('li', {}, p.kind === 'e1rm' ? `${p.name}: e1RM ${p.value} lb (was ${p.prev})` : `${p.name}: heaviest ${fmtWeight(p.value)} lb (was ${fmtWeight(p.prev)})`)))]));
    container.appendChild(el('div', { class: 'stack' }, [
      el('button', { class: 'btn primary', id: 'save-session', disabled: gate && open.length > 0, onclick: () => { if (gate && open.length) return; onSave(overrides); } }, gate && open.length ? `Save session (${open.length} to check first)` : 'Save session'),
      onCancel ? el('button', { class: 'btn ghost', onclick: onCancel }, 'Back') : null,
      onDiscard ? el('button', { class: 'btn ghost danger-text', id: 'discard-session', onclick: onDiscard }, 'Discard this session') : null
    ]));
    window.scrollTo(0, 0);
    if (onPaint) onPaint();
  }

  function editSet(st, ex) {
    const isBw = ex && ex.equipment === 'bodyweight';
    const w = el('input', { type: 'number', step: '2.5', value: st.weight == null ? '' : st.weight, inputmode: 'decimal' });
    const r = el('input', { type: 'number', step: '1', value: st.reps == null ? '' : st.reps, inputmode: 'numeric' });
    let rpe = st.rpe;
    let picked = false;
    const chips = effortChips(rules, rpe, lvl => { rpe = lvl.rpe; picked = true; chips.querySelectorAll('.effort-chip').forEach(b => b.classList.toggle('on', b.dataset.key === lvl.key)); });
    const flag = st.done ? numberFlag(st, ex, rules) : null;
    // v1.18: the effort on a set the timer logged is the app's guess, so no button is lit until he picks one
    const guess = isUnchecked(st);
    if (guess) chips.querySelectorAll('.effort-chip').forEach(b => b.classList.remove('on'));
    // v1.18: a number that cannot be right is refused, said inside the sheet (a toast sits behind it)
    const refused = el('div', { class: 'num-flag', id: 'edit-refused', role: 'alert', hidden: true });
    showModal(el('div', {}, [
      el('h2', {}, `${st.name}${st.setIndex ? ', set ' + st.setIndex : ''}`),
      flag ? el('div', { class: 'num-flag', id: 'num-flag' }, [el('b', {}, 'Check this number. '), `${flag.text}.`]) : null,
      guess ? el('p', { class: 'muted', id: 'unchecked-note', style: 'margin:0 0 10px' }, 'The timer logged this set before an effort was picked. Change what is off and pick the effort, then save.') : null,
      el('div', { class: 'grid2' }, [
        isBw ? el('div') : el('div', { class: 'field' }, [el('label', {}, ex && ex.equipment === 'weighted_bw' ? 'Added lb' : (isPair(ex) ? 'Total of both (lb)' : 'Weight')), w]),
        el('div', { class: 'field' }, [el('label', {}, st.holdSeconds ? 'Seconds' : 'Reps'), r])
      ]),
      st.holdSeconds ? null : el('div', { class: 'field' }, [el('label', {}, 'Effort'), chips]),
      refused,
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Cancel'),
        flag ? el('button', { class: 'btn', id: 'number-ok', onclick: () => { st.numberOk = true; closeModal(); paint(); } }, 'It\'s right') : null,
        st.skipped
          ? el('button', { class: 'btn', onclick: () => { st.skipOk = true; closeModal(); paint(); } }, 'I skipped it')
          : el('button', { class: 'btn', onclick: () => { st.skipped = true; st.skipOk = true; st.done = false; delete st.unconfirmed; closeModal(); paint(); } }, 'Mark skipped'),
        el('button', { class: 'btn primary', id: 'edit-set-save', onclick: () => {
          const typed = { weight: w.value === '' ? null : Number(w.value), reps: r.value === '' ? null : Number(r.value) };
          // v1.18: reps below 0 or part of a rep are refused; the sheet stays open
          const bad = impossibleNumber(typed, ex, { hold: !!st.holdSeconds });
          if (bad) { refused.textContent = `${bad}.`; refused.hidden = false; return; }
          // v1.18: the effort on a set the timer logged is a guess, so saving it needs a pick (Save used to keep the guess)
          if (guess && !picked && !st.holdSeconds) { refused.textContent = 'Pick the effort too, so this set can count.'; refused.hidden = false; return; }
          st.weight = typed.weight; st.reps = typed.reps; st.rpe = rpe; st.done = true; st.skipped = false; st.skipOk = false; delete st.unconfirmed; closeModal(); paint(); } }, st.skipped ? 'I did it: save' : 'Save')
      ])
    ]));
  }
  await paint();
}

export function renderSummary(container, record, { onDone, onBackup, prev, rings, syncOn } = {}) {
  container.innerHTML = '';
  const n = sessionNumbers(record, prev);
  const { done, planned } = n;
  const over = record.actualSeconds - record.plannedSeconds;
  // v1.14: one card worth keeping. The numbers roll up, volume is compared with the same session last time,
  // records get a badge, the week's rings sit underneath, and Save image makes a picture of it.
  const num = (value, fmt) => { const b = el('b', {}, ''); countUp(b, value, fmt ? { fmt } : {}); return b; };
  const tile = (cls, value, unit, label, fmt) => el('div', { class: 'done-stat' + cls }, [el('div', { class: 'ds-num' }, [num(value, fmt), el('small', {}, unit)]), el('span', {}, label)]);
  const stats = el('div', { class: 'card done-card', id: 'done-card' }, [
    record.status === 'complete' ? el('div', { class: 'done-check' }, [icon('check')]) : null,
    el('h1', {}, record.status === 'complete' ? 'Session done' : 'Session ended early'),
    el('p', { class: 'muted', style: 'margin:0' }, `${record.sessionName} · ${fmtDate(record.date)} · week ${record.week}`),
    (planned - done > 0) ? el('p', { id: 'owed-note', style: 'margin:10px 0 0' }, `${planned - done} ${planned - done === 1 ? 'set was' : 'sets were'} not done. ${planned - done === 1 ? 'It is' : 'They are'} on this week's catch-up list on Home.`) : null,
    el('div', { class: 'done-stats' }, [
      tile(done === planned ? ' good' : '', done, `/ ${planned}`, 'sets logged'),
      tile('', Math.round(record.actualSeconds / 60), 'min', `plan ${fmtMinutes(record.plannedSeconds)}, ${over >= 0 ? '+' : '−'}${Math.round(Math.abs(over) / 60)}`),
      n.volume ? tile(n.change > 0 ? ' good' : '', n.volume, 'lb', n.change != null ? `${n.change >= 0 ? '+' : '−'}${Math.abs(n.change)}% vs last time` : 'lifted', v => Math.round(v).toLocaleString()) : null,
      // v1.18: with a pause in it, the time in the gym next to the working time (it used to show the pause alone)
      pausedInGym(record) > 30 ? el('div', { class: 'done-stat', id: 'gym-stat' }, [el('div', { class: 'ds-num' }, [num(Math.round(gymSecondsOf(record) / 60)), el('small', {}, 'min')]), el('span', {}, `in the gym, ${Math.max(1, Math.round(pausedInGym(record) / 60))} paused`)]) : null
    ]),
    record.trims.length ? el('p', { class: 'done-trims' }, [el('b', {}, 'Trimmed: '), record.trims.join('; ')]) : null,
    rings ? ringsCard(rings, { compact: true }) : null
  ]);
  const prs = (record.prs || []).length ? el('div', { class: 'card pr-card', id: 'pr-card' }, [
    el('h2', {}, `${record.prs.length === 1 ? 'Personal record' : `${record.prs.length} personal records`}`),
    el('div', { class: 'pr-rows' }, record.prs.map(p => el('div', { class: 'pr-row' }, [
      el('span', { class: 'pr-badge big' }, 'PR'),
      el('div', { class: 'pr-what' }, [el('b', {}, p.name), el('span', { class: 'muted' }, p.kind === 'e1rm' ? `estimated 1RM, was ${p.prev}` : `heaviest set, was ${fmtWeight(p.prev)}`)]),
      el('div', { class: 'pr-val' }, [num(p.value, v => fmtWeight(Math.round(v * 2) / 2)), el('small', {}, ' lb')])
    ])))
  ]) : null;
  const changes = el('div', { class: 'card' }, [
    el('h2', {}, 'What changed for next time'),
    record.whatChanged.length ? el('ul', { class: 'lines' }, record.whatChanged.map(l => el('li', {}, l.text))) : el('p', { class: 'muted' }, 'Nothing logged, nothing changed.')
  ]);
  const e1 = Object.entries(record.e1rms || {});
  const bench = e1.length ? el('div', { class: 'card' }, [
    el('h2', {}, 'Estimated 1RM today'),
    el('table', {}, e1.map(([id, v]) => el('tr', {}, [el('td', {}, record.sets.find(s => s.exerciseId === id)?.name || id), el('td', { class: 'num' }, `${v} lb`)])))
  ]) : null;
  const sets = el('div', { class: 'card' }, [
    el('h2', {}, 'Sets'),
    setsTable(record.sets)
  ]);
  const saveImage = el('button', { class: 'btn', id: 'save-image', onclick: async () => {
    saveImage.disabled = true;
    try {
      const blob = await drawShareCard(record, { prev, rings });
      const r = await shareOrSave(blob, `${(record.logName || record.sessionName).replace(/[^\w-]+/g, '-').toLowerCase()}-${record.date}.png`);
      if (r === 'saved') toast('Image saved to Downloads');
    } catch (e) { toast('Could not make the image'); }
    saveImage.disabled = false;
  } }, [icon('share'), 'Save image']);
  // with sync on the session is already on its way to the computer copy, so Done leads
  const actions = el('div', { class: 'stack' }, [
    el('button', { class: 'btn primary', id: 'summary-done', onclick: onDone }, 'Done'),
    saveImage,
    el('button', { class: 'btn ' + (syncOn ? 'ghost' : ''), onclick: onBackup }, 'Back up to Drive')
  ]);
  container.append(stats, prs || '', actions, changes, bench || '', sets);
}

export function setsTable(sets) {
  const rows = sets.filter(s => !s.ramp).map(s => el('tr', {}, [
    el('td', {}, [`${s.name}${s.baseline ? ' (baseline)' : ''}${s.retest ? ' (retest)' : ''}`, s.pr && s.pr.length ? el('span', { class: 'pr-badge' }, 'PR') : null]),
    el('td', { class: 'num' }, s.setIndex != null ? (s.round ? `R${s.round}` : `${s.setIndex || ''}`) : ''),
    el('td', { class: 'num' }, s.skipped ? 'skipped' : `${s.weight != null ? weightWithPair(getData().plan.exercises[s.exerciseId], s.weight) : (s.holdSeconds ? '' : 'bw')} × ${s.reps != null ? s.reps : '?'}${s.holdSeconds ? ' s' : ''}`),
    el('td', { class: 'num' + (isUnchecked(s) ? ' muted' : '') }, isUnchecked(s) ? 'not rated' : (s.rpe != null && !s.skipped ? effortLabel(getData().rules, s.rpe) : ''))
  ]));
  return el('table', {}, [el('tr', {}, [el('th', {}, 'Exercise'), el('th', { class: 'num' }, 'Set'), el('th', { class: 'num' }, 'Weight × reps'), el('th', { class: 'num' }, 'Effort')]), ...rows]);
}

// ---- pace as m:ss per mile ----
export function fmtPace(p) {
  if (!p) return '';
  const m = Math.floor(p); const s = Math.round((p - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}/mi`;
}
