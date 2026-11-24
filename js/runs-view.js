// runs-view.js - v1.10: the Runs tab. v1.12: a run counts for its planned run whatever the day. v1.18.1: a run from
// Garmin counts for a planned run only when Cameron taps Count it.
// This week's two runs with what each asks for, miles by week, every run
// with its numbers, the run sheet and form, and Garmin set-up. The numbers come from runs.js.

import { el, toast, showModal, closeModal, confirmDialog } from './ui.js';
import { APP_VERSION, weekNumber, toISODate, parseISODate, fmtDate, getData } from './data.js';
import { getRuns, putRun, deleteRun, getSettings, newId, ignoreGarmin } from './store.js';
import { getSync, garminLinks, garminJobState, GARMIN_SECRET, GARMIN_FILE } from './sync.js';
import { getGarminState, importFromGarmin, checkGarminNow } from './garmin.js';
import { weekRuns, weeklyMiles, runLine, fmtDuration, parseMinutes, paceOf, planRunForType, countsMiles, settleWeek, openRunDays, needsCredit, creditOptions, countAs, keepAsSide, countCandidates, weekRange } from './runs.js';
import { svg, tooltip, yTicks } from './progress.js';

const clock = iso => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const when = iso => (toISODate(new Date(iso)) === toISODate(new Date()) ? `today at ${clock(iso)}` : `${fmtDate(iso)} at ${clock(iso)}`);
const dayLabel = iso => { const d = parseISODate(iso); return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getDate()}`; };
const startClock = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`; };
const STATUS = { done: '✓ done', today: 'today', open: 'not logged yet', later: '' };
const shortDay = iso => parseISODate(iso).toLocaleDateString(undefined, { weekday: 'short' });

/** v1.12: after a run is saved, settle again what the app-picked runs in that week count as. */
export async function resettle(dates) {
  const { plan, rules } = getData();
  const settings = await getSettings();
  const all = await getRuns();
  const weeks = [...new Set(dates.filter(Boolean).map(d => weekNumber(parseISODate(d), settings.startDate)))];
  for (const w of weeks) for (const r of settleWeek(all, w, { plan, rules, settings })) await putRun(r);
}

/** "Thursday or Saturday works." for a planned run whose day passed, or that it drops on Sunday night. */
export function openRunText(ctx, runId, week, today) {
  const days = openRunDays({ ...ctx, runId, week, today });
  if (!days.length) return 'No day left this week. It drops on Sunday night.';
  const names = days.map(d => (d.today ? 'today' : d.name));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
  return `${list[0].toUpperCase()}${list.slice(1)} works.`;
}

/**
 * v1.18.1 (Cameron, Nov 21: "Maybe make me log it to take credit"): this week's Garmin runs that could be this planned
 * run, each with Count it. Nothing when there are none. `onCounted(run)` after the tap is saved.
 */
export function countItBlock(row, ctx, onCounted) {
  const { plan, rules, settings, runs, week } = ctx;
  const run = (plan.runs || []).find(r => r.id === row.id);
  if (!run || row.status === 'done') return null;
  const cands = countCandidates(plan, runs, run, weekRange(settings, week));
  if (!cands.length) return null;
  return el('div', { class: 'count-it', 'data-count-for': row.id }, [
    el('p', { class: 'count-it-head' }, cands.length === 1 ? `From Garmin this week. Was it the ${row.short.toLowerCase()}?` : `From Garmin this week. Was one of these the ${row.short.toLowerCase()}?`),
    ...cands.map(c => el('div', { class: 'count-it-row' }, [
      el('span', {}, [el('b', {}, shortDay(c.date)), ` · ${runLine(c, rules, true) || c.type}`]),
      el('div', { class: 'count-it-btns' }, [
        el('button', { class: 'btn small', 'data-count': c.id, onclick: async e => {
          e.stopPropagation();
          const next = countAs(c, run);
          await putRun(next);
          toast(`Counted as ${row.short}`);
          if (onCounted) onCounted(next);
        } }, 'Count it'),
        // the other answer: a run on the side, which stops every planned run asking about it
        el('button', { class: 'btn small ghost', 'data-side': c.id, onclick: async e => {
          e.stopPropagation();
          const next = keepAsSide(c);
          await putRun(next);
          toast('Kept as a side run. It counts toward your miles only.');
          if (onCounted) onCounted(next);
        } }, 'Side run')
      ])
    ]))
  ]);
}

// ---- the run form ----

/** Log or edit a run. `preset` fills a new one in ({ type, date }). Time takes 27:30 or 27.5. */
export function runForm(plan, settings, existing, onSaved, preset = {}) {
  const today = toISODate(new Date());
  const r = existing || { date: preset.date || today, type: preset.type || 'Intervals', distance: '', minutes: '', rpe: '', hr: '', notes: '' };
  const f = {};
  const mk = (label, key, attrs, value) => { f[key] = el('input', { value: value !== undefined ? value : (r[key] == null ? '' : r[key]), ...attrs }); return el('div', { class: 'field' }, [el('label', {}, label), f[key]]); };
  const typeSel = el('select', { id: 'run-type' }, plan.runTypes.map(t => el('option', { value: t, selected: t === r.type }, t)));
  const paceOut = el('p', { class: 'muted', id: 'run-pace', style: 'margin:-2px 0 10px;font-size:var(--t-small)' });
  const showPace = () => { const p = paceOf(Number(f.distance.value) || null, parseMinutes(f.minutes.value)); paceOut.textContent = p ? `Pace ${fmtDuration(p)}/mi` : ''; };
  const form = el('div', {}, [
    el('h2', {}, existing ? 'Edit run' : 'Log a run'),
    mk('Date', 'date', { type: 'date' }),
    el('div', { class: 'field' }, [el('label', {}, 'Type'), typeSel]),
    el('div', { class: 'grid2' }, [
      mk('Distance (mi)', 'distance', { type: 'number', step: '0.01', inputmode: 'decimal', id: 'run-distance', oninput: showPace }),
      mk('Time (27:30)', 'minutes', { type: 'text', inputmode: 'text', id: 'run-time', placeholder: 'min:sec', oninput: showPace }, r.minutes ? fmtDuration(r.minutes) : '')
    ]),
    paceOut,
    el('div', { class: 'grid2' }, [
      mk('Effort (1 easy, 10 all out)', 'rpe', { type: 'number', step: '0.5', min: '1', max: '10', inputmode: 'decimal', id: 'run-rpe' }),
      mk('Avg heart rate', 'hr', { type: 'number', step: '1', inputmode: 'numeric', id: 'run-hr' })
    ]),
    el('div', { class: 'field' }, [el('label', {}, 'Notes'), (f.notes = el('textarea', { rows: 2 }, r.notes || ''))]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Cancel'),
      el('button', { class: 'btn primary', onclick: async () => {
        const num = x => (x.value === '' ? null : Number(x.value));
        const minutes = parseMinutes(f.minutes.value);
        if (f.minutes.value.trim() && minutes === null) { toast('Time looks off. Use 27:30 or 27.5.', 3000); return; }
        const planRun = planRunForType(plan, typeSel.value);
        const rec = { ...(existing || {}), id: r.id || newId('run'), date: f.date.value || today, type: typeSel.value, planId: planRun ? planRun.id : null, distance: num(f.distance), minutes, rpe: num(f.rpe), hr: num(f.hr), notes: f.notes.value.trim(), appVersion: APP_VERSION };
        rec.week = weekNumber(new Date(rec.date + 'T12:00:00'), settings.startDate);
        rec.pace = paceOf(rec.distance, rec.minutes);
        await putRun(rec);
        await resettle([rec.date, existing && existing.date]);
        closeModal(); toast('Run saved'); onSaved && onSaved(rec);
      } }, 'Save run')
    ])
  ]);
  showModal(form);
  showPace();
}

// ---- one run, opened ----
function runSheet(r, ctx) {
  const { plan, rules, settings, refresh, readOnly } = ctx;
  const save = async patch => {
    const next = { ...r, ...patch };
    await putRun(next);
    if ('type' in patch) await resettle([next.date]);
    toast('Saved'); refresh(); runSheet(next, ctx);
  };
  const stat = (label, value) => (value === null || value === undefined || value === '' ? null : el('div', { class: 'run-stat' }, [el('span', {}, label), el('b', {}, value)]));
  const pace = countsMiles(rules, r.type) ? (r.pace || paceOf(r.distance, r.minutes)) : null;
  showModal(el('div', { id: 'run-sheet' }, [
    el('h2', {}, `${r.type}, ${fmtDate(r.date)}`),
    r.source === 'garmin' ? el('p', { class: 'muted', style: 'margin:0 0 10px' }, `From Garmin${r.name ? ` · ${r.name}` : ''}${r.startTime ? ` · started ${startClock(r.startTime)}` : ''}`) : null,
    el('div', { class: 'run-stats' }, [
      stat('Distance', r.distance ? `${r.distance} mi` : null), stat('Time', r.minutes ? fmtDuration(r.minutes) : null), stat('Pace', pace ? `${fmtDuration(pace)}/mi` : null),
      stat('Avg heart rate', r.hr ? Math.round(r.hr) : null), stat('Max heart rate', r.maxHr ? Math.round(r.maxHr) : null), stat('Climb', r.climbFt ? `${r.climbFt} ft` : null), stat('Cadence', r.cadence ? `${r.cadence} spm` : null)
    ]),
    readOnly ? null : el('h3', { style: 'margin-top:14px' }, 'Counts as'),
    readOnly ? null : el('div', { class: 'tag-row', id: 'run-type-row' }, plan.runTypes.map(t => el('button', { class: 'tag-btn' + (t === r.type ? ' on' : ''), onclick: () => { const pr = planRunForType(plan, t); save({ type: t, planId: pr ? pr.id : null, typeLocked: true, autoType: false, autoWhy: null }); } }, t))),
    // v1.18.1: a Garmin run counts toward miles, and for a planned run only once he says which it was
    !readOnly && needsCredit(r) && creditOptions(plan, r).length ? el('div', { class: 'count-it', id: 'run-count-it' }, [
      el('p', { class: 'count-it-head' }, 'From Garmin it counts toward your miles, not for a planned run. If it was one, count it:'),
      el('div', { class: 'btn-row' }, creditOptions(plan, r).map(run => el('button', { class: 'btn small', 'data-count-as': run.id, onclick: async () => {
        const next = countAs(r, run);
        await putRun(next);
        toast(`Counted as ${run.name.includes(': ') ? run.name.split(': ')[1] : run.name}`); refresh(); runSheet(next, ctx);
      } }, run.name.includes(': ') ? run.name.split(': ')[1] : run.name)))
    ]) : null,
    readOnly ? null : el('h3', {}, 'Effort (1 easy, 10 all out)'),
    readOnly ? (r.rpe ? el('p', {}, `Effort ${r.rpe} of 10`) : null) : el('div', { class: 'tag-row', id: 'run-effort-row' }, [3, 4, 5, 6, 7, 8, 9, 10].map(n => el('button', { class: 'tag-btn' + (Number(r.rpe) === n ? ' on' : ''), 'data-rpe': n, onclick: () => save({ rpe: n }) }, String(n)))),
    r.notes ? el('p', { class: 'muted' }, r.notes) : null,
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Close'),
      readOnly ? null : el('button', { class: 'btn', onclick: () => runForm(plan, settings, r, refresh) }, 'Edit'),
      readOnly ? null : el('button', { class: 'btn danger', onclick: async () => {
        closeModal();
        if (!(await confirmDialog('Delete this run?', r.garminId ? 'It stays in Garmin. It will not be added here again.' : '', 'Delete', true))) return;
        if (r.garminId) await ignoreGarmin(r.garminId);
        await deleteRun(r.id); refresh();
      } }, 'Delete')
    ])
  ]));
}

// ---- miles by week: one thin column per week, value on the latest, tooltip on each ----
function milesBars(rows, current) {
  const W = 320, H = 150, L = 30, R = 8, T = 16, B = 24;
  const wrap = el('div', { class: 'viz' });
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Miles per week: ${rows.filter(r => r.miles).map(r => `week ${r.week} ${r.miles}`).join(', ')}` });
  const ticks = yTicks([0, Math.max(8, ...rows.map(r => r.miles))], 4);
  const band = (W - L - R) / rows.length;
  const bw = Math.min(24, band - 6);
  const y = v => H - B - v * (H - T - B) / ticks[2];
  ticks.forEach(t => {
    root.appendChild(svg('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: 'viz-grid' }));
    root.appendChild(svg('text', { x: L - 6, y: y(t) + 3.5, 'text-anchor': 'end', class: 'viz-axis' }, `${t}`));
  });
  wrap.appendChild(root);
  const tip = tooltip(wrap);
  const latest = [...rows].reverse().find(r => r.miles);
  rows.forEach((r, i) => {
    const cx = L + band * i + band / 2;
    root.appendChild(svg('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'viz-axis' + (r.week === current ? ' now' : '') }, `${r.week}`));
    if (!r.miles) return;
    const x0 = cx - bw / 2, top = y(r.miles), base = y(0), rad = Math.min(4, (base - top) / 2);
    const bar = svg('path', { d: `M${x0} ${base}V${top + rad}Q${x0} ${top} ${x0 + rad} ${top}H${x0 + bw - rad}Q${x0 + bw} ${top} ${x0 + bw} ${top + rad}V${base}Z`, class: 'viz-bar', tabindex: 0, 'aria-label': `Week ${r.week}: ${r.miles} miles` });
    const show = () => { bar.classList.add('on'); tip.show(cx / W, `${r.miles} mi`, [`week ${r.week} · ${r.runs} ${r.runs === 1 ? 'run' : 'runs'}`]); };
    const hide = () => { bar.classList.remove('on'); tip.hide(); };
    bar.addEventListener('pointerenter', show); bar.addEventListener('pointerdown', show); bar.addEventListener('pointerleave', hide);
    bar.addEventListener('focus', show); bar.addEventListener('blur', hide);
    root.appendChild(bar);
    if (latest && r.week === latest.week) root.appendChild(svg('text', { x: cx, y: top - 5, 'text-anchor': 'middle', class: 'viz-value' }, `${r.miles}`));
  });
  return wrap;
}

// ---- Garmin set-up ----
async function garminSheet(ctx, note) {
  const { plan, rules, refresh, onOpenSync } = ctx;
  const cfg = await getSync();
  if (!cfg || !cfg.repo) {
    showModal(el('div', { id: 'garmin-sheet' }, [
      el('h2', {}, 'Connect Garmin'),
      el('p', { class: 'muted' }, 'Garmin runs come in through the private GitHub repo that sync uses. Turn sync on first, then come back here.'),
      el('div', { class: 'btn-row' }, [el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Close'), el('button', { class: 'btn primary', onclick: () => onOpenSync && onOpenSync() }, 'Set up sync')])
    ]));
    return;
  }
  const phone = cfg.role === 'phone';
  const jobText = await fetch('data/garmin-job.yml', { cache: 'no-cache' }).then(r => (r.ok ? r.text() : ''), () => '');
  let links = garminLinks(cfg.repo, 'main', jobText);
  const state = await getGarminState();
  const say = el('p', { class: 'sync-status', id: 'garmin-say' }, note || (state.lastError ? state.lastError : (state.found ? `Connected. Last pulled ${state.fetchedAt ? when(state.fetchedAt) : 'a while ago'}, ${state.activities || 0} activities in the last few weeks.` : '')));
  const open = (key, label, id) => el('a', { class: 'btn', id, href: links[key], target: '_blank', rel: 'noopener', onclick: e => { e.currentTarget.href = links[key]; } }, label);
  const copy = (text, label, id) => el('button', { class: 'btn', id, onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch (e) { toast('Could not copy. Select the text and copy it by hand.', 3500); } } }, label);
  const jobState = el('span', { class: 'muted', id: 'garmin-job-state' }, '');
  const step = (n, title, body) => el('li', { class: 'setup-step' }, [el('b', {}, `${n}. ${title}`), ...body]);
  showModal(el('div', { id: 'garmin-sheet' }, [
    el('h2', {}, 'Connect Garmin'),
    el('p', { class: 'muted' }, `Garmin gives you a personal key that reads your own activities. A small job in your private repo (${cfg.repo}) asks Garmin every two hours, and when you tap Check now, and saves the answer as ${GARMIN_FILE}. The app adds your runs from that file. The key is kept by GitHub as a secret: it is never on your phone or computer, in the app, or in a backup.`),
    phone && !state.found ? el('p', { class: 'muted' }, 'Steps 1 to 3 mean pasting a key from one site into another, which is easier on the computer. Open the app there, go to Runs, and click Connect Garmin.') : null,
    el('ol', { class: 'setup-steps' }, [
      step(1, 'Make the key', [el('p', { class: 'muted' }, 'In Garmin Connect, create a personal API key and pick one year. Garmin shows the key once, so copy it before you close the page.'), open('key', 'Open Garmin Connect', 'garmin-open-key')]),
      step(2, 'Save it in your repo as a secret', [el('p', { class: 'muted' }, ['Name: ', el('code', {}, GARMIN_SECRET), '. Secret: the key you just copied. Then Add secret.']), el('div', { class: 'btn-row' }, [copy(GARMIN_SECRET, 'Copy name', 'garmin-copy-name'), open('secret', 'Open secrets', 'garmin-open-secret')])]),
      step(3, 'Add the job', [el('p', { class: 'muted' }, ['GitHub opens a new file with the job already filled in. Press Commit changes, twice. If the file opens empty, name it .github/workflows/garmin.yml and paste the job text. ', jobState]), el('div', { class: 'btn-row' }, [open('job', 'Open job page', 'garmin-open-job'), copy(jobText, 'Copy job text', 'garmin-copy-job')])]),
      step(4, 'Check it', [
        el('p', { class: 'muted' }, phone ? 'This asks Garmin now and takes up to two minutes.' : 'The phone adds the runs. Open the app on your phone, go to Runs, and tap Check now. They show up here after that.'),
        phone ? el('button', { class: 'btn primary', id: 'garmin-check-now', onclick: async e => {
          e.currentTarget.disabled = true;
          const r = await checkGarminNow({ plan, rules }, t => { say.textContent = t; });
          refresh();
          garminSheet(ctx, r.ok ? (r.error || `Connected. Garmin sent ${r.activities} ${r.activities === 1 ? 'activity' : 'activities'}; ${r.added} ${r.added === 1 ? 'run was' : 'runs were'} added.`) : r.error);
        } }, 'Check Garmin now') : null
      ])
    ]),
    say,
    el('div', { class: 'btn-row' }, [el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Close')])
  ]));
  garminJobState().then(s => {
    if (!s.ok) return;
    links = garminLinks(cfg.repo, s.branch, jobText);
    jobState.textContent = s.job ? 'The job is already in the repo.' : '';
    document.querySelectorAll('#garmin-sheet a.btn').forEach(a => { const k = { 'garmin-open-key': 'key', 'garmin-open-secret': 'secret', 'garmin-open-job': 'job' }[a.id]; if (k) a.href = links[k]; });
  });
}

// ---- the tab ----
let lastAutoCheck = 0;

/** Draw the Runs tab. ctx = { plan, rules, onOpenSync } */
export async function renderRunsTab(view, ctx) {
  const { plan, rules } = ctx;
  const [settings, runs, cfg, garmin] = await Promise.all([getSettings(), getRuns(), getSync(), getGarminState()]);
  const today = new Date();
  const week = weekNumber(today, settings.startDate);
  const phone = !cfg || cfg.role !== 'viewer';
  const refresh = () => renderRunsTab(view, ctx);
  const full = { ...ctx, settings, refresh, readOnly: !phone };
  view.innerHTML = '';

  view.appendChild(el('div', { class: 'row page-head' }, [
    el('h1', {}, 'Runs'),
    phone ? el('button', { class: 'btn small primary', id: 'log-run', onclick: () => runForm(plan, settings, null, refresh) }, 'Log a run') : null
  ]));

  // Garmin: one line under the heading
  const linked = !!(cfg && cfg.repo && garmin.found);
  const gRow = el('div', { class: 'garmin-row', id: 'garmin-row' });
  if (linked) {
    gRow.appendChild(el('span', { class: 'garmin-state' + (garmin.lastError ? ' bad' : ''), id: 'garmin-status' }, garmin.lastError ? `Garmin: ${garmin.lastError}` : `Garmin is connected · last pull ${garmin.fetchedAt ? when(garmin.fetchedAt) : 'a while ago'}${phone ? '' : ' · runs show up here after your phone opens the app'}`));
    if (phone) gRow.appendChild(el('button', { class: 'link-btn', id: 'garmin-check', onclick: async e => {
      const b = e.currentTarget; b.disabled = true;
      const r = await checkGarminNow({ plan, rules }, t => { b.textContent = t; });
      toast(r.ok ? (r.error || (r.added ? `${r.added} ${r.added === 1 ? 'run' : 'runs'} added from Garmin` : 'Nothing new from Garmin')) : r.error, 4000);
      refresh();
    } }, 'Check now'));
    gRow.appendChild(el('button', { class: 'link-btn', id: 'garmin-setup', onclick: () => garminSheet(full) }, 'Set-up'));
  } else {
    gRow.appendChild(el('span', { class: 'garmin-state', id: 'garmin-status' }, 'Have a Garmin watch? Runs can show up here on their own.'));
    gRow.appendChild(el('button', { class: 'link-btn', id: 'garmin-setup', onclick: () => garminSheet(full) }, 'Connect Garmin'));
  }
  view.appendChild(gRow);

  const main = el('div', { class: 'runs-main' });
  const side = el('div', { class: 'runs-side' });
  view.appendChild(el('div', { class: 'runs-cols' }, [main, side]));

  // this week
  if (week >= 1 && week <= 12) {
    const rows = weekRuns({ plan, settings, runs, week, today });
    const inWeek = runs.filter(r => (r.week || weekNumber(parseISODate(r.date), settings.startDate)) === week);
    const miles = Math.round(inWeek.reduce((m, r) => m + (countsMiles(rules, r.type) ? (r.distance || 0) : 0), 0) * 10) / 10;
    main.appendChild(el('div', { class: 'card', id: 'runs-week' }, [
      el('h3', {}, `Week ${week} of 12`),
      ...rows.map(row => el('div', { class: `run-plan ${row.status}`, 'data-run': row.id }, [
        el('span', { class: 'day-name' }, /weekend/i.test(row.day) ? 'Sat/Sun' : dayLabel(row.date)),
        el('div', { class: 'run-plan-body' }, [
          el('div', { class: 'row' }, [
            el('b', {}, row.short),
            row.status === 'done' || !phone
              ? el('span', { class: 'day-status ' + (row.status === 'done' ? 'done' : '') }, row.status === 'done' && row.run && !/weekend/i.test(row.day) && row.run.date !== row.date ? `✓ done ${shortDay(row.run.date)}` : STATUS[row.status])
              : (row.status === 'later' ? null : el('button', { class: 'btn small', onclick: () => runForm(plan, settings, null, refresh, { type: row.type }) }, 'Log'))
          ]),
          el('div', { class: 'run-ask' }, row.plan.text),
          row.plan.lines ? el('div', { class: 'muted run-detail run-lines' }, row.plan.lines.map(t => { const i = t.indexOf(': '); return i > 0 && i < 12 ? el('div', {}, [el('b', {}, t.slice(0, i + 1) + ' '), t.slice(i + 2)]) : el('div', {}, t); })) : el('div', { class: 'muted run-detail' }, row.plan.detail),
          row.status === 'open' ? el('div', { class: 'run-moved' }, `Not done ${/weekend/i.test(row.day) ? 'yet' : shortDay(row.date)}. ${openRunText({ plan, rules, settings }, row.id, week, today)}`) : null,
          phone ? countItBlock(row, { plan, rules, settings, runs, week }, () => refresh()) : null,
          row.run ? el('button', { class: 'run-result', onclick: () => runSheet(row.run, full) }, runLine(row.run, rules, true) || 'Logged') : null
        ])
      ])),
      el('p', { class: 'muted card-foot', id: 'runs-week-total' }, `${rows.filter(r => r.status === 'done').length} of ${rows.length} planned runs done${miles ? ` · ${miles} mi this week` : ''}`),
      el('details', { class: 'run-notes' }, [el('summary', {}, 'How to run them'), ...plan.runs.map(r => el('p', { class: 'muted' }, [el('b', {}, `${r.name}. `), r.note]))])
    ]));
  } else {
    main.appendChild(el('div', { class: 'card', id: 'runs-week' }, [el('h3', {}, 'The plan\'s runs'), ...plan.runs.map(r => el('p', { class: 'muted' }, [el('b', {}, `${r.name}. `), r.note]))]));
  }

  // miles by week
  const byWeek = weeklyMiles(runs, settings, rules);
  if (byWeek.some(r => r.miles)) {
    const total = Math.round(byWeek.reduce((m, r) => m + r.miles, 0) * 10) / 10;
    const count = byWeek.reduce((n, r) => n + r.runs, 0);
    main.appendChild(el('div', { class: 'card', id: 'runs-miles' }, [el('h3', {}, 'Miles by week'), milesBars(byWeek, week), el('p', { class: 'muted card-foot' }, `${total} mi over ${count} ${count === 1 ? 'run' : 'runs'} in this block`)]));
  }

  // every run
  const list = el('div', { class: 'card', id: 'runs-list' }, [el('h3', {}, 'All runs')]);
  if (!runs.length) list.appendChild(el('p', { class: 'muted', style: 'margin:0' }, phone ? 'No runs yet. Log one, or connect Garmin and they add themselves.' : 'No runs yet. They show up here after your phone logs one.'));
  runs.forEach(r => list.appendChild(el('div', { class: 'list-item run-item', 'data-id': r.id, onclick: () => runSheet(r, full) }, [
    el('div', { class: 'row' }, [
      el('b', {}, `${fmtDate(r.date)} · ${r.type}`),
      el('span', { class: 'run-tags' }, [r.rpe ? el('span', { class: 'tag' }, `Effort ${r.rpe}`) : (phone ? el('span', { class: 'tag tag-todo' }, 'Add effort') : null)])
    ]),
    el('div', { class: 'muted run-line' }, [runLine(r, rules) || (r.notes || 'No numbers logged'), r.source === 'garmin' ? ' · Garmin' : ''])
  ])));
  side.appendChild(list);

  // look for a newer Garmin file when the tab opens (at most once a minute; the file is small). The phone adds
  // what is new; a computer only notes that the file is there.
  if (cfg && cfg.repo && Date.now() - lastAutoCheck > 60000) {
    lastAutoCheck = Date.now();
    importFromGarmin({ plan, rules }).then(r => {
      if (!r || !r.ok) return;
      if (r.added) toast(`${r.added} ${r.added === 1 ? 'run' : 'runs'} added from Garmin`, 3500);
      if (r.changed || !!r.found !== !!garmin.found || r.fetchedAt !== garmin.fetchedAt || (r.error || null) !== (garmin.lastError || null)) { if (document.getElementById('garmin-row')) refresh(); }
    });
  }
}
