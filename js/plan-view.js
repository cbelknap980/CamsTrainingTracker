// plan-view.js - v1.9 Plan tab: goals in order, the 12 weeks, this week day by day, every session as planned with
// next targets, and the coach check-in thread. Reads the plan data and what the app stores; writes only check-ins.
// v1.18.3: on the phone (under 1000 px wide) the tab splits into Week, Sessions, Goals and Check-ins, one at a time,
// with one session shown at a time (Cameron, Nov 22: "too busy and requires too much scrolling", picked option B).
// A computer keeps every card on one page in two columns. Nothing here changes the plan or a target.

import { el, showModal, closeModal } from './ui.js';
import { projectExercise } from './projection.js';
import { fmtWeight, fmtDate, repsText, weekNumber, phaseForWeek, parseISODate, toISODate } from './data.js';
import { TAGS, thread } from './coach.js';
import { countsFor } from './runs.js';

const DAYS = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['0', 'Sun']];
const when = iso => { const d = new Date(iso); return `${fmtDate(toISODate(d))}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`; };

function goalsCard(goals) {
  return el('div', { class: 'card', id: 'plan-goals' }, [
    el('h3', {}, 'Goals, most important first'),
    el('ol', { class: 'goal-list' }, goals.goals.map(g => el('li', {}, [el('b', {}, g.name), el('div', { class: 'muted' }, g.measure)]))),
    el('h3', { style: 'margin-top:14px' }, 'How the plan works'),
    el('ul', { class: 'lines' }, goals.rules.map(r => el('li', {}, r)))
  ]);
}

function weeksCard(plan, week) {
  const cells = [];
  for (let w = 1; w <= 12; w++) {
    const ph = phaseForWeek(plan, w);
    cells.push(el('div', { class: `wk-cell ph-${ph.id}` + (w === week ? ' now' : '') + (w < week ? ' past' : ''), title: `Week ${w}: ${ph.name}` }, `${w}`));
  }
  return el('div', { class: 'card', id: 'plan-weeks' }, [
    el('h3', {}, '12 weeks'),
    el('div', { class: 'wk-strip' }, cells),
    el('div', { class: 'phase-list' }, plan.phases.map(ph => el('div', { class: 'phase-row' + (ph.weeks.includes(week) ? ' now' : '') }, [
      el('span', { class: `phase-dot ph-${ph.id}` }),
      el('div', {}, [el('b', {}, `${ph.name} `), el('span', { class: 'muted' }, ph.weeks.length > 1 ? `weeks ${ph.weeks[0]}–${ph.weeks[ph.weeks.length - 1]}` : `week ${ph.weeks[0]}`), el('div', { class: 'muted' }, ph.note)])
    ])))
  ]);
}

function thisWeekCard(plan, settings, sessions, runs, today, week, onPick) {
  const start = parseISODate(settings.startDate);
  start.setDate(start.getDate() + (week - 1) * 7);
  const todayIso = toISODate(today);
  const weekEndDate = new Date(start); weekEndDate.setDate(start.getDate() + 6);
  const weekEnd = toISODate(weekEndDate);
  const rows = DAYS.map(([dow], i) => {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const iso = toISODate(d);
    const id = plan.calendar[dow];
    const lift = id ? plan.sessions.find(s => s.id === id) : null;
    const run = id ? plan.runs.find(r => r.id === id) : null;
    const done = lift ? sessions.find(s => s.sessionId === id && s.week === week) : (run ? runs.find(r => r.date >= toISODate(start) && r.date <= weekEnd && countsFor(plan, r, run)) : null); // v1.12: a run done on another day of the week still counts; v1.18.1: a Garmin run only once he counts it
    const status = done ? 'done' : (iso < todayIso && (lift || run) ? 'missed' : '');
    const pick = onPick && (lift || run) ? () => onPick(lift ? lift.id : 'runs') : null;
    return el('div', { class: 'day-row' + (iso === todayIso ? ' today' : '') + (pick ? ' tappable' : ''), 'data-day': dow, ...(pick ? { role: 'button', tabindex: '0', onclick: pick, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } } } : {}) }, [
      el('span', { class: 'day-name' }, d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })),
      el('span', {}, lift ? lift.name : (run ? run.name : el('span', { class: 'muted' }, 'Rest or make-up day'))),
      el('span', { class: 'day-status ' + status }, status === 'done' ? '✓ done' : (status === 'missed' ? 'not logged' : (iso === todayIso ? 'today' : '')))
    ]);
  });
  return el('div', { class: 'card', id: 'plan-week' }, [el('h3', {}, `Week ${week}, day by day`), ...rows]);
}

function sessionCard(plan, s, targets, restAdjust, onEx) {
  const adj = restAdjust || {};
  const whole = adj[`session:${s.id}`] || 0;
  const rows = [];
  for (const b of s.blocks) {
    if (b.type === 'warmup' || b.type === 'stretch') {
      rows.push(el('tr', { class: 'blk' }, [el('td', { colspan: 3 }, `${b.name} · ${b.minutes} min`)]));
      continue;
    }
    if (b.type === 'emom') {
      const st = b.stations || [];
      rows.push(el('tr', { class: 'blk' }, [el('td', { colspan: 3 }, `${b.name} · EMOM about ${b.minutes} min${b.room ? ` · ${b.room}` : ''}`)]));
      st.forEach((x, i) => rows.push(el('tr', {}, [el('td', { colspan: 3 }, [el('div', {}, `Minute ${i + 1}: ${x.name}`), x.cue ? el('div', { class: 'muted small' }, x.cue) : null])])));
      continue;
    }
    const label = b.type === 'finisher' ? `Finisher · ${b.rounds} rounds` : (b.type === 'iftime' ? 'If there is time' : `${b.name} · ${b.type === 'superset' ? 'superset' : 'straight sets'}`);
    rows.push(el('tr', { class: 'blk' }, [el('td', { colspan: 3 }, label)]));
    for (const it of b.items || []) {
      if (!it.exercise) continue;
      const ex = plan.exercises[it.exercise] || { name: it.exercise };
      const t = targets[it.exercise];
      const baseRest = it.restSeconds || b.roundRestSeconds || 0;
      const d = (adj[it.exercise] || 0) + whole;
      const rest = baseRest ? `${baseRest + d} s rest${d ? ` (${d > 0 ? '+' : ''}${d} from check-ins)` : ''}` : '';
      const tap = onEx ? () => onEx(it.exercise) : null;
      rows.push(el('tr', { 'data-ex': it.exercise, ...(tap ? { class: 'tappable', role: 'button', tabindex: '0', onclick: tap, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } } } : {}) }, [
        el('td', {}, [el('div', {}, ex.name), rest ? el('div', { class: 'muted small' }, rest) : null]),
        el('td', { class: 'num' }, `${it.sets ? it.sets + ' × ' : ''}${it.reps ? repsText(it.reps) : (ex.timed ? 'hold' : '')}`),
        el('td', { class: 'num' }, t && t.weight != null ? [`${fmtWeight(t.weight)} lb`, t.source === 'coach' ? el('span', { class: 'badge coach' }, 'coach') : null] : el('span', { class: 'muted' }, '–'))
      ]));
    }
  }
  return el('div', { class: 'card plan-session', 'data-session': s.id }, [
    el('div', { class: 'row' }, [el('h2', { style: 'margin:0' }, s.name), el('span', { class: 'muted' }, `${s.day} · about ${s.plannedMinutes} min`)]),
    s.goal ? el('p', { class: 'muted', style: 'margin:6px 0 0' }, s.goal) : null,
    el('table', { class: 'plan-table' }, [el('tr', {}, [el('th', {}, 'Exercise'), el('th', { class: 'num' }, 'Sets × reps'), el('th', { class: 'num' }, 'Next')]), ...rows]),
    onEx ? el('p', { class: 'muted small', style: 'margin:8px 0 0' }, 'Tap an exercise to see where it could be by week 12.') : null
  ]);
}

function runsCard(plan) {
  return el('div', { class: 'card', id: 'plan-runs' }, [
    el('h3', {}, 'Runs'),
    ...plan.runs.map(r => el('p', {}, [el('b', {}, `${r.name} `), el('span', { class: 'muted' }, `${r.day} · ${r.plannedMinutes} min. ${r.note}`)]))
  ]);
}

/** The check-in thread and, on the phone, the box to write one. */
function checkinCard(data, opts) {
  const { plan, checkins, coachFile, sessions } = data;
  const items = thread(checkins, coachFile);
  const list = el('div', { class: 'chat', id: 'chat-list' }, items.length ? items.map(m => el('div', { class: `msg ${m.from}`, 'data-from': m.from }, [
    el('div', { class: 'msg-meta' }, [m.from === 'you' ? 'You' : (m.from === 'coach' ? 'Coach' : 'App'), ' · ', when(m.at),
      m.from === 'you' && (m.exerciseId || m.sessionId) ? ` · ${m.exerciseId ? (plan.exercises[m.exerciseId] || {}).name : (plan.sessions.find(s => s.id === m.sessionId) || {}).name}` : '']),
    m.from === 'you' && m.tags && m.tags.length ? el('div', { class: 'msg-tags' }, m.tags.map(t => el('span', { class: 'tag' }, (TAGS.find(x => x.id === t) || { label: t }).label))) : null,
    m.text ? el('div', { class: 'msg-text' }, m.text) : null
  ])) : [el('p', { class: 'muted', style: 'margin:0' }, 'No check-ins yet. After a session, say how it felt: a lift that was too heavy, rests that dragged, a knee that talked. Nothing here is required. The app keeps adjusting from your logged sets either way.')]);

  if (!opts.canWrite) {
    return el('div', { class: 'card', id: 'checkin' }, [
      el('h3', {}, 'Coach check-ins'),
      list,
      el('p', { class: 'muted card-foot' }, 'Write check-ins on the phone so they sync with everything else. This computer shows them.')
    ]);
  }

  // what it is about: the latest session's exercises first, then the rest
  const latest = sessions[0];
  const recentIds = latest ? [...new Set(latest.sets.filter(st => st.exerciseId && !st.ramp).map(st => st.exerciseId))] : [];
  const about = el('select', { id: 'checkin-about' }, [
    el('option', { value: '' }, 'Nothing specific'),
    el('optgroup', { label: 'Session' }, plan.sessions.map(s => el('option', { value: `session:${s.id}`, selected: latest && latest.sessionId === s.id && latest.date === toISODate(new Date()) }, s.name))),
    recentIds.length ? el('optgroup', { label: `From ${latest.sessionName || 'the last session'}` }, recentIds.filter(id => plan.exercises[id]).map(id => el('option', { value: id }, plan.exercises[id].name))) : null,
    el('optgroup', { label: 'All exercises' }, Object.entries(plan.exercises).filter(([id]) => !recentIds.includes(id)).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, ex]) => el('option', { value: id }, ex.name)))
  ]);
  const text = el('textarea', { id: 'checkin-text', rows: '3', placeholder: 'How did it feel?' });
  const picked = new Set();
  const tagRow = el('div', { class: 'tag-row', id: 'checkin-tags' });
  const send = el('button', { class: 'btn primary', id: 'checkin-send', disabled: true }, 'Send');
  const drawTags = () => {
    const v = about.value;
    const isEx = v && !v.startsWith('session:');
    tagRow.innerHTML = '';
    TAGS.forEach(t => {
      const off = (t.needs === 'exercise' && !isEx) || (t.needs === 'any' && !v);
      if (off) picked.delete(t.id);
      tagRow.appendChild(el('button', { type: 'button', class: 'tag-btn' + (picked.has(t.id) ? ' on' : ''), 'data-tag': t.id, disabled: off, title: off ? (t.needs === 'exercise' ? 'Pick an exercise first' : 'Pick an exercise or session first') : '', onclick: () => {
        if (picked.has(t.id)) picked.delete(t.id); else {
          picked.add(t.id);
          const opposite = { too_heavy: 'too_light', too_light: 'too_heavy', rest_long: 'rest_short', rest_short: 'rest_long' }[t.id];
          if (opposite) picked.delete(opposite);
        }
        drawTags();
      } }, t.label));
    });
    send.disabled = !text.value.trim() && !picked.size;
  };
  about.addEventListener('change', drawTags);
  text.addEventListener('input', () => { send.disabled = !text.value.trim() && !picked.size; });
  send.addEventListener('click', async () => {
    const v = about.value;
    send.disabled = true;
    await opts.onSend({
      text: text.value.trim(), tags: [...picked],
      exerciseId: v && !v.startsWith('session:') ? v : null,
      sessionId: v && v.startsWith('session:') ? v.slice(8) : (latest && latest.date === toISODate(new Date()) ? latest.sessionId : null)
    });
  });
  drawTags();
  return el('div', { class: 'card', id: 'checkin' }, [
    el('h3', {}, 'Coach check-ins'),
    list,
    el('div', { class: 'composer' }, [
      el('div', { class: 'field' }, [el('label', {}, 'About'), about]),
      tagRow,
      text,
      send,
      el('p', { class: 'muted card-foot' }, 'Too heavy or Too light moves that lift\'s next target one step. Rest tags move its rest 15 s, up to 45 s. The coach review reads every check-in and answers here.')
    ])
  ]);
}

const WIDE = '(min-width: 1000px)';
const PANES = [['week', 'Week'], ['sessions', 'Sessions'], ['goals', 'Goals'], ['coach', 'Check-ins']];
const ui = { pane: 'week', pick: null }; // the phone's open tab and session; kept while the app is open
let last = null;
if (typeof window !== 'undefined' && window.matchMedia) {
  // a window dragged across 1000 px redraws the Plan tab in the other layout, if it is still the one showing
  window.matchMedia(WIDE).addEventListener('change', () => { if (last && last.view.querySelector('.plan-grid, .plan-tabs')) renderPlan(...last.args); });
}

/** The session the phone's Sessions tab opens on: the next lift day from today whose session is not logged yet. */
export function nextSessionId(plan, settings, sessions, today) {
  for (let i = 0; i < 8; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const id = plan.calendar[String(d.getDay())];
    const s = id && plan.sessions.find(x => x.id === id);
    if (s && !sessions.some(x => x.sessionId === id && x.week === weekNumber(d, settings.startDate))) return id;
  }
  return plan.sessions[0].id;
}

export function renderPlan(view, data, opts = {}) {
  last = { view, args: [view, data, opts] };
  const wide = typeof window === 'undefined' || !window.matchMedia || window.matchMedia(WIDE).matches;
  if (!wide) return renderPhone(view, data, opts);
  const { plan, settings, targets, sessions, runs, goals } = data;
  const today = data.today || new Date();
  const week = Math.max(1, Math.min(12, weekNumber(today, settings.startDate)));
  view.innerHTML = '';
  view.appendChild(el('div', { class: 'row' }, [el('h1', {}, 'Plan')]));
  const main = el('div', { class: 'plan-main' }, [
    weeksCard(plan, weekNumber(today, settings.startDate)),
    el('div', { class: 'plan-pair' }, [thisWeekCard(plan, settings, sessions, runs, today, week), goalsCard(goals)]),
    el('h2', { class: 'section-title' }, 'Sessions'),
    ...plan.sessions.map(s => sessionCard(plan, s, targets, settings.restAdjust, id => openProjection(data, id))),
    runsCard(plan)
  ]);
  const side = el('div', { class: 'plan-side' }, [checkinCard(data, opts)]);
  view.appendChild(el('div', { class: 'plan-grid' }, [side, main]));
  const chat = document.getElementById('chat-list');
  if (chat) chat.scrollTop = chat.scrollHeight;
}

/** v1.18.3: the phone's Plan tab. Four tabs, each about one screen. */
function renderPhone(view, data, opts) {
  const { plan, settings, targets, sessions, runs, goals } = data;
  const today = data.today || new Date();
  const week = Math.max(1, Math.min(12, weekNumber(today, settings.startDate)));
  const go = (pane, pick) => { ui.pane = pane; if (pick) ui.pick = pick; renderPhone(view, data, opts); window.scrollTo(0, 0); };
  view.innerHTML = '';
  view.appendChild(el('div', { class: 'row' }, [el('h1', {}, 'Plan')]));
  view.appendChild(el('div', { class: 'segmented plan-seg', id: 'plan-seg', role: 'tablist' }, PANES.map(([k, label]) =>
    el('button', { type: 'button', role: 'tab', 'data-pane': k, 'aria-selected': String(k === ui.pane), class: k === ui.pane ? 'on' : '', onclick: () => go(k) }, label))));
  const pane = el('div', { class: 'plan-tabs', 'data-pane': ui.pane });
  if (ui.pane === 'week') {
    const ph = phaseForWeek(plan, week);
    const strip = weeksCard(plan, week).querySelector('.wk-strip');
    const tw = thisWeekCard(plan, settings, sessions, runs, today, week, id => go('sessions', id));
    tw.querySelector('h3').replaceWith(el('div', { class: 'row wk-head' }, [el('h3', { style: 'margin:0' }, 'This week'), el('span', { class: 'muted small' }, 'Tap a day to see it')]));
    pane.append(
      el('div', { class: 'card', id: 'plan-weeks' }, [
        el('div', { class: 'row wk-head' }, [el('b', {}, `Week ${week} of 12`), el('span', { class: 'wk-phase' }, [el('span', { class: `phase-dot ph-${ph.id}` }), ph.name])]),
        ph.note ? el('p', { class: 'muted wk-note' }, ph.note) : null,
        strip
      ]),
      tw);
  } else if (ui.pane === 'sessions') {
    const ids = [...plan.sessions.map(s => s.id), 'runs'];
    const pick = ids.includes(ui.pick) ? ui.pick : nextSessionId(plan, settings, sessions, today);
    pane.append(el('div', { class: 'plan-chips', id: 'plan-chips' }, ids.map(id => {
      const s = plan.sessions.find(x => x.id === id);
      return el('button', { type: 'button', class: 'plan-chip' + (id === pick ? ' on' : ''), 'data-pick': id, 'aria-pressed': String(id === pick), onclick: () => go('sessions', id) }, s ? s.name.split(':')[0] : 'Runs');
    })));
    const s = plan.sessions.find(x => x.id === pick);
    pane.append(s ? sessionCard(plan, s, targets, settings.restAdjust, id => openProjection(data, id)) : runsCard(plan));
  } else if (ui.pane === 'goals') {
    pane.append(goalsCard(goals), weeksCard(plan, week));
  } else {
    pane.append(checkinCard(data, opts));
  }
  view.appendChild(pane);
  const chat = document.getElementById('chat-list');
  if (chat) chat.scrollTop = chat.scrollHeight;
}

// ---- v1.18.5: tap an exercise for its 12-week projection (Cameron, Nov 24) ----

const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs, kids) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
  for (const k of kids || []) if (k) n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
  return n;
};
const COLORS = { plan: '#c97f0a', slower: '#5b8fe0' };   // checked for colour-blind separation on the sheet's surface

const tText = (p, t) => (!t ? '–' : (p.kind === 'reps' ? `${t.reps} reps` : `${fmtWeight(t.weight)} × ${t.reps}`));

/** The line chart: the target weight (or reps) by week, on plan and slower, with the value at each end labelled. */
function projChart(p) {
  const val = t => (p.kind === 'reps' ? t.reps : t.weight);
  const pts = [{ week: p.weeks[0].week - 1, plan: p.now, slower: p.now }, ...p.weeks];
  const all = pts.flatMap(x => [val(x.plan), val(x.slower)]).filter(v => v != null);
  if (!all.length) return null;
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = Math.max(2, (hi - lo) * 0.12); lo -= pad; hi += pad;
  const W = 340, H = 150, L = 8, R = 46, T = 10, B = 22;
  const x = w => L + (w - pts[0].week) / (12 - pts[0].week) * (W - L - R);
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const line = k => pts.filter(q => val(q[k]) != null).map((q, i) => `${i ? 'L' : 'M'}${x(q.week).toFixed(1)},${y(val(q[k])).toFixed(1)}`).join(' ');
  const g = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': p.kind === 'reps' ? 'Reps by week' : 'Target weight by week' });
  for (const w of [pts[0].week, 7, 12].filter((w, i, a) => a.indexOf(w) === i && w >= pts[0].week)) {
    g.appendChild(svgEl('line', { x1: x(w), x2: x(w), y1: T, y2: H - B, stroke: 'rgba(255,255,255,0.08)', 'stroke-width': 1 }));
    g.appendChild(svgEl('text', { x: x(w), y: H - 6, 'text-anchor': w === pts[0].week ? 'start' : 'middle', fill: '#9aa1ad', 'font-size': 11 }, [w === pts[0].week ? 'now' : `wk ${w}`]));
  }
  const endP = val(p.end.plan), endS = val(p.end.slower);
  for (const k of ['slower', 'plan']) {
    g.appendChild(svgEl('path', { d: line(k), fill: 'none', stroke: COLORS[k], 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const v = val(p.end[k]);
    g.appendChild(svgEl('circle', { cx: x(12), cy: y(v), r: 4, fill: COLORS[k], stroke: '#23272f', 'stroke-width': 2 }));
  }
  const yP = y(endP), yS = y(endS);
  const apart = Math.abs(yP - yS) >= 13;
  g.appendChild(svgEl('text', { x: x(12) + 8, y: (apart ? yP : Math.min(yP, yS) - 2) + 4, fill: '#f3f4f6', 'font-size': 12, 'font-weight': 700 }, [fmtWeight(endP)]));
  if (apart) g.appendChild(svgEl('text', { x: x(12) + 8, y: yS + 4, fill: '#9aa1ad', 'font-size': 12 }, [fmtWeight(endS)]));
  const v0 = val(p.now);
  g.appendChild(svgEl('circle', { cx: x(pts[0].week), cy: y(v0), r: 4, fill: '#f3f4f6', stroke: '#23272f', 'stroke-width': 2 }));
  return g;
}

function openProjection(data, exerciseId) {
  const { plan, rules, settings, sessions, targets } = data;
  const ex = plan.exercises[exerciseId] || { name: exerciseId };
  const p = rules ? projectExercise({ plan, rules, settings, sessions, targets, exerciseId, today: data.today || new Date() }) : null;
  const close = el('button', { class: 'btn', style: 'margin-top:12px', onclick: () => closeModal() }, 'Close');
  if (!p || p.kind === 'self') {
    const why = p && p.kind === 'self'
      ? `The power clean moves when you go heavier on your doubles; the app does not raise it by itself, so there is nothing to project. Now: ${tText({ kind: 'weight' }, p.now)}.`
      : 'No target yet, so there is nothing to project. It starts from the first session you log.';
    showModal(el('div', { class: 'proj', id: 'proj-sheet' }, [el('h2', {}, ex.name), el('p', {}, why), close]));
    return;
  }
  const e1 = t => (p.kind === 'weight' && t && t.e1rm ? `est. 1RM ${t.e1rm}` : '');
  const bw = ex.equipment === 'weighted_bw' ? ' (bodyweight in)' : '';
  const box = (label, t, sub) => el('div', {}, [el('small', {}, label), el('b', {}, tText(p, t)), el('div', { class: 'sub' }, sub)]);
  const rows = p.weeks.filter(w => w.week === p.weeks[0].week || w.week % 2 === 0 || w.week === 7 || w.week === 12).filter((w, i, a) => a.findIndex(z => z.week === w.week) === i);
  const chart = projChart(p);
  showModal(el('div', { class: 'proj', id: 'proj-sheet' }, [
    el('h2', {}, ex.name),
    el('div', { class: 'muted small' }, `${p.sessionsLeft} sessions left in the 12 weeks`),
    el('div', { class: 'proj-now' }, [
      box('Now', p.now, e1(p.now) + (e1(p.now) ? bw : '')),
      box(p.weekly ? 'Week 12, best case' : 'Week 12, on plan', p.end.plan, e1(p.end.plan))
    ]),
    chart,
    chart ? el('div', { class: 'proj-key' }, [
      el('span', {}, [el('i', { style: `background:${COLORS.plan}` }), p.weekly ? 'Best case' : 'On plan']),
      el('span', {}, [el('i', { style: `background:${COLORS.slower}` }), p.weekly ? 'Steady' : 'Slower']),
      el('span', {}, p.kind === 'reps' ? 'reps' : (ex.equipment === 'weighted_bw' ? 'lb added' : (ex.pair ? 'lb, both dumbbells' : 'lb')))
    ]) : null,
    el('table', { id: 'proj-table' }, [
      el('tr', {}, [el('th', {}, 'Target after week'), el('th', {}, p.weekly ? 'Best case' : 'On plan'), el('th', {}, p.weekly ? 'Steady' : 'Slower')]),
      ...rows.map(w => el('tr', {}, [el('td', {}, `${w.week}${w.phase === 'light' ? ' (lighter)' : (w.phase === 'heavy' && p.mainLift ? ' (heavier)' : '')}`), el('td', {}, tText(p, w.plan)), el('td', {}, tText(p, w.slower))]))
    ]),
    el('p', {}, p.weekly ? `Best case: every set makes its reps at Solid or easier every week, so the weight goes up every week. Steady: that happens every other week. A Hard week holds the weight, and so does a missed rep. Both use the app's own rules (week 7 holds, weeks 8-11 start 5% heavier at 3 reps, week 12 is the retest). Expect to land between the two, closer to best case early on.` : `On plan: every set makes its reps at Solid or easier. Slower: every other session falls a rep short, so it moves about half as often. Both use the app's own rules, the same ones that set your targets after each session${p.mainLift ? ' (week 7 holds, weeks 8-11 start 5% heavier at 3-5 reps, week 12 is the retest)' : ''}. Real progress usually lands between the two${p.mainLift ? '' : ', and small lifts tend to slow down before the end'}.`),
    close
  ]));
}
