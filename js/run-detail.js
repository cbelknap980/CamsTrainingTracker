// run-detail.js (v1.24.0) - one planned run, one tap in from the Plan list, laid out like a lift page (lift-detail.js).
// Cameron, Nov 26: "lets put these 5k tests in the plan as defined points... Lets show the plan over the 12 week
// sprints (similar to how we show the plan for weights)".
// Run 1 (intervals): next time; the 12 weeks as a strip of workouts with the 5K check-ins marked, and once there is a
// check-in, a chart of where the next ones should land (doing well, steady, struggling: plan.json run1.projection);
// the three check-ins and the goal; how it moves. Run 2 (long run): next time; its 12 weeks by the 10% rule, with
// the long runs done; how it moves. Read only: the runs themselves are logged on the Runs tab.

import { el, showModal, closeModal, haptic } from './ui.js';
import { fmtDate, toISODate, parseISODate, weekNumber } from './data.js';
import { intervalPlan, longRunPlan, checkIns, fiveKProjection, fmtSeconds, parseMinutes, runLine, weekRange, fiveKTests } from './runs.js';

// the three cases, as on the lift page
const CASE = {
  well: { label: 'Doing well', color: '#e0a030', dash: null },
  steady: { label: 'Steady', color: '#5b8fe0', dash: null },
  struggle: { label: 'Struggling', color: '#9aa1ad', dash: '5 4' }
};
const CASES = ['well', 'steady', 'struggle'];
const GOAL_COLOR = '#3dcc7a';
const DONE_COLOR = '#f3f4f6';
const PLAN_COLOR = '#5b8fe0';
// kept while the app is open: the case drawn bold and whether the week table is open
const view = { pick: 'steady', table: false };

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, kids) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, String(v));
  for (const k of kids || []) if (k) n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
  return n;
};
const put = (node, ...kids) => { node.append(...kids.filter(k => k != null && k !== false)); return node; };
/** "5 s" under a minute, else "1:12". */
const gap = sec => (Math.abs(sec) < 60 ? `${Math.round(Math.abs(sec))} s` : fmtSeconds(Math.abs(sec)));
const monthDay = iso => parseISODate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
/** "Sat Nov 28 or Sun 29" for a weekend run. */
const weekendText = iso => {
  const d = parseISODate(iso), s = new Date(d); s.setDate(d.getDate() + 1);
  return `Sat ${monthDay(iso)} or Sun ${s.getMonth() === d.getMonth() ? s.getDate() : monthDay(toISODate(s))}`;
};

/** The first row not done yet whose week is not over: what the run asks next. */
export function nextRow(rows, settings, today) {
  const t = toISODate(today);
  return rows.find(r => !r.done && weekRange(settings, r.week).end >= t) || null;
}

export function openRunDetail(data, runId, opts = {}) {
  const st = { data, week: opts.week || null };
  const root = el('div', { class: 'lift run-page', id: 'run-sheet', 'data-run': runId });
  const draw = () => { root.innerHTML = ''; build(root, st, runId, draw); };
  draw();
  showModal(root, { className: 'sheet-page' });
}

function build(root, st, runId, draw) {
  const d = st.data;
  const { plan, settings } = d;
  const run = plan.runs.find(r => r.id === runId);
  if (!run) return;
  const today = d.today || new Date();
  put(root, el('div', { class: 'lift-head' }, [
    el('button', { type: 'button', class: 'lift-back', 'aria-label': 'Back to the plan', onclick: () => closeModal() }, '‹'),
    el('div', { class: 'lift-title' }, [el('h2', {}, run.name), el('div', { class: 'muted small' }, `${run.day} · about ${run.plannedMinutes} min`)])
  ]));
  if (run.intervals) {
    const rows = intervalPlan(plan, settings, d.runs, run, today);
    const proj = fiveKProjection(run, d.runs, settings);
    const checks = checkIns(plan, settings, d.runs, run);
    put(root, nextIntervals(d, run, rows, today), intervalWeeks(st, { run, rows, proj, checks, today, draw }), checkInsCard(run, checks, proj, today), howIntervals(run, proj));
  } else if (run.distance) {
    const rows = longRunPlan(plan, settings, d.runs, run, today);
    put(root, nextLong(d, run, rows, today), longWeeks(st, { run, rows, today }), howLong(run, rows));
  }
}

// ---------------------------------------------------------------- next time

function nextCard(when, big, sub) {
  return put(el('div', { class: 'lift-card lift-next', id: 'run-next' }),
    el('div', { class: 'row lc-top' }, [el('h3', {}, 'Next time'), when ? el('span', { class: 'muted small', id: 'run-next-when' }, when) : null]),
    el('div', { class: 'ln-nums' }, big),
    sub ? el('div', { class: 'muted small ln-sub' }, sub) : null);
}

const whenText = (r, today) => {
  const t = toISODate(today);
  if (r.date === t) return 'Today';
  if (r.date < t) return 'This week, still open';
  return fmtDate(r.date);
};

function nextIntervals(d, run, rows, today) {
  const r = nextRow(rows, d.settings, today);
  if (!r) return nextCard(null, el('span', { class: 'muted' }, 'The 12 weeks are done.'), '');
  const hr = run.hr || {};
  if (r.kind === 'test') {
    const after = (run.tests || []).map(t => t.week).find(w => w > r.week);
    return nextCard(whenText(r, today), [el('b', { class: 'ln-w' }, '5K'), el('span', { class: 'ln-sr' }, 'check-in')],
      `In place of the intervals. Your time sets the fast pace for weeks ${r.week + 1} to ${after ? after - 1 : 12}.`);
  }
  const from = r.paceFrom ? `from your ${monthDay(r.paceFrom.date)} 5K, ${fmtSeconds(r.paceFrom.seconds)}` : (r.waitsFor ? `your week ${r.waitsFor} check-in sets the pace` : 'the plan\'s pace until your first check-in');
  return nextCard(whenText(r, today), [
    el('b', { class: 'ln-w' }, [`${r.reps} × ${r.hardMin}`, el('small', {}, ' min')]),
    r.pace ? el('span', { class: 'ln-sr' }, [r.pace, el('small', { class: 'muted' }, ' /mi')]) : null
  ], `${hr.fastEnd ? `Heart rate ${hr.fastEnd[0]}-${hr.fastEnd[1]} by the end of each · ` : ''}${from}`);
}

function nextLong(d, run, rows, today) {
  const r = nextRow(rows, d.settings, today);
  if (!r) return nextCard(null, el('span', { class: 'muted' }, 'The 12 weeks are done.'), '');
  const t = toISODate(today);
  const when = r.end >= t && r.start <= t ? 'This weekend' : weekendText(r.date);
  const p = run.distance;
  // the longest run in the 30 days before that week, as the Runs tab says it
  const { start } = weekRange(d.settings, r.week);
  const from = parseISODate(start); from.setDate(from.getDate() - (p.windowDays || 30));
  const fromIso = toISODate(from);
  const recent = (d.runs || []).filter(x => x.date >= fromIso && x.date < start && x.distance && !['Ski day', 'Bike/rower sub'].includes(x.type)).reduce((m, x) => Math.max(m, x.distance), 0);
  return nextCard(when, [el('b', { class: 'ln-w' }, [String(r.miles), el('small', {}, ' mi')]), el('span', { class: 'ln-sr' }, 'easy')],
    `${(run.hr && run.hr.easy) ? `Heart rate ${run.hr.easy[0]}-${run.hr.easy[1]}, easy enough to talk` : run.effort}${recent ? ` · longest run in the last ${p.windowDays || 30} days ${Math.round(recent * 10) / 10} mi` : ''}`);
}

// ---------------------------------------------------------------- a 12-week chart

function tickStep(span, steps) {
  for (const s of steps) if (span / s <= 4) return s;
  return steps[steps.length - 1];
}

/**
 * The chart both pages draw: weeks 1-12 across, one or more lines, the weeks it marks (the check-ins) in the accent,
 * and the done results as white dots. Tap or drag to pick a week; onSelect(week) fills in the rest.
 * lines: [{ key, color, dash, on, pts: [{ week, v }], rings: [weeks] }]; dots: [{ week, v, label }]
 */
function weekChart({ lines, dots, marks = [], invert = false, fmt, steps, refs = [], sel, onSelect, label }) {
  const W = 340, H = 186, L = 38, R = 14, T = 16, B = 24;
  const weeks = Array.from({ length: 12 }, (_, i) => i + 1);
  const vals = [...lines.flatMap(l => l.pts.map(p => p.v)), ...dots.map(p => p.v), ...refs.filter(r => r.inRange).map(r => r.v)].filter(v => v != null);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const step = tickStep(Math.max(hi - lo, 1e-9), steps);
  if (hi - lo < step * 2) { const mid = (hi + lo) / 2; lo = mid - step; hi = mid + step; }
  const padV = (hi - lo) * 0.12; lo -= padV; hi += padV;
  const x = w => L + (w - 1) * (W - L - R) / 11;
  const y = v => (invert ? T + (v - lo) / (hi - lo) * (H - T - B) : T + (hi - v) / (hi - lo) * (H - T - B));
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lc-svg', role: 'slider', tabindex: '0', 'aria-label': label || 'Weeks: tap or drag to read one', 'aria-valuemin': 1, 'aria-valuemax': 12 });
  for (const w of marks) g.appendChild(svg('rect', { x: x(w) - 9, y: T - 6, width: 18, height: H - B - T + 8, rx: 5, class: 'rc-band' }));
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    g.appendChild(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'lc-grid' }));
    g.appendChild(svg('text', { x: L - 6, y: y(v) + 3.5, 'text-anchor': 'end', class: 'lc-tick' }, [fmt(v)]));
  }
  for (const r of refs) {
    if (r.inRange) {
      g.appendChild(svg('line', { x1: L, x2: W - R, y1: y(r.v), y2: y(r.v), class: r.cls || 'lc-goal-line', stroke: r.color }));
      g.appendChild(svg('text', { x: r.left ? L + 4 : W - R, y: y(r.v) - 4, 'text-anchor': r.left ? 'start' : 'end', class: 'lc-note', fill: r.color }, [r.text]));
    } else {
      g.appendChild(svg('text', { x: W - R, y: (invert ? r.v < lo : r.v > hi) ? T - 4 : H - B - 4, 'text-anchor': 'end', class: 'lc-note', fill: r.color }, [r.text]));
    }
  }
  const order = lines.filter(l => !l.on).concat(lines.filter(l => l.on));
  for (const l of order) {
    const pts = l.pts.filter(p => p.v != null);
    if (pts.length > 1) g.appendChild(svg('path', { d: pts.map((p, j) => `${j ? 'L' : 'M'}${x(p.week).toFixed(1)},${y(p.v).toFixed(1)}`).join(' '), class: `lc-line${l.on ? ' on' : ''}`, 'data-case': l.key, stroke: l.color, 'stroke-dasharray': l.dash && !l.on ? l.dash : null }));
    for (const p of pts) {
      if ((l.rings || []).includes(p.week)) g.appendChild(svg('circle', { cx: x(p.week), cy: y(p.v), r: l.on ? 4.2 : 3, class: 'lc-ring', stroke: l.color, 'data-ring': `${l.key}-${p.week}` }));
      else if (l.on) g.appendChild(svg('circle', { cx: x(p.week), cy: y(p.v), r: 2.6, class: 'lc-dot', fill: l.color }));
    }
  }
  for (const p of dots) {
    g.appendChild(svg('circle', { cx: x(p.week), cy: y(p.v), r: 4.6, class: 'rc-done', fill: DONE_COLOR, 'data-done': p.week }));
    // the label above the dot (below when p.below), kept inside the chart at the first and last week
    // (beside it in week 1, clear of the axis numbers)
    const first = p.week === 1;
    const edge = first ? ['start', 8] : (p.week === 12 ? ['end', 3] : ['middle', 0]);
    if (p.label) g.appendChild(svg('text', { x: x(p.week) + edge[1], y: first ? y(p.v) + 3.5 : y(p.v) + (p.below ? 16 : -9), 'text-anchor': edge[0], class: 'rc-done-label' }, [p.label]));
  }
  const labels = weeks.map(w => { const t = svg('text', { x: x(w), y: H - 7, 'text-anchor': 'middle', class: 'lc-wk' + (marks.includes(w) ? ' rc-mark' : '') }, [String(w)]); g.appendChild(t); return t; });
  const cursor = svg('line', { y1: T - 6, y2: H - B + 2, class: 'lc-cursor' });
  g.appendChild(cursor);
  const hits = lines.map(l => { const c = svg('circle', { r: l.on ? 5.5 : 3.5, class: 'lc-hit', fill: l.color }); g.appendChild(c); return c; });
  g.appendChild(svg('rect', { x: 0, y: 0, width: W, height: H, class: 'lc-pad' }));
  let cur = sel;
  const select = (w, fromUser) => {
    w = Math.max(1, Math.min(12, w));
    if (fromUser && w !== cur) haptic('tap');
    cur = w;
    cursor.setAttribute('x1', x(w)); cursor.setAttribute('x2', x(w));
    lines.forEach((l, j) => { const p = l.pts.find(q => q.week === w); hits[j].setAttribute('cx', x(w)); hits[j].setAttribute('cy', p && p.v != null ? y(p.v) : -20); });
    labels.forEach((t, j) => t.classList.toggle('on', j + 1 === w));
    g.setAttribute('aria-valuenow', w);
    if (onSelect) onSelect(w, fromUser);
  };
  const at = ev => { const r = g.getBoundingClientRect(); return Math.round(((ev.clientX - r.left) / r.width * W - L) / ((W - L - R) / 11)) + 1; };
  let down = false;
  g.addEventListener('pointerdown', ev => { down = true; try { g.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ } select(at(ev), true); });
  g.addEventListener('pointermove', ev => { if (down) select(at(ev), true); });
  const up = () => { down = false; };
  g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up); g.addEventListener('lostpointercapture', up);
  g.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { ev.preventDefault(); select(cur - 1, true); }
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { ev.preventDefault(); select(cur + 1, true); }
  });
  return { node: g, select };
}

// ---------------------------------------------------------------- run 1: the 12 weeks

/** The week a page opens on: the one asked for, else the next one not done, else this week. */
function startWeek(st, rows, settings, today) {
  if (st.week) return st.week;
  const n = nextRow(rows, settings, today);
  return n ? n.week : Math.max(1, Math.min(12, weekNumber(today, settings.startDate)));
}

function intervalWeeks(st, { run, rows, proj, checks, today, draw }) {
  const { settings, rules } = st.data;
  const card = el('div', { class: 'lift-card lift-chart', id: 'run-chart' });
  const marks = (run.tests || []).map(t => t.week);
  const nowWeek = weekNumber(today, settings.startDate);
  const readout = el('div', { class: 'lc-read', id: 'run-read', 'aria-live': 'polite' });
  const sub = el('div', { class: 'muted small rc-sub', id: 'run-read-sub' });
  const tests = fiveKTests(st.data.runs, run.fiveKCheck).filter(t => !t.flagged).map(t => ({ ...t, week: t.week || weekNumber(parseISODate(t.date), settings.startDate) }));
  const caseAt = (k, w) => (proj ? (proj.cases[k].find(p => p.week === w) || {}).seconds : null);

  // the strip: each week's workout, check-ins in the accent
  const cells = rows.map(r => el('button', {
    type: 'button', class: `rp-cell${r.kind === 'test' ? ' test' : ''}${r.done ? ' done' : ''}${r.week === nowWeek ? ' now' : ''}`, 'data-week': r.week,
    'aria-label': `Week ${r.week}: ${r.text}${r.done ? ', done' : ''}`, onclick: () => select(r.week, true)
  }, [el('b', {}, String(r.week)), el('span', {}, r.kind === 'test' ? '5K' : `${r.reps}×${r.hardMin}`)]));
  const strip = el('div', { class: 'rp-strip', id: 'run-strip' }, cells);

  const picks = proj ? el('div', { class: 'lc-cases', role: 'radiogroup', 'aria-label': 'Which case to draw' }, CASES.map(k => el('button', {
    type: 'button', class: `lc-case${k === view.pick ? ' on' : ''}`, 'data-case': k, role: 'radio', 'aria-checked': String(k === view.pick), onclick: () => { view.pick = k; draw(); }
  }, [el('span', { class: 'lcc-k' }, [el('i', { style: `background:${CASE[k].color}` }), CASE[k].label]), el('span', { class: 'lcc-v' }, '')]))) : null;

  let chart = null;
  if (proj) {
    const goal = run.goal && run.goal.fiveK ? Math.round(parseMinutes(run.goal.fiveK) * 60) : null;
    const all = CASES.flatMap(k => proj.cases[k].map(p => p.seconds)).concat(tests.map(t => t.seconds));
    const lo = Math.min(...all), hi = Math.max(...all);
    chart = weekChart({
      lines: CASES.map(k => ({ key: k, color: CASE[k].color, dash: CASE[k].dash, on: k === view.pick, pts: proj.cases[k].map(p => ({ week: p.week, v: p.seconds })), rings: marks.filter(w => w > proj.from.week) })),
      dots: tests.map(t => ({ week: Math.max(1, Math.min(12, t.week)), v: t.seconds, label: fmtSeconds(t.seconds) })),
      marks, invert: true, fmt: v => fmtSeconds(v), steps: [5, 10, 15, 20, 30, 60, 120, 300],
      refs: goal ? [{ v: goal, color: GOAL_COLOR, text: goal >= lo - (hi - lo) ? `Goal ${run.goal.fiveK}` : `Goal ${run.goal.fiveK} ↑`, inRange: goal >= lo - (hi - lo) }] : [],
      sel: startWeek(st, rows, settings, today), label: 'Weeks: tap or drag to read one', onSelect: w => select(w, false, true)
    });
  }
  const extra = el('div', { class: 'muted small lc-extra', id: 'run-extra' });

  // the table
  const table = el('table', { class: 'lc-table rc-table', id: 'run-weeks' }, [
    el('tr', {}, [el('th', {}, 'Week'), el('th', {}, 'Day'), el('th', {}, 'Run'), el('th', {}, 'Fast pace')]),
    ...rows.map(r => el('tr', { 'data-week': r.week, class: r.kind === 'test' ? 'rc-test' : '', onclick: () => select(r.week, true) }, [
      el('td', {}, `${r.week}${r.done ? ' ✓' : ''}`),
      el('td', {}, monthDay(r.date)),
      el('td', {}, r.kind === 'test' ? '5K check-in' : r.text),
      el('td', {}, r.kind === 'test' ? testCell(r, tests, proj) : (r.pace || (r.waitsFor ? `from wk ${r.waitsFor}` : '–')))
    ]))
  ]);
  const det = el('details', { class: 'lc-more', ...(view.table ? { open: true } : {}) }, [el('summary', {}, 'Every week'), table,
    el('p', { class: 'muted small', style: 'margin:6px 0 0' }, `Fast pace is per mile. "From wk ${marks[0]}": that week's check-in sets it.${proj ? ` A check-in still to come shows the ${CASE[view.pick].label.toLowerCase()} case.` : ''}`)]);
  det.addEventListener('toggle', () => { view.table = det.open; });

  let sel = startWeek(st, rows, settings, today);
  function select(w, fromUser, fromChart) {
    w = Math.max(1, Math.min(12, w));
    if (chart && !fromChart) { chart.select(w, fromUser); return; } // the chart calls back with fromChart
    if (!chart && fromUser && w !== sel) haptic('tap');
    sel = w; st.week = w;
    const r = rows[w - 1];
    cells.forEach(c => c.classList.toggle('on', Number(c.dataset.week) === w));
    readout.innerHTML = '';
    const what = r.kind === 'test' ? '5K check-in' : `${r.text}${r.pace ? ` at ${r.pace}` : ''}`;
    put(readout, el('b', {}, `Week ${w}`), el('span', { class: 'muted' }, ` · ${monthDay(r.date)} · `), el('span', {}, what));
    const res = r.kind === 'test' ? (checks.find(c => c.week === w) || {}).result : null;
    sub.textContent = r.done
      ? (res ? `Done: ${fmtSeconds(res.seconds)}${res.flagged ? ', waiting for your OK' : ''}.` : `Done: ${runLine(r.done, rules, true) || 'logged'}.`)
      : (r.kind === 'test' ? (r.week === marks[0] ? 'Your first time sets the interval paces.' : 'In place of the intervals. Your time moves the paces.') : (r.waitsFor ? `The pace comes from your week ${r.waitsFor} check-in.` : (r.paceFrom ? `Pace from your ${monthDay(r.paceFrom.date)} 5K.` : 'The plan\'s pace until your first check-in.')));
    if (picks) picks.querySelectorAll('.lc-case').forEach(b => { const v = caseAt(b.dataset.case, w); b.querySelector('.lcc-v').textContent = v ? fmtSeconds(v) : '–'; });
    if (proj) {
      const v = caseAt(view.pick, w);
      extra.textContent = v == null ? `Before your ${monthDay(proj.from.date)} 5K.` : (w === proj.from.week ? `Your ${monthDay(proj.from.date)} 5K: ${fmtSeconds(proj.from.seconds)}.` : `${CASE[view.pick].label}: a 5K of about ${fmtSeconds(v)} that week${v < proj.from.seconds ? `, ${gap(proj.from.seconds - v)} faster than ${monthDay(proj.from.date)}` : `, the same as ${monthDay(proj.from.date)}`}.`);
    }
    table.querySelectorAll('tr[data-week]').forEach(tr => tr.classList.toggle('on', Number(tr.dataset.week) === w));
  }

  put(card,
    el('div', { class: 'row lc-top' }, [el('h3', {}, 'The 12 weeks'), el('span', { class: 'rc-key muted small' }, [el('i', { class: 'rc-key-5k' }, '5K'), ' check-in'])]),
    readout, sub, strip,
    proj ? null : el('p', { class: 'muted small rc-wait', id: 'run-chart-wait' }, `Your first check-in, ${fmtDate((checks[0] || {}).date || rows[0].date)}, is the starting point. After it, a chart here shows where your week ${marks[1] || 7} and week ${marks[2] || 12} check-ins should land if you're doing well, steady or struggling.`),
    picks, chart ? chart.node : null, proj ? extra : null,
    el('p', { class: 'muted small lc-hint' }, proj ? 'Rings are the check-ins still to come; white dots are your times. Tap a week, or drag across the chart.' : 'Tap a week to read it.'),
    det);
  select(sel, false);
  return card;
}

/** A check-in row's last cell: the time when done, else the picked case's estimate, else what it does. */
function testCell(r, tests, proj) {
  const t = tests.filter(x => x.week === r.week).pop();
  if (t) return fmtSeconds(t.seconds);
  const v = proj ? (proj.cases[view.pick].find(p => p.week === r.week) || {}).seconds : null;
  return v ? `~${fmtSeconds(v)}` : 'sets pace';
}

function checkInsCard(run, checks, proj, today) {
  const card = el('div', { class: 'lift-card', id: 'run-checks' });
  const t = toISODate(today);
  const next = checks.find(c => !c.result && c.date >= t);
  put(card, el('div', { class: 'row lc-top' }, [el('h3', {}, '5K check-ins'), proj ? el('span', { class: 'muted small' }, `~ ${CASE[view.pick].label.toLowerCase()}`) : null]));
  put(card, el('div', { class: 'rc-checks' }, checks.map(c => {
    const est = proj && !c.result ? (proj.cases[view.pick].find(p => p.week === c.week) || {}).seconds : null;
    const right = c.result
      ? el('b', { class: c.result.flagged ? 'rc-flag' : '' }, `${fmtSeconds(c.result.seconds)}${c.result.flagged ? ' ?' : ''}`)
      : (c === next ? el('span', { class: 'rc-next' }, est ? `Next · ~${fmtSeconds(est)}` : 'Next') : (c.date < t ? el('span', { class: 'muted' }, 'Not run') : (est ? el('span', { class: 'muted' }, `~${fmtSeconds(est)}`) : el('span', { class: 'muted' }, '–'))));
    return el('div', { class: 'rc-check', 'data-week': c.week }, [el('span', {}, [el('b', {}, `Week ${c.week}`), el('span', { class: 'muted' }, ` · ${fmtDate(c.date)}`)]), right]);
  })));
  const goal = run.goal && run.goal.fiveK;
  if (goal) {
    const gs = Math.round(parseMinutes(goal) * 60);
    let line = `Goal ${goal}, a fit 31-year-old's 5K. Your first check-in shows how far off it is.`;
    if (proj) {
      const end = k => proj.cases[k][proj.cases[k].length - 1].seconds;
      const rate = run.projection.perWeek.well;
      if (proj.from.seconds <= gs) line = `Goal ${goal}: reached with ${fmtSeconds(proj.from.seconds)}.`;
      else if (end('well') <= gs) line = `Goal ${goal}: doing well gets there by week 12.`;
      else {
        const more = rate > 0 ? Math.ceil(Math.log(gs / end('well')) / Math.log(1 - rate)) : null;
        line = `Goal ${goal} (a fit 31-year-old). By week 12: steady about ${fmtSeconds(end('steady'))}, doing well about ${fmtSeconds(end('well'))}, ${gap(end('well') - gs)} short.${more ? ` At the doing-well rate, ${goal} is about ${more} weeks past week 12.` : ''}`;
      }
    }
    put(card, el('p', { class: 'small', id: 'run-goal', style: 'margin:8px 0 0' }, line));
  }
  return card;
}

function howIntervals(run, proj) {
  const card = el('div', { class: 'lift-card lift-how', id: 'run-how' });
  const stages = (run.intervals || []).map(i => `${i.reps} × ${i.hardMin} min in weeks ${i.weeks[0]}-${i.weeks[1]}`).join(', ');
  const tw = (run.tests || []).map(t => t.week);
  const per = (run.projection || {}).perWeek || {};
  const at = proj ? proj.from.seconds : null;
  const s = k => (at && per[k] ? ` (about ${Math.round(at * per[k])} s at ${fmtSeconds(at)})` : '');
  put(card,
    el('h3', {}, 'How it moves'),
    el('p', { class: 'small', style: 'margin:0 0 8px' }, `Plan: ${stages}, each fast part followed by easy jogging until your heart rate is under ${(run.hr || {}).easyUnder || 160}. Weeks ${tw.slice(0, -1).join(', ')} and ${tw[tw.length - 1]} are a 5K check-in instead.`),
    el('p', { class: 'small', style: 'margin:0 0 8px' }, 'Each good check-in sets the fast pace for the weeks after it (Daniels\' interval pace for that 5K). A time more than 5% off the last one waits for your OK on the Runs tab.'),
    proj || per.well ? el('ul', { class: 'lift-rules' }, CASES.filter(k => per[k] != null).map(k => el('li', {}, [el('i', { style: `background:${CASE[k].color}` }), el('b', {}, `${CASE[k].label}: `),
      per[k] ? `about ${Math.round(per[k] * 1000) / 10}% faster a week${s(k)}.` : 'no faster from one check-in to the next.']))) : null,
    run.projection && run.projection.say ? el('p', { class: 'muted small', id: 'run-sources', style: 'margin:8px 0 0' }, run.projection.say) : null
  );
  return card;
}

// ---------------------------------------------------------------- run 2: the long run

function longWeeks(st, { run, rows, today }) {
  const { settings, rules } = st.data;
  const card = el('div', { class: 'lift-card lift-chart', id: 'run-chart' });
  const cap = run.distance.capMiles;
  const readout = el('div', { class: 'lc-read', id: 'run-read', 'aria-live': 'polite' });
  const sub = el('div', { class: 'muted small rc-sub', id: 'run-read-sub' });
  const t = toISODate(today);
  const done = rows.filter(r => r.done && r.done.distance);
  const chart = weekChart({
    lines: [{ key: 'plan', color: PLAN_COLOR, on: true, pts: rows.map(r => ({ week: r.week, v: r.miles })) }],
    dots: done.map(r => ({ week: r.week, v: r.done.distance, label: `${Math.round(r.done.distance * 10) / 10}`, below: r.done.distance < r.miles })),
    fmt: v => `${Math.round(v * 10) / 10}`, steps: [0.5, 1, 2],
    refs: cap ? [{ v: cap, color: '#9aa1ad', cls: 'lc-bench', text: `Up to ${cap} mi`, inRange: true, left: true }] : [],
    sel: startWeek(st, rows, settings, today), label: 'Weeks: tap or drag to read one', onSelect: w => select(w, false, true)
  });
  const table = el('table', { class: 'lc-table rc-table', id: 'run-weeks' }, [
    el('tr', {}, [el('th', {}, 'Week'), el('th', {}, 'Weekend'), el('th', {}, 'Plan'), el('th', {}, 'Done')]),
    ...rows.map(r => el('tr', { 'data-week': r.week, onclick: () => select(r.week, true) }, [
      el('td', {}, String(r.week)), el('td', {}, monthDay(r.date)), el('td', {}, `${r.miles} mi`),
      el('td', {}, r.done ? (r.done.distance ? `${Math.round(r.done.distance * 10) / 10} mi` : r.done.type) : (r.past ? 'not run' : ''))
    ]))
  ]);
  const det = el('details', { class: 'lc-more', ...(view.table ? { open: true } : {}) }, [el('summary', {}, 'Every week'), table]);
  det.addEventListener('toggle', () => { view.table = det.open; });
  let sel = startWeek(st, rows, settings, today);
  function select(w, fromUser, fromChart) {
    w = Math.max(1, Math.min(12, w));
    if (!fromChart) { chart.select(w, fromUser); return; } // the chart calls back with fromChart
    sel = w; st.week = w;
    const r = rows[w - 1];
    readout.innerHTML = '';
    put(readout, el('b', {}, `Week ${w}`), el('span', { class: 'muted' }, ` · ${weekendText(r.date)} · `), el('span', {}, `${r.miles} mi`));
    sub.textContent = r.done
      ? (r.done.distance ? `Done: ${runLine(r.done, rules, true) || `${r.done.distance} mi`}.` : `${r.done.type}: it stands in for the long run, with no miles.`)
      : (r.past ? 'Not run. The next one holds the distance.' : (r.now ? 'This weekend.' : (r.start > t ? 'If you run each long run before it.' : '')));
    table.querySelectorAll('tr[data-week]').forEach(tr => tr.classList.toggle('on', Number(tr.dataset.week) === w));
  }
  put(card,
    el('div', { class: 'row lc-top' }, [el('h3', {}, 'The 12 weeks'), el('span', { class: 'rc-key muted small' }, [el('i', { class: 'rc-key-line' }), ' plan ', el('i', { class: 'rc-key-dot' }), ' done'])]),
    readout, sub, chart.node,
    el('p', { class: 'muted small lc-hint' }, 'The line is what each week asks if you run every long run before it; the app works it out again from what you actually run. Tap or drag to read a week.'),
    det);
  select(sel, false);
  return card;
}

function howLong(run, rows) {
  const d = run.distance;
  const card = el('div', { class: 'lift-card lift-how', id: 'run-how' });
  const reach = rows.find(r => r.miles >= d.capMiles);
  put(card,
    el('h3', {}, 'How it moves'),
    el('p', { class: 'small', style: 'margin:0 0 8px' }, `Plan: start at ${d.startMiles} mi, then each long run is up to ${d.stepMiles} mi, and never more than ${Math.round((d.maxJump || 0) * 100)}%, past the longest run of any kind in the last ${d.windowDays || 30} days, up to ${d.capMiles} mi. A missed week holds the distance.${reach ? ` Run each one and you reach ${d.capMiles} mi in week ${reach.week}.` : ''}`),
    el('p', { class: 'small', style: 'margin:0 0 8px' }, `${run.effort}. A ski day stands in for it but adds no miles.`),
    el('p', { class: 'muted small', id: 'run-sources', style: 'margin:0' }, `Why ${Math.round((d.maxJump || 0) * 100)}%: among 5,205 runners on Garmin, one run 10-30% longer than their longest in the previous 30 days raised injury risk 64%, and over twice as long more than doubled it (Frandsen et al., Br J Sports Med 2025). ${run.hr && run.hr.easy ? `Heart rate ${run.hr.easy[0]}-${run.hr.easy[1]} keeps it easy for a max near 189 (Daniels' easy zone, RunnersConnect, Powers & Howley).` : ''}`)
  );
  return card;
}
