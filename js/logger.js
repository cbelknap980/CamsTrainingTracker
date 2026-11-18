// logger.js - Logger: turns a finished timeline into a session record, runs the Progression Engine,
// saves everything, and renders the summary. Also the run log form.

import { applyProgression } from './progression.js';
import { getTargets, setTargets, putSession, putRun, newId, getSettings } from './store.js';
import { APP_VERSION, toISODate, fmtWeight, fmtMinutes, weekNumber, effortLabel, getData } from './data.js';
import { el, toast, closeModal, showModal, effortChips } from './ui.js';

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
export async function renderReview(container, draft, ctx, { onSave, onCancel }) {
  const { plan, rules } = ctx;
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
      const rows = sets.map((st, i) => el('div', { class: 'review-set' + (st.skipped ? ' skipped' : ''), onclick: () => editSet(st, ex) }, [
        el('span', { class: 'muted' }, st.baseline ? 'Base' : (st.retest ? 'Test' : (st.round ? `R${st.round}` : `${st.setIndex || i + 1}`))),
        el('span', {}, st.skipped ? 'skipped' : `${st.weight != null ? fmtWeight(st.weight) + ' lb' : (st.holdSeconds ? '' : 'bw')} × ${st.reps != null ? st.reps : '?'}${st.holdSeconds ? ' s' : ''}`),
        el('span', { class: 'muted' }, st.rpe != null && !st.skipped ? effortLabel(rules, st.rpe) : ''),
        st.pr && st.pr.length ? el('span', { class: 'pr-badge' }, 'PR') : el('span', { class: 'muted' }, '›')
      ]));
      card.appendChild(el('div', { class: 'review-sets' }, rows));
      if (line.verdict !== 'none' && (nextW != null || (ex && ex.equipment !== 'bodyweight'))) {
        const wIn = el('input', { type: 'number', step: String(ex && ex.mainLift ? (rules.increments.byExercise[id] || rules.increments.default) : (rules.smallestJump[(ex || {}).equipment] || 5)), value: nextW == null ? '' : nextW, inputmode: 'decimal', onchange: e => { overrides[id] = { ...(overrides[id] || {}), weight: e.target.value === '' ? null : Number(e.target.value) }; paint(); } });
        const rIn = el('input', { type: 'number', step: '1', value: nextR == null ? '' : nextR, inputmode: 'numeric', onchange: e => { overrides[id] = { ...(overrides[id] || {}), reps: e.target.value === '' ? null : Number(e.target.value) }; paint(); } });
        card.appendChild(el('div', { class: 'review-next' }, [
          el('div', { class: 'field' }, [el('label', {}, 'Next weight (lb)'), wIn]),
          el('div', { class: 'field' }, [el('label', {}, 'Next reps'), rIn]),
          ov ? el('button', { class: 'btn small ghost', onclick: () => { delete overrides[id]; paint(); } }, 'Reset') : el('div')
        ]));
      }
      container.appendChild(card);
    }
    if (result.prs && result.prs.length) container.appendChild(el('div', { class: 'card pr-card' }, [el('h2', {}, 'Personal records'), el('ul', { class: 'lines' }, result.prs.map(p => el('li', {}, p.kind === 'e1rm' ? `${p.name}: e1RM ${p.value} lb (was ${p.prev})` : `${p.name}: heaviest ${fmtWeight(p.value)} lb (was ${fmtWeight(p.prev)})`)))]));
    container.appendChild(el('div', { class: 'stack' }, [
      el('button', { class: 'btn primary', onclick: () => onSave(overrides) }, 'Save session'),
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
        isBw ? el('div') : el('div', { class: 'field' }, [el('label', {}, ex && ex.equipment === 'weighted_bw' ? 'Added lb' : 'Weight'), w]),
        el('div', { class: 'field' }, [el('label', {}, st.holdSeconds ? 'Seconds' : 'Reps'), r])
      ]),
      st.holdSeconds ? null : el('div', { class: 'field' }, [el('label', {}, 'Effort'), chips]),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Cancel'),
        st.skipped ? el('button', { class: 'btn', onclick: () => { st.skipped = false; st.done = true; st.weight = w.value === '' ? null : Number(w.value); st.reps = r.value === '' ? null : Number(r.value); st.rpe = rpe; closeModal(); paint(); } }, 'Mark done') : el('button', { class: 'btn', onclick: () => { st.skipped = true; st.done = false; closeModal(); paint(); } }, 'Mark skipped'),
        el('button', { class: 'btn primary', onclick: () => { st.weight = w.value === '' ? null : Number(w.value); st.reps = r.value === '' ? null : Number(r.value); st.rpe = rpe; st.done = true; st.skipped = false; closeModal(); paint(); } }, 'Save')
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
  const stats = el('div', { class: 'card' }, [
    el('h1', {}, record.status === 'complete' ? 'Session done' : 'Session ended early'),
    el('p', { class: 'muted' }, `${record.sessionName} · week ${record.week}`),
    el('table', {}, [
      el('tr', {}, [el('td', {}, 'Sets logged'), el('td', { class: 'num' }, `${done} of ${planned}`)]),
      el('tr', {}, [el('td', {}, 'Time'), el('td', { class: 'num' }, `${fmtMinutes(record.actualSeconds)} (plan ${fmtMinutes(record.plannedSeconds)}, ${over >= 0 ? '+' : '−'}${Math.round(Math.abs(over) / 60)})`)]),
      record.pausedSeconds > 30 ? el('tr', {}, [el('td', {}, 'Paused'), el('td', { class: 'num' }, fmtMinutes(record.pausedSeconds))]) : null,
      record.trims.length ? el('tr', {}, [el('td', {}, 'Trimmed'), el('td', {}, record.trims.join('; '))]) : null
    ])
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
    el('td', { class: 'num' }, s.skipped ? 'skipped' : `${s.weight != null ? fmtWeight(s.weight) + ' lb' : (s.holdSeconds ? '' : 'bw')} × ${s.reps != null ? s.reps : '?'}${s.holdSeconds ? ' s' : ''}`),
    el('td', { class: 'num' }, s.rpe != null && !s.skipped ? effortLabel(getData().rules, s.rpe) : '')
  ]));
  return el('table', {}, [el('tr', {}, [el('th', {}, 'Exercise'), el('th', { class: 'num' }, 'Set'), el('th', { class: 'num' }, 'Weight × reps'), el('th', { class: 'num' }, 'Effort')]), ...rows]);
}

// ---- run log form ----
export function runForm(plan, settings, existing, onSaved) {
  const today = toISODate(new Date());
  const r = existing || { date: today, type: 'Intervals', distance: '', minutes: '', rpe: 7, hr: '', notes: '' };
  const f = {};
  const mk = (label, key, attrs) => { f[key] = el('input', { value: r[key] == null ? '' : r[key], ...attrs }); return el('div', { class: 'field' }, [el('label', {}, label), f[key]]); };
  const typeSel = el('select', {}, plan.runTypes.map(t => el('option', { value: t, selected: t === r.type }, t)));
  const form = el('div', {}, [
    el('h2', {}, existing ? 'Edit run' : 'Log a run'),
    mk('Date', 'date', { type: 'date' }),
    el('div', { class: 'field' }, [el('label', {}, 'Type'), typeSel]),
    el('div', { class: 'grid2' }, [mk('Distance (mi)', 'distance', { type: 'number', step: '0.1', inputmode: 'decimal' }), mk('Time (min)', 'minutes', { type: 'number', step: '0.5', inputmode: 'decimal' })]),
    el('div', { class: 'grid2' }, [mk('RPE', 'rpe', { type: 'number', step: '0.5', inputmode: 'decimal' }), mk('Avg HR', 'hr', { type: 'number', step: '1', inputmode: 'numeric' })]),
    el('div', { class: 'field' }, [el('label', {}, 'Notes'), (f.notes = el('textarea', { rows: 2 }, r.notes || ''))]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Cancel'),
      el('button', { class: 'btn primary', onclick: async () => {
        const num = x => (x.value === '' ? null : Number(x.value));
        const rec = { id: r.id || newId('run'), date: f.date.value || today, type: typeSel.value, distance: num(f.distance), minutes: num(f.minutes), rpe: num(f.rpe), hr: num(f.hr), notes: f.notes.value.trim(), appVersion: APP_VERSION };
        rec.week = weekNumber(new Date(rec.date + 'T12:00:00'), settings.startDate);
        rec.pace = rec.distance && rec.minutes ? Math.round((rec.minutes / rec.distance) * 100) / 100 : null;
        await putRun(rec);
        closeModal(); toast('Run saved'); onSaved && onSaved(rec);
      } }, 'Save run')
    ])
  ]);
  showModal(form);
}

export function fmtPace(p) {
  if (!p) return '';
  const m = Math.floor(p); const s = Math.round((p - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}/mi`;
}
