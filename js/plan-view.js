// plan-view.js - v1.9 Plan tab: goals in order, the 12 weeks, this week day by day, every session as planned with
// next targets, and the coach check-in thread. Reads the plan data and what the app stores; writes only check-ins.

import { el } from './ui.js';
import { fmtWeight, fmtDate, repsText, weekNumber, phaseForWeek, parseISODate, toISODate } from './data.js';
import { TAGS, thread } from './coach.js';

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

function thisWeekCard(plan, settings, sessions, runs, today, week) {
  const start = parseISODate(settings.startDate);
  start.setDate(start.getDate() + (week - 1) * 7);
  const todayIso = toISODate(today);
  const rows = DAYS.map(([dow], i) => {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const iso = toISODate(d);
    const id = plan.calendar[dow];
    const lift = id ? plan.sessions.find(s => s.id === id) : null;
    const run = id ? plan.runs.find(r => r.id === id) : null;
    const done = lift ? sessions.find(s => s.sessionId === id && s.week === week) : (run ? runs.find(r => r.date >= toISODate(start) && r.date <= iso && (r.planId === id || r.type === run.type)) : null);
    const status = done ? 'done' : (iso < todayIso && (lift || run) ? 'missed' : '');
    return el('div', { class: 'day-row' + (iso === todayIso ? ' today' : '') }, [
      el('span', { class: 'day-name' }, d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })),
      el('span', {}, lift ? lift.name : (run ? run.name : el('span', { class: 'muted' }, 'Rest or make-up day'))),
      el('span', { class: 'day-status ' + status }, status === 'done' ? '✓ done' : (status === 'missed' ? 'not logged' : (iso === todayIso ? 'today' : '')))
    ]);
  });
  return el('div', { class: 'card', id: 'plan-week' }, [el('h3', {}, `Week ${week}, day by day`), ...rows]);
}

function sessionCard(plan, s, targets, restAdjust) {
  const adj = restAdjust || {};
  const whole = adj[`session:${s.id}`] || 0;
  const rows = [];
  for (const b of s.blocks) {
    if (b.type === 'warmup' || b.type === 'stretch') {
      rows.push(el('tr', { class: 'blk' }, [el('td', { colspan: 3 }, `${b.name} · ${b.minutes} min`)]));
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
      rows.push(el('tr', { 'data-ex': it.exercise }, [
        el('td', {}, [el('div', {}, ex.name), rest ? el('div', { class: 'muted small' }, rest) : null]),
        el('td', { class: 'num' }, `${it.sets ? it.sets + ' × ' : ''}${it.reps ? repsText(it.reps) : (ex.timed ? 'hold' : '')}`),
        el('td', { class: 'num' }, t && t.weight != null ? [`${fmtWeight(t.weight)} lb`, t.source === 'coach' ? el('span', { class: 'badge coach' }, 'coach') : null] : el('span', { class: 'muted' }, '–'))
      ]));
    }
  }
  return el('div', { class: 'card plan-session', 'data-session': s.id }, [
    el('div', { class: 'row' }, [el('h2', { style: 'margin:0' }, s.name), el('span', { class: 'muted' }, `${s.day} · about ${s.plannedMinutes} min`)]),
    s.goal ? el('p', { class: 'muted', style: 'margin:6px 0 0' }, s.goal) : null,
    el('table', { class: 'plan-table' }, [el('tr', {}, [el('th', {}, 'Exercise'), el('th', { class: 'num' }, 'Sets × reps'), el('th', { class: 'num' }, 'Next')]), ...rows])
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

export function renderPlan(view, data, opts = {}) {
  const { plan, settings, targets, sessions, runs, goals } = data;
  const today = data.today || new Date();
  const week = Math.max(1, Math.min(12, weekNumber(today, settings.startDate)));
  view.innerHTML = '';
  view.appendChild(el('div', { class: 'row' }, [el('h1', {}, 'Plan')]));
  const main = el('div', { class: 'plan-main' }, [
    weeksCard(plan, weekNumber(today, settings.startDate)),
    el('div', { class: 'plan-pair' }, [thisWeekCard(plan, settings, sessions, runs, today, week), goalsCard(goals)]),
    el('h2', { class: 'section-title' }, 'Sessions'),
    ...plan.sessions.map(s => sessionCard(plan, s, targets, settings.restAdjust)),
    runsCard(plan)
  ]);
  const side = el('div', { class: 'plan-side' }, [checkinCard(data, opts)]);
  view.appendChild(el('div', { class: 'plan-grid' }, [side, main]));
  const chat = document.getElementById('chat-list');
  if (chat) chat.scrollTop = chat.scrollHeight;
}
