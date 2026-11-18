// progress.js - Progress page (v1.6): where the 12 weeks stand, estimated 1RM per benchmark lift over time,
// personal records, work sets per week and how the accessories have moved. Reads what the app already stores.
// The helpers at the top are pure (tested in node); the rendering is below them.

import { epley } from './progression.js';
import { el } from './ui.js';
import { fmtWeight, fmtDate, weekNumber, phaseForWeek, parseISODate } from './data.js';
import { owedSetsFor } from './catchup.js';

const WEEKS = 12;
const isWork = st => !st.ramp && st.done && !st.skipped;
const oldestFirst = sessions => [...sessions].sort((a, b) => String(a.startedAt || a.date).localeCompare(String(b.startedAt || b.date)));

/** Best estimated 1RM per session for each benchmark lift, oldest first, with the change from the first session. */
export function strengthSeries(sessions, plan, settings) {
  const asc = oldestFirst(sessions);
  const out = [];
  for (const [id, ex] of Object.entries(plan.exercises)) {
    if (!ex.benchmark) continue;
    const bw = ex.equipment === 'weighted_bw' ? ((settings && settings.bodyweightLb) || 0) : 0;
    const points = [];
    for (const s of asc) {
      let best = null;
      for (const st of s.sets || []) {
        if (st.exerciseId !== id || !isWork(st) || st.weight == null || !st.reps || st.holdSeconds) continue;
        const e = epley(st.weight + bw, st.reps);
        if (!best || e > best.e1rm) best = { e1rm: e, weight: st.weight, reps: st.reps };
      }
      if (best) points.push({ date: s.date, week: s.week, ...best });
    }
    if (!points.length) continue;
    const first = points[0].e1rm;
    const last = points[points.length - 1].e1rm;
    out.push({ id, name: ex.name, addsBodyweight: bw > 0, points, first, last, delta: last - first, pct: first ? Math.round(1000 * (last - first) / first) / 10 : 0 });
  }
  return out;
}

/**
 * One cell per planned lift per week: 'done', 'partial' (ended early), 'missed' (a past week with nothing logged),
 * 'open' (this week, not done yet) or 'later'.
 */
export function adherence(sessions, plan, settings, today) {
  const current = weekNumber(today, settings.startDate);
  const rows = plan.sessions.map(l => {
    const cells = [];
    for (let w = 1; w <= WEEKS; w++) {
      const recs = sessions.filter(s => s.sessionId === l.id && s.week === w);
      let status;
      if (recs.some(r => r.status === 'complete')) status = 'done';
      else if (recs.length) status = owedSetsFor(plan, sessions, l.id, w) === 0 ? 'done' : 'partial'; // v1.8: made up on a catch-up day
      else status = w < current ? 'missed' : (w === current ? 'open' : 'later');
      cells.push({ week: w, status, date: recs.length ? recs[0].date : null });
    }
    return { id: l.id, name: l.name, short: l.name.includes(': ') ? l.name.split(': ')[1] : l.name, cells };
  });
  const all = rows.flatMap(r => r.cells);
  return { current, rows, logged: all.filter(c => c.status === 'done' || c.status === 'partial').length, missed: all.filter(c => c.status === 'missed').length };
}

/** Work sets completed in each week of the block (ramp-ups and skipped sets do not count). */
export function weeklySets(sessions) {
  const out = [];
  for (let w = 1; w <= WEEKS; w++) out.push({ week: w, sets: 0, sessions: 0 });
  for (const s of sessions) {
    const row = out[s.week - 1];
    if (!row) continue;
    row.sessions += 1;
    row.sets += (s.sets || []).filter(isWork).length;
  }
  return out;
}

/** Every non-benchmark exercise that has been logged: its top set in the first session and in the latest one. */
export function accessoryRows(sessions, plan) {
  const asc = oldestFirst(sessions);
  const rows = [];
  for (const [id, ex] of Object.entries(plan.exercises)) {
    if (ex.benchmark) continue;
    const tops = [];
    for (const s of asc) {
      let top = null;
      for (const st of s.sets || []) {
        if (st.exerciseId !== id || !isWork(st) || st.reps == null) continue;
        const better = !top || (st.weight || 0) > (top.weight || 0) || ((st.weight || 0) === (top.weight || 0) && st.reps > top.reps);
        if (better) top = { weight: st.weight, reps: st.reps, holdSeconds: st.holdSeconds || null };
      }
      if (top) tops.push({ date: s.date, ...top });
    }
    if (tops.length) rows.push({ id, name: ex.name, sessions: tops.length, first: tops[0], last: tops[tops.length - 1] });
  }
  return rows;
}

/**
 * v1.9: work sets per muscle group. A main muscle counts a full set, a helper half. `planned` is what one normal week
 * of the plan holds (sets, or rounds for finishers; if-time extras left out), so done can be read against it.
 */
export function muscleSets(sessions, plan, muscles, week) {
  const credit = (id, n, into) => {
    const m = muscles.exercises[id];
    if (!m) return;
    (m.main || []).forEach(g => { into[g] = (into[g] || 0) + n; });
    (m.helper || []).forEach(g => { into[g] = (into[g] || 0) + n / 2; });
  };
  const planned = {};
  for (const sess of plan.sessions) for (const b of sess.blocks) {
    if (b.type === 'iftime') continue;
    for (const it of b.items || []) if (it.exercise) credit(it.exercise, it.sets || b.rounds || 0, planned);
  }
  const done = {}, last = {};
  for (const ss of sessions) {
    const into = ss.week === week ? done : (ss.week === week - 1 ? last : null);
    if (!into) continue;
    for (const st of ss.sets || []) if (isWork(st)) credit(st.exerciseId, 1, into);
  }
  return muscles.groups.map(g => ({ id: g.id, name: g.name, arms: !!g.arms, done: done[g.id] || 0, lastWeek: last[g.id] || 0, planned: planned[g.id] || 0 }));
}

/** Personal records from saved sessions, newest first. */
export function prList(sessions) {
  const out = [];
  for (const s of sessions) for (const p of s.prs || []) out.push({ date: s.date, ...p });
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// ---- charts (inline SVG; marks in --viz, text in the text colors) ----
const NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, text) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}
const shortDate = iso => parseISODate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Three clean y ticks that contain every value. */
export function yTicks(values, step = 5) {
  let lo = Math.floor(Math.min(...values) / step) * step;
  let hi = Math.ceil(Math.max(...values) / step) * step;
  if (hi === lo) { lo -= step; hi += step; }
  if (((hi - lo) / step) % 2) hi += step; // keep the middle tick on a clean number
  return [lo, (lo + hi) / 2, hi];
}

export function tooltip(wrap) {
  const tip = el('div', { class: 'viz-tip', hidden: true });
  wrap.appendChild(tip);
  return {
    show(xFrac, strong, lines) {
      tip.innerHTML = '';
      tip.appendChild(el('b', {}, strong));
      lines.forEach(l => tip.appendChild(el('span', {}, l)));
      tip.hidden = false;
      tip.style.left = `${Math.min(78, Math.max(22, xFrac * 100))}%`;
    },
    hide() { tip.hidden = true; }
  };
}

/** One series over time: 2px line, ringed dots, value at the end, crosshair and tooltip on hover or focus. */
function lineChart(points, label) {
  const W = 320, H = 132, L = 36, R = 44, T = 12, B = 22;
  const wrap = el('div', { class: 'viz' });
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${label}: ${points.map(p => `${shortDate(p.date)} ${p.e1rm} lb`).join(', ')}` });
  const ticks = yTicks(points.map(p => p.e1rm));
  const t0 = parseISODate(points[0].date).getTime();
  const t1 = parseISODate(points[points.length - 1].date).getTime();
  const x = p => (t1 === t0 ? (L + W - R) / 2 : L + (parseISODate(p.date).getTime() - t0) * (W - L - R) / (t1 - t0));
  const y = v => H - B - (v - ticks[0]) * (H - T - B) / (ticks[2] - ticks[0]);
  ticks.forEach(t => {
    root.appendChild(svg('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: 'viz-grid' }));
    root.appendChild(svg('text', { x: L - 6, y: y(t) + 3.5, 'text-anchor': 'end', class: 'viz-axis' }, `${t}`));
  });
  root.appendChild(svg('text', { x: x(points[0]), y: H - 6, 'text-anchor': points.length > 1 ? 'start' : 'middle', class: 'viz-axis' }, shortDate(points[0].date)));
  if (points.length > 1) root.appendChild(svg('text', { x: x(points[points.length - 1]), y: H - 6, 'text-anchor': 'end', class: 'viz-axis' }, shortDate(points[points.length - 1].date)));
  const cross = svg('line', { y1: T, y2: H - B, class: 'viz-cross', visibility: 'hidden' });
  root.appendChild(cross);
  if (points.length > 1) root.appendChild(svg('path', { d: points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)} ${y(p.e1rm).toFixed(1)}`).join(' '), class: 'viz-line' }));
  const dots = points.map(p => { const c = svg('circle', { cx: x(p), cy: y(p.e1rm), r: 4, class: 'viz-dot' }); root.appendChild(c); return c; });
  const lastP = points[points.length - 1];
  root.appendChild(svg('text', { x: x(lastP) + 9, y: y(lastP.e1rm) + 4, class: 'viz-value' }, `${lastP.e1rm}`));
  wrap.appendChild(root);
  const tip = tooltip(wrap);
  const pick = i => {
    const p = points[i];
    cross.setAttribute('x1', x(p)); cross.setAttribute('x2', x(p)); cross.setAttribute('visibility', 'visible');
    dots.forEach((d, j) => d.setAttribute('r', j === i ? 5.5 : 4));
    tip.show(x(p) / W, `${p.e1rm} lb`, [`${fmtDate(p.date)} · week ${p.week}`, `best set ${fmtWeight(p.weight)} lb × ${p.reps}`]);
  };
  const clear = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('r', 4)); tip.hide(); };
  const nearest = ev => {
    const r = root.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width * W;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(x(p) - px) < Math.abs(x(points[best]) - px)) best = i; });
    pick(best);
  };
  root.addEventListener('pointermove', nearest);
  root.addEventListener('pointerdown', nearest);
  root.addEventListener('pointerleave', clear);
  // keyboard: each point takes focus and shows the same readout
  points.forEach((p, i) => {
    const hit = svg('circle', { cx: x(p), cy: y(p.e1rm), r: 13, class: 'viz-hit', tabindex: 0, 'aria-label': `${shortDate(p.date)}: ${p.e1rm} lb` });
    hit.addEventListener('focus', () => pick(i));
    hit.addEventListener('blur', clear);
    root.appendChild(hit);
  });
  return wrap;
}

/** Work sets per week: one thin column per week, rounded at the top, value on the latest column, tooltip on each. */
function weekBars(rows, current) {
  const W = 320, H = 150, L = 30, R = 8, T = 16, B = 24;
  const wrap = el('div', { class: 'viz' });
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Work sets per week: ${rows.filter(r => r.sets).map(r => `week ${r.week} ${r.sets}`).join(', ')}` });
  const ticks = yTicks([0, Math.max(10, ...rows.map(r => r.sets))], 10);
  const band = (W - L - R) / rows.length;
  const bw = Math.min(24, band - 6);
  const y = v => H - B - v * (H - T - B) / ticks[2];
  ticks.forEach(t => {
    root.appendChild(svg('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: 'viz-grid' }));
    root.appendChild(svg('text', { x: L - 6, y: y(t) + 3.5, 'text-anchor': 'end', class: 'viz-axis' }, `${t}`));
  });
  wrap.appendChild(root);
  const tip = tooltip(wrap);
  const latest = [...rows].reverse().find(r => r.sets);
  rows.forEach((r, i) => {
    const cx = L + band * i + band / 2;
    root.appendChild(svg('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'viz-axis' + (r.week === current ? ' now' : '') }, `${r.week}`));
    if (!r.sets) return;
    const x0 = cx - bw / 2, top = y(r.sets), base = y(0), rad = Math.min(4, (base - top) / 2);
    const bar = svg('path', { d: `M${x0} ${base}V${top + rad}Q${x0} ${top} ${x0 + rad} ${top}H${x0 + bw - rad}Q${x0 + bw} ${top} ${x0 + bw} ${top + rad}V${base}Z`, class: 'viz-bar', tabindex: 0, 'aria-label': `Week ${r.week}: ${r.sets} work sets` });
    const show = () => { bar.classList.add('on'); tip.show(cx / W, `${r.sets} work sets`, [`week ${r.week} · ${r.sessions} ${r.sessions === 1 ? 'session' : 'sessions'}`]); };
    const hide = () => { bar.classList.remove('on'); tip.hide(); };
    bar.addEventListener('pointerenter', show); bar.addEventListener('pointerdown', show); bar.addEventListener('pointerleave', hide);
    bar.addEventListener('focus', show); bar.addEventListener('blur', hide);
    root.appendChild(bar);
    if (latest && r.week === latest.week) root.appendChild(svg('text', { x: cx, y: top - 5, 'text-anchor': 'middle', class: 'viz-value' }, `${r.sets}`));
  });
  return wrap;
}

const CELL = { done: '✓', partial: '~', missed: '×', open: '', later: '' };
const CELL_WORD = { done: 'done', partial: 'ended early', missed: 'missed', open: 'this week', later: 'to come' };

function statusCard(a, plan, runs) {
  const phase = phaseForWeek(plan, a.current);
  const inBlock = a.current >= 1 && a.current <= WEEKS;
  const miles = runs.reduce((m, r) => m + (r.distance || 0), 0);
  const grid = el('div', { class: 'adh', role: 'table', 'aria-label': 'Planned lifts by week' }, [
    el('div', { class: 'adh-row head', role: 'row' }, [el('span', { class: 'adh-name' }, 'Week'), ...a.rows[0].cells.map(c => el('span', { class: 'adh-wk' + (c.week === a.current ? ' now' : '') }, `${c.week}`))]),
    ...a.rows.map(r => el('div', { class: 'adh-row', role: 'row' }, [
      el('span', { class: 'adh-name' }, r.short),
      ...r.cells.map(c => el('span', { class: `adh-cell ${c.status}` + (c.week === a.current ? ' now' : ''), title: `${r.name}, week ${c.week}: ${CELL_WORD[c.status]}${c.date ? ' (' + fmtDate(c.date) + ')' : ''}`, 'aria-label': `${r.short} week ${c.week} ${CELL_WORD[c.status]}` }, CELL[c.status]))
    ]))
  ]);
  return el('div', { class: 'card', id: 'progress-status' }, [
    el('h3', {}, 'Where you are'),
    el('h1', {}, inBlock ? `Week ${a.current} of ${WEEKS} · ${phase.name}` : phase.name),
    el('p', { class: 'muted' }, `${a.logged} ${a.logged === 1 ? 'lift' : 'lifts'} logged${a.missed ? `, ${a.missed} missed` : ', none missed'}${runs.length ? ` · ${runs.length} ${runs.length === 1 ? 'run' : 'runs'}${miles ? ', ' + (Math.round(miles * 10) / 10) + ' mi' : ''}` : ''}.`),
    grid,
    el('div', { class: 'adh-key' }, [
      el('span', {}, [el('span', { class: 'adh-cell done' }, '✓'), 'done']),
      el('span', {}, [el('span', { class: 'adh-cell partial' }, '~'), 'ended early']),
      el('span', {}, [el('span', { class: 'adh-cell missed' }, '×'), 'missed']),
      el('span', {}, [el('span', { class: 'adh-cell open' }, ''), 'this week']),
      el('span', {}, [el('span', { class: 'adh-cell later' }, ''), 'to come'])
    ])
  ]);
}

function strengthCard(s, target, onOpen) {
  const up = s.delta > 0, flat = s.delta === 0;
  const one = s.points.length < 2;
  const change = one ? `estimated 1RM from ${shortDate(s.points[0].date)}` : (flat ? 'no change since the first session' : `${up ? '+' : '−'}${Math.abs(s.delta)} lb (${up ? '+' : '−'}${Math.abs(s.pct)}%) since ${shortDate(s.points[0].date)}`);
  // v1.9: with one session a chart is a lone dot, so show the set it came from and what is next instead
  const p = s.points[0];
  const baseline = one ? el('div', { class: 'baseline-box' }, [
    el('div', {}, [el('div', { class: 'label' }, 'Best set'), el('div', { class: 'baseline-num' }, `${fmtWeight(p.weight)} × ${p.reps}`)]),
    el('div', {}, [el('div', { class: 'label' }, 'Next time'), el('div', { class: 'baseline-num' }, target && target.weight != null ? `${fmtWeight(target.weight)} × ${target.reps != null ? target.reps : '–'}` : '–')])
  ]) : null;
  const card = el('div', { class: 'card strength-card' + (onOpen ? ' tappable' : ''), 'data-ex': s.id, ...(onOpen ? { tabindex: 0, role: 'button', 'aria-label': `${s.name}: every set` } : {}) }, [
    el('div', { class: 'row' }, [el('b', {}, s.name), el('span', { class: 'e1rm-now' }, [`${s.last}`, el('small', {}, ' lb')])]),
    el('div', { class: 'muted change' + (!one && !flat ? (up ? ' up' : ' down') : '') }, [!one && !flat ? el('span', { class: 'arrow' }, up ? '↑ ' : '↓ ') : null, change]),
    one ? baseline : lineChart(s.points, `${s.name} estimated 1RM`),
    el('div', { class: 'muted card-foot' }, one ? 'The trend line starts with the second session. Click or tap for every set.' : 'Click or tap for every set.')
  ]);
  if (onOpen) {
    card.addEventListener('click', e => { if (!e.target.closest('.viz-hit')) onOpen(s.id); });
    card.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); onOpen(s.id); } });
  }
  return card;
}

/** v1.9: sets per muscle group this week against what the plan holds, with the 10-set mark. */
function muscleCard(rows, week, muscles) {
  const mark = muscles.weeklyTarget.sets;
  const max = Math.max(mark + 2, ...rows.map(r => Math.max(r.planned, r.done)));
  const pct = v => `${(100 * v / max).toFixed(1)}%`;
  const fmt = v => (Math.round(v * 2) / 2).toString();
  return el('div', { class: 'card', id: 'muscle-sets' }, [
    el('h3', {}, `Sets per muscle group, week ${week}`),
    el('div', { class: 'muscle-list' }, rows.map(r => el('div', { class: 'muscle-row' + (r.arms ? ' arms' : ''), 'data-group': r.id, title: `${r.name}: ${fmt(r.done)} done this week, ${fmt(r.planned)} in the plan, ${fmt(r.lastWeek)} last week` }, [
      el('span', { class: 'muscle-name' }, r.name),
      el('span', { class: 'muscle-track' }, [
        el('span', { class: 'muscle-plan', style: `width:${pct(r.planned)}` }),
        el('span', { class: 'muscle-done', style: `width:${pct(r.done)}` }),
        el('span', { class: 'muscle-mark', style: `left:${pct(mark)}` })
      ]),
      el('span', { class: 'muscle-num' }, [el('b', {}, fmt(r.done)), el('span', { class: 'muted' }, ` of ${fmt(r.planned)}`)])
    ]))),
    el('div', { class: 'muscle-key muted' }, [
      el('span', {}, [el('span', { class: 'sw done' }), 'done this week']),
      el('span', {}, [el('span', { class: 'sw plan' }), 'in the plan each week']),
      el('span', {}, [el('span', { class: 'sw mark' }), `${mark} sets`])
    ]),
    el('div', { class: 'muted card-foot', title: muscles.weeklyTarget.source }, `Main muscle counts a set, a helper half (rows help biceps, presses help triceps). The line is ${mark} sets a week, a common mark for size (Schoenfeld 2017).`)
  ]);
}

/**
 * Draw the Progress page. `data` = { plan, rules, settings, sessions, runs, today }; `opts.onLoadBackup(file)` is
 * offered when the app is not installed (a computer browser), so the phone's backup can be opened there.
 */
export function renderProgress(view, data, opts = {}) {
  const { plan, settings, sessions, runs } = data;
  const today = data.today || new Date();
  view.innerHTML = '';
  view.appendChild(opts.header || el('div', { class: 'row' }, [el('h1', {}, 'Progress')]));

  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: e => { const f = e.target.files[0]; if (f && opts.onLoadBackup) opts.onLoadBackup(f); } });
  // v1.9: sync status moved to the header; the load-backup card shows only when sync is off
  const syncCard = opts.syncOn ? true : null;
  const loadCard = syncCard || !opts.onLoadBackup ? null : el('div', { class: 'card', id: 'load-backup' }, [
    el('h3', {}, 'On a computer'),
    el('p', { class: 'muted' }, sessions.length ? 'Workouts are logged on the phone. To refresh what you see here, load the newest backup file from the phone. It replaces the copy in this browser.' : 'Workouts are logged on the phone. To see them here, back up on the phone (Settings, Back up), then load that file.'),
    el('button', { class: 'btn', style: 'max-width:320px', onclick: () => fileInput.click() }, 'Load backup file'),
    fileInput
  ]);

  if (!sessions.length) {
    view.appendChild(el('div', { class: 'card' }, [el('h2', {}, 'No workouts logged yet'), el('p', { class: 'muted', style: 'margin:0' }, 'After the first saved session this page shows your 12-week status, strength trend per lift and personal records.')]));
    if (loadCard) view.appendChild(loadCard);
    return;
  }

  const a = adherence(sessions, plan, settings, today);
  view.appendChild(statusCard(a, plan, runs || []));

  const series = strengthSeries(sessions, plan, settings);
  if (series.length) {
    view.appendChild(el('h2', { class: 'section-title' }, 'Strength: estimated 1RM'));
    view.appendChild(el('p', { class: 'muted section-note' }, `Your likely one-rep max, worked out from each session's best set (weight × (1 + reps ÷ 30)).${series.some(s => s.addsBodyweight) ? ' Weighted pull-up counts bodyweight plus the added weight.' : ''}`));
    view.appendChild(el('div', { class: 'strength-grid', id: 'strength-grid' }, series.map(x => strengthCard(x, (data.targets || {})[x.id], opts.onExercise))));
  }

  const prs = prList(sessions);
  const acc = accessoryRows(sessions, plan);
  const lower = el('div', { class: 'progress-lower' });
  if (data.muscles) lower.appendChild(muscleCard(muscleSets(sessions, plan, data.muscles, Math.max(1, Math.min(WEEKS, a.current))), Math.max(1, Math.min(WEEKS, a.current)), data.muscles));
  lower.appendChild(el('div', { class: 'card', id: 'weekly-sets' }, [
    el('h3', {}, 'Work sets per week'),
    weekBars(weeklySets(sessions), a.current),
    el('div', { class: 'muted', style: 'font-size:var(--t-small)' }, 'Sets you finished, not counting ramp-ups. Week number along the bottom.')
  ]));
  lower.appendChild(el('div', { class: 'card', id: 'pr-list' }, [
    el('h3', {}, 'Personal records'),
    prs.length ? el('table', {}, prs.slice(0, 12).map(p => el('tr', {}, [
      el('td', {}, [el('div', {}, p.name), el('div', { class: 'muted', style: 'font-size:var(--t-small)' }, fmtDate(p.date))]),
      el('td', { class: 'num' }, p.kind === 'e1rm' ? `est. 1RM ${p.value} lb` : `heaviest ${fmtWeight(p.value)} lb`),
      el('td', { class: 'num muted' }, `was ${fmtWeight(p.prev)}`)
    ]))) : el('p', { class: 'muted', style: 'margin:0' }, 'None yet. A record shows up when you beat a number from an earlier session.')
  ]));
  if (acc.length) {
    const cell = t => (t.holdSeconds ? `${t.reps} s` : `${t.weight != null ? fmtWeight(t.weight) + ' × ' : ''}${t.reps}`);
    lower.appendChild(el('div', { class: 'card', id: 'accessories' }, [
      el('h3', {}, 'Accessories: first session to latest'),
      el('div', { class: 'muted', style: 'font-size:var(--t-small);margin-bottom:4px' }, 'Top set each time, as lb × reps. Two-dumbbell lifts show the total.'),
      el('table', { class: 'acc-table' }, [
        el('tr', {}, [el('th', {}, 'Exercise'), el('th', { class: 'num' }, 'First'), el('th', { class: 'num' }, 'Latest')]),
        ...acc.map(r => el('tr', {}, [el('td', {}, r.name), el('td', { class: 'num muted' }, cell(r.first)), el('td', { class: 'num' }, r.sessions > 1 ? cell(r.last) : '–')]))
      ])
    ]));
  }
  view.appendChild(lower);
  view.appendChild(el('p', { class: 'muted', style: 'font-size:var(--t-small)' }, 'Every set behind these numbers is under Exercises at the top of this page.'));
  if (loadCard) view.appendChild(loadCard);
}
