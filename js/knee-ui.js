// knee-ui.js - v1.19 (idea 1): the knee check on screen. The 0-10 picker sheet, the Home card for the day after a
// leg session, the note on the start page when the swaps are on, and the trend on Progress. Logic is in knee.js.

import { el, showModal, closeModal, toast, infoBtn } from './ui.js';
import { fmtDate } from './data.js';
import { kneeEntry, kneeTrend, sortedLog } from './knee.js';
import { addKneeScore } from './store.js';

/** A grid of 0-10 buttons. onPick gets the number. current marks one. */
export function kneeButtons(onPick, current = null, swapAt = null) {
  return el('div', { class: 'knee-grid', role: 'group', 'aria-label': 'Knee pain, 0 to 10' }, Array.from({ length: 11 }, (_, n) => el('button', {
    type: 'button', class: 'knee-btn' + (n === current ? ' on' : '') + (swapAt != null && n >= swapAt ? ' high' : ''), 'data-score': String(n),
    'aria-label': `Knee pain ${n}`, onclick: () => onPick(n)
  }, String(n))));
}

const SCALE = '0 is no pain, 10 is the worst you can imagine.';
const dayName = iso => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' });

/**
 * The sheet that asks for a score and saves it. when: 'set' | 'morning' | 'before'. extra goes on the entry
 * (sessionId, exerciseId, stepKey). onSaved gets the entry. Returns nothing; the sheet closes itself.
 */
export function askKnee({ rules, title = 'How is the knee?', text, when, extra = {}, current = null, onSaved }) {
  const k = rules.knee;
  const pick = async n => {
    const entry = kneeEntry(n, when, extra);
    await addKneeScore(entry);
    closeModal();
    toast(n >= k.swapAt ? `Knee ${n} saved. The knee swaps are on.` : `Knee ${n} saved`);
    if (onSaved) onSaved(entry);
  };
  showModal(el('div', { class: 'knee-sheet' }, [
    el('h2', {}, title),
    el('p', { class: 'muted' }, text || SCALE),
    kneeButtons(pick, current, k.swapAt),
    el('p', { class: 'muted knee-foot' }, `${k.swapAt} or more switches the squat and clean to their knee versions and holds their weights.`),
    el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Not now')
  ]));
}

/** Home, the day after a leg session: one card with the 0-10 row. onDone re-renders Home. */
export function morningCard({ rules, due, onDone, onSkip }) {
  const k = rules.knee;
  const pick = async n => {
    await addKneeScore(kneeEntry(n, 'morning', { sessionId: due.session.id }));
    toast(n >= k.swapAt ? `Knee ${n} saved. Your next squat day uses the knee swaps.` : `Knee ${n} saved`);
    onDone();
  };
  return el('div', { class: 'card', id: 'knee-morning' }, [
    el('h3', {}, ['Knee after yesterday', infoBtn('Knee check', [SCALE, `A score of ${k.swapAt} or more switches the next squat day to the knee versions: box squat with a 3-second lowering, box front squat, hang power clean. Their weights hold until the knee settles. Rate it again on the start page if it changes.`])]),
    el('p', { class: 'muted', style: 'margin:0 0 8px' }, `How does it feel after ${dayName(due.session.date)}'s ${due.session.sessionName.replace(/^Lift \d: /, '').toLowerCase()}?`),
    kneeButtons(pick, null, k.swapAt),
    el('button', { class: 'btn ghost small', id: 'knee-skip', style: 'margin-top:6px', onclick: onSkip }, 'Skip today')
  ]);
}

/** The start page (and Home) when the swaps are on: what changes and why, with a way to rate it again. */
export function swapNote({ rules, score, lifts, onRate }) {
  if (!lifts.length) return null;
  const when = score.when === 'morning' ? `${fmtDate(score.date)} morning` : fmtDate(score.date);
  return el('div', { class: 'card knee-note', id: 'knee-swap' }, [
    el('h3', {}, `Knee ${score.score}/10, ${when}`),
    el('ul', { class: 'lines' }, lifts.map(l => el('li', {}, [el('b', {}, l.to), ` in place of ${l.from.toLowerCase()}, same weight`]))),
    onRate ? el('button', { class: 'btn small', id: 'knee-rate', onclick: onRate }, 'Rate the knee again') : null
  ]);
}

/** Progress: the knee scores over the last 12 weeks, as one small line. Nothing until there is a score. */
export function trendCard({ rules, log, now = new Date() }) {
  const pts = kneeTrend(log, 84, now);
  if (!pts.length) return null;
  const k = rules.knee;
  const W = 300, H = 64, pad = 6;
  const t0 = new Date(pts[0].date).getTime(), t1 = new Date(pts[pts.length - 1].date).getTime();
  const x = d => pad + (t1 > t0 ? (new Date(d).getTime() - t0) / (t1 - t0) : 0.5) * (W - 2 * pad);
  const y = v => pad + (1 - v / 10) * (H - 2 * pad);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const svg = `<svg viewBox="0 0 ${W} ${H}" style="display:block;width:100%;height:auto" role="img" aria-label="Knee scores">`
    + `<line x1="0" x2="${W}" y1="${y(k.swapAt)}" y2="${y(k.swapAt)}" class="knee-line-swap"/>`
    + `<path d="${line}" class="knee-line" fill="none"/>`
    + pts.map(p => `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.score).toFixed(1)}" r="3" class="knee-dot${p.score >= k.swapAt ? ' high' : ''}"/>`).join('')
    + '</svg>';
  const last = sortedLog(log)[0];
  const chart = el('div', { class: 'knee-chart' }); chart.innerHTML = svg;
  return el('div', { class: 'card', id: 'knee-trend' }, [
    el('h3', {}, ['Knee', infoBtn('Knee scores', `The highest score each day, from the check after the first squat or RDL set and the next morning. The dashed line is ${k.swapAt}, where the knee swaps start.`)]),
    el('div', { class: 'knee-head' }, [el('b', {}, `${last.score}/10`), el('span', { class: 'muted' }, ` last, ${fmtDate(last.date)} · ${pts.length} ${pts.length === 1 ? 'day' : 'days'} rated`)]),
    chart
  ]);
}
