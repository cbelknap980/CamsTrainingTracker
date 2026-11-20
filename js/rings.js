// rings.js (v1.14) - the week at a glance: three rings on Home and on Session done.
// Lifts done of the plan's three, runs done of the two planned, and hard efforts (the Wednesday Engine finisher
// and the interval run) of two. Rules for what counts are in rules.json under "weekRings".

import { el } from './ui.js';
import { weekRuns } from './runs.js';

const NS = 'http://www.w3.org/2000/svg';

/**
 * What the week holds so far. Returns [{ key, label, done, of, detail }] in ring order.
 * A lift counts once per week when a session for it is saved (complete or ended early). The Engine counts when
 * the saved Lift 2 has engine minutes (sessions saved before v1.14 count when Lift 2 was completed).
 */
export function weekRings({ plan, rules, settings, sessions, runs, week, today }) {
  const cfg = (rules && rules.weekRings) || {};
  const inWeek = (sessions || []).filter(s => s.week === week && !s.catchUp);
  const liftIds = plan.sessions.map(s => s.id);
  const liftsDone = liftIds.filter(id => inWeek.some(s => s.sessionId === id));
  const rows = weekRuns({ plan, settings, runs: runs || [], week, today });
  const runsDone = rows.filter(r => r.status === 'done');
  const engineSession = cfg.engineSession || 'lift2';
  const engineDone = inWeek.some(s => s.sessionId === engineSession && (s.engineMinutes > 0 || (s.engineMinutes == null && s.status === 'complete')));
  const hardRun = cfg.hardRun || 'run1';
  const intervalsDone = runsDone.some(r => r.id === hardRun);
  const hard = [engineDone ? 'Engine' : null, intervalsDone ? 'Intervals' : null].filter(Boolean);
  return [
    { key: 'lifts', label: 'Lifts', done: liftsDone.length, of: liftIds.length,
      detail: liftsDone.length ? plan.sessions.filter(s => liftsDone.includes(s.id)).map(s => (s.name.split(': ')[1] || s.name)).join(', ') : 'None yet' },
    { key: 'runs', label: 'Runs', done: runsDone.length, of: rows.length || (plan.runs || []).length,
      detail: runsDone.length ? runsDone.map(r => r.short).join(', ') : 'None yet' },
    { key: 'hard', label: 'Hard efforts', done: hard.length, of: 2, detail: hard.length ? hard.join(', ') : 'Engine and Intervals to come' }
  ];
}

/** One ring as inline SVG; `k` is 0 to 1. */
function ring(k, cls) {
  const r = 26, c = 2 * Math.PI * r;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('class', 'wk-ring ' + cls); svg.setAttribute('aria-hidden', 'true');
  const bg = document.createElementNS(NS, 'circle');
  Object.entries({ cx: 32, cy: 32, r, class: 'wk-ring-bg' }).forEach(([a, v]) => bg.setAttribute(a, v));
  const fg = document.createElementNS(NS, 'circle');
  Object.entries({ cx: 32, cy: 32, r, class: 'wk-ring-fg', 'stroke-dasharray': c.toFixed(1), 'stroke-dashoffset': (c * (1 - Math.max(0, Math.min(1, k)))).toFixed(1), transform: 'rotate(-90 32 32)' }).forEach(([a, v]) => fg.setAttribute(a, v));
  svg.append(bg, fg);
  return svg;
}

/** The card: three rings with the count inside and the label under. onOpen(key) runs on a tap. */
export function ringsCard(rings, { week, onOpen, compact } = {}) {
  return el('div', { class: 'card wk-rings' + (compact ? ' compact' : ''), id: compact ? null : 'week-rings' }, [
    compact ? null : el('h3', {}, `Week ${week} so far`),
    el('div', { class: 'wk-ring-row' }, rings.map(r => el(onOpen ? 'button' : 'div', {
      type: onOpen ? 'button' : null, class: 'ring-btn' + (r.done >= r.of && r.of ? ' full' : ''), 'data-ring': r.key,
      'aria-label': `${r.label}: ${r.done} of ${r.of}. ${r.detail}`,
      onclick: onOpen ? () => onOpen(r.key) : null
    }, [
      el('span', { class: 'wk-ring-wrap' }, [ring(r.of ? r.done / r.of : 0, 'r-' + r.key), el('span', { class: 'wk-ring-num' }, [String(r.done), el('small', {}, `/${r.of}`)])]),
      el('span', { class: 'wk-ring-label' }, r.label)
    ])))
  ]);
}
