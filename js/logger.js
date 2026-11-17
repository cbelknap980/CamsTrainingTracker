// logger.js - Logger: turns a finished timeline into a session record, runs the Progression Engine,
// saves everything, and renders the summary. Also the run log form.

import { applyProgression } from './progression.js';
import { getTargets, setTargets, putSession, putRun, newId, getSettings } from './store.js';
import { APP_VERSION, toISODate, fmtWeight, fmtMinutes, weekNumber } from './data.js';
import { el, toast, closeModal, showModal } from './ui.js';

/** Build the session record from the Player's draft, apply progression, save, return the record. */
export async function saveSession(draft, { plan, rules }) {
  const settings = await getSettings();
  const tl = draft.timeline;
  const record = {
    id: newId('ses'),
    sessionId: tl.sessionId, sessionName: tl.sessionName, logName: tl.logName,
    week: tl.week, phase: tl.phase, planVersion: tl.planVersion, appVersion: APP_VERSION,
    date: toISODate(draft.startedAt), startedAt: draft.startedAt, endedAt: draft.endedAt,
    plannedSeconds: draft.plannedSeconds, actualSeconds: draft.actualSeconds, pausedSeconds: draft.pausedSeconds,
    trims: draft.trims || [], status: draft.status,
    sets: draft.sets.map(s => ({ ...s, logName: plan.exercises[s.exerciseId] ? (plan.exercises[s.exerciseId].logName || plan.exercises[s.exerciseId].name) : s.name })),
    whatChanged: [], e1rms: {}, prs: []
  };
  const targets = await getTargets();
  const result = applyProgression({ session: record, targets, rules, plan, settings });
  record.whatChanged = result.lines;
  record.e1rms = result.e1rms;
  record.prs = result.prs || [];
  await setTargets(result.targets);
  await putSession(record);
  return record;
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
    el('td', { class: 'num' }, s.rpe != null && !s.skipped ? `RPE ${s.rpe}` : '')
  ]));
  return el('table', {}, [el('tr', {}, [el('th', {}, 'Exercise'), el('th', { class: 'num' }, 'Set'), el('th', { class: 'num' }, 'Weight × reps'), el('th', { class: 'num' }, 'RPE')]), ...rows]);
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
