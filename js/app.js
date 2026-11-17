// app.js - app shell: boot, tabs, Home, History, Runs, Settings, and the start/resume/summary flow.

import { loadData, APP_VERSION, weekNumber, phaseForWeek, todaysSessionId, sessionById, fmtWeight, fmtDate, fmtMinutes, toISODate } from './data.js';
import { buildTimeline, lastResults } from './builder.js';
import { icon } from './icons.js';
import { Player } from './player.js';
import { saveSession, renderSummary, renderReview, runForm, setsTable, fmtPace } from './logger.js';
import { epley, targetFromBenchmark } from './progression.js';
import { getTargets, setTarget, getSessions, getRuns, deleteRun, deleteSession, getInProgress, clearInProgress, getSettings, saveSettings, setSettingsDefaults, wipeAll } from './store.js';
import { backupNow, downloadBackup, restoreFromFile, exportExcel } from './export.js';
import { renderArchitecture } from './architecture.js';
import { el, toast, showModal, closeModal, confirmDialog } from './ui.js';

const view = document.getElementById('view');
let D = null; // { plan, rules, settingsDefaults, architecture }
let player = null;
let currentTab = 'home';

async function boot() {
  try {
    D = await loadData();
  } catch (e) {
    view.innerHTML = '';
    view.appendChild(el('div', { class: 'card' }, [el('h2', {}, 'Could not load the plan data'), el('p', { class: 'muted' }, String(e.message || e))]));
    return;
  }
  setSettingsDefaults(D.settingsDefaults);
  document.querySelectorAll('#tabs .tab').forEach(b => {
    b.prepend(icon(b.dataset.view));
    b.addEventListener('click', () => showTab(b.dataset.view));
  });
  const sb = document.getElementById('settings-btn'); sb.innerHTML = ''; sb.appendChild(icon('settings'));
  sb.addEventListener('click', () => renderSettings());
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  await updateWeekChip();
  const inProgress = await getInProgress();
  if (inProgress && inProgress.status === 'running' && Date.now() - (inProgress.lastTick || 0) < D.rules.timing.resumeWindowHours * 3600000) {
    offerResume(inProgress);
  } else {
    if (inProgress) clearInProgress().catch(() => {});
    showTab('home');
  }
}

async function updateWeekChip() {
  const settings = await getSettings();
  const week = weekNumber(new Date(), settings.startDate);
  const phase = phaseForWeek(D.plan, week);
  document.getElementById('week-chip').textContent = week >= 1 && week <= 12 ? `Week ${week} · ${phase.name}` : phase.name;
}

function showTab(name) {
  currentTab = name;
  document.querySelectorAll('#tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  window.scrollTo(0, 0);
  if (name === 'home') renderHome();
  else if (name === 'history') renderHistory();
  else if (name === 'runs') renderRuns();
  else if (name === 'architecture') renderArchitecture(view, D.architecture, D.plan);
}

// ---- Home ----
async function renderHome() {
  await updateWeekChip();
  const settings = await getSettings();
  const targets = await getTargets();
  const today = new Date();
  const week = weekNumber(today, settings.startDate);
  const phase = phaseForWeek(D.plan, week);
  const todayId = todaysSessionId(D.plan, today);
  const session = todayId ? sessionById(D.plan, todayId) : null;
  const run = todayId ? D.plan.runs.find(r => r.id === todayId) : null;
  view.innerHTML = '';

  const todayCard = el('div', { class: 'card accent' });
  todayCard.appendChild(el('h3', {}, `Today, ${fmtDate(toISODate(today))} · week ${week}${phase.note ? ' · ' + phase.name : ''}`));
  if (session) {
    const tl = buildTimeline({ plan: D.plan, rules: D.rules, settings, sessionId: session.id, week, targets });
    todayCard.appendChild(el('h1', {}, session.name));
    todayCard.appendChild(el('p', { class: 'muted' }, `${tl.steps.length} steps · about ${fmtMinutes(tl.plannedSeconds)} · ${phase.note || ''}`));
    todayCard.appendChild(el('button', { class: 'btn primary', onclick: () => startSession(session.id, week) }, 'Start'));
  } else if (run) {
    todayCard.appendChild(el('h1', {}, run.name));
    todayCard.appendChild(el('p', { class: 'muted' }, run.note));
    todayCard.appendChild(el('button', { class: 'btn primary', onclick: () => runForm(D.plan, settings, null, () => renderHome()) }, 'Log this run'));
  } else {
    todayCard.appendChild(el('h1', {}, 'Slack day'));
    todayCard.appendChild(el('p', { class: 'muted' }, 'Make-up day. Pick a session below if you missed one, or rest.'));
  }
  view.appendChild(todayCard);

  const other = el('div', { class: 'card' }, [
    el('h3', {}, 'Start a different session'),
    el('div', { class: 'grid3' }, D.plan.sessions.map(s => el('button', { class: 'btn small', style: 'width:100%', onclick: () => startSession(s.id, week) }, s.name.replace(': ', '\n'))))
  ]);
  view.appendChild(other);

  // next targets
  const rows = Object.entries(D.plan.exercises).filter(([id]) => targets[id] && targets[id].weight != null).map(([id, ex]) => {
    const t = targets[id];
    return el('tr', { class: 'tappable', onclick: () => editTarget(id, ex, t) }, [
      el('td', {}, [ex.name, ' ', t.source === 'you' ? el('span', { class: 'badge you' }, 'set by you') : null]),
      el('td', { class: 'num' }, `${fmtWeight(t.weight)} lb × ${t.reps != null ? t.reps : '-'}`),
      el('td', { class: 'num muted' }, t.e1rm ? `e1RM ${t.e1rm}` : '')
    ]);
  });
  view.appendChild(el('div', { class: 'card' }, [
    el('h3', {}, 'Next targets'),
    rows.length ? el('table', {}, [el('tr', {}, [el('th', {}, 'Exercise'), el('th', { class: 'num' }, 'Weight × reps'), el('th', { class: 'num' }, '')]), ...rows]) : el('p', { class: 'muted' }, 'No targets yet. Week 1 sessions work up to a baseline set on each main lift; accessories take the weight you log the first time.'),
    el('p', { class: 'muted', style: 'margin-top:8px' }, 'Tap a row to change a target by hand.')
  ]));

  view.appendChild(benchmarksCard(targets, settings));

  const last = (await getSessions())[0];
  if (last && last.whatChanged && last.whatChanged.length) {
    view.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, `What changed after ${last.sessionName}, ${fmtDate(last.date)}`),
      el('ul', { class: 'lines' }, last.whatChanged.map(l => el('li', {}, l.text)))
    ]));
  }
}

// ---- Benchmarks (v1.3) ----
function repRangeFor(exerciseId) {
  for (const sess of D.plan.sessions) for (const b of sess.blocks) for (const it of b.items || []) if (it.exercise === exerciseId && it.reps) return it.reps;
  return null;
}

function benchmarksCard(targets, settings) {
  const ids = Object.entries(D.plan.exercises).filter(([, ex]) => ex.benchmark).map(([id]) => id);
  const rows = ids.map(id => {
    const ex = D.plan.exercises[id];
    const t = targets[id] || {};
    const bench = t.benchmarkWeight != null ? `${fmtWeight(t.benchmarkWeight)}` : '–';
    const now = t.e1rm != null ? `${t.e1rm}` : (t.bestE1rm != null ? `${t.bestE1rm}` : '–');
    const next = t.weight != null ? `${fmtWeight(t.weight)} × ${t.reps != null ? t.reps : '-'}` : '–';
    return el('tr', { class: 'tappable', onclick: () => editBenchmark(id, ex, t, settings) }, [
      el('td', {}, [ex.name, ' ', t.source === 'benchmark' ? el('span', { class: 'badge you' }, 'bench') : null]),
      el('td', { class: 'num' }, bench),
      el('td', { class: 'num' }, now),
      el('td', { class: 'num' }, next)
    ]);
  });
  return el('div', { class: 'card' }, [
    el('h3', {}, 'Benchmarks'),
    el('table', {}, [el('tr', {}, [el('th', {}, 'Lift'), el('th', { class: 'num' }, '5 w/ 2 left'), el('th', { class: 'num' }, 'e1RM'), el('th', { class: 'num' }, 'Next')]), ...rows]),
    el('p', { class: 'muted', style: 'margin-top:8px' }, 'Tap a lift to enter a benchmark: the weight you can do for 5 with 2 reps left. Targets update from it right away (90% in weeks 1–2) and keep moving with your sessions. Pull-up: added weight.')
  ]);
}

function editBenchmark(id, ex, t, settings) {
  const w = el('input', { type: 'number', step: '2.5', value: t.benchmarkWeight != null ? t.benchmarkWeight : (t.weight != null ? t.weight : ''), inputmode: 'decimal', placeholder: 'lb' });
  const range = repRangeFor(id);
  const bwAdd = ex.equipment === 'weighted_bw' ? (settings.bodyweightLb || 0) : 0;
  const preview = el('p', { class: 'muted' });
  const upd = () => {
    const v = w.value === '' ? null : Number(w.value);
    if (v == null) { preview.textContent = ''; return; }
    const tgt = targetFromBenchmark({ rules: D.rules, exerciseId: id, ex, benchmark: v, repRange: range, bodyweightAdd: bwAdd, existing: t });
    preview.textContent = `Training target ${fmtWeight(tgt.weight)} lb × ${tgt.reps} · estimated 1RM ${epley(v + bwAdd, D.rules.baseline.topSetReps)} lb${bwAdd ? ' (incl. bodyweight)' : ''}`;
  };
  w.addEventListener('input', upd); upd();
  showModal(el('div', {}, [
    el('h2', {}, ex.name),
    el('p', { class: 'muted' }, ex.equipment === 'weighted_bw' ? 'Added weight for a set of 5 with 2 reps left.' : (id === 'power_clean' ? 'A crisp, fast double. The app trains at 90% of it.' : 'Weight for a set of 5 with 2 reps left (RPE 8).')),
    el('div', { class: 'field' }, [el('label', {}, 'Benchmark (lb)'), w]),
    preview,
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Cancel'),
      el('button', { class: 'btn primary', onclick: async () => {
        const v = w.value === '' ? null : Number(w.value);
        if (v == null) { toast('Enter a weight'); return; }
        const tgt = targetFromBenchmark({ rules: D.rules, exerciseId: id, ex, benchmark: v, repRange: range, bodyweightAdd: bwAdd, existing: t });
        await setTarget(id, tgt);
        closeModal(); toast(`${ex.name}: next ${fmtWeight(tgt.weight)} lb × ${tgt.reps}`); renderHome();
      } }, 'Save benchmark')
    ])
  ]));
}

function editTarget(id, ex, t) {
  const w = el('input', { type: 'number', step: '2.5', value: t.weight, inputmode: 'decimal' });
  const r = el('input', { type: 'number', step: '1', value: t.reps == null ? '' : t.reps, inputmode: 'numeric' });
  showModal(el('div', {}, [
    el('h2', {}, ex.name),
    el('div', { class: 'grid2' }, [el('div', { class: 'field' }, [el('label', {}, 'Target weight (lb)'), w]), el('div', { class: 'field' }, [el('label', {}, 'Target reps'), r])]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Cancel'),
      el('button', { class: 'btn primary', onclick: async () => {
        await setTarget(id, { weight: w.value === '' ? null : Number(w.value), reps: r.value === '' ? null : Number(r.value), source: 'you', updated: new Date().toISOString() });
        closeModal(); toast('Target updated'); renderHome();
      } }, 'Save')
    ])
  ]));
}

// ---- Session flow ----
async function startSession(sessionId, week) {
  const settings = await getSettings();
  const targets = await getTargets();
  const history = lastResults(await getSessions());
  const timeline = buildTimeline({ plan: D.plan, rules: D.rules, settings, sessionId, week, targets, history });
  await askNotificationPermission(settings);
  player = new Player({ timeline, plan: D.plan, rules: D.rules, settings, targets, container: view, onFinish: onSessionFinished });
  window.scrollTo(0, 0);
  player.start();
}

// Asked from the Start tap (a user gesture), only while the answer is still 'default'.
async function askNotificationPermission(settings) {
  if (!('Notification' in window) || !(settings.cues && settings.cues.notify !== false)) return;
  if (Notification.permission !== 'default') return;
  try { await Notification.requestPermission(); } catch (e) { /* ignore */ }
}

function offerResume(saved) {
  view.innerHTML = '';
  const tl = saved.timeline;
  view.appendChild(el('div', { class: 'card accent' }, [
    el('h1', {}, 'Resume session?'),
    el('p', { class: 'muted' }, `${tl.sessionName}, step ${saved.idx + 1} of ${tl.steps.length}, started ${fmtDate(saved.startedISO)}.`),
    el('div', { class: 'stack' }, [
      el('button', { class: 'btn primary', onclick: async () => {
        const settings = await getSettings();
        const targets = await getTargets();
        player = new Player({ timeline: tl, plan: D.plan, rules: D.rules, settings, targets, container: view, onFinish: onSessionFinished });
        player.resume(saved);
      } }, 'Resume'),
      el('button', { class: 'btn', onclick: async () => {
        const settings = await getSettings();
        player = new Player({ timeline: tl, plan: D.plan, rules: D.rules, settings, container: view, onFinish: onSessionFinished });
        player.s = saved; player.finish('ended_early');
      } }, 'Save what I did and stop'),
      el('button', { class: 'btn danger', onclick: async () => { await clearInProgress(); showTab('home'); } }, 'Discard it')
    ])
  ]));
}

async function onSessionFinished(draft) {
  player = null;
  try {
    window.scrollTo(0, 0);
    await renderReview(view, draft, { plan: D.plan, rules: D.rules }, {
      onSave: async overrides => {
        const record = await saveSession(draft, { plan: D.plan, rules: D.rules, overrides });
        await updateWeekChip();
        window.scrollTo(0, 0);
        const settings = await getSettings();
        renderSummary(view, record, {
          onDone: () => showTab('home'),
          onBackup: () => backupNow(settings, D.plan.planVersion)
        });
      }
    });
  } catch (e) {
    view.innerHTML = '';
    view.appendChild(el('div', { class: 'card' }, [el('h2', {}, 'Could not save the session'), el('p', {}, String(e.message || e)), el('button', { class: 'btn', onclick: () => showTab('home') }, 'Home')]));
  }
}

// ---- History ----
let historyMode = 'sessions';
async function renderHistory() {
  const sessions = await getSessions();
  view.innerHTML = '';
  view.appendChild(el('div', { class: 'row' }, [
    el('h1', {}, 'Log'),
    el('div', { class: 'segmented' }, [
      el('button', { class: historyMode === 'sessions' ? 'on' : '', onclick: () => { historyMode = 'sessions'; renderHistory(); } }, 'Sessions'),
      el('button', { class: historyMode === 'exercises' ? 'on' : '', onclick: () => { historyMode = 'exercises'; renderHistory(); } }, 'Exercises')
    ])
  ]));
  if (!sessions.length) { view.appendChild(el('p', { class: 'muted' }, 'No sessions yet.')); return; }
  if (historyMode === 'exercises') { renderExerciseLog(sessions); return; }
  const list = el('div', { class: 'card' });
  sessions.forEach(s => {
    const done = s.sets.filter(x => x.done && !x.ramp).length;
    const item = el('div', { class: 'list-item' }, [
      el('div', { class: 'row' }, [el('b', {}, `${s.sessionName}`), el('span', { class: 'muted' }, fmtDate(s.date))]),
      el('div', { class: 'muted' }, `Week ${s.week} · ${done} sets · ${fmtMinutes(s.actualSeconds)}${s.status !== 'complete' ? ' · ended early' : ''}${s.trims && s.trims.length ? ' · trimmed' : ''}`)
    ]);
    item.addEventListener('click', () => showSession(s));
    list.appendChild(item);
  });
  view.appendChild(list);
}

// ---- Exercise log (v1.3) ----
function exerciseRows(sessions, id) {
  const rows = [];
  for (const s of sessions) for (const st of s.sets) if (st.exerciseId === id && !st.ramp && st.done && !st.skipped) rows.push({ date: s.date, week: s.week, sessionId: s.id, ...st });
  return rows;
}
function renderExerciseLog(sessions) {
  const settings = D.settingsDefaults;
  const ids = [];
  for (const s of sessions) for (const st of s.sets) if (st.exerciseId && !st.ramp && st.done && !ids.includes(st.exerciseId)) ids.push(st.exerciseId);
  ids.sort((a, b) => (D.plan.exercises[a] ? D.plan.exercises[a].name : a).localeCompare(D.plan.exercises[b] ? D.plan.exercises[b].name : b));
  const card = el('div', { class: 'card' });
  ids.forEach(id => {
    const ex = D.plan.exercises[id];
    const rows = exerciseRows(sessions, id);
    const best = rows.reduce((m, r) => Math.max(m, r.weight != null && r.reps && !r.holdSeconds ? epley(r.weight + (ex && ex.equipment === 'weighted_bw' ? (settings.bodyweightLb || 0) : 0), r.reps) : 0), 0);
    const last = rows[0];
    card.appendChild(el('div', { class: 'list-item', onclick: () => showExercise(id, sessions) }, [
      el('div', { class: 'row' }, [el('b', {}, ex ? ex.name : id), el('span', { class: 'muted' }, best ? `best e1RM ${best}` : '')]),
      el('div', { class: 'muted' }, `${rows.length} ${rows.length === 1 ? 'set' : 'sets'} · last ${fmtDate(last.date)}: ${last.weight != null ? fmtWeight(last.weight) + ' lb' : 'bw'} × ${last.reps}`)
    ]));
  });
  view.appendChild(card);
}
function sparkline(points) {
  if (points.length < 2) return null;
  const W = 300, H = 60, pad = 4;
  const xs = points.map((_, i) => pad + i * (W - 2 * pad) / (points.length - 1));
  const min = Math.min(...points), max = Math.max(...points);
  const y = v => max === min ? H / 2 : H - pad - (v - min) * (H - 2 * pad) / (max - min);
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const wrap = el('div', { class: 'spark' });
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${points.map((v, i) => `<circle cx="${xs[i].toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="var(--accent)"/>`).join('')}</svg>`;
  return wrap;
}
function showExercise(id, sessions) {
  const ex = D.plan.exercises[id];
  const bw = ex && ex.equipment === 'weighted_bw' ? (D.settingsDefaults.bodyweightLb || 0) : 0;
  const rows = exerciseRows(sessions, id);
  // best e1RM per session, oldest first, for the trend
  const perSession = [];
  [...sessions].reverse().forEach(s => {
    const best = s.sets.filter(st => st.exerciseId === id && !st.ramp && st.done && !st.skipped && st.weight != null && st.reps && !st.holdSeconds).reduce((m, st) => Math.max(m, epley(st.weight + bw, st.reps)), 0);
    if (best) perSession.push({ date: s.date, best });
  });
  const table = el('table', {}, [
    el('tr', {}, [el('th', {}, 'Date'), el('th', { class: 'num' }, 'Set'), el('th', { class: 'num' }, 'Weight × reps'), el('th', { class: 'num' }, 'RPE'), el('th', { class: 'num' }, 'e1RM')]),
    ...rows.map(r => el('tr', {}, [
      el('td', {}, fmtDate(r.date)),
      el('td', { class: 'num' }, r.baseline ? 'Base' : (r.round ? `R${r.round}` : `${r.setIndex || ''}`)),
      el('td', { class: 'num' }, `${r.weight != null ? fmtWeight(r.weight) + ' lb' : 'bw'} × ${r.reps}${r.holdSeconds ? ' s' : ''}`),
      el('td', { class: 'num' }, r.rpe != null ? r.rpe : ''),
      el('td', { class: 'num' }, [r.weight != null && r.reps && !r.holdSeconds ? `${epley(r.weight + bw, r.reps)}` : '', r.pr && r.pr.length ? el('span', { class: 'pr-badge' }, 'PR') : null])
    ]))
  ]);
  showModal(el('div', {}, [
    el('h2', {}, ex ? ex.name : id),
    perSession.length >= 2 ? el('div', {}, [el('div', { class: 'label' }, `Estimated 1RM, ${perSession.length} sessions: ${perSession[0].best} → ${perSession[perSession.length - 1].best} lb`), sparkline(perSession.map(p => p.best))]) : (perSession.length === 1 ? el('p', { class: 'muted' }, `Estimated 1RM ${perSession[0].best} lb. The trend line appears after a second session.`) : null),
    table,
    el('button', { class: 'btn ghost', style: 'margin-top:12px', onclick: () => closeModal() }, 'Close')
  ]));
}

function showSession(s) {
  showModal(el('div', {}, [
    el('h2', {}, `${s.sessionName} · ${fmtDate(s.date)}`),
    el('p', { class: 'muted' }, `Week ${s.week} · ${fmtMinutes(s.actualSeconds)} (plan ${fmtMinutes(s.plannedSeconds)})${s.trims && s.trims.length ? ' · ' + s.trims.join('; ') : ''}`),
    s.whatChanged && s.whatChanged.length ? el('div', {}, [el('h3', {}, 'What changed'), el('ul', { class: 'lines' }, s.whatChanged.map(l => el('li', {}, l.text)))]) : null,
    el('h3', { style: 'margin-top:12px' }, 'Sets'),
    setsTable(s.sets),
    el('div', { class: 'btn-row', style: 'margin-top:12px' }, [
      el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Close'),
      el('button', { class: 'btn danger', onclick: async () => { if (await confirmDialog('Delete this session?', 'Targets already set from it are kept.', 'Delete', true)) { await deleteSession(s.id); toast('Deleted'); renderHistory(); } } }, 'Delete')
    ])
  ]));
}

// ---- Runs ----
async function renderRuns() {
  const settings = await getSettings();
  const runs = await getRuns();
  view.innerHTML = '';
  view.appendChild(el('div', { class: 'row' }, [el('h1', {}, 'Runs'), el('button', { class: 'btn small primary', onclick: () => runForm(D.plan, settings, null, () => renderRuns()) }, 'Log a run')]));
  view.appendChild(el('div', { class: 'card' }, D.plan.runs.map(r => el('p', { class: 'muted' }, [el('b', { style: 'color:var(--text)' }, r.name + ': '), r.note]))));
  if (!runs.length) { view.appendChild(el('p', { class: 'muted' }, 'No runs logged yet.')); return; }
  const table = el('table', {}, [
    el('tr', {}, [el('th', {}, 'Date'), el('th', {}, 'Type'), el('th', { class: 'num' }, 'Mi'), el('th', { class: 'num' }, 'Min'), el('th', { class: 'num' }, 'Pace'), el('th', { class: 'num' }, 'RPE')]),
    ...runs.map(r => el('tr', { class: 'tappable', onclick: () => editRun(r, settings) }, [
      el('td', {}, fmtDate(r.date)), el('td', {}, r.type), el('td', { class: 'num' }, r.distance == null ? '' : r.distance), el('td', { class: 'num' }, r.minutes == null ? '' : r.minutes), el('td', { class: 'num' }, fmtPace(r.pace)), el('td', { class: 'num' }, r.rpe == null ? '' : r.rpe)
    ]))
  ]);
  view.appendChild(el('div', { class: 'card' }, table));
}

function editRun(r, settings) {
  showModal(el('div', {}, [
    el('h2', {}, `${r.type}, ${fmtDate(r.date)}`),
    el('p', { class: 'muted' }, r.notes || ''),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Close'),
      el('button', { class: 'btn', onclick: () => runForm(D.plan, settings, r, () => renderRuns()) }, 'Edit'),
      el('button', { class: 'btn danger', onclick: async () => { closeModal(); if (await confirmDialog('Delete this run?', '', 'Delete', true)) { await deleteRun(r.id); renderRuns(); } } }, 'Delete')
    ])
  ]));
}

// ---- Settings ----
async function renderSettings() {
  const s = await getSettings();
  const toggle = (label, path, val) => el('div', { class: 'toggle' }, [el('span', {}, label), el('input', { type: 'checkbox', checked: val, onchange: async e => { const patch = {}; let o = patch; const keys = path.split('.'); keys.forEach((k, i) => { if (i === keys.length - 1) o[k] = e.target.checked; else { o[k] = {}; o = o[k]; } }); await saveSettings(patch); } })]);
  const numField = (label, key, step) => el('div', { class: 'field' }, [el('label', {}, label), el('input', { type: 'number', step: String(step), value: s[key], inputmode: 'decimal', onchange: async e => { await saveSettings({ [key]: Number(e.target.value) }); toast('Saved'); } })]);
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!(await confirmDialog('Restore from this file?', 'This replaces everything on the phone with the backup.', 'Restore', true))) return;
    try { const r = await restoreFromFile(f); toast(`Restored ${r.sessions} sessions, ${r.runs} runs`); closeModal(); await updateWeekChip(); showTab('home'); } catch (err) { toast('Restore failed: ' + err.message, 4000); }
  } });
  showModal(el('div', {}, [
    el('h2', {}, 'Settings'),
    toggle('Vibrate when a rest ends', 'cues.vibrate', s.cues.vibrate),
    toggle('Beep when a rest ends', 'cues.beep', s.cues.beep),
    toggle('3-second warning tick', 'cues.warningTick', s.cues.warningTick),
    toggle('Notify when a rest ends while in another app', 'cues.notify', s.cues.notify !== false),
    ('Notification' in window && Notification.permission === 'denied') ? el('p', { class: 'muted', style: 'margin:4px 0 0' }, 'Notifications are blocked for this site in Android settings; allow them there to get the rest-end alert.') : null,
    toggle('Keep the screen on during a session', 'keepScreenOn', s.keepScreenOn !== false),
    el('div', { style: 'height:10px' }),
    el('div', { class: 'grid2' }, [numField('Bodyweight (lb)', 'bodyweightLb', 0.5), numField('Transition (s)', 'transitionSeconds', 5)]),
    el('div', { class: 'field' }, [el('label', {}, 'Week 1 start date'), el('input', { type: 'date', value: s.startDate, onchange: async e => { await saveSettings({ startDate: e.target.value }); await updateWeekChip(); toast('Saved'); } })]),
    el('h3', { style: 'margin-top:14px' }, 'Data'),
    el('div', { class: 'stack' }, [
      el('button', { class: 'btn', onclick: () => backupNow(s, D.plan.planVersion) }, 'Back up (share to Drive)'),
      el('button', { class: 'btn', onclick: () => downloadBackup(s, D.plan.planVersion) }, 'Download backup file'),
      el('button', { class: 'btn', onclick: async () => { const r = await exportExcel(s, D.plan); if (r) toast(`Exported ${r.sets} sets, ${r.runs} runs`); } }, 'Export to Excel'),
      el('button', { class: 'btn', onclick: () => fileInput.click() }, 'Restore from backup file'),
      fileInput,
      el('button', { class: 'btn danger', onclick: async () => { if (await confirmDialog('Wipe all data on this phone?', 'Back up first. This cannot be undone.', 'Wipe', true)) { await wipeAll(); toast('Wiped'); closeModal(); showTab('home'); } } }, 'Wipe all data')
    ]),
    el('p', { class: 'muted', style: 'margin-top:14px' }, `Cam's Training Tracker v${APP_VERSION} · plan v${D.plan.planVersion} · rules v${D.rules.rulesVersion}`),
    el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Close')
  ]));
}

boot();
