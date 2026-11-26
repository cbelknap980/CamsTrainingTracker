// plan-view.js - v1.9 Plan tab: goals in order, the 12 weeks, this week day by day, every session as planned with
// next targets, and the coach check-in thread. Reads the plan data and what the app stores; writes only check-ins.
// v1.18.3: on the phone (under 1000 px wide) the tab splits into Week, Sessions, Goals and Check-ins, one at a time,
// with one session shown at a time (Cameron, Nov 22: "too busy and requires too much scrolling", picked option B).
// A computer keeps every card on one page in two columns.
// v1.18.11: each session is one line a lift (sets x reps, weight, a chevron); a tap opens the lift page
// (lift-detail.js), which can set the next target or a week-12 goal through opts.saveTarget and opts.saveGoal.
// v1.18.14 (Cameron, Nov 25: "This page still feels clunky"): on a computer the page leads with today's session, flags
// what this week has not logged and where it still fits, puts the other days on one line each (a click opens one),
// shows the phases on the week strip, and keeps goals, check-ins and an "About this plan" fold in a right column.

import { el, infoBtn } from './ui.js';
import { nextNumbers, nextWeekOf } from './lift-goal.js';
import { openLiftDetail } from './lift-detail.js';
import { fmtWeight, fmtDate, repsText, weekNumber, phaseForWeek, parseISODate, toISODate } from './data.js';
import { TAGS, thread } from './coach.js';
import { countsFor, weekRuns, weekRange, openRunDays, runLine } from './runs.js';
import { stationFor, emomMinutesFor } from './builder.js';

const DAYS = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['0', 'Sun']];
const when = iso => { const d = new Date(iso); return `${fmtDate(toISODate(d))}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`; };

function goalsCard(goals, withRules = true) {
  return el('div', { class: 'card', id: 'plan-goals' }, [
    el('h3', {}, 'Goals, most important first'),
    el('ol', { class: 'goal-list' }, goals.goals.map(g => el('li', {}, [el('b', {}, g.name), el('div', { class: 'muted' }, g.measure)]))),
    withRules ? el('h3', { style: 'margin-top:14px' }, 'How the plan works') : null,
    withRules ? el('ul', { class: 'lines' }, goals.rules.map(r => el('li', {}, r))) : null
  ]);
}

const phaseList = (plan, week) => el('div', { class: 'phase-list' }, plan.phases.map(ph => el('div', { class: 'phase-row' + (ph.weeks.includes(week) ? ' now' : '') }, [
  el('span', { class: `phase-dot ph-${ph.id}` }),
  el('div', {}, [el('b', {}, `${ph.name} `), el('span', { class: 'muted' }, ph.weeks.length > 1 ? `weeks ${ph.weeks[0]}–${ph.weeks[ph.weeks.length - 1]}` : `week ${ph.weeks[0]}`), el('div', { class: 'muted' }, ph.note)])
])));

function weeksCard(plan, week) {
  const cells = [];
  for (let w = 1; w <= 12; w++) {
    const ph = phaseForWeek(plan, w);
    cells.push(el('div', { class: `wk-cell ph-${ph.id}` + (w === week ? ' now' : '') + (w < week ? ' past' : ''), title: `Week ${w}: ${ph.name}` }, `${w}`));
  }
  return el('div', { class: 'card', id: 'plan-weeks' }, [
    el('h3', {}, '12 weeks'),
    el('div', { class: 'wk-strip' }, cells),
    phaseList(plan, week)
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

// v1.18.11 (Cameron, Nov 25: "The base view should just be weight and sets. Make more compact. When we click in then
// show detail and plan. Also provide a button or [cue] to show I can click in for more details."): one line per lift,
// its sets x reps and weight for the next time that session comes round, and a chevron. Rest, the plan's rep range,
// the chart and the goal are one tap in (lift-detail.js).
const chevron = () => {
  const NS = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(NS, 'svg');
  g.setAttribute('viewBox', '0 0 16 16'); g.setAttribute('aria-hidden', 'true');
  const pth = document.createElementNS(NS, 'path');
  pth.setAttribute('d', 'M6 3.5 10.5 8 6 12.5'); pth.setAttribute('fill', 'none'); pth.setAttribute('stroke', 'currentColor');
  pth.setAttribute('stroke-width', '2'); pth.setAttribute('stroke-linecap', 'round'); pth.setAttribute('stroke-linejoin', 'round');
  g.appendChild(pth);
  return g;
};

/** What one row shows: { sets, weight } as text for the next time, from the plan item and the stored target. */
export function rowNumbers(data, it, b, t, phaseId) {
  const ex = data.plan.exercises[it.exercise] || { name: it.exercise };
  const n = nextNumbers(data, it, b, t, phaseId);
  let reps = '';
  if (ex.timed || n.hold) reps = 'hold';
  else if (n.reps != null) reps = String(n.reps);
  else if (n.range) reps = repsText(n.range);
  const weight = n.weight != null ? `${ex.equipment === 'weighted_bw' ? '+' : ''}${fmtWeight(n.weight)} lb` : (ex.equipment === 'bodyweight' || ex.timed || n.hold ? 'bw' : '');
  return { sets: n.sets ? `${n.sets} × ${reps}` : reps, weight };
}

function sessionCard(data, s, onEx) {
  const { plan, settings, targets, sessions } = data;
  const week = nextWeekOf(plan, settings, sessions, s.id, data.today || new Date());
  const phaseId = phaseForWeek(plan, week).id;
  const rows = [];
  for (const b of s.blocks) {
    if (b.type === 'warmup' || b.type === 'stretch') {
      rows.push(el('div', { class: 'ex-blk ex-blk-quiet' }, `${b.name} · ${b.minutes} min`));
      continue;
    }
    if (b.type === 'emom') {
      const st = b.stations || [];
      // v1.21.0: the stations of the coming week (the rower and the sled in their weeks), or that week's benchmark
      const wk = emomMinutesFor(b, week);
      if (wk.test) {
        rows.push(el('div', { class: 'ex-blk' }, `${b.name} · benchmark, up to ${Math.round(wk.test.seconds / 60)} min${b.room ? ` · ${b.room}` : ''}`));
        rows.push(el('div', { class: 'ex-emom' }, [el('span', {}, wk.test.name), wk.test.cue ? el('span', { class: 'muted' }, wk.test.cue) : null]));
        continue;
      }
      rows.push(el('div', { class: 'ex-blk' }, `${b.name} · EMOM ${wk.minutes || b.minutes} min${b.room ? ` · ${b.room}` : ''}`));
      st.forEach((x0, i) => {
        const x = stationFor(x0, week);
        const other = x0.alt ? (x === x0 ? `Weeks ${x0.alt.weeks.join(', ')}: ${x0.alt.name}.` : `Other weeks: ${x0.name}.`) : '';
        rows.push(el('div', { class: 'ex-emom' }, [el('span', {}, `Minute ${i + 1}: ${x.name}`), x.cue ? el('span', { class: 'muted' }, `${x.cue}${other ? ' ' + other : ''}`) : null]));
      });
      continue;
    }
    const label = b.type === 'finisher' ? `Finisher · ${b.rounds} rounds` : (b.type === 'iftime' ? 'If there is time' : `${b.name} · ${b.type === 'superset' ? 'superset' : 'straight sets'}`);
    rows.push(el('div', { class: 'ex-blk' }, label));
    for (const it of b.items || []) {
      if (!it.exercise) continue;
      const ex = plan.exercises[it.exercise] || { name: it.exercise };
      const n = rowNumbers(data, it, b, targets[it.exercise], phaseId);
      const tap = onEx ? () => onEx(it.exercise, s.id) : null;
      rows.push(el(tap ? 'button' : 'div', { class: 'ex-row', 'data-ex': it.exercise, ...(tap ? { type: 'button', onclick: tap, 'aria-label': `${ex.name}, ${n.sets}${n.weight ? `, ${n.weight}` : ''}. Open for the plan and chart.` } : {}) }, [
        el('span', { class: 'ex-name' }, [ex.name, ex.slow ? el('span', { class: 'slow-tag', title: ex.slow }, 'Slow') : null]),
        el('span', { class: 'ex-sets' }, n.sets),
        el('span', { class: 'ex-wt' + (n.weight === 'bw' || !n.weight ? ' muted' : '') }, n.weight || '–'),
        tap ? el('span', { class: 'ex-go' }, chevron()) : null
      ]));
    }
  }
  const ph = phaseForWeek(plan, week);
  return el('div', { class: 'card plan-session', 'data-session': s.id }, [
    el('div', { class: 'ps-head' }, [
      el('h2', {}, s.name),
      s.goal ? infoBtn(s.name, s.goal, `What ${s.name} is for`) : null
    ]),
    el('div', { class: 'muted ps-sub' }, `${s.day} · about ${s.plannedMinutes} min · week ${week}${ph.id !== 'build' && ph.id !== 'baseline' ? `, ${ph.name.toLowerCase()}` : ''}`),
    onEx ? el('div', { class: 'ps-hint' }, ['Next time. Tap a lift for its plan and chart ', el('span', { class: 'ex-go mini' }, chevron())]) : null,
    el('div', { class: 'ex-list' }, rows)
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
const ui = { pane: 'week', pick: null, wideOpen: new Set(), aboutOpen: false }; // the phone's open tab and session, the computer's open rows; kept while the app is open
let last = null;
if (typeof window !== 'undefined' && window.matchMedia) {
  // a window dragged across 1000 px redraws the Plan tab in the other layout, if it is still the one showing
  window.matchMedia(WIDE).addEventListener('change', () => { if (last && last.view.querySelector('.plan-cols, .plan-tabs')) renderPlan(...last.args); });
}

/** The next lift day from today whose session is not logged yet: { id, iso }, or null. */
function nextLift(plan, settings, sessions, today) {
  for (let i = 0; i < 8; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const id = plan.calendar[String(d.getDay())];
    const s = id && plan.sessions.find(x => x.id === id);
    const w = weekNumber(d, settings.startDate);
    if (s && w >= 1 && !sessions.some(x => x.sessionId === id && x.week === w)) return { id, iso: toISODate(d) };
  }
  return null;
}

/** The session the phone's Sessions tab opens on: the next lift day from today whose session is not logged yet. */
export function nextSessionId(plan, settings, sessions, today) {
  const n = nextLift(plan, settings, sessions, today);
  return n ? n.id : plan.sessions[0].id;
}

// ---- v1.18.14: the computer page ----
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const monthDay = iso => parseISODate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const dayShort = iso => { const d = parseISODate(iso); return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getDate()}`; }; // "Mon 23"
const orList = a => (a.length > 1 ? `${a.slice(0, -1).join(', ')} or ${a[a.length - 1]}` : a[0]);
const workSets = rec => (rec.sets || []).filter(x => x.done && !x.ramp).length;
const liftCount = s => s.blocks.filter(b => b.items && b.type !== 'warmup' && b.type !== 'stretch' && b.type !== 'emom' && b.type !== 'iftime').reduce((n, b) => n + b.items.filter(it => it.exercise).length, 0);
// "Fast: 7:45-8:15 per mile ..." with the label in bold, as on Home
const runLinePart = t => { const i = t.indexOf(': '); return i > 0 && i < 12 ? el('p', {}, [el('b', {}, t.slice(0, i + 1) + ' '), t.slice(i + 2)]) : el('p', {}, t); };

/**
 * This week's planned lifts and runs in day order, each with where it stands: 'done', 'today', 'later' or 'missed'
 * (its day has passed with nothing logged). A run done on another day counts, as on Home and the Runs tab.
 */
export function weekItems(data, week, today) {
  const { plan, settings, sessions, runs } = data;
  const { start } = weekRange(settings, week);
  const todayIso = toISODate(today);
  const runRows = weekRuns({ plan, settings, runs, week, today });
  const out = [];
  DAYS.forEach(([dow], i) => {
    const d = parseISODate(start); d.setDate(d.getDate() + i);
    const iso = toISODate(d);
    const id = plan.calendar[dow];
    const lift = id && plan.sessions.find(s => s.id === id);
    if (lift) {
      const rec = sessions.filter(s => s.sessionId === id && s.week === week).sort((a, b) => workSets(b) - workSets(a))[0] || null;
      out.push({ kind: 'lift', id, iso, dow: Number(dow), name: lift.name, lift, rec, status: rec ? 'done' : (iso < todayIso ? 'missed' : (iso === todayIso ? 'today' : 'later')) });
      return;
    }
    const row = id && runRows.find(r => r.id === id);
    if (row) out.push({ kind: 'run', id, iso, dow: Number(dow), name: row.name, row, status: { done: 'done', today: 'today', open: 'missed', later: 'later' }[row.status] });
  });
  return out;
}

/** What the page leads with: today's lift or run if it is not logged yet, otherwise the next lift. */
function upNext(data, items, today) {
  const { plan, settings, sessions } = data;
  const todayIso = toISODate(today);
  const t = items.find(x => x.status === 'today');
  if (t) return { item: t, tag: `Today · ${fmtDate(todayIso)}` };
  const n = nextLift(plan, settings, sessions, today);
  if (!n) return null;
  const item = items.find(x => x.kind === 'lift' && x.id === n.id && x.iso === n.iso) || { kind: 'lift', id: n.id, iso: n.iso, lift: plan.sessions.find(s => s.id === n.id) };
  return { item, tag: `${n.iso === todayIso ? 'Today' : 'Next'} · ${fmtDate(n.iso)}` };
}

/** A planned run's ask: the main line, then its Fast / Easy / warm-up lines, and what was logged if it is done. */
function runPanel(data, r) {
  return el('div', { class: 'rw-run' }, [
    el('p', { class: 'run-ask' }, r.plan.text),
    r.plan.lines ? el('div', { class: 'run-lines' }, r.plan.lines.map(runLinePart)) : (r.plan.detail ? el('p', { class: 'muted' }, r.plan.detail) : null),
    r.run ? el('p', { class: 'muted run-logged' }, `Logged: ${runLine(r.run, data.rules)}`) : null
  ]);
}

/**
 * Change 2: whatever this week has not logged, with the days it still fits. A run goes by rules.runSchedule (as on
 * Home); a lift by the free days left, where Home offers a catch-up. One button to the page where it is done.
 */
function missedCard(data, items, week, today, opts) {
  const { plan, rules, settings } = data;
  const missed = items.filter(x => x.status === 'missed');
  if (!missed.length) return null;
  const todayIso = toISODate(today);
  const { start } = weekRange(settings, week);
  const free = DAYS.map(([dow], i) => { const d = parseISODate(start); d.setDate(d.getDate() + i); return { dow: Number(dow), iso: toISODate(d) }; })
    .filter(x => !plan.calendar[String(x.dow)] && x.iso >= todayIso);
  return el('div', { class: 'card plan-missed', id: 'plan-missed', role: 'status' }, missed.map(x => {
    const days = x.kind === 'run'
      ? openRunDays({ plan, rules, settings, runId: x.id, week, today }).map(d => (d.today ? 'today' : d.name))
      : free.map(d => (d.iso === todayIso ? 'today' : DAY_NAMES[d.dow]));
    const fits = days.length ? `It still fits ${orList(days)}.` : 'No day is left for it this week. It drops on Sunday night.';
    const tab = x.kind === 'run' ? 'runs' : 'home';
    return el('div', { class: 'miss-row', 'data-missed': x.id }, [
      el('p', {}, [el('b', {}, `${x.name} isn't logged. `), x.kind === 'run' ? `${x.row.plan.text}. ` : '', fits]),
      opts.onTab ? el('button', { type: 'button', class: 'btn small', 'data-go': tab, onclick: () => opts.onTab(tab) }, tab === 'runs' ? 'Open Runs' : 'Open Home') : null
    ]);
  }));
}

/** Change 1: today's session (or the next one) first, with its lifts and weights. */
function todayCard(data, up, onEx) {
  const x = up.item;
  const tag = el('span', { class: 'today-tag' }, up.tag);
  if (x.kind === 'run') {
    const run = data.plan.runs.find(r => r.id === x.id) || {};
    return el('div', { class: 'card plan-today', id: 'plan-today', 'data-run': x.id }, [
      tag,
      el('div', { class: 'ps-head' }, [el('h2', {}, x.name)]),
      el('div', { class: 'muted ps-sub' }, `${run.day} · about ${run.plannedMinutes} min`),
      runPanel(data, x.row)
    ]);
  }
  const card = sessionCard(data, x.lift, onEx);
  card.id = 'plan-today';
  card.classList.add('plan-today');
  card.prepend(tag);
  return card;
}

/** Change 3: the other days of the week, one line each; a click opens the session (or run) under its line. */
function restOfWeek(data, items, skip, onEx) {
  const { plan, settings, rules } = data;
  const rows = items.filter(x => x !== skip).map(x => {
    let detail;
    let panel;
    if (x.kind === 'lift') {
      detail = x.rec ? `${workSets(x.rec)} sets${x.rec.status !== 'complete' ? ' · ended early' : ''}` : `${liftCount(x.lift)} lifts · about ${x.lift.plannedMinutes} min`;
      panel = () => sessionCard(data, x.lift, onEx);
    } else {
      detail = x.row.run ? runLine(x.row.run, rules, true) : x.row.plan.text;
      panel = () => runPanel(data, x.row);
    }
    const open = ui.wideOpen.has(x.id);
    const box = el('div', { class: 'rw-panel', hidden: !open }, open ? panel() : null);
    const btn = el('button', { type: 'button', class: 'rw-row', 'data-item': x.id, 'aria-expanded': String(open), onclick: () => {
      const show = box.hidden;
      if (show && !box.firstChild) box.appendChild(panel());
      box.hidden = !show;
      btn.setAttribute('aria-expanded', String(show));
      if (show) ui.wideOpen.add(x.id); else ui.wideOpen.delete(x.id);
    } }, [
      el('span', { class: 'day-name' }, dayShort(x.iso)),
      el('span', { class: 'rw-what' }, [el('b', {}, x.name), detail ? el('span', { class: 'muted' }, detail) : null]),
      el('span', { class: 'day-status ' + x.status }, { done: '✓ done', missed: 'not logged', today: 'today' }[x.status] || ''),
      el('span', { class: 'rw-chev' }, chevron())
    ]);
    return el('div', { class: 'rw-item', 'data-status': x.status }, [btn, box]);
  });
  const { start } = weekRange(settings, items.length ? weekNumber(parseISODate(items[0].iso), settings.startDate) : 1);
  const rest = DAYS.map(([dow], i) => { const d = parseISODate(start); d.setDate(d.getDate() + i); return { dow, iso: toISODate(d) }; }).filter(x => !plan.calendar[x.dow]);
  if (rest.length) rows.push(el('div', { class: 'rw-rest' }, [el('span', { class: 'day-name' }, rest.map(x => parseISODate(x.iso).toLocaleDateString(undefined, { weekday: 'short' })).join(', ')), el('span', { class: 'muted' }, 'Rest or make-up days')]));
  return el('div', { class: 'card', id: 'plan-rest' }, [el('h3', {}, skip ? 'Rest of the week' : 'This week'), ...rows]);
}

/** Change 4 (part): one strip for weeks and phases. Phase names over their weeks, each week's start date under it. */
function stripCard(plan, settings, week) {
  const cells = plan.phases.map(ph => el('div', { class: `wk-ph ph-${ph.id}`, style: `grid-column:${ph.weeks[0]} / ${ph.weeks[ph.weeks.length - 1] + 1}`, title: ph.note }, ph.name));
  for (let w = 1; w <= 12; w++) {
    const ph = phaseForWeek(plan, w);
    const { start } = weekRange(settings, w);
    cells.push(el('div', { class: `wk-cell ph-${ph.id}` + (w === week ? ' now' : '') + (w < week ? ' past' : ''), style: `grid-column:${w}`, title: `Week ${w}: ${ph.name}, from ${fmtDate(start)}` }, [el('b', {}, String(w)), el('small', {}, monthDay(start))]));
  }
  return el('div', { class: 'card plan-strip', id: 'plan-weeks' }, [el('div', { class: 'wk-strip wk-strip-wide' }, cells)]);
}

/** Change 10: the text that reads the same every week, behind one fold. */
function aboutCard(plan, goals, week) {
  const d = el('details', { class: 'card plan-about', id: 'plan-about', open: ui.aboutOpen }, [
    el('summary', {}, [el('span', { class: 'about-title' }, [el('b', {}, 'About this plan'), el('span', { class: 'muted' }, 'Phases, how the plan works, what each session and run is for')])]),
    el('div', { class: 'about-body' }, [
      el('h3', {}, 'Phases'),
      phaseList(plan, week),
      el('h3', {}, 'How the plan works'),
      el('ul', { class: 'lines' }, goals.rules.map(r => el('li', {}, r))),
      el('h3', {}, 'What each session is for'),
      ...plan.sessions.map(s => el('p', {}, [el('b', {}, `${s.name}. `), el('span', { class: 'muted' }, s.goal || '')])),
      el('h3', {}, 'Runs'),
      ...plan.runs.map(r => el('p', {}, [el('b', {}, `${r.name}. `), el('span', { class: 'muted' }, `${r.day} · ${r.plannedMinutes} min. ${r.note}`)]))
    ])
  ]);
  d.addEventListener('toggle', () => { ui.aboutOpen = d.open; });
  return d;
}

/** "Week 2 of 12 · Baseline · Nov 23 – 29 · 1 of 5 done so far" */
function weekLine(plan, settings, raw, week, items) {
  if (raw < 1) return `Starts ${fmtDate(settings.startDate)}`;
  const { start, end } = weekRange(settings, week);
  const range = start.slice(0, 7) === end.slice(0, 7) ? `${monthDay(start)} – ${Number(end.slice(8))}` : `${monthDay(start)} – ${monthDay(end)}`;
  const done = items.filter(x => x.status === 'done').length;
  return `Week ${week} of 12 · ${phaseForWeek(plan, week).name} · ${range} · ${done} of ${items.length} done${raw > 12 ? '' : ' so far'}`;
}

export function renderPlan(view, data, opts = {}) {
  last = { view, args: [view, data, opts] };
  const wide = typeof window === 'undefined' || !window.matchMedia || window.matchMedia(WIDE).matches;
  if (!wide) return renderPhone(view, data, opts);
  const { plan, settings, goals } = data;
  const today = data.today || new Date();
  const raw = weekNumber(today, settings.startDate);
  const week = Math.max(1, Math.min(12, raw));
  const items = weekItems(data, week, today);
  const up = upNext(data, items, today);
  const onEx = (id, sessionId) => openLiftDetail(data, id, { ...opts, sessionId });
  view.innerHTML = '';
  view.appendChild(el('div', { class: 'row plan-top' }, [el('h1', {}, 'Plan'), el('span', { class: 'muted plan-sub', id: 'plan-sub' }, weekLine(plan, settings, raw, week, items))]));
  view.appendChild(stripCard(plan, settings, raw));
  // v1.18.14 change 9: two columns all the way down. Today and the week on the left; check-ins, goals and the
  // reference fold on the right.
  const left = el('div', { class: 'plan-left' }, [
    missedCard(data, items, week, today, opts),
    up ? todayCard(data, up, onEx) : null,
    restOfWeek(data, items, up && up.item, onEx)
  ]);
  const rail = el('div', { class: 'plan-rail' }, [checkinCard(data, opts), goalsCard(goals, false), aboutCard(plan, goals, raw)]);
  view.appendChild(el('div', { class: 'plan-cols' }, [left, rail]));
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
      missedCard(data, weekItems(data, week, today), week, today, opts) || '',
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
    pane.append(s ? sessionCard(data, s, (id, sessionId) => openLiftDetail(data, id, { ...opts, sessionId })) : runsCard(plan));
  } else if (ui.pane === 'goals') {
    pane.append(goalsCard(goals), weeksCard(plan, week));
  } else {
    pane.append(checkinCard(data, opts));
  }
  view.appendChild(pane);
  const chat = document.getElementById('chat-list');
  if (chat) chat.scrollTop = chat.scrollHeight;
}
