// logger.js - Logger: turns a finished timeline into a session record, runs the Progression Engine,
// saves everything, and renders the summary.

import { applyProgression, incrementFor } from './progression.js';
import { getTargets, setTargets, putSession, putRun, newId, getSettings } from './store.js';
import { APP_VERSION, toISODate, fmtWeight, fmtMinutes, weekNumber, effortLabel, getData, weightWithPair, isPair } from './data.js';
import { el, toast, closeModal, showModal, effortChips } from './ui.js';
import { icon } from './icons.js';

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
    trims: draft.trims || [], status: draft.status,
    // same objects as the draft, so edits on the Review screen stick across re-renders
    sets: draft.sets.map(s => Object.assign(s, { logName: plan.exercises[s.exerciseId] ? (plan.exercises[s.exerciseId].logName || plan.exercises[s.exerciseId].name) : s.name })),
    whatChanged: [], e1rms: {}, prs: []
  };
  if (tl.catchUp) { record.catchUp = true; record.catchUpInfo = tl.catchUpInfo || {}; }
  if (!record.id || draft.recordId) record.id = draft.recordId || record.id;
  return record;
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

export async function renderReview(container, draft, ctx, { onSave, onCancel }) {
  const { plan, rules } = ctx;
  const gate = !(rules.review && rules.review.blockSaveOnOpenItems === false);
  const overrides = {};
  draft.recordId = draft.recordId || newId('ses');
  const settings = await getSettings();

  async function paint() {
    const { record, result } = await previewSession(draft, { plan, rules });
    container.innerHTML = '';
    const over = record.actualSeconds - record.plannedSeconds;
    container.appendChild(el('div', { class: 'card' }, [
      el('h1', {}, 'Review and save'),
      el('p', { class: 'muted' }, `${record.sessionName} · week ${record.week} · ${fmtMinutes(record.actualSeconds)} (plan ${fmtMinutes(record.plannedSeconds)}, ${over >= 0 ? '+' : '−'}${Math.round(Math.abs(over) / 60)})${record.status !== 'complete' ? ' · ended early' : ''}`),
      el('p', { class: 'muted', style: 'margin:0' }, 'Tap a set to correct it. The arrow is the plan’s verdict for next time; change the next weight if you disagree.')
    ]));

    // v1.5: skipped sets and missing numbers come first, and Save waits for them
    const open = record.sets.map(st => ({ st, ex: plan.exercises[st.exerciseId], why: setIssue(st, plan.exercises[st.exerciseId]) })).filter(x => x.why);
    const skippedOpen = open.filter(x => x.why === 'skipped');
    if (open.length) {
      container.appendChild(el('div', { class: 'card review-open', id: 'review-open' }, [
        el('h2', {}, `${open.length} ${open.length === 1 ? 'set needs' : 'sets need'} a look`),
        el('p', { class: 'muted', style: 'margin:0 0 6px' }, gate ? 'Fill each one in, or confirm you skipped it. Then you can save.' : 'Fill each one in, or confirm you skipped it.'),
        ...open.map(({ st, ex, why }) => el('div', { class: 'open-item', onclick: () => editSet(st, ex) }, [
          el('span', {}, `${ex ? ex.name : st.name}${st.round ? ', round ' + st.round : (st.setIndex ? ', set ' + st.setIndex : '')}`),
          el('span', { class: 'why' }, `${why} ›`)
        ])),
        skippedOpen.length ? el('button', { class: 'btn', id: 'confirm-skipped', style: 'margin-top:10px', onclick: () => { skippedOpen.forEach(x => { x.st.skipOk = true; }); paint(); } }, skippedOpen.length === 1 ? 'Yes, I skipped that set' : `Yes, I skipped those ${skippedOpen.length} sets`) : null
      ]));
    } else {
      container.appendChild(el('div', { class: 'card review-open clear', id: 'review-clear' }, [el('b', {}, '✓ Every set is filled in or marked skipped.')]));
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
      const rows = sets.map((st, i) => el('div', { class: 'review-set' + (st.skipped ? ' skipped' : '') + (setIssue(st, ex) ? ' flag' : ''), onclick: () => editSet(st, ex) }, [
        el('span', { class: 'muted' }, st.baseline ? 'Base' : (st.retest ? 'Test' : (st.round ? `R${st.round}` : `${st.setIndex || i + 1}`))),
        setIssue(st, ex) ? el('span', { class: 'flag-text' }, st.skipped ? 'skipped: confirm or fill in' : `${setIssue(st, ex)}: tap to add`) : el('span', {}, st.skipped ? 'skipped' : `${st.weight != null ? weightWithPair(ex, st.weight) : (st.holdSeconds ? '' : (ex && ex.equipment === 'bodyweight' ? 'bw' : '? lb'))} × ${st.reps != null ? st.reps : '?'}${st.holdSeconds ? ' s' : ''}`),
        el('span', { class: 'muted' }, st.rpe != null && !st.skipped ? effortLabel(rules, st.rpe) : ''),
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
      onCancel ? el('button', { class: 'btn ghost', onclick: onCancel }, 'Back') : null
    ]));
    window.scrollTo(0, 0);
  }

  function editSet(st, ex) {
    const isBw = ex && ex.equipment === 'bodyweight';
    const w = el('input', { type: 'number', step: '2.5', value: st.weight == null ? '' : st.weight, inputmode: 'decimal' });
    const r = el('input', { type: 'number', step: '1', value: st.reps == null ? '' : st.reps, inputmode: 'numeric' });
    let rpe = st.rpe;
    const chips = effortChips(rules, rpe, lvl => { rpe = lvl.rpe; chips.querySelectorAll('.effort-chip').forEach(b => b.classList.toggle('on', b.dataset.key === lvl.key)); });
    showModal(el('div', {}, [
      el('h2', {}, `${st.name}${st.setIndex ? ', set ' + st.setIndex : ''}`),
      el('div', { class: 'grid2' }, [
        isBw ? el('div') : el('div', { class: 'field' }, [el('label', {}, ex && ex.equipment === 'weighted_bw' ? 'Added lb' : (isPair(ex) ? 'Total of both (lb)' : 'Weight')), w]),
        el('div', { class: 'field' }, [el('label', {}, st.holdSeconds ? 'Seconds' : 'Reps'), r])
      ]),
      st.holdSeconds ? null : el('div', { class: 'field' }, [el('label', {}, 'Effort'), chips]),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Cancel'),
        st.skipped
          ? el('button', { class: 'btn', onclick: () => { st.skipOk = true; closeModal(); paint(); } }, 'I skipped it')
          : el('button', { class: 'btn', onclick: () => { st.skipped = true; st.skipOk = true; st.done = false; closeModal(); paint(); } }, 'Mark skipped'),
        el('button', { class: 'btn primary', onclick: () => { st.weight = w.value === '' ? null : Number(w.value); st.reps = r.value === '' ? null : Number(r.value); st.rpe = rpe; st.done = true; st.skipped = false; st.skipOk = false; closeModal(); paint(); } }, st.skipped ? 'I did it: save' : 'Save')
      ])
    ]));
  }
  await paint();
}

export function renderSummary(container, record, { onDone, onBackup }) {
  container.innerHTML = '';
  const done = record.sets.filter(s => s.done && !s.ramp).length;
  const planned = record.sets.filter(s => !s.ramp).length;
  const over = record.actualSeconds - record.plannedSeconds;
  // polish: a check that pops in, then the numbers as tiles
  const stats = el('div', { class: 'card' }, [
    record.status === 'complete' ? el('div', { class: 'done-check' }, [icon('check')]) : null,
    el('h1', {}, record.status === 'complete' ? 'Session done' : 'Session ended early'),
    el('p', { class: 'muted', style: 'margin:0' }, `${record.sessionName} · week ${record.week}`),
    (planned - done > 0) ? el('p', { id: 'owed-note', style: 'margin:10px 0 0' }, `${planned - done} ${planned - done === 1 ? 'set was' : 'sets were'} not done. ${planned - done === 1 ? 'It is' : 'They are'} on this week's catch-up list on Home.`) : null,
    el('div', { class: 'done-stats' }, [
      el('div', { class: 'done-stat' + (done === planned ? ' good' : '') }, [el('b', {}, [String(done), el('small', {}, `/ ${planned}`)]), el('span', {}, 'sets logged')]),
      el('div', { class: 'done-stat' }, [el('b', {}, [String(Math.round(record.actualSeconds / 60)), el('small', {}, 'min')]), el('span', {}, `plan ${fmtMinutes(record.plannedSeconds)}, ${over >= 0 ? '+' : '−'}${Math.round(Math.abs(over) / 60)}`)]),
      record.pausedSeconds > 30 ? el('div', { class: 'done-stat' }, [el('b', {}, [String(Math.round(record.pausedSeconds / 60)), el('small', {}, 'min')]), el('span', {}, 'paused')]) : null
    ]),
    record.trims.length ? el('p', { class: 'done-trims' }, [el('b', {}, 'Trimmed: '), record.trims.join('; ')]) : null
  ]);
  const prs = (record.prs || []).length ? el('div', { class: 'card pr-card' }, [
    el('h2', {}, `${record.prs.length === 1 ? 'Personal record' : 'Personal records'}`),
    el('ul', { class: 'lines' }, record.prs.map(p => el('li', {}, p.kind === 'e1rm' ? `${p.name}: estimated 1RM ${p.value} lb (was ${p.prev})` : `${p.name}: heaviest set ${fmtWeight(p.value)} lb (was ${fmtWeight(p.prev)})`)))
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
  const actions = el('div', { class: 'stack' }, [
    el('button', { class: 'btn primary', onclick: onBackup }, 'Back up to Drive'),
    el('button', { class: 'btn', onclick: onDone }, 'Done')
  ]);
  container.append(stats, prs || '', changes, bench || '', sets, actions);
}

export function setsTable(sets) {
  const rows = sets.filter(s => !s.ramp).map(s => el('tr', {}, [
    el('td', {}, [`${s.name}${s.baseline ? ' (baseline)' : ''}${s.retest ? ' (retest)' : ''}`, s.pr && s.pr.length ? el('span', { class: 'pr-badge' }, 'PR') : null]),
    el('td', { class: 'num' }, s.setIndex != null ? (s.round ? `R${s.round}` : `${s.setIndex || ''}`) : ''),
    el('td', { class: 'num' }, s.skipped ? 'skipped' : `${s.weight != null ? weightWithPair(getData().plan.exercises[s.exerciseId], s.weight) : (s.holdSeconds ? '' : 'bw')} × ${s.reps != null ? s.reps : '?'}${s.holdSeconds ? ' s' : ''}`),
    el('td', { class: 'num' }, s.rpe != null && !s.skipped ? effortLabel(getData().rules, s.rpe) : '')
  ]));
  return el('table', {}, [el('tr', {}, [el('th', {}, 'Exercise'), el('th', { class: 'num' }, 'Set'), el('th', { class: 'num' }, 'Weight × reps'), el('th', { class: 'num' }, 'Effort')]), ...rows]);
}

// ---- pace as m:ss per mile ----
export function fmtPace(p) {
  if (!p) return '';
  const m = Math.floor(p); const s = Math.round((p - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}/mi`;
}
