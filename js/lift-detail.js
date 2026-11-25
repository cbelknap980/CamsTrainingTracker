// lift-detail.js (v1.18.11) - one lift, one tap in from the Plan list. Cameron, Nov 25: "When we click in then show
// detail and plan... Make the progression chart cleaner and dynamic. Allow me to edit and override as an option if I
// want to push towards a goal. Graph should be able to show per week weight when I click on it not a static picture."
// Top to bottom: next time (with Edit), the 12 weeks as a chart you tap or drag to read any week, a goal for week 12,
// and how the lift moves. It replaces the v1.18.5-v1.18.9 projection sheet. Writes go through opts.saveTarget and
// opts.saveGoal (app.js); a computer set to Only views shows the same page without them.

import { el, showModal, closeModal, toast, haptic } from './ui.js';
import { projectExercise } from './projection.js';
import { incrementFor } from './progression.js';
import { fmtWeight, repsText, phaseForWeek, pairText } from './data.js';
import { checkGoal, checkTarget, chartColumns, weekReaching, canPush, pushStep, goalShownMax, goalAtReps, GOAL_REPS, nextNumbers, nextWeekOf } from './lift-goal.js';

// the three cases (v1.18.8): amber, blue and a dashed grey read apart on the dark surface, also without colour
const CASE = {
  well: { label: 'Doing well', color: '#e0a030', dash: null },
  steady: { label: 'Steady', color: '#5b8fe0', dash: null },
  struggle: { label: 'Struggling', color: '#9aa1ad', dash: '5 4' }
};
const CASES = ['well', 'steady', 'struggle'];
const GOAL_COLOR = '#3dcc7a';
// kept while the app is open: the chart's unit, the case drawn bold, and whether the week table is open
const view = { mode: 'weight', pick: 'well', table: false };

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, kids) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, String(v));
  for (const k of kids || []) if (k) n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
  return n;
};
const num = x => (x === '' || x == null ? null : Number(x));
/** node.append without the nulls (the DOM's own append writes them out as "null"). */
const put = (node, ...kids) => { node.append(...kids.filter(k => k != null && k !== false)); return node; };

/** Where the lift sits in the plan: in the session it was tapped from, else its first session. */
function placeOf(plan, exerciseId, sessionId) {
  const order = sessionId ? [...plan.sessions.filter(s => s.id === sessionId), ...plan.sessions.filter(s => s.id !== sessionId)] : plan.sessions;
  for (const s of order) for (const b of s.blocks) for (const it of b.items || []) if (it.exercise === exerciseId) return { session: s, block: b, item: it };
  return null;
}

/**
 * A new goal's pace before he picks one: normal steps when doing well already gets there by week 12, else a push
 * (lifts that can push only).
 */
function defaultPush({ d, ex, exerciseId, draft, gmax }) {
  const { plan, rules, settings } = d;
  if (!canPush(rules, exerciseId, ex)) return 0;
  const normal = projectExercise({ plan, rules, settings: { ...settings, liftGoals: { ...(settings.liftGoals || {}), [exerciseId]: { weight: num(draft.weight), reps: num(draft.reps), push: 0 } } }, sessions: d.sessions, targets: d.targets, exerciseId, today: d.today || new Date() });
  return normal && weekReaching(normal, 'well', gmax) ? 0 : pushStep(rules, exerciseId, ex);
}

const SOURCE = { you: 'Set by you', coach: 'Set by the coach', benchmark: 'From your benchmark', baseline: 'From your week-1 baseline', engine: 'From your last session' };

/** "+30" on the pull-up (added weight), "195" elsewhere. */
const wTxt = (ex, w) => `${ex && ex.equipment === 'weighted_bw' && w > 0 ? '+' : ''}${fmtWeight(w)}`;

export function openLiftDetail(data, exerciseId, opts = {}) {
  const st = {
    data,
    edit: null,           // 'target' | 'goal' | null
    draftT: null,         // { weight, reps } while editing the next target
    draftG: null,         // { weight, reps, push } while editing the goal
    ok: false,            // he ticked "it's right" on a flagged number
    week: null            // the selected column's week (null: the last)
  };
  const root = el('div', { class: 'lift', id: 'lift-sheet', 'data-ex': exerciseId });
  st.root = root;
  const draw = () => { root.innerHTML = ''; build(root, st, exerciseId, opts, draw); };
  draw();
  showModal(root, { className: 'sheet-page' });
}

function build(root, st, exerciseId, opts, draw) {
  const d = st.data;
  const { plan, rules, settings } = d;
  const ex = plan.exercises[exerciseId] || { name: exerciseId };
  const stored = d.targets[exerciseId] || null;
  const place = placeOf(plan, exerciseId, opts.sessionId);
  const canWrite = !!(opts.canWrite && opts.saveTarget);
  const goal = (settings.liftGoals || {})[exerciseId] || null;

  // what the chart runs on: the stored target and goal, or the ones being typed (drafts that pass their checks)
  let targets = d.targets, sets = settings;
  if (st.edit === 'target' && st.draftT) {
    const c = checkTarget({ rules, plan, settings, exerciseId, current: stored, weight: st.draftT.weight, reps: st.draftT.reps, range: place && place.item.reps });
    if (c.level !== 'block') targets = { ...d.targets, [exerciseId]: { ...(stored || {}), weight: num(st.draftT.weight), reps: num(st.draftT.reps), stall: 0 } };
  }
  let shownGoal = goal;
  if (st.edit === 'goal' && st.draftG) {
    const c = checkGoal({ rules, plan, settings, exerciseId, goal: st.draftG, now: stored });
    if (st.draftG.push == null) st.draftG.push = c.level === 'block' ? 0 : defaultPush({ d, ex, exerciseId, draft: st.draftG, gmax: c.max });
    shownGoal = c.level === 'block' ? null : { weight: num(st.draftG.weight), reps: num(st.draftG.reps), push: st.draftG.push || 0 };
    sets = { ...settings, liftGoals: { ...(settings.liftGoals || {}), [exerciseId]: shownGoal } };
  }
  const today = d.today || new Date();
  const p = rules && stored ? projectExercise({ plan, rules, settings: sets, sessions: d.sessions, targets, exerciseId, today }) : null;

  // ---- header ----
  const where = place ? `${place.session.name.split(':')[0]} · ${place.block.type === 'finisher' ? 'finisher' : `${place.block.name}, ${place.block.type === 'superset' ? 'superset' : 'straight sets'}`}` : '';
  put(root, el('div', { class: 'lift-head' }, [
    el('button', { type: 'button', class: 'lift-back', 'aria-label': 'Back to the plan', onclick: () => closeModal() }, '‹'),
    el('div', { class: 'lift-title' }, [el('h2', {}, ex.name), where ? el('div', { class: 'muted small' }, where) : null])
  ]));

  // ---- next time ----
  put(root, nextCard(st, { ex, exerciseId, stored, place, canWrite, opts, draw, settings, rules, plan, p }));

  // ---- the 12 weeks ----
  put(root, chartCard(st, { p, ex, exerciseId, goal: shownGoal, settings: sets, rules, plan, draw }));

  // ---- goal ----
  if (p && p.kind === 'weight') put(root, goalCard(st, { p, ex, exerciseId, stored, goal, canWrite: !!(opts.canWrite && opts.saveGoal), opts, draw, settings, rules, plan, today }));

  // ---- how it moves ----
  put(root, howCard({ p, ex, exerciseId, place, rules, settings: sets, goal: shownGoal }));
}

// ---------------------------------------------------------------- next time

function nextCard(st, { ex, exerciseId, stored, place, canWrite, opts, draw, settings, rules, plan, p }) {
  // what the next session asks for, as the workout will build it (the same numbers as the row on the Plan list): the
  // stored target or its heavier-week start, reps held inside the plan's range, sets cut on the lighter week
  const it = place && place.item, b = place && place.block;
  const today = st.data.today || new Date();
  const nextWeek = place ? nextWeekOf(plan, settings, st.data.sessions, place.session.id, today) : null;
  const phaseId = nextWeek ? phaseForWeek(plan, nextWeek).id : null;
  const n = it && stored ? nextNumbers({ plan, rules, settings }, it, b, stored, phaseId) : null;
  const eff = n && n.weight != null && stored.weight != null && n.weight !== stored.weight && st.edit !== 'target' ? n : null;
  const t = stored ? { ...stored, ...(n ? { weight: n.weight != null ? n.weight : stored.weight, reps: n.reps != null ? n.reps : stored.reps } : {}) } : {};
  const adj = settings.restAdjust || {};
  const baseRest = it ? (it.restSeconds || b.roundRestSeconds || 0) : 0;
  const dRest = (adj[exerciseId] || 0) + (place ? (adj[`session:${place.session.id}`] || 0) : 0);
  const rest = baseRest ? `${baseRest + dRest} s rest${dRest ? ` (${dRest > 0 ? '+' : ''}${dRest} from check-ins)` : ''}` : '';
  const sets = n ? n.sets : (it ? (it.sets || (b.type === 'finisher' ? b.rounds : null)) : null);
  const has = t.weight != null || t.reps != null;
  const heavyStart = eff && phaseId === 'heavy';
  const src = heavyStart
    ? `Heavier weeks start ${Math.round(((rules.phases.heavy || {}).startWeightFactor - 1) * 100)}% up from ${wTxt(ex, stored.weight)} × ${stored.reps}`
    : [SOURCE[t.source] || '', t.pendingCoach ? 'reaches the phone when it next opens' : ''].filter(Boolean).join(', ');

  const card = el('div', { class: 'lift-card lift-next', id: 'lift-next' });
  const big = has
    ? el('div', { class: 'ln-nums' }, [
      t.weight != null ? el('b', { class: 'ln-w' }, [wTxt(ex, t.weight), el('small', {}, ' lb')]) : null,
      el('span', { class: 'ln-sr' }, `${sets ? `${sets} × ` : ''}${t.reps != null ? t.reps : (it && it.reps ? repsText(it.reps) : '')}${t.weight == null ? ' reps' : ''}`)
    ])
    : el('div', { class: 'ln-nums' }, el('span', { class: 'muted' }, 'No target yet. It starts from the first session you log.'));
  put(card, 
    el('div', { class: 'row lc-top' }, [
      el('h3', {}, 'Next time'),
      canWrite && has && st.edit !== 'target' ? el('button', { type: 'button', class: 'lift-btn', id: 'lift-edit', onclick: () => { st.edit = 'target'; st.ok = false; st.draftT = { weight: t.weight != null ? t.weight : '', reps: t.reps != null ? t.reps : '' }; draw(); document.getElementById('lift-t-weight')?.focus(); } }, 'Edit') : null
    ]),
    big,
    el('div', { class: 'muted small ln-sub' }, [pairText(ex, t.weight) ? `${pairText(ex, t.weight)} lb · ` : '', rest, rest && src ? ' · ' : '', src].join(''))
  );

  if (st.edit === 'target') {
    const range = n && n.range ? n.range : (it && it.reps);
    const w = el('input', { type: 'number', inputmode: 'decimal', step: String(incrementFor(rules, exerciseId, ex) || 5), id: 'lift-t-weight', value: st.draftT.weight, 'aria-label': 'Weight' });
    const r = el('input', { type: 'number', inputmode: 'numeric', step: '1', min: '1', id: 'lift-t-reps', value: st.draftT.reps, 'aria-label': 'Reps' });
    const msg = el('div', { class: 'lift-check', id: 'lift-t-check' });
    const save = el('button', { type: 'button', class: 'btn primary', id: 'lift-t-save' }, 'Save');
    const verdict = () => checkTarget({ rules, plan, settings, exerciseId, current: stored, weight: st.draftT.weight, reps: st.draftT.reps, range });
    const paint = () => {
      const c = verdict();
      msg.className = `lift-check ${c.level}`;
      msg.textContent = c.text || (num(st.draftT.weight) === (t.weight != null ? t.weight : null) && num(st.draftT.reps) === t.reps ? 'Same as now.' : 'The chart below follows these numbers.');
      save.disabled = c.level === 'block';
      save.textContent = c.level === 'flag' ? 'Save anyway' : 'Save';
    };
    // the chart follows as he types; the inputs keep focus (only the chart part is redrawn)
    const live = () => { st.draftT = { weight: w.value, reps: r.value }; paint(); refreshChart(); };
    w.addEventListener('input', live); r.addEventListener('input', live);
    save.addEventListener('click', async () => {
      const c = verdict();
      if (c.level === 'block') return;
      save.disabled = true;
      const res = await opts.saveTarget(exerciseId, { weight: num(st.draftT.weight), reps: num(st.draftT.reps), week: nextWeek });
      st.data = res.data; st.edit = null; st.draftT = null; draw(); haptic('done');
      const nt = st.data.targets[exerciseId] || {};
      toast(`${ex.name}: next time ${nt.weight != null ? `${wTxt(ex, nt.weight)} × ` : ''}${nt.reps}`, 5000, { action: 'Undo', onAction: async () => { const back = await res.undo(); if (st.root.isConnected) { st.data = back; draw(); } } });
    });
    put(card, el('div', { class: 'lift-form' }, [
      el('div', { class: 'lf-fields' }, [
        t.weight != null ? el('label', { class: 'lf-field' }, [el('span', {}, ex.equipment === 'weighted_bw' ? 'Added (lb)' : (ex.pair ? 'Both (lb)' : 'Weight (lb)')), w]) : null,
        el('label', { class: 'lf-field' }, [el('span', {}, 'Reps'), r])
      ]),
      msg,
      el('p', { class: 'muted small lf-note' }, 'Your target for the next session. The app keeps moving it from what you log, as usual.'),
      el('div', { class: 'btn-row' }, [el('button', { type: 'button', class: 'btn ghost', id: 'lift-t-cancel', onclick: () => { st.edit = null; st.draftT = null; draw(); } }, 'Cancel'), save])
    ]));
    paint();
  }
  // redraw only the chart and goal parts while typing, so the input keeps its focus and keyboard
  const refreshChart = () => {
    const holder = document.createElement('div');
    build(holder, st, exerciseId, opts, draw);
    for (const id of ['lift-chart', 'lift-goal', 'lift-how']) {
      const now = document.getElementById(id), fresh = holder.querySelector(`#${id}`);
      if (now && fresh) now.replaceWith(fresh); else if (now && !fresh) now.remove();
    }
  };
  card._refresh = refreshChart;
  return card;
}

// ---------------------------------------------------------------- chart

const PHASE_NAME = { baseline: 'Baseline', build: 'Build', light: 'Lighter week', heavy: 'Heavier', retest: 'Retest' };

function valText(p, ex, col, c, mode) {
  const t = col.t[c], v = col.v[c];
  if (!t || v == null) return '–';
  if (p.kind === 'reps') return `${v} reps`;
  if (mode === 'max') return wTxt(ex, v);
  if (col.retest) return `~${wTxt(ex, v)} × 5`;
  return `${wTxt(ex, v)} × ${t.reps}`;
}

/** "Intermediate at 165 lb" and "Intermediate, all men" read as "Intermediate" where space is short. */
const shortLabel = s => String(s || 'Benchmark').replace(/ at \d+ lb$/, '').replace(/, all men$/, '');

/** Tick step for a range: about four lines. */
function tickStep(span) {
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100]) if (span / s <= 4) return s;
  return 200;
}

function chartCard(st, { p, ex, exerciseId, goal, settings, rules, plan, draw }) {
  const card = el('div', { class: 'lift-card lift-chart', id: 'lift-chart' });
  if (!p || p.kind === 'self') {
    put(card, el('h3', {}, 'Next 12 weeks'), el('p', { class: 'muted', style: 'margin:0' }, p && p.kind === 'self'
      ? 'The power clean moves when you go heavier on your doubles. The app does not raise it by itself, so there is nothing to chart.'
      : 'No target yet, so there is nothing to chart. It starts from the first session you log.'));
    return card;
  }
  const mode = p.kind === 'reps' ? 'weight' : view.mode;
  const cols = chartColumns(p, mode);
  // opens on the last training week (week 11 for a main lift: week 12 is its retest)
  let sel = cols.findIndex(c => c.week === st.week);
  if (sel < 0) { sel = cols.length - 1; while (sel > 0 && cols[sel].retest) sel -= 1; }
  const inc = incrementFor(rules, exerciseId, ex) || 5;

  // goal marker: on estimated max a line; on weight, a mark at the last week in that week's reps (5 on the retest)
  let goalV = null;
  if (goal && p.kind === 'weight') {
    if (mode === 'max') goalV = goalShownMax(ex, goal, settings);
    else {
      const last = cols[cols.length - 1];
      const reps = last.retest ? 5 : ((last.t[view.pick] || {}).reps || goal.reps);
      goalV = goalAtReps(ex, goal, reps, settings, inc);
    }
  }
  const bench = mode === 'max' && p.standard ? p.standard.lb : null;

  const readout = el('div', { class: 'lc-read', id: 'lift-read', 'aria-live': 'polite' });
  const picks = el('div', { class: 'lc-cases', role: 'radiogroup', 'aria-label': 'Which case to draw' });
  const extra = el('div', { class: 'muted small lc-extra', id: 'lift-extra' });

  // ---- the svg ----
  const W = 340, H = 176, L = 34, R = 14, T = 12, B = 24;
  const vals = cols.flatMap(c => CASES.map(k => c.v[k])).filter(v => v != null);
  if (goalV != null) vals.push(goalV);
  if (bench != null) vals.push(bench);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 4) { lo -= 2; hi += 2; }
  const step = tickStep(hi - lo);
  const padV = (hi - lo) * 0.08; lo -= padV; hi += padV;
  const x = i => (cols.length > 1 ? L + i * (W - L - R) / (cols.length - 1) : (L + W - R) / 2);
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lc-svg', role: 'slider', tabindex: '0', 'aria-label': 'Weeks: tap or drag to read one', 'aria-valuemin': cols[0].week, 'aria-valuemax': 12 });
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    g.appendChild(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'lc-grid' }));
    g.appendChild(svg('text', { x: L - 6, y: y(v) + 3.5, 'text-anchor': 'end', class: 'lc-tick' }, [p.kind === 'reps' ? String(v) : wTxt(ex, v)]));
  }
  if (bench != null) {
    g.appendChild(svg('line', { x1: L, x2: W - R, y1: y(bench), y2: y(bench), class: 'lc-bench' }));
    g.appendChild(svg('text', { x: L + 4, y: y(bench) - 4, class: 'lc-note' }, [`${shortLabel(p.standard.label)} ${wTxt(ex, bench)}`]));
  }
  if (goalV != null && mode === 'max') {
    g.appendChild(svg('line', { x1: L, x2: W - R, y1: y(goalV), y2: y(goalV), class: 'lc-goal-line', stroke: GOAL_COLOR }));
    g.appendChild(svg('text', { x: W - R, y: y(goalV) - 4, 'text-anchor': 'end', class: 'lc-note', fill: GOAL_COLOR }, [`Goal ${wTxt(ex, goalV)}`]));
  }
  // lines: the picked case bold with a dot each week, the other two thin
  const order = CASES.filter(k => k !== view.pick).concat(view.pick);
  for (const k of order) {
    const on = k === view.pick;
    const pts = cols.map((c, i) => ({ i, v: c.v[k], retest: c.retest })).filter(q => q.v != null);
    const d = pts.filter(q => !q.retest).map((q, j) => `${j ? 'L' : 'M'}${x(q.i).toFixed(1)},${y(q.v).toFixed(1)}`).join(' ');
    g.appendChild(svg('path', { d, class: `lc-line${on ? ' on' : ''}`, 'data-case': k, stroke: CASE[k].color, 'stroke-dasharray': CASE[k].dash && !on ? CASE[k].dash : null }));
    for (const q of pts) {
      if (q.retest) g.appendChild(svg('circle', { cx: x(q.i), cy: y(q.v), r: on ? 4 : 3, class: 'lc-ring', stroke: CASE[k].color }));
      else if (on) g.appendChild(svg('circle', { cx: x(q.i), cy: y(q.v), r: 2.6, class: 'lc-dot', fill: CASE[k].color }));
    }
  }
  if (goalV != null && mode !== 'max') {
    const gx = x(cols.length - 1), gy = y(goalV);
    g.appendChild(svg('path', { d: `M${gx},${gy - 6} L${gx + 6},${gy} L${gx},${gy + 6} L${gx - 6},${gy} Z`, class: 'lc-goal-mark', fill: GOAL_COLOR }));
    g.appendChild(svg('text', { x: gx - 9, y: gy + 4, 'text-anchor': 'end', class: 'lc-note', fill: GOAL_COLOR }, ['Goal']));
  }
  // week labels: every week, the selected one stands out
  const labels = cols.map((c, i) => {
    const t = svg('text', { x: x(i), y: H - 7, 'text-anchor': 'middle', class: 'lc-wk' }, [String(c.week)]);
    g.appendChild(t); return t;
  });
  // the cursor
  const cursor = svg('line', { y1: T - 4, y2: H - B + 2, class: 'lc-cursor' });
  g.appendChild(cursor);
  const hits = CASES.map(k => { const c = svg('circle', { r: k === view.pick ? 5.5 : 3.5, class: 'lc-hit', fill: CASE[k].color, 'data-case': k }); g.appendChild(c); return c; });
  const pad = svg('rect', { x: 0, y: 0, width: W, height: H, class: 'lc-pad' });
  g.appendChild(pad);

  const select = (i, fromUser) => {
    i = Math.max(0, Math.min(cols.length - 1, i));
    if (fromUser && i !== sel) haptic('tap');
    sel = i;
    const col = cols[i];
    st.week = col.week;
    cursor.setAttribute('x1', x(i)); cursor.setAttribute('x2', x(i));
    CASES.forEach((k, j) => { const v = col.v[k]; hits[j].setAttribute('cx', x(i)); hits[j].setAttribute('cy', v != null ? y(v) : -20); });
    labels.forEach((t, j) => t.classList.toggle('on', j === i));
    g.setAttribute('aria-valuenow', col.week);
    const ph = i === 0 ? `Week ${col.week}, next time` : `Week ${col.week}`;
    const phase = col.retest ? 'Retest: work up to a set of 5' : (PHASE_NAME[col.phase] || '');
    readout.innerHTML = '';
    put(readout, el('b', {}, ph), phase ? el('span', { class: 'muted' }, ` · ${phase}`) : null);
    g.setAttribute('aria-valuetext', `${ph}${phase ? `, ${phase}` : ''}: ${CASES.map(k => `${CASE[k].label} ${valText(p, ex, col, k, mode)}`).join(', ')}`);
    picks.querySelectorAll('.lc-case').forEach(btn => { btn.querySelector('.lcc-v').textContent = valText(p, ex, col, btn.dataset.case, mode); });
    const t = col.t[view.pick];
    if (p.kind !== 'weight' || !t) extra.textContent = '';
    else if (mode === 'max') extra.textContent = col.retest ? `${CASE[view.pick].label}: about ${wTxt(ex, t.fiveRep)} × 5 on the retest` : `${CASE[view.pick].label}: ${wTxt(ex, t.weight)} × ${t.reps} that week`;
    else extra.textContent = `${CASE[view.pick].label}: estimated max ${wTxt(ex, t.max)} lb${ex.equipment === 'weighted_bw' ? ' added' : ''}`;
    if (table) table.querySelectorAll('tr[data-week]').forEach(tr => tr.classList.toggle('on', Number(tr.dataset.week) === col.week));
  };
  const at = ev => {
    const r = g.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width * W;
    return cols.length > 1 ? Math.round((px - L) / ((W - L - R) / (cols.length - 1))) : 0;
  };
  let down = false;
  g.addEventListener('pointerdown', ev => { down = true; try { g.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ } select(at(ev), true); });
  g.addEventListener('pointermove', ev => { if (down) select(at(ev), true); });
  const up = () => { down = false; };
  g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up); g.addEventListener('lostpointercapture', up);
  g.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { ev.preventDefault(); select(sel - 1, true); }
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { ev.preventDefault(); select(sel + 1, true); }
  });

  // ---- the case buttons: pick one to draw bold; each shows its number for the selected week ----
  for (const k of CASES) {
    put(picks, el('button', { type: 'button', class: `lc-case${k === view.pick ? ' on' : ''}`, 'data-case': k, role: 'radio', 'aria-checked': String(k === view.pick), onclick: () => { view.pick = k; draw(); } }, [
      el('span', { class: 'lcc-k' }, [el('i', { style: `background:${CASE[k].color}` }), CASE[k].label]),
      el('span', { class: 'lcc-v' }, '')
    ]));
  }

  // ---- every week, as a table (closed until he opens it) ----
  let table = null;
  const rows = cols;
  table = el('table', { class: 'lc-table', id: 'lift-weeks' }, [
    el('tr', {}, [el('th', {}, 'Week'), ...CASES.map(k => el('th', {}, CASE[k].label))]),
    ...rows.map(c => el('tr', { 'data-week': c.week, onclick: () => select(cols.indexOf(c), true) }, [
      el('td', {}, `${c.week}${c.retest ? ' test' : (c.phase === 'heavy' && p.mainLift ? ' H' : (c.phase === 'light' ? ' L' : ''))}`),
      ...CASES.map(k => el('td', {}, valText(p, ex, c, k, mode)))
    ]))
  ]);
  const det = el('details', { class: 'lc-more', ...(view.table ? { open: true } : {}) }, [el('summary', {}, 'Every week'), table,
    p.mainLift ? el('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'H: heavier week (3 to 5 reps). L: lighter week, half the sets. Test: the week-12 retest.') : null]);
  det.addEventListener('toggle', () => { view.table = det.open; });

  const head = el('div', { class: 'row lc-top' }, [
    el('h3', {}, 'Next 12 weeks'),
    p.kind === 'weight' ? el('div', { class: 'segmented lc-mode', role: 'tablist' }, [['weight', 'Weight'], ['max', 'Est. max']].map(([m, label]) =>
      el('button', { type: 'button', role: 'tab', 'data-mode': m, 'aria-selected': String(mode === m), class: mode === m ? 'on' : '', onclick: () => { view.mode = m; draw(); } }, label))) : null
  ]);
  put(card, head, readout, picks, g, extra,
    el('p', { class: 'muted small lc-hint' }, p.kind === 'weight' && mode === 'max' ? 'Estimated max: what a target works out to for one rep, so 5-rep and 3-rep weeks compare. Tap or drag across the chart to read a week.' : 'Tap or drag across the chart to read any week.'),
    det);
  select(sel, false);
  return card;
}

// ---------------------------------------------------------------- goal

function goalCard(st, { p, ex, exerciseId, stored, goal, canWrite, opts, draw, settings, rules, plan, today }) {
  const card = el('div', { class: 'lift-card lift-goal', id: 'lift-goal' });
  const unit = ex.equipment === 'weighted_bw' ? ' added' : '';
  const push = canPush(rules, exerciseId, ex);
  const stepLb = pushStep(rules, exerciseId, ex);
  const run = g => projectExercise({ plan, rules, settings: { ...settings, liftGoals: { ...(settings.liftGoals || {}), [exerciseId]: g } }, sessions: st.data.sessions, targets: st.data.targets, exerciseId, today });
  // where each case stands against a goal's max: "Doing well gets there in week 9", "ends at 255, 20 short"
  const standing = (proj, gmax) => {
    if (!proj || gmax == null) return '';
    const wk = weekReaching(proj, 'well', gmax), wkS = weekReaching(proj, 'steady', gmax);
    const endW = proj.end.well.max, endS = proj.end.steady.max;
    if (wkS) return `Steady gets there in week ${wkS}, doing well in week ${wk}.`;
    if (wk) return `Doing well gets there in week ${wk}. Steady ends at ${wTxt(ex, endS)}.`;
    return `Doing well ends at ${wTxt(ex, endW)}, ${fmtWeight(gmax - endW)} short. Steady ends at ${wTxt(ex, endS)}.`;
  };

  if (st.edit !== 'goal') {
    put(card, el('div', { class: 'row lc-top' }, [
      el('h3', {}, 'Goal'),
      canWrite ? el('div', { class: 'lg-btns' }, [
        goal ? el('button', { type: 'button', class: 'lift-btn ghost', id: 'lift-g-remove', onclick: async () => {
          const res = await opts.saveGoal(exerciseId, null);
          st.data = res.data; draw();
          toast('Goal removed', 5000, { action: 'Undo', onAction: async () => { const back = await res.undo(); if (st.root.isConnected) { st.data = back; draw(); } } });
        } }, 'Remove') : null,
        el('button', { type: 'button', class: 'lift-btn', id: 'lift-g-edit', onclick: () => {
          st.edit = 'goal'; st.ok = false;
          st.draftG = goal ? { weight: goal.weight, reps: goal.reps, push: goal.push || 0 } : { weight: '', reps: 1, push: null };
          draw();
          const w = document.getElementById('lift-g-weight'); if (w && !goal) w.focus();
        } }, goal ? 'Edit' : 'Set a goal')
      ]) : null
    ]));
    if (!goal) {
      put(card, el('p', { class: 'muted small', style: 'margin:0' }, canWrite
        ? `Pick a number to aim for by week 12. The chart shows whether the plan gets you there${push ? ', and you can have the app take bigger steps toward it' : ''}.`
        : 'No goal set. Goals are set on the phone.'));
      return card;
    }
    const gmax = goalShownMax(ex, goal, settings);
    put(card, 
      el('div', { class: 'lg-now' }, [el('b', {}, `${wTxt(ex, goal.weight)} lb${unit} × ${goal.reps}`), el('span', { class: 'muted' }, goal.reps === 1 ? ' (a single)' : ` (estimated max ${wTxt(ex, gmax)})`)]),
      el('p', { class: 'small lg-line', id: 'lift-g-standing' }, standing(p, gmax)),
      push ? el('p', { class: 'muted small lg-line' }, goal.push > 0 ? `Pushing: ${fmtWeight(stepLb + goal.push)} lb each clean session instead of ${fmtWeight(stepLb)}, until you reach it. A Hard set or a missed rep still holds the weight.` : `Normal steps: ${fmtWeight(stepLb)} lb each clean session.`) : el('p', { class: 'muted small lg-line' }, 'This lift moves by how you rate its last set, so the goal is a mark on the chart. Rating the last set Easy adds weight sooner.'),
      goal.beyond ? el('p', { class: 'lift-check flag', style: 'margin-top:8px' }, 'Past what a block like this usually adds. You chose to keep it.') : null
    );
    return card;
  }

  // ---- editing ----
  const dg = st.draftG;
  const w = el('input', { type: 'number', inputmode: 'decimal', step: '5', id: 'lift-g-weight', value: dg.weight, 'aria-label': 'Goal weight' });
  const r = el('input', { type: 'number', inputmode: 'numeric', step: '1', min: String(GOAL_REPS[0]), max: String(GOAL_REPS[1]), id: 'lift-g-reps', value: dg.reps, 'aria-label': 'Goal reps' });
  const msg = el('div', { class: 'lift-check', id: 'lift-g-check' });
  const ok = el('input', { type: 'checkbox', id: 'lift-g-ok', checked: st.ok });
  const okRow = el('label', { class: 'lg-ok', hidden: true }, [ok, el('span', {}, 'I know. Keep it anyway.')]);
  const paceBox = el('div', { class: 'lg-pace', id: 'lift-g-pace' });
  const save = el('button', { type: 'button', class: 'btn primary', id: 'lift-g-save' }, 'Save goal');
  const quick = [];
  if (p.standard) quick.push([`${shortLabel(p.standard.label)} ${wTxt(ex, p.standard.lb)}`, p.standard.lb]);
  if (p.oldBest && p.oldBest > (p.now.max || 0)) quick.push([`Your best ${wTxt(ex, p.oldBest)}`, p.oldBest]);
  const verdict = () => checkGoal({ rules, plan, settings, exerciseId, goal: st.draftG, now: stored });
  const paint = () => {
    const c = verdict();
    msg.className = `lift-check ${c.level}`;
    msg.textContent = c.text;
    okRow.hidden = c.level !== 'flag';
    paceBox.innerHTML = '';
    if (c.level !== 'block' && push) {
      const gm = c.max;
      const normal = run({ weight: num(st.draftG.weight), reps: num(st.draftG.reps), push: 0 });
      const pushed = run({ weight: num(st.draftG.weight), reps: num(st.draftG.reps), push: stepLb });
      const opt = (val, title, proj) => el('button', { type: 'button', class: `lg-opt${st.draftG.push === val ? ' on' : ''}`, 'data-push': val, 'aria-pressed': String(st.draftG.push === val), onclick: () => { st.draftG.push = val; paint(); refresh(); } }, [
        el('b', {}, title), el('span', { class: 'muted small' }, standing(proj, gm))
      ]);
      put(paceBox, 
        el('div', { class: 'small lg-q' }, 'How to get there'),
        opt(0, `Normal steps, ${fmtWeight(stepLb)} lb a session`, normal),
        opt(stepLb, `Push: ${fmtWeight(stepLb * 2)} lb a session`, pushed),
        el('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'Pushing only changes the size of a step after a clean session. A Hard set or a missed rep still holds the weight, and the step goes back to normal once you reach the goal.'));
    } else if (c.level !== 'block') {
      st.draftG.push = 0;
      put(paceBox, el('p', { class: 'muted small', style: 'margin:0' }, standing(run({ weight: num(st.draftG.weight), reps: num(st.draftG.reps), push: 0 }), c.max) + ' This lift moves by how you rate its last set, so the goal is a mark on the chart.'));
    }
    save.disabled = c.level === 'block' || (c.level === 'flag' && !ok.checked);
  };
  const refresh = () => {
    const holder = document.createElement('div');
    build(holder, st, exerciseId, opts, draw);
    for (const id of ['lift-chart', 'lift-how']) { const now = document.getElementById(id), fresh = holder.querySelector(`#${id}`); if (now && fresh) now.replaceWith(fresh); }
  };
  const live = () => {
    st.draftG = { ...st.draftG, weight: w.value, reps: r.value, push: null };
    const c = verdict();
    st.draftG.push = c.level === 'block' ? 0 : defaultPush({ d: st.data, ex, exerciseId, draft: st.draftG, gmax: c.max });
    st.ok = false; ok.checked = false; paint(); refresh();
  };
  w.addEventListener('input', live); r.addEventListener('input', live);
  ok.addEventListener('change', () => { st.ok = ok.checked; paint(); });
  save.addEventListener('click', async () => {
    const c = verdict();
    if (c.level === 'block' || (c.level === 'flag' && !ok.checked)) return;
    save.disabled = true;
    const g = { weight: num(st.draftG.weight), reps: num(st.draftG.reps), push: push ? (st.draftG.push || 0) : 0, setAt: new Date().toISOString(), beyond: c.level === 'flag' }; // every key, every time: settings merge per key
    const res = await opts.saveGoal(exerciseId, g);
    st.data = res.data; st.edit = null; st.draftG = null; draw(); haptic('done');
    toast(`Goal saved: ${ex.name} ${wTxt(ex, g.weight)} × ${g.reps}`, 5000, { action: 'Undo', onAction: async () => { const back = await res.undo(); if (st.root.isConnected) { st.data = back; draw(); } } });
  });
  put(card, 
    el('h3', {}, 'Goal for week 12'),
    quick.length ? el('div', { class: 'lg-quick' }, quick.map(([label, v]) => el('button', { type: 'button', class: 'lg-chip', onclick: () => { w.value = v; r.value = 1; live(); } }, label))) : null,
    el('div', { class: 'lf-fields' }, [
      el('label', { class: 'lf-field' }, [el('span', {}, ex.equipment === 'weighted_bw' ? 'Added (lb)' : 'Weight (lb)'), w]),
      el('label', { class: 'lf-field' }, [el('span', {}, 'Reps'), r])
    ]),
    msg, okRow, paceBox,
    el('div', { class: 'btn-row' }, [el('button', { type: 'button', class: 'btn ghost', id: 'lift-g-cancel', onclick: () => { st.edit = null; st.draftG = null; draw(); } }, 'Cancel'), save])
  );
  paint();
  return card;
}

// ---------------------------------------------------------------- how it moves

function howCard({ p, ex, exerciseId, place, rules, settings, goal }) {
  const card = el('div', { class: 'lift-card lift-how', id: 'lift-how' });
  const it = place && place.item, b = place && place.block;
  const sets = it ? (it.sets || (b.type === 'finisher' ? b.rounds : null)) : null;
  const heavy = p && p.mainLift && it && it.reps && rules.phases.heavy ? rules.phases.heavy.mainLiftReps : null;
  const hw = rules.phases.heavy && rules.phases.heavy.weeks ? rules.phases.heavy.weeks : [8, 11];
  const hwTxt = `weeks ${hw[0]} to ${hw[hw.length - 1]}`;
  const planLine = !it ? '' : (p && p.weekly && heavy
    ? `${sets} sets. Reps stay at ${(rules.mainLiftTest.weekly || {}).reps || 5} (${heavy[0]} in the heavier ${hwTxt}) and the weight steps up after every clean session.`
    : `${sets ? `${sets} ${b.type === 'finisher' ? 'rounds' : 'sets'} of ` : ''}${it.reps ? `${repsText(it.reps)} reps` : (ex.timed ? 'a hold' : '')}${heavy ? ` (${heavy[0]} to ${heavy[1]} in the heavier ${hwTxt})` : ''}.`);
  const inc = incrementFor(rules, exerciseId, ex);
  const g = goal && goal.push > 0 && p && p.weekly ? goal.push : 0;
  const rules3 = !p || p.kind === 'self' ? [] : (p.weekly
    ? [['Doing well', `all reps made, no set Hard, every week: ${fmtWeight(inc + g)} lb more each time${g ? ` (${fmtWeight(inc)} plus ${fmtWeight(g)} toward your goal)` : ''}.`],
       ['Steady', 'every other week a set is Hard: the weight holds that week.'],
       ['Struggling', 'a rep short two weeks in three: the weight holds, and three misses in a row take 5% off.']]
    : [['Doing well', 'last set Solid: 2 more reps each time (Easy: more weight right away).'],
       ['Steady', 'last set Hard: 1 more rep, then more weight at the top of the range.'],
       ['Struggling', 'a rep short every other session.']]);
  const cap = Math.round((((rules.projection || {}).maxGain || {})[p && p.mainLift ? 'main' : 'accessory'] || 0) * 100);
  put(card, 
    el('h3', {}, 'How it moves'),
    planLine ? el('p', { class: 'small', style: 'margin:0 0 8px' }, `Plan: ${planLine}`) : null,
    rules3.length ? el('ul', { class: 'lift-rules' }, rules3.map(([a, t]) => el('li', {}, [el('i', { style: `background:${CASE[a === 'Doing well' ? 'well' : (a === 'Steady' ? 'steady' : 'struggle')].color}` }), el('b', {}, `${a}: `), t]))) : null,
    p && p.kind === 'weight' && p.standard ? el('p', { class: 'small', id: 'lift-standard', style: 'margin:8px 0 0' }, `${p.standard.label}: ${wTxt(ex, p.standard.lb)} lb estimated max${p.standard.lb > p.now.max ? `, ${fmtWeight(p.standard.lb - p.now.max)} to go` : ', already past it'}.${p.oldBest ? ` Your best single: ${fmtWeight(p.oldBest)}.` : ''}`) : null,
    p && p.kind !== 'self' && cap ? el('p', { class: 'muted small', style: 'margin:8px 0 0' }, `No line runs past ${cap}% over today's estimated max, about the most a trained lifter adds in a block this long.`) : null
  );
  return card;
}
