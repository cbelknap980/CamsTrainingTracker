// app.js - app shell: boot, tabs, Home, Progress (with the log since v1.9), Plan, Runs, Settings, and the start/resume/summary flow.

import { loadData, APP_VERSION, weekNumber, phaseForWeek, todaysSessionId, sessionById, fmtWeight, fmtDate, fmtMinutes, fmtTime, toISODate, repsText, effortPlain, effortLabel, equipmentFor, isPair, pairText, weightWithPair } from './data.js';
import { buildTimeline, lastResults } from './builder.js';
import { icon } from './icons.js';
import { Player } from './player.js';
import { saveSession, renderSummary, renderReview, setsTable } from './logger.js';
import { epley, targetFromBenchmark, estimateStart, incrementFor } from './progression.js';
import { getTargets, setTarget, getSessions, getRuns, deleteSession, putSession, getInProgress, clearInProgress, getSettings, saveSettings, setSettingsDefaults, wipeAll, getPairTotals, setPairTotals, pairWeightsOnFile, doublePairWeights, kvGet, getCheckins, addCheckin, getCoachApplied, setCoachApplied, newId } from './store.js';
import { backupNow, downloadBackup, restoreFromFile, exportExcel } from './export.js';
import { renderArchitecture } from './architecture.js';
import { renderProgress } from './progress.js';
import { weekOwed, owedLines, buildCatchUpSession, slackDays } from './catchup.js';
import { renderRunsTab, runForm, openRunText } from './runs-view.js';
import { weekRuns, runLine, openRunDays } from './runs.js';
import { importFromGarmin } from './garmin.js';
import { getSync, saveSync, clearSync, parseRepo, checkAccess, pushNow, pullNow, pullCoach, startAutoSync, setupLink, readSetupLink, SYNC_FILE } from './sync.js';
import { renderPlan } from './plan-view.js';
import { changesFor, replyFor, pendingAdjustments, withRest } from './coach.js';
import { el, toast, showModal, closeModal, confirmDialog, installHaptics, setHaptics, haptic, onBack, dropBack, infoBtn, transition, swipeToDelete, syncStatusBar, countUp } from './ui.js';
import { weekRings, ringsCard } from './rings.js';

const view = document.getElementById('view');
let D = null; // { plan, rules, settingsDefaults, architecture }
let player = null;
let currentTab = 'home';
let installPrompt = null; // Chrome's deferred install prompt, when the app is not installed yet
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (currentTab === 'home' && !player && D) renderHome(); });
window.addEventListener('appinstalled', () => { installPrompt = null; if (currentTab === 'home' && !player && D) renderHome(); });
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
// a computer browser: not the installed app, and a wide window or a mouse
// (a phone in Chrome's Desktop site mode has a wide window but still a touch pointer, so width alone is not enough)
const onComputer = () => !isInstalled() && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

async function boot() {
  try {
    D = await loadData();
  } catch (e) {
    view.innerHTML = '';
    view.appendChild(el('div', { class: 'card' }, [el('h2', {}, 'Could not load the plan data'), el('p', { class: 'muted' }, String(e.message || e))]));
    return;
  }
  setSettingsDefaults(D.settingsDefaults);
  // v1.14: tap buzz (follows the vibrate setting) and the status bar color per workout phase
  installHaptics();
  getSettings().then(st => setHaptics(!st.cues || st.cues.vibrate !== false)).catch(() => {});
  syncStatusBar();
  // v1.9: a computer gets the sidebar layout and full-width pages
  document.body.classList.toggle('computer', onComputer());
  document.getElementById('sync-chip').addEventListener('click', onSyncChip);
  document.querySelectorAll('#tabs .tab').forEach(b => {
    b.prepend(icon(b.dataset.view));
    b.addEventListener('click', () => {
      // v1.14: tapping the tab you are on scrolls it to the top; another tab comes back where you left it
      if (b.dataset.view === currentTab && !player) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      if (b.dataset.view === 'progress' && currentTab !== 'progress') progressMode = 'overview';
      showTab(b.dataset.view, { restore: true });
    });
  });
  const sb = document.getElementById('settings-btn'); sb.innerHTML = ''; sb.appendChild(icon('settings'));
  sb.addEventListener('click', () => renderSettings());
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  await startSync();
  await updateWeekChip();
  updateSyncChip();
  syncCoach();
  if (await pairPrompt(() => openApp())) return;
  openApp();
}

/**
 * v1.7 sync. A set-up link (#sync=...) turns this device into one that only views. A viewing device downloads
 * the phone's copy before the first screen (8 s limit, so a bad connection never blocks the app). The phone
 * uploads on its own after each saved change.
 */
async function startSync() {
  try {
    const link = readSetupLink(location.hash);
    if (link) {
      history.replaceState(null, '', location.pathname + location.search);
      await saveSync({ repo: link.repo, token: link.token, role: 'viewer', lastPulledExport: null, lastError: null });
      toast('Sync set up on this device');
    }
    const cfg = await getSync();
    if (cfg && cfg.role === 'viewer') await Promise.race([pullNow(), new Promise(r => setTimeout(r, 8000))]);
  } catch (e) { /* sync never stops the app from opening */ }
  startAutoSync(() => ({ appVersion: APP_VERSION, planVersion: D.plan.planVersion }), r => { if (!r.ok) toast('Upload to the computer copy failed. It will retry.', 3500); updateSyncChip(); });
  // v1.10: the phone picks up new Garmin runs in the background when the app opens
  getSync().then(cfg => {
    if (!cfg || cfg.role !== 'phone') return;
    importFromGarmin({ plan: D.plan, rules: D.rules }).then(r => {
      if (!r || !r.ok || !r.added) return;
      toast(`${r.added} ${r.added === 1 ? 'run' : 'runs'} added from Garmin`, 3500);
      // redraw only a screen that shows runs: the Runs tab, or Home while it is asking for today's run
      if (document.getElementById('garmin-row') || (document.getElementById('run-ask') && !document.getElementById('run-done'))) showTab(currentTab);
    }).catch(() => { /* Garmin never stops the app */ });
  });
}

// ---- v1.9: sync status in the header ----
const clock = iso => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayClock = iso => (toISODate(new Date(iso)) === toISODate(new Date()) ? clock(iso) : `${fmtDate(iso)} ${clock(iso)}`);
async function updateSyncChip() {
  const chip = document.getElementById('sync-chip');
  const cfg = await getSync();
  if (!cfg || !cfg.repo) { chip.hidden = true; return; }
  chip.hidden = false;
  let text, bad = !!cfg.lastError;
  if (cfg.role === 'viewer') text = bad ? 'Could not reach the phone copy' : (cfg.lastPulledExport ? `From phone · ${dayClock(cfg.lastPulledExport)}` : 'Nothing from the phone yet');
  else text = bad || cfg.dirty ? 'Upload waiting' : (cfg.lastPushedAt ? `Synced · ${dayClock(cfg.lastPushedAt)}` : 'Sync on');
  chip.className = 'sync-chip' + (bad ? ' bad' : '');
  chip.title = (cfg.lastError || '') + (cfg.role === 'viewer' ? ' Click to load the newest copy from the phone.' : ' Tap to upload now.');
  chip.innerHTML = '';
  chip.append(el('span', { id: 'sync-chip-text' }, text), icon('refresh'));
}
async function onSyncChip() {
  const chip = document.getElementById('sync-chip');
  const cfg = await getSync();
  if (!cfg || !cfg.repo) return;
  chip.classList.add('busy');
  if (cfg.role === 'viewer') {
    const r = await pullNow();
    toast(r.ok ? (r.empty ? 'Nothing uploaded yet' : (r.changed ? `Loaded ${r.sessions} sessions, ${r.runs} runs` : 'Already up to date')) : r.error, 3500);
    await updateWeekChip();
    await syncCoach(true);
    if (r.ok && r.changed && !(await pairPrompt(() => showTab(currentTab)))) showTab(currentTab);
  } else {
    const r = await pushNow(APP_VERSION, D.plan.planVersion);
    toast(r.ok ? 'Uploaded' : r.error, 3500);
    await syncCoach(true);
  }
  updateSyncChip();
}

/**
 * v1.9: read the coach's file. On the phone, apply adjustments it has not applied yet (a target, or a rest offset
 * from the plan, kept inside the check-in limits). The computer only shows the replies.
 */
async function syncCoach(rerender) {
  try {
    const cfg = await getSync();
    const r = await pullCoach();
    let applied = 0;
    if (r.file && (!cfg || cfg.role !== 'viewer')) {
      const done = await getCoachApplied();
      const todo = pendingAdjustments(r.file, done, D.plan);
      for (const a of todo) {
        if (a.exerciseId && (a.weight != null || a.reps != null)) {
          const patch = { source: 'coach', updated: new Date().toISOString() };
          if (a.weight != null) patch.weight = Number(a.weight);
          if (a.reps != null) patch.reps = Number(a.reps);
          await setTarget(a.exerciseId, patch);
        }
        if (a.restDelta != null) {
          const key = a.exerciseId || `session:${a.sessionId}`;
          const cur = (await getSettings()).restAdjust || {};
          await saveSettings({ restAdjust: { [key]: withRest(cur, key, Number(a.restDelta))[key] || 0 } });
        }
        done.push(a.id); applied++;
      }
      if (applied) { await setCoachApplied(done); toast(`Coach updated ${applied} ${applied === 1 ? 'thing' : 'things'}. See Plan.`, 3500); }
    }
    if ((rerender || applied) && (currentTab === 'plan' || currentTab === 'home')) showTab(currentTab);
  } catch (e) { /* the coach file never stops the app */ }
}

async function openApp() {
  const inProgress = await getInProgress();
  if (inProgress && inProgress.status === 'running' && Date.now() - (inProgress.lastTick || 0) < D.rules.timing.resumeWindowHours * 3600000) {
    offerResume(inProgress);
  } else {
    if (inProgress) clearInProgress().catch(() => {});
    if (!(await openShortcut())) showTab('home');
  }
}

/**
 * v1.14: long-press the app icon on Android for shortcuts (manifest.webmanifest): ?go=today opens today's
 * session preview (Home on a day without a lift), ?go=runs and ?go=progress open those tabs.
 */
async function openShortcut() {
  const go = new URLSearchParams(location.search).get('go');
  if (!go) return false;
  try { history.replaceState(history.state, '', location.pathname + location.hash); } catch (e) { /* ignore */ }
  if (go === 'runs' || go === 'progress' || go === 'plan') { showTab(go); return true; }
  if (go === 'today') {
    const settings = await getSettings();
    const today = new Date();
    const id = todaysSessionId(D.plan, today);
    if (id && sessionById(D.plan, id)) { currentTab = 'home'; previewSession(id, weekNumber(today, settings.startDate)); return true; }
    if (id && D.plan.runs.some(r => r.id === id)) { showTab('runs'); return true; }
  }
  return false;
}

/**
 * v1.5: two-dumbbell lifts changed from per-dumbbell numbers to totals. If older numbers are on the phone,
 * ask once whether to double them. Returns true when the question is on screen (then() runs after the answer).
 */
async function pairPrompt(then) {
  if (await getPairTotals()) return false;
  const ids = Object.entries(D.plan.exercises).filter(([, ex]) => isPair(ex)).map(([id]) => id);
  const found = await pairWeightsOnFile(ids);
  if (!found.length) { await setPairTotals('none'); return false; }
  view.innerHTML = '';
  window.scrollTo(0, 0);
  // v1.7.1: one answer per lift, because the saved numbers can be a mix of one-dumbbell weights and totals
  const picks = {};
  const save = async () => {
    const toDouble = found.filter(f => picks[f.id] === 'one').map(f => f.id);
    if (toDouble.length) await doublePairWeights(toDouble);
    await setPairTotals(toDouble.length === found.length ? 'doubled' : (toDouble.length ? 'mixed' : 'kept'));
    toast(toDouble.length ? `Doubled ${toDouble.length} of ${found.length}. Dumbbell weights are totals now.` : 'Left as they were.');
    then();
  };
  const saveBtn = el('button', { class: 'btn primary', id: 'pair-save', disabled: true, onclick: save }, 'Save');
  const rows = found.map(f => {
    const w = f.weight;
    const result = el('div', { class: 'pair-result muted' }, 'Pick one');
    const seg = el('div', { class: 'segmented' });
    const draw = () => {
      seg.innerHTML = '';
      [['one', 'One dumbbell'], ['total', 'Both together']].forEach(([k, label]) => seg.appendChild(el('button', { type: 'button', class: picks[f.id] === k ? 'on' : '', 'data-pick': k, onclick: () => {
        picks[f.id] = k; draw();
        result.textContent = k === 'one' ? `Becomes ${fmtWeight(w * 2)} lb total (2 × ${fmtWeight(w)})` : `Stays ${fmtWeight(w)} lb total (2 × ${fmtWeight(w / 2)})`;
        result.classList.remove('muted');
        saveBtn.disabled = !found.every(x => picks[x.id]);
      } }, label)));
    };
    draw();
    return el('div', { class: 'pair-row', 'data-ex': f.id }, [
      el('div', { class: 'row' }, [el('b', {}, D.plan.exercises[f.id].name), el('span', { class: 'pair-saved' }, `${fmtWeight(w)} lb`)]),
      seg, result
    ]);
  });
  view.appendChild(el('div', { class: 'card accent', id: 'pair-prompt' }, [
    el('h1', {}, 'Dumbbell weights are now totals'),
    el('p', {}, 'Lifts that use two dumbbells now show the total of both, so two 40s read as 80 lb (2 × 40).'),
    el('p', { class: 'muted' }, 'For each saved number below, was it the weight of one dumbbell, or both together?'),
    ...rows,
    saveBtn
  ]));
  return true;
}

async function updateWeekChip() {
  const settings = await getSettings();
  const week = weekNumber(new Date(), settings.startDate);
  const phase = phaseForWeek(D.plan, week);
  document.getElementById('week-chip').textContent = week >= 1 && week <= 12 ? `Week ${week} · ${phase.name}` : phase.name;
}

const TAB_ORDER = ['home', 'progress', 'plan', 'runs', 'architecture'];
const scrollByTab = {};
function showTab(name, { restore = false } = {}) {
  if (name === 'history') { progressMode = 'sessions'; name = 'progress'; } // v1.9: the log lives in Progress
  const from = currentTab;
  if (from && from !== name) scrollByTab[from] = window.scrollY;
  currentTab = name;
  document.querySelectorAll('#tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  // v1.14: Back on any page but Home goes Home, instead of closing the app
  if (name === 'home') dropBack('page'); else onBack('page', () => showTab('home'));
  const render = () => {
    view.classList.toggle('wide', name === 'progress' || name === 'plan' || document.body.classList.contains('computer'));
    view.classList.toggle('home-cols', name === 'home' && document.body.classList.contains('computer'));
    if (name === 'home') return renderHome();
    if (name === 'progress') return renderProgressTab();
    if (name === 'plan') return renderPlanTab();
    if (name === 'runs') return renderRunsTab(view, { plan: D.plan, rules: D.rules, onOpenSync: () => renderSyncSheet() });
    if (name === 'architecture') return renderArchitecture(view, D.architecture, D.plan);
  };
  const y = restore ? (scrollByTab[name] || 0) : 0;
  // v1.14: the page slides toward the tab you picked (a view transition); where those are not supported the
  // v1.13 rise-in stays
  const dir = TAB_ORDER.indexOf(name) >= TAB_ORDER.indexOf(from) ? 'fwd' : 'back';
  const useVT = !!document.startViewTransition && from !== name;
  if (!useVT) {
    view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
    clearTimeout(showTab.t); showTab.t = setTimeout(() => view.classList.remove('enter'), 700);
  }
  const done = (useVT ? transition(async () => { await render(); window.scrollTo(0, y); }, dir) : Promise.resolve(render()));
  if (!useVT) { window.scrollTo(0, 0); Promise.resolve(done).then(() => { if (y) window.scrollTo(0, y); }).catch(() => {}); }
  return done;
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

  // v1.8 catch-up: sets skipped or not reached this week, and lifts whose day passed with nothing logged
  const allSessions = await getSessions();
  const allRuns = await getRuns();
  const owed = week >= 1 && week <= 12 ? weekOwed({ plan: D.plan, sessions: allSessions, week, today }) : { lifts: [], totalSets: 0, missed: [] };
  const catchUp = owed.totalSets ? buildCatchUpSession(D.plan, D.rules, owed) : null;
  const hasOwed = !!(catchUp || owed.missed.length);
  const catchUpBody = (card, primary) => {
    if (catchUp) {
      const tl = buildTimeline({ plan: D.plan, rules: D.rules, settings, session: catchUp, week, targets });
      card.appendChild(el('p', { class: primary ? '' : 'muted' }, `${owed.totalSets} ${owed.totalSets === 1 ? 'set' : 'sets'} left over from this week, about ${fmtMinutes(tl.plannedSeconds)} with warm-up and stretch.`));
      card.appendChild(el('ul', { class: 'lines owed-list' }, owedLines(owed).map(l => el('li', {}, [el('b', {}, `${l.short}: `), l.text]))));
      card.appendChild(el('button', { class: 'btn ' + (primary ? 'primary' : ''), id: 'catchup-start', onclick: () => previewSession(catchUp, week) }, primary ? 'Start catch-up' : 'Do the catch-up now'));
    }
    owed.lifts.filter(l => l.missed).forEach(l => {
      card.appendChild(el('p', { class: 'muted', style: 'margin:12px 0 8px' }, `${l.name} was planned for ${l.day} and is not logged.`));
      card.appendChild(el('button', { class: 'btn ' + (primary && !catchUp ? 'primary' : ''), 'data-missed': l.id, onclick: () => previewSession(l.id, week) }, `Start ${l.name}`));
    });
    const slack = slackDays(D.plan);
    // v1.14: the how-it-works note sits behind an (i) next to the card title
    // (the day to do it stays in view on other days)
    if (!primary) card.appendChild(el('p', { class: 'muted', style: 'margin:12px 0 0;font-size:var(--t-small)' }, `For your next Slack day, ${slack.join(' or ')}.`));
    const h = card.querySelector('h3');
    if (h) h.appendChild(infoBtn('Catch-up', ['Skipped sets and missed lifts land here, and a catch-up session runs just those sets.', 'Anything still owed on Sunday night is dropped, it does not roll into next week.']));
  };

  // v1.12: runs follow Cameron off schedule. A planned run whose day passed is offered on a free day that still
  // works (rules.runSchedule); on other days a card says what is still to run this week.
  const runRows = week >= 1 && week <= 12 ? weekRuns({ plan: D.plan, settings, runs: allRuns, week, today }) : [];
  const runCtx = { plan: D.plan, rules: D.rules, settings };
  const movedRun = !session && !run ? runRows.find(r => (r.status === 'open' || r.status === 'today') && openRunDays({ ...runCtx, runId: r.id, week, today }).some(d => d.today)) : null;
  const runBody = (card, row, primary) => {
    card.appendChild(el('p', { id: primary ? 'run-ask' : null, style: 'font-weight:600;margin:0 0 4px' }, row.plan.text));
    card.appendChild(el('p', { class: 'muted' }, row.plan.detail));
    if (row.run) {
      card.appendChild(el('p', { id: primary ? 'run-done' : null, style: 'color:var(--good);font-weight:700' }, `✓ Done${row.run.date !== toISODate(today) ? ' ' + fmtDate(row.run.date) : ''} · ${runLine(row.run, D.rules) || 'logged'}`));
      card.appendChild(el('button', { class: 'btn', onclick: () => showTab('runs') }, 'Open Runs'));
    } else {
      card.appendChild(el('button', { class: 'btn ' + (primary ? 'primary' : ''), onclick: () => runForm(D.plan, settings, null, () => renderHome(), { type: row.type }) }, 'Log this run'));
    }
  };
  const movedNote = row => (row.status === 'open' ? `Moved here from ${new Date(row.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' })}. If you run with your watch, it logs itself.` : 'If you run with your watch, it logs itself.');

  // v1.14: the week at a glance, above today's card. Each ring opens the page behind it.
  if (week >= 1 && week <= 12) {
    view.appendChild(ringsCard(weekRings({ plan: D.plan, rules: D.rules, settings, sessions: allSessions, runs: allRuns, week, today }), {
      week, onOpen: k => (k === 'runs' ? showTab('runs') : (k === 'hard' ? showTab('plan') : showTab('progress')))
    }));
  }
  const todayCard = el('div', { class: 'card accent', id: 'today-card' });
  todayCard.appendChild(el('h3', {}, `Today, ${fmtDate(toISODate(today))} · week ${week}${phase.note ? ' · ' + phase.name : ''}`));
  if (session) {
    const tl = buildTimeline({ plan: D.plan, rules: D.rules, settings, sessionId: session.id, week, targets });
    todayCard.appendChild(el('h1', {}, session.name));
    // polish: the facts as chips, a strip with one bar per block (sized by its minutes), the phase note small
    const blocks = session.blocks.filter(b => b.type !== 'iftime');
    todayCard.appendChild(el('ul', { class: 'hero-facts' }, [
      el('li', {}, [el('b', {}, fmtMinutes(tl.plannedSeconds))]),
      el('li', {}, ['done by', el('b', {}, fmtTime(Date.now() + tl.plannedSeconds * 1000))])
    ]));
    todayCard.appendChild(el('div', { class: 'hero-blocks', 'aria-hidden': 'true' }, blocks.map(b => el('span', { class: b.type === 'warmup' || b.type === 'stretch' ? 'soft' : '', style: `flex:${b.minutes || 1}` }))));
    if (phase.note) todayCard.appendChild(el('p', { class: 'hero-note' }, phase.note));
    todayCard.appendChild(el('button', { class: 'btn primary', onclick: () => previewSession(session.id, week) }, 'Start'));
  } else if (run) {
    // v1.10: what the run asks for this week, and its numbers once it is logged (by hand or from Garmin;
    // v1.12: also when it was done on another day)
    const row = runRows.find(r => r.id === run.id);
    todayCard.appendChild(el('h1', {}, run.name));
    if (row) runBody(todayCard, row, true);
    else {
      todayCard.appendChild(el('p', { class: 'muted' }, run.note));
      todayCard.appendChild(el('button', { class: 'btn primary', onclick: () => runForm(D.plan, settings, null, () => renderHome(), { type: run.type }) }, 'Log this run'));
    }
  } else if (movedRun && !hasOwed) {
    // v1.12: a free day that suits a run still open this week
    todayCard.id = 'moved-run-card';
    todayCard.appendChild(el('h1', {}, movedRun.name));
    todayCard.appendChild(el('p', { class: 'muted', style: 'font-size:var(--t-small);margin:0 0 8px' }, movedNote(movedRun)));
    runBody(todayCard, movedRun, true);
  } else if (hasOwed) {
    // v1.8: on a Slack day the catch-up takes the today card
    todayCard.id = 'catchup-card';
    todayCard.appendChild(el('h1', {}, 'Catch-up day'));
    catchUpBody(todayCard, true);
  } else {
    todayCard.appendChild(el('h1', {}, 'Slack day'));
    todayCard.appendChild(el('p', { class: 'muted' }, 'Nothing owed this week. Rest, or pick a session below.'));
  }
  view.appendChild(todayCard);
  if (hasOwed && (session || run)) {
    const c = el('div', { class: 'card', id: 'catchup-card' }, [el('h3', {}, 'Owed this week')]);
    catchUpBody(c, false);
    view.appendChild(c);
  }
  if (movedRun && hasOwed) {
    // the catch-up kept the today card; the run that also fits today goes right under it
    const c = el('div', { class: 'card', id: 'moved-run-card' }, [el('h3', {}, 'Also today'), el('h2', {}, movedRun.name), el('p', { class: 'muted', style: 'font-size:var(--t-small)' }, movedNote(movedRun))]);
    runBody(c, movedRun, false);
    view.appendChild(c);
  }
  const stillOpen = runRows.filter(r => r.status === 'open' && r !== movedRun);
  if (stillOpen.length) {
    view.appendChild(el('div', { class: 'card', id: 'runs-open-card' }, [
      el('h3', {}, ['Still to run this week', infoBtn('Runs off schedule', 'Run whenever it suits you. A run from Garmin counts for whichever planned run it most likely is.')]),
      ...stillOpen.map(r => el('p', { style: 'margin:0 0 6px' }, [el('b', {}, `${r.name}. `), el('span', { class: 'muted' }, `${r.plan.text}. ${openRunText(runCtx, r.id, week, today)}`)]))
    ]));
  }
  // v1.4: install card, only while the app is running in a browser tab. v1.6: on a phone it sits right under
  // the today card so it is not missed; on a computer it stays at the bottom.
  const installCard = isInstalled() ? null : el('div', { class: 'card', id: 'install-card' }, [
    el('h3', {}, 'Install the app'),
    el('p', { class: 'muted' }, 'Installed, it opens full screen from its own icon, with no address bar, and works without signal.'),
    installPrompt
      ? el('button', { class: 'btn', onclick: async () => { const p = installPrompt; installPrompt = null; try { p.prompt(); await p.userChoice; } catch (e) { /* ignore */ } renderHome(); } }, 'Install')
      : el('p', { class: 'muted', style: 'margin:0' }, 'In Chrome, open the three-dot menu and tap "Add to Home screen", then "Install".')
  ]);
  if (installCard && !onComputer()) view.appendChild(installCard);


  const other = el('div', { class: 'card' }, [
    el('h3', {}, 'Start a different session'),
    el('div', { class: 'grid3' }, D.plan.sessions.map(s => { const [k, n] = s.name.includes(': ') ? s.name.split(': ') : ['', s.name]; return el('button', { class: 'btn small sess-btn', style: 'width:100%', onclick: () => previewSession(s.id, week) }, [k ? el('small', {}, k) : null, el('b', {}, n)]); }))
  ]);
  view.appendChild(other);

  // next targets
  const rows = Object.entries(D.plan.exercises).filter(([id]) => targets[id] && targets[id].weight != null).map(([id, ex]) => {
    const t = targets[id];
    // polish: two columns; the badge and e1RM sit under the name so long names do not wrap into a column
    return el('tr', { class: 'tappable', onclick: () => editTarget(id, ex, t) }, [
      el('td', {}, [el('div', { class: 'tgt-name' }, ex.name), (t.e1rm || t.source === 'you' || t.source === 'coach') ? el('div', { class: 'tgt-sub' }, [
        t.e1rm ? `e1RM ${t.e1rm}` : null,
        t.source === 'you' ? el('span', { class: 'badge you' }, 'set by you') : (t.source === 'coach' ? el('span', { class: 'badge coach' }, 'coach') : null)
      ]) : null]),
      el('td', { class: 'num tgt-val' }, `${weightWithPair(ex, t.weight)} × ${t.reps != null ? t.reps : '-'}`)
    ]);
  });
  view.appendChild(el('div', { class: 'card', id: 'next-targets' }, [
    el('h3', {}, 'Next targets'),
    rows.length ? el('table', { class: 'tgt-table' }, [el('tr', {}, [el('th', {}, 'Exercise'), el('th', { class: 'num' }, 'Weight × reps')]), ...rows]) : el('p', { class: 'muted' }, 'No targets yet. Week 1 sessions work up to a baseline set on each main lift; accessories take the weight you log the first time.'),
    el('p', { class: 'muted', style: 'margin-top:8px' }, 'Tap a row to change a target by hand.')
  ]));

  view.appendChild(benchmarksCard(targets, settings));

  const last = allSessions[0];
  if (last && last.whatChanged && last.whatChanged.length) {
    view.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, `What changed after ${last.sessionName}, ${fmtDate(last.date)}`),
      el('ul', { class: 'lines' }, last.whatChanged.map(l => el('li', {}, l.text)))
    ]));
  }

  if (installCard && onComputer()) view.appendChild(installCard);
  // v1.9: on a computer, the today card across the top, then two columns: next targets on the right
  if (document.body.classList.contains('computer')) {
    const kids = [...view.children];
    const ti = kids.findIndex(c => c.classList.contains('accent'));
    const top = kids.slice(0, ti + 1), rest = kids.slice(ti + 1);
    const right = rest.filter(c => c.id === 'next-targets');
    const left = rest.filter(c => c.id !== 'next-targets');
    view.innerHTML = '';
    view.append(...top, el('div', { class: 'home-col' }, left), el('div', { class: 'home-col' }, right));
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
    el('p', { class: 'muted' }, ex.equipment === 'weighted_bw' ? 'Added weight for a set of 5 with 2 reps left.' : (id === 'power_clean' ? 'A crisp, fast double. The app trains at 90% of it.' : 'Weight for a set of 5 with 2 reps left.')),
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

// ---- Pre-session overview (v1.4) ----
// What the session is for, every exercise with sets x reps and a weight you can change, and the time it should take.
async function previewSession(sessionRef, week) {
  const settings = await getSettings();
  const targets = await getTargets();
  // v1.8: a session id from the plan, or a session object (the catch-up session is built on the fly)
  const session = typeof sessionRef === 'string' ? sessionById(D.plan, sessionRef) : sessionRef;
  const phase = phaseForWeek(D.plan, week);
  const weights = {};   // exerciseId -> weight for today (typed, saved target, or estimate)
  const estimated = {}; // exerciseId -> true while the number is still the app's estimate
  const withWeights = () => {
    const t = { ...targets };
    for (const [id, w] of Object.entries(weights)) if (w != null) t[id] = { ...(t[id] || {}), weight: w };
    return t;
  };
  let tl = buildTimeline({ plan: D.plan, rules: D.rules, settings, session, week, targets });
  for (const st of tl.steps) {
    if (st.kind !== 'set' || st.ramp || !st.exerciseId || st.exerciseId in weights) continue;
    const ex = D.plan.exercises[st.exerciseId];
    if (!ex || ex.equipment === 'bodyweight' || st.holdSeconds) continue;
    if (st.target && st.target.weight != null) weights[st.exerciseId] = st.target.weight;
    else if (st.baseline || st.fillFromBaseline) weights[st.exerciseId] = null;
    else { const est = estimateStart(D.rules, st.exerciseId, targets, settings, ex); weights[st.exerciseId] = est; if (est != null) estimated[st.exerciseId] = true; }
  }

  const paint = () => {
    tl = buildTimeline({ plan: D.plan, rules: D.rules, settings, session, week, targets: withWeights() });
    const y = window.scrollY;
    view.innerHTML = '';
    const finish = Date.now() + tl.plannedSeconds * 1000;
    view.appendChild(el('div', { class: 'card accent', id: 'preview-hero' }, [
      el('h3', {}, `Week ${week}${phase.name ? ' · ' + phase.name : ''}`),
      el('h1', {}, session.name),
      // polish: same chips as the Home card; the session goal reads as the lead, the phase note small
      el('ul', { class: 'hero-facts' }, [
        el('li', {}, [el('b', {}, fmtMinutes(tl.plannedSeconds))]),
        el('li', {}, ['done by', el('b', {}, fmtTime(finish))])
      ]),
      session.goal ? el('p', { class: 'hero-lead' }, session.goal) : null,
      phase.note ? el('p', { class: 'hero-note', style: 'margin:0' }, phase.note) : null
    ]));

    const blocks = [];
    for (const st of tl.steps) {
      let b = blocks[blocks.length - 1];
      if (!b || b.id !== st.blockId) { b = { id: st.blockId, name: st.blockName, type: st.blockType, seconds: 0, ex: [] }; blocks.push(b); }
      b.seconds += st.seconds || 0;
      if (st.kind === 'set' && !st.ramp && st.exerciseId) {
        // a baseline work-up comes before the block's sets; list exercises in the order their work sets run
        if (st.baseline) { (b.base = b.base || {})[st.exerciseId] = true; continue; }
        let e = b.ex.find(x => x.id === st.exerciseId);
        if (!e) { e = { id: st.exerciseId, name: st.name, sets: 0, step: st, baseline: !!(b.base && b.base[st.exerciseId]) }; b.ex.push(e); }
        e.sets += 1;
      }
    }
    const card = el('div', { class: 'card' }, [el('h3', {}, ['Today', infoBtn('Weights on this page', 'Weights are in lb. Lifts with two dumbbells show the total of both. Change any of them here. A number marked Estimate is a rough guess from your main lifts and bodyweight, so set it to what you know. Blank ones get filled in after the first set.')])]);
    for (const b of blocks) {
      const title = b.type === 'warmup' ? 'Warm-up' : (b.type === 'stretch' ? 'Stretch' : (b.type === 'iftime' ? 'If time' : (/^[A-Z]$/.test(b.name) ? `Block ${b.name}` : b.name)));
      const rows = b.ex.map(e => {
        const ex = D.plan.exercises[e.id] || {};
        const st = e.step;
        const reps = st.holdSeconds ? `${st.holdSeconds} s${st.perSide ? '/side' : ''}` : `${st.repRange ? repsText(st.repRange) : (st.target && st.target.reps) || ''}${st.perSide ? '/side' : ''}`;
        const unit = b.type === 'finisher' ? (e.sets === 1 ? 'round' : 'rounds') : (e.sets === 1 ? 'set' : 'sets');
        const sub = [equipmentFor(ex), `${e.sets} ${unit} × ${reps}`, st.effort ? effortPlain(st.effort) : ''].filter(Boolean).join(' · ');
        let right;
        if (ex.equipment === 'bodyweight' || st.holdSeconds) right = el('div', { class: 'pre-fixed' }, st.holdSeconds ? 'Timed' : 'Bodyweight');
        else if (e.baseline && weights[e.id] == null) right = el('div', { class: 'pre-fixed' }, 'Work up today');
        else {
          const input = el('input', { type: 'number', step: String(incrementFor(D.rules, e.id, ex) || 2.5), inputmode: 'decimal', placeholder: 'lb', 'data-ex': e.id, 'aria-label': `${e.name} weight`, value: weights[e.id] == null ? '' : weights[e.id],
            onchange: ev => { weights[e.id] = ev.target.value === '' ? null : Number(ev.target.value); delete estimated[e.id]; paint(); } });
          right = el('div', {}, [input, isPair(ex) && weights[e.id] != null ? el('div', { class: 'pair-sub' }, `total · ${pairText(ex, weights[e.id])} lb`) : null, estimated[e.id] ? el('div', { class: 'est' }, 'Estimate') : null]);
        }
        return el('div', { class: 'pre-ex' }, [el('div', {}, [el('div', { class: 'pre-name' }, e.name), el('div', { class: 'pre-sub' }, sub)]), right]);
      });
      const mark = /^[A-Z]$/.test(b.name) ? b.name : (b.type === 'warmup' ? 'W' : (b.type === 'stretch' ? 'S' : (b.type === 'finisher' || b.type === 'emom' ? 'F' : '+')));
      card.appendChild(el('div', { class: 'pre-block' }, [
        el('div', { class: 'row pre-head' }, [el('span', { class: 'pre-mark' + (b.type === 'warmup' || b.type === 'stretch' ? ' soft' : '') }, mark), el('b', {}, title), el('span', { class: 'muted' }, fmtMinutes(b.seconds))]),
        ...rows
      ]));
    }
    view.appendChild(card);
    view.appendChild(el('div', { class: 'stack' }, [
      el('button', { class: 'btn primary', id: 'start-workout', onclick: async () => {
        // a weight typed here becomes the saved target, tagged 'set by you'
        for (const [id, w] of Object.entries(weights)) {
          if (w == null || estimated[id]) continue;
          const t = targets[id];
          if (t && t.weight != null && t.weight !== w) await setTarget(id, { weight: w, source: 'you', updated: new Date().toISOString() });
        }
        startSession(session, week, withWeights());
      } }, 'Start workout'),
      el('button', { class: 'btn ghost', onclick: () => transition(() => showTab('home'), 'back') }, 'Back')
    ]));
    // a typed weight repaints in place, so the page stays where it was
    window.scrollTo(0, y);
  };
  // v1.14: the Start card grows into this page (a view transition); Back on the phone returns Home
  onBack('page', () => transition(() => showTab('home'), 'back'));
  await transition(() => { window.scrollTo(0, 0); paint(); }, 'fwd');
}

// ---- Session flow ----
async function startSession(session, week, targetsForToday) {
  const settings = await getSettings();
  const targets = targetsForToday || await getTargets();
  const history = lastResults(await getSessions());
  const timeline = buildTimeline({ plan: D.plan, rules: D.rules, settings, session, week, targets, history });
  await askNotificationPermission(settings);
  player = new Player({ timeline, plan: D.plan, rules: D.rules, settings, targets, container: view, onFinish: onSessionFinished });
  transition(() => { window.scrollTo(0, 0); player.start(); }, 'fwd');
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
      el('button', { class: 'btn', id: 'arch-open', onclick: () => { closeModal(); showTab('architecture'); } }, 'How the app works'),
      el('button', { class: 'btn danger', onclick: async () => { await clearInProgress(); showTab('home'); } }, 'Discard it')
    ])
  ]));
}

async function onSessionFinished(draft) {
  player = null;
  // v1.14: the review is not saved yet, so Back must not leave it
  const guard = () => { onBack('page', guard); toast('Tap Save at the bottom to keep this session'); };
  onBack('page', guard);
  try {
    window.scrollTo(0, 0);
    await renderReview(view, draft, { plan: D.plan, rules: D.rules }, {
      onSave: async overrides => {
        const record = await saveSession(draft, { plan: D.plan, rules: D.rules, overrides });
        await updateWeekChip();
        window.scrollTo(0, 0);
        const [settings, sessions, runs, cfg] = await Promise.all([getSettings(), getSessions(), getRuns(), getSync()]);
        // v1.14: the same session last time (for volume) and the week's rings for the done card
        const prev = sessions.find(x => x.id !== record.id && x.sessionId === record.sessionId && !x.catchUp && (x.startedAt || x.date) < (record.startedAt || record.date)) || null;
        const rings = record.week >= 1 && record.week <= 12 ? weekRings({ plan: D.plan, rules: D.rules, settings, sessions, runs, week: record.week, today: new Date() }) : null;
        onBack('page', () => showTab('home'));
        transition(() => renderSummary(view, record, {
          prev, rings, syncOn: !!(cfg && cfg.repo && cfg.role !== 'viewer'),
          onDone: () => showTab('home'),
          onBackup: () => backupNow(settings, D.plan.planVersion)
        }), 'fade');
      }
    });
  } catch (e) {
    view.innerHTML = '';
    view.appendChild(el('div', { class: 'card' }, [el('h2', {}, 'Could not save the session'), el('p', {}, String(e.message || e)), el('button', { class: 'btn', onclick: () => showTab('home') }, 'Home')]));
  }
}

// ---- Progress: overview, sessions and exercises (v1.9: the Log tab merged in) ----
let progressMode = 'overview';
function progressHeader() {
  const b = (k, label) => el('button', { class: progressMode === k ? 'on' : '', 'data-mode': k, onclick: () => { progressMode = k; window.scrollTo(0, 0); renderProgressTab(); } }, label);
  return el('div', { class: 'row page-head' }, [el('h1', {}, 'Progress'), el('div', { class: 'segmented', id: 'progress-mode' }, [b('overview', 'Overview'), b('sessions', 'Sessions'), b('exercises', 'Exercises')])]);
}
async function renderHistory() {
  const sessions = await getSessions();
  if (currentTab !== 'progress') return;
  view.innerHTML = '';
  view.appendChild(progressHeader());
  if (!sessions.length) { view.appendChild(el('p', { class: 'muted' }, 'No sessions yet.')); return; }
  if (progressMode === 'exercises') { renderExerciseLog(sessions); return; }
  const list = el('div', { class: 'card' });
  sessions.forEach(s => {
    const done = s.sets.filter(x => x.done && !x.ramp).length;
    const item = el('div', { class: 'list-item' }, [
      el('div', { class: 'row' }, [el('b', {}, `${s.sessionName}`), el('span', { class: 'muted' }, fmtDate(s.date))]),
      el('div', { class: 'muted' }, `Week ${s.week} · ${done} sets · ${fmtMinutes(s.actualSeconds)}${s.status !== 'complete' ? ' · ended early' : ''}${s.trims && s.trims.length ? ' · trimmed' : ''}`)
    ]);
    item.addEventListener('click', () => showSession(s));
    // v1.14: swipe a session left to delete it, with Undo
    list.appendChild(swipeToDelete(item, () => removeSession(s)));
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
    el('tr', {}, [el('th', {}, 'Date'), el('th', { class: 'num' }, 'Set'), el('th', { class: 'num' }, 'Weight × reps'), el('th', { class: 'num' }, 'Effort'), el('th', { class: 'num' }, 'e1RM')]),
    ...rows.map(r => el('tr', {}, [
      el('td', {}, fmtDate(r.date)),
      el('td', { class: 'num' }, r.baseline ? 'Base' : (r.round ? `R${r.round}` : `${r.setIndex || ''}`)),
      el('td', { class: 'num' }, `${r.weight != null ? fmtWeight(r.weight) + ' lb' : 'bw'} × ${r.reps}${r.holdSeconds ? ' s' : ''}`),
      el('td', { class: 'num' }, r.rpe != null ? effortLabel(D.rules, r.rpe) : ''),
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
      el('button', { class: 'btn', id: 'arch-open', onclick: () => { closeModal(); showTab('architecture'); } }, 'How the app works'),
      el('button', { class: 'btn danger', id: 'session-delete', onclick: () => { closeModal(); removeSession(s); } }, 'Delete')
    ])
  ]));
}

/** v1.14: delete a session at once and offer Undo, instead of asking first. Targets already set from it are kept. */
async function removeSession(s) {
  await deleteSession(s.id);
  if (currentTab === 'progress') renderProgressTab();
  toast(`Deleted ${s.sessionName}, ${fmtDate(s.date)}`, 6000, { action: 'Undo', onAction: async () => {
    await putSession(s);
    if (currentTab === 'progress') renderProgressTab();
    toast('Session restored');
  } });
}

// ---- Progress (v1.6) ----
async function renderProgressTab() {
  if (progressMode !== 'overview') return renderHistory();
  const [settings, sessions, runs, targets] = await Promise.all([getSettings(), getSessions(), getRuns(), getTargets()]);
  if (currentTab !== 'progress' || progressMode !== 'overview') return;
  const onLoadBackup = async file => {
    if (sessions.length && !(await confirmDialog('Load this backup?', 'It replaces the workouts stored in this browser with the ones in the file.', 'Load'))) return;
    try {
      const r = await restoreFromFile(file);
      toast(`Loaded ${r.sessions} sessions, ${r.runs} runs`);
      await updateWeekChip();
      if (!(await pairPrompt(() => showTab('progress')))) showTab('progress');
    } catch (err) { toast('Could not load that file: ' + err.message, 4000); }
  };
  const cfg = await getSync();
  renderProgress(view, { plan: D.plan, rules: D.rules, settings, sessions, runs, targets, muscles: D.muscles, today: new Date() }, {
    header: progressHeader(), syncOn: !!(cfg && cfg.repo), onExercise: id => showExercise(id, sessions), ...(onComputer() ? { onLoadBackup } : {})
  });
}

// ---- Plan and coach check-ins (v1.9) ----
async function renderPlanTab() {
  const [settings, targets, sessions, runs, checkins, coachFile, cfg] = await Promise.all([getSettings(), getTargets(), getSessions(), getRuns(), getCheckins(), kvGet('coach'), getSync()]);
  if (currentTab !== 'plan') return;
  const canWrite = !(cfg && cfg.role === 'viewer');
  renderPlan(view, { plan: D.plan, goals: D.goals, settings, targets, sessions, runs, checkins, coachFile, today: new Date() }, { canWrite, onSend: sendCheckin });
}
async function sendCheckin(input) {
  const settings = await getSettings();
  const targets = await getTargets();
  const c = { id: newId('chk'), at: new Date().toISOString(), ...input };
  const changes = changesFor(c, { plan: D.plan, rules: D.rules, targets, restAdjust: settings.restAdjust });
  for (const ch of changes) {
    if (ch.kind === 'weight') await setTarget(ch.exerciseId, { weight: ch.to, source: 'coach', updated: c.at });
    else await saveSettings({ restAdjust: { [ch.key]: ch.to } });
  }
  c.changes = changes;
  c.reply = replyFor(c, changes, D.plan);
  await addCheckin(c);
  toast(changes.length ? 'Sent. Plan nudged.' : 'Sent');
  renderPlanTab();
}

// ---- Sync sheet (v1.7) ----
async function renderSyncSheet(note) {
  const cfg = (await getSync()) || {};
  let role = cfg.role || (onComputer() ? 'viewer' : 'phone');
  const when = iso => `${fmtDate(iso)} at ${new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  const statusText = () => {
    if (!cfg.repo) return 'Off. Nothing leaves this device.';
    if (cfg.lastError) return cfg.lastError;
    if (cfg.role === 'viewer') return cfg.lastPulledExport ? `Showing the phone's upload from ${when(cfg.lastPulledExport)}.` : 'On. Nothing downloaded yet.';
    return cfg.lastPushedAt ? `On. Last upload ${when(cfg.lastPushedAt)}.` : 'On. Nothing uploaded yet.';
  };
  const repoIn = el('input', { type: 'text', id: 'sync-repo', value: cfg.repo || '', placeholder: 'yourname/training-data', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' });
  const tokenIn = el('input', { type: 'password', id: 'sync-token', value: cfg.token || '', placeholder: 'github_pat_...', autocomplete: 'off' });
  const status = el('p', { class: cfg.lastError && !note ? 'sync-status bad' : 'sync-status muted', id: 'sync-state' }, note || statusText());
  const say = (text, bad) => { status.textContent = text; status.className = 'sync-status ' + (bad ? 'bad' : 'muted'); };
  const roleBtns = el('div', { class: 'segmented', id: 'sync-role' });
  const drawRole = () => { roleBtns.innerHTML = ''; [['phone', 'Logs workouts'], ['viewer', 'Only views']].forEach(([k, label]) => roleBtns.appendChild(el('button', { type: 'button', class: role === k ? 'on' : '', 'data-role': k, onclick: () => { role = k; drawRole(); } }, label))); };
  drawRole();
  const run = async () => {
    const r = role === 'phone' ? await pushNow(APP_VERSION, D.plan.planVersion) : await pullNow();
    Object.assign(cfg, await getSync());
    if (!r.ok) { say(r.error, true); return false; }
    say(statusText());
    if (role === 'viewer') { await updateWeekChip(); if (r.changed && !(await pairPrompt(() => showTab(currentTab)))) showTab(currentTab); }
    return true;
  };
  const save = async () => {
    const repo = parseRepo(repoIn.value);
    const token = tokenIn.value.trim();
    if (!repo) { say('Type the repo as owner/name, for example yourname/training-data.', true); return; }
    if (!token) { say('Paste the token from GitHub.', true); return; }
    say('Checking with GitHub...');
    try { await checkAccess({ repo, token }, role === 'phone'); } catch (e) { say(String(e.message || e), true); return; }
    Object.assign(cfg, await saveSync({ repo, token, role, lastError: null, ...(repo !== cfg.repo ? { lastPulledExport: null, lastPushedAt: null } : {}) }));
    // an empty phone must not wipe the copy on GitHub: if there is one, load it here instead of uploading nothing
    if (role === 'phone' && !(await getSessions()).length && !(await getRuns()).length) {
      const got = await pullNow();
      Object.assign(cfg, await getSync());
      if (got.ok && !got.empty && (got.sessions || got.runs)) {
        toast('Sync is on. Loaded your log.'); await updateWeekChip();
        renderSyncSheet(`This device had no workouts, so it loaded ${got.sessions} sessions and ${got.runs} runs from GitHub.`);
        return;
      }
    }
    if (await run()) { toast(role === 'phone' ? 'Sync is on. Uploaded.' : 'Sync is on.'); renderSyncSheet(); }
  };
  const copyLink = async () => {
    if (!cfg.repo || !cfg.token) { say('Save and test first.', true); return; }
    const link = setupLink(location.href, cfg);
    try { await navigator.clipboard.writeText(link); toast('Link copied. Open it once on the computer.', 3500); }
    catch (e) { showModal(el('div', {}, [el('h2', {}, 'Link for the computer'), el('p', { class: 'muted' }, 'Copy this and open it once on the computer.'), el('textarea', { readonly: 'readonly', rows: '5', style: 'width:100%' }, link), el('button', { class: 'btn', onclick: () => renderSyncSheet() }, 'Back')])); }
  };
  showModal(el('div', {}, [
    el('h2', {}, 'Sync with the computer'),
    el('p', { class: 'muted' }, `Keeps a copy of your log (${SYNC_FILE}) in a private GitHub repo of yours. The phone uploads after every saved workout or run. A computer set to "Only views" loads it when the app opens. The token is stored on this device only.`),
    el('div', { class: 'field' }, [el('label', {}, 'Private repo'), repoIn]),
    el('div', { class: 'field' }, [el('label', {}, 'Token'), tokenIn]),
    el('div', { class: 'field' }, [el('label', {}, 'This device'), roleBtns]),
    status,
    el('div', { class: 'stack' }, [
      el('button', { class: 'btn primary', id: 'sync-save', onclick: save }, 'Save and test'),
      cfg.repo ? el('button', { class: 'btn', id: 'sync-now', onclick: async () => { say('Working...'); if (await run()) toast(role === 'phone' ? 'Uploaded' : 'Up to date'); } }, 'Sync now') : null,
      cfg.repo ? el('button', { class: 'btn', id: 'sync-link', onclick: copyLink }, 'Copy set-up link for the computer') : null,
      cfg.repo ? el('button', { class: 'btn danger', id: 'sync-off', onclick: async () => { if (await confirmDialog('Turn sync off on this device?', 'The repo name and token are removed from this device. The copy on GitHub stays.', 'Turn off', true)) { await clearSync(); toast('Sync is off'); renderSyncSheet(); } else renderSyncSheet(); } }, 'Turn off') : null,
      el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Close')
    ])
  ]));
}

// ---- Settings ----
async function renderSettings() {
  const s = await getSettings();
  const toggle = (label, path, val) => el('div', { class: 'toggle' }, [el('span', {}, label), el('input', { type: 'checkbox', checked: val, onchange: async e => { const patch = {}; let o = patch; const keys = path.split('.'); keys.forEach((k, i) => { if (i === keys.length - 1) o[k] = e.target.checked; else { o[k] = {}; o = o[k]; } }); await saveSettings(patch); if (path === 'cues.vibrate') setHaptics(e.target.checked); } })]);
  const numField = (label, key, step) => el('div', { class: 'field' }, [el('label', {}, label), el('input', { type: 'number', step: String(step), value: s[key], inputmode: 'decimal', onchange: async e => { await saveSettings({ [key]: Number(e.target.value) }); toast('Saved'); } })]);
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!(await confirmDialog('Restore from this file?', 'This replaces everything on the phone with the backup.', 'Restore', true))) return;
    try { const r = await restoreFromFile(f); toast(`Restored ${r.sessions} sessions, ${r.runs} runs`); closeModal(); await updateWeekChip(); if (!(await pairPrompt(() => showTab('home')))) showTab('home'); } catch (err) { toast('Restore failed: ' + err.message, 4000); }
  } });
  showModal(el('div', {}, [
    el('h2', {}, 'Settings'),
    toggle('Vibrate when a set or rest ends', 'cues.vibrate', s.cues.vibrate),
    toggle('Beep when a set or rest ends', 'cues.beep', s.cues.beep),
    toggle('Countdown ticks before a set starts', 'cues.warningTick', s.cues.warningTick),
    toggle('Say each exercise and rest out loud', 'cues.voice', s.cues.voice !== false),
    toggle('End each set on its own timer', 'autoAdvance', s.autoAdvance !== false),
    toggle('Wait for a Set-up done tap before each new block', 'confirmSetup', s.confirmSetup !== false),
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
      el('button', { class: 'btn', id: 'sync-open', onclick: () => renderSyncSheet() }, 'Sync with the computer'),
      el('button', { class: 'btn', onclick: () => fileInput.click() }, 'Restore from backup file'),
      fileInput,
      el('button', { class: 'btn', id: 'arch-open', onclick: () => { closeModal(); showTab('architecture'); } }, 'How the app works'),
      el('button', { class: 'btn danger', onclick: async () => { if (await confirmDialog('Wipe all data on this phone?', 'Back up first. This cannot be undone.', 'Wipe', true)) { await wipeAll(); await setPairTotals('none'); toast('Wiped'); closeModal(); showTab('home'); } } }, 'Wipe all data')
    ]),
    el('p', { class: 'muted', style: 'margin-top:14px' }, `Cam's Training Tracker v${APP_VERSION} · plan v${D.plan.planVersion} · rules v${D.rules.rulesVersion}`),
    el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Close')
  ]));
}

boot();
