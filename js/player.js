// player.js - Player: walks the timeline, timestamp timers, cues, wake lock, session clock, trim to fit.
// State lives in `this.s` and is saved to IndexedDB on every change so a session can be resumed.

import { trimToFit, remainingSeconds } from './builder.js';
import { setInProgress, clearInProgress } from './store.js';
import { fmtClock, fmtTime, fmtWeight, repsText, roundTo } from './data.js';
import { incrementFor } from './progression.js';
import { el, showModal, closeModal, toast } from './ui.js';

export class Player {
  constructor({ timeline, plan, rules, settings, container, onFinish }) {
    this.plan = plan; this.rules = rules; this.settings = settings;
    this.container = container; this.onFinish = onFinish;
    this.s = {
      timeline, idx: 0, stepStart: null, side: 0,
      sessionStart: null, pausedAt: null, pausedTotal: 0,
      trims: [], warned: false, fired: false, status: 'running', startedISO: null
    };
    this.audio = null; this.wakeLock = null; this.timer = null; this.editOpen = false;
    this._onVis = () => this.onVisibility();
  }

  // ---- lifecycle ----
  start() {
    const now = Date.now();
    this.s.sessionStart = now; this.s.startedISO = new Date(now).toISOString();
    this.s.stepStart = now;
    this.boot();
  }

  resume(saved) {
    this.s = saved;
    if (this.s.pausedAt == null && this.s.status === 'running') {
      // the app was closed: treat the time away as a pause on the current step
      const away = Date.now() - (this.s.lastTick || Date.now());
      if (away > 2000) { this.s.pausedTotal += away; this.s.stepStart += away; }
    }
    this.boot();
  }

  boot() {
    document.body.classList.add('in-session');
    document.addEventListener('visibilitychange', this._onVis);
    this.requestWakeLock();
    this.ensureAudio();
    this.renderStep();
    this.timer = setInterval(() => this.tick(), 250);
    this.persist();
  }

  teardown() {
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this._onVis);
    document.body.classList.remove('in-session');
    if (this.wakeLock) { try { this.wakeLock.release(); } catch (e) { /* ignore */ } this.wakeLock = null; }
  }

  async requestWakeLock() {
    if (!(this.settings.keepScreenOn !== false) || !('wakeLock' in navigator)) return;
    try { this.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ }
  }

  onVisibility() {
    if (document.visibilityState === 'visible') {
      this.requestWakeLock();
      this.tick(true);
    }
  }

  ensureAudio() {
    if (this.audio) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this.audio = new Ctx();
    } catch (e) { this.audio = null; }
  }

  persist() {
    this.s.lastTick = Date.now();
    setInProgress(JSON.parse(JSON.stringify(this.s))).catch(() => {});
  }

  // ---- cues ----
  beep(kind) {
    if (!this.settings.cues || !this.settings.cues.beep || !this.audio) return;
    try {
      if (this.audio.state === 'suspended') this.audio.resume();
      const t0 = this.audio.currentTime;
      const tones = kind === 'warn' ? [[880, 0, 0.08]] : [[880, 0, 0.15], [1320, 0.18, 0.25]];
      tones.forEach(([f, dt, dur]) => {
        const o = this.audio.createOscillator(); const g = this.audio.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(0.4, t0 + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + dur);
        o.connect(g); g.connect(this.audio.destination); o.start(t0 + dt); o.stop(t0 + dt + dur + 0.05);
      });
    } catch (e) { /* ignore */ }
  }
  buzz(kind) {
    if (!this.settings.cues || !this.settings.cues.vibrate || !navigator.vibrate) return;
    try { navigator.vibrate(kind === 'warn' ? 60 : [200, 100, 200]); } catch (e) { /* ignore */ }
  }
  cue(kind) { this.beep(kind); this.buzz(kind); }

  // ---- timing ----
  get steps() { return this.s.timeline.steps; }
  get step() { return this.steps[this.s.idx]; }
  now() { return this.s.pausedAt != null ? this.s.pausedAt : Date.now(); }
  elapsedInStep() { return (this.now() - this.s.stepStart) / 1000; }
  stepSeconds(step) { return step.holdSeconds ? step.holdSeconds : (step.seconds || 0); }
  remainingInStep(step = this.step) {
    if (!step) return 0;
    return Math.max(0, this.stepSeconds(step) - this.elapsedInStep());
  }
  isCountdown(step = this.step) { return !!(step && (step.countdown || step.holdSeconds)); }

  projection() {
    const tl = this.s.timeline;
    const now = this.now();
    let remaining = remainingSeconds(this.steps, this.s.idx + 1);
    const cur = this.step;
    if (cur) {
      if (cur.holdSeconds && cur.perSide) remaining += this.remainingInStep(cur) + (this.s.side === 0 ? cur.holdSeconds : 0);
      else remaining += Math.max(0, (cur.seconds || 0) - this.elapsedInStep());
    }
    const plannedFinish = this.s.sessionStart + tl.plannedSeconds * 1000 + this.s.pausedTotal;
    const capFinish = this.s.sessionStart + (this.plan.sessionCapMinutes || 60) * 60000 + this.s.pausedTotal;
    const projected = now + remaining * 1000;
    return { remaining, plannedFinish, capFinish, projected, deltaSeconds: Math.round((projected - plannedFinish) / 1000), overCapSeconds: Math.round((projected - capFinish) / 1000) };
  }

  tick(force) {
    if (!this.step || this.s.status !== 'running') return;
    if (this.s.pausedAt != null && !force) { this.updateTimerDom(); return; }
    const step = this.step;
    if (this.isCountdown(step)) {
      const rem = this.remainingInStep(step);
      const warnAt = this.rules.timing.restWarningSeconds;
      if (!this.s.warned && rem <= warnAt && rem > 0 && this.settings.cues && this.settings.cues.warningTick && this.stepSeconds(step) > warnAt + 2) {
        this.s.warned = true; this.cue('warn');
      }
      if (rem <= 0 && !this.s.fired) {
        this.s.fired = true;
        this.cue('end');
        if (step.holdSeconds && step.perSide && this.s.side === 0) {
          this.s.side = 1; this.s.stepStart = Date.now(); this.s.warned = false; this.s.fired = false;
          this.renderStep(); this.persist();
          return;
        }
        if (step.kind === 'set') this.logSet({ auto: true });
        else this.advance();
        return;
      }
    }
    this.updateTimerDom();
    if (Date.now() - (this.s.lastTick || 0) > 5000) this.persist();
  }

  // ---- navigation ----
  goTo(idx) {
    this.s.idx = idx; this.s.stepStart = Date.now(); this.s.side = 0; this.s.warned = false; this.s.fired = false; this.editOpen = false;
    if (idx >= this.steps.length) { this.finish('complete'); return; }
    this.renderStep();
    this.persist();
  }
  advance() {
    const s = this.step;
    if (s && s.kind !== 'set') { s.done = true; s.actualSeconds = Math.round(this.elapsedInStep()); }
    this.goTo(this.s.idx + 1);
  }
  skip() {
    const s = this.step;
    if (s.kind === 'set') { s.skipped = true; s.done = false; s.record = { ...this.baseRecord(s), done: false, skipped: true }; }
    else { s.skipped = true; s.done = true; }
    this.goTo(this.s.idx + 1);
  }
  back() {
    if (this.s.idx === 0) return;
    const prev = this.steps[this.s.idx - 1];
    prev.done = false; prev.skipped = false;
    this.goTo(this.s.idx - 1);
  }
  pause() {
    if (this.s.pausedAt != null) return;
    this.s.pausedAt = Date.now(); this.renderStep(); this.persist();
  }
  unpause() {
    if (this.s.pausedAt == null) return;
    const away = Date.now() - this.s.pausedAt;
    this.s.pausedTotal += away; this.s.stepStart += away; this.s.pausedAt = null;
    this.renderStep(); this.persist();
  }
  addSeconds(n) {
    const s = this.step; if (!s) return;
    s.seconds = (s.seconds || 0) + n; this.s.fired = false; this.s.warned = false; this.updateTimerDom(); this.persist();
  }
  decide(doIt) {
    const s = this.step;
    s.done = true;
    if (doIt) { this.goTo(this.s.idx + 1); return; }
    // skip every if-time step that follows
    let i = this.s.idx + 1;
    while (i < this.steps.length && this.steps[i].iftime) { this.steps[i].skipped = true; this.steps[i].done = this.steps[i].kind !== 'set'; i++; }
    this.goTo(i);
  }

  // ---- logging ----
  baseRecord(s) {
    return { exerciseId: s.exerciseId, name: s.name, setIndex: s.setIndex, round: s.round, ramp: s.ramp, baseline: s.baseline, retest: s.retest,
      holdSeconds: s.holdSeconds, perSide: s.perSide, repRange: s.repRange, target: { ...(s.target || {}) }, blockId: s.blockId };
  }
  readInputs() {
    const w = this.container.querySelector('#in-weight');
    const r = this.container.querySelector('#in-reps');
    const p = this.container.querySelector('#in-rpe');
    const num = x => (x && x.value !== '' ? Number(x.value) : null);
    return { weight: num(w), reps: num(r), rpe: num(p) };
  }
  logSet({ auto } = {}) {
    const s = this.step;
    const v = auto ? { weight: s.target ? s.target.weight : null, reps: s.holdSeconds || (s.target ? s.target.reps : null), rpe: s.rpeDefault } : this.readInputs();
    if (s.holdSeconds && v.reps == null) v.reps = s.holdSeconds;
    const ex = this.plan.exercises[s.exerciseId];
    const needsWeight = ex && ex.equipment !== 'bodyweight' && !s.holdSeconds;
    if (needsWeight && v.weight == null && !auto) { toast('Enter the weight you used'); this.openEdit(); return; }
    if (v.reps == null && !auto && !s.holdSeconds) { toast('Enter reps'); this.openEdit(); return; }
    s.done = true; s.skipped = false; s.actualSeconds = Math.round(this.elapsedInStep());
    s.record = { ...this.baseRecord(s), weight: v.weight, reps: v.reps, rpe: v.rpe, done: true, skipped: false, at: new Date().toISOString() };

    // baseline top set -> fill the training weight for the work sets that follow
    if (s.baseline && v.weight != null) {
      const inc = incrementFor(this.rules, s.exerciseId, ex);
      const tw = roundTo(v.weight * this.rules.baseline.trainingFraction, inc);
      this.steps.forEach((o, i) => { if (i > this.s.idx && o.exerciseId === s.exerciseId && o.fillFromBaseline && !o.done) { o.target = { ...(o.target || {}), weight: tw }; } });
      toast(`Training weight for today: ${fmtWeight(tw)} lb`);
    } else if (!s.ramp && v.weight != null && s.target && v.weight !== s.target.weight) {
      // edited weight carries forward to later sets of the same exercise that still have the old target
      const old = s.target.weight;
      this.steps.forEach((o, i) => { if (i > this.s.idx && o.exerciseId === s.exerciseId && o.kind === 'set' && !o.ramp && !o.done && o.target && (o.target.weight === old || o.target.weight == null)) o.target = { ...o.target, weight: v.weight }; });
    }
    this.goTo(this.s.idx + 1);
  }

  // ---- trim ----
  trimPreview() {
    const p = this.projection();
    const over = Math.max(p.deltaSeconds, p.overCapSeconds, 60);
    const res = trimToFit({ steps: this.steps, fromIdx: this.s.idx, overBySeconds: over, rules: this.rules });
    const body = el('div', {}, [
      el('h2', {}, 'Trim to fit'),
      el('p', { class: 'muted' }, `About ${Math.round(over / 60)} min to make up. This would:`),
      el('ul', { class: 'lines' }, res.notes.map(n => el('li', {}, n))),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: () => { this.applyTrim(res); closeModal(); } }, 'Apply')
      ])
    ]);
    showModal(body);
  }
  applyTrim(res) {
    // carry done/record state over: trimToFit copied the steps, so the current and earlier steps keep their fields
    this.s.timeline.steps = res.steps;
    this.s.trims.push(...res.notes);
    this.renderStep(); this.persist();
    toast(`Trimmed about ${Math.round(res.savedSeconds / 60)} min`);
  }

  // ---- finishing ----
  confirmEnd() {
    showModal(el('div', {}, [
      el('h2', {}, 'End session early?'),
      el('p', { class: 'muted' }, 'What you logged is saved; the remaining steps are marked skipped.'),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Keep going'),
        el('button', { class: 'btn danger', onclick: () => { closeModal(); this.finish('ended_early'); } }, 'End session')
      ])
    ]));
  }
  finish(status) {
    this.s.status = status;
    this.steps.forEach((s, i) => { if (i >= this.s.idx && !s.done && !s.skipped) { s.skipped = true; if (s.kind === 'set') s.record = { ...this.baseRecord(s), done: false, skipped: true }; } });
    const endedAt = Date.now();
    const draft = {
      timeline: this.s.timeline, status, startedAt: this.s.startedISO, endedAt: new Date(endedAt).toISOString(),
      actualSeconds: Math.round((endedAt - this.s.sessionStart - this.s.pausedTotal) / 1000), pausedSeconds: Math.round(this.s.pausedTotal / 1000),
      plannedSeconds: this.s.timeline.plannedSeconds, trims: this.s.trims,
      sets: this.steps.filter(s => s.kind === 'set' && s.record).map(s => s.record)
    };
    this.teardown();
    clearInProgress().catch(() => {});
    this.onFinish(draft);
  }
  abandon() { this.teardown(); clearInProgress().catch(() => {}); }

  // ---- rendering ----
  renderStep() {
    const s = this.step; if (!s) return;
    const c = this.container; c.innerHTML = '';
    const tl = this.s.timeline;
    const doneCount = this.steps.filter(x => x.done || x.skipped).length;
    const paused = this.s.pausedAt != null;

    const head = el('div', { class: 'player-head' }, [
      el('div', {}, [
        el('div', { class: 'block' }, `${tl.sessionName} · ${s.blockName}${s.setIndex && s.setCount && !s.round ? ` · set ${s.setIndex} of ${s.setCount}` : ''}${s.round ? ` · round ${s.round} of ${s.roundCount}` : ''}`),
        el('div', { class: 'progress' }, [el('div', { id: 'prog' })])
      ]),
      el('div', { class: 'clock', id: 'clock' })
    ]);

    const main = el('div', { class: 'step-main' });
    const kindLabel = { set: s.ramp ? 'Ramp-up' : (s.baseline ? 'Baseline' : (s.retest ? 'Retest' : (s.holdSeconds ? 'Hold' : 'Work set'))), rest: 'Rest', timed: 'Timed', transition: 'Transition', stretch: 'Stretch', decision: 'Your call' }[s.kind] || s.kind;
    main.appendChild(el('div', { class: 'step-kind' }, kindLabel + (s.holdSeconds && s.perSide ? (this.s.side === 0 ? ' · left' : ' · right') : '')));
    main.appendChild(el('div', { class: 'step-name' }, s.name));
    if (s.kind === 'set') {
      const ex = this.plan.exercises[s.exerciseId];
      const w = s.target && s.target.weight != null ? `${fmtWeight(s.target.weight)} lb` : (ex && ex.equipment === 'bodyweight' ? 'Bodyweight' : (ex && ex.equipment === 'weighted_bw' ? '+0 lb' : 'Pick a weight'));
      const r = s.holdSeconds ? `${s.holdSeconds} s${s.perSide ? ' per side' : ''}` : (s.target && s.target.reps != null ? `× ${s.target.reps}${s.perSide ? '/side' : ''}` : (s.repRange ? `× ${repsText(s.repRange)}` : 'max reps'));
      main.appendChild(el('div', { class: 'step-target' }, [w, ' ', el('small', {}, r)]));
      if (s.repRange && !s.holdSeconds && s.repRange[0] !== s.repRange[1]) main.appendChild(el('div', { class: 'step-effort' }, `Range ${repsText(s.repRange)} · ${s.effortText}`));
      else if (s.effortText) main.appendChild(el('div', { class: 'step-effort' }, s.effortText));
      if (s.cue) main.appendChild(el('div', { class: 'step-cue' }, s.cue));
    } else if (s.cue) {
      main.appendChild(el('div', { class: 'step-cue' }, s.cue));
    }
    const timerCls = 'timer' + (s.kind === 'rest' ? ' rest' : '') + (!this.isCountdown(s) ? ' small' : '');
    main.appendChild(el('div', { class: timerCls, id: 'timer' }, '0:00'));
    if (paused) main.appendChild(el('div', { class: 'badge' }, 'Paused'));

    const next = this.nextStepText();
    const nextBox = el('div', { class: 'next' }, next);

    const actions = el('div', { class: 'player-actions' });
    if (s.kind === 'set') {
      const ex = this.plan.exercises[s.exerciseId];
      const showEdit = this.editOpen || (s.target && s.target.weight == null && ex && ex.equipment !== 'bodyweight' && !s.holdSeconds) || s.baseline || s.retest || (s.repRange == null && !s.holdSeconds);
      actions.appendChild(this.editPanel(s, ex, showEdit));
      actions.appendChild(el('button', { class: 'btn primary', onclick: () => this.logSet() }, s.holdSeconds ? 'Done early' : 'Done'));
      actions.appendChild(el('div', { class: 'secondary' }, [
        el('button', { class: 'btn', onclick: () => this.toggleEdit() }, this.editOpen ? 'Hide edit' : 'Edit'),
        el('button', { class: 'btn', onclick: () => this.skip() }, 'Skip set'),
        ...this.commonButtons()
      ]));
    } else if (s.kind === 'decision') {
      actions.appendChild(el('button', { class: 'btn primary', onclick: () => this.decide(true) }, 'Do it'));
      actions.appendChild(el('div', { class: 'secondary' }, [
        el('button', { class: 'btn', onclick: () => this.decide(false) }, 'Skip it'),
        ...this.commonButtons()
      ]));
    } else {
      actions.appendChild(el('button', { class: 'btn primary', onclick: () => this.advance() }, s.kind === 'rest' ? 'Skip rest' : 'Next'));
      actions.appendChild(el('div', { class: 'secondary' }, [
        el('button', { class: 'btn', onclick: () => this.addSeconds(30) }, '+30 s'),
        ...this.commonButtons()
      ]));
    }

    const wrap = el('div', { class: 'player' }, [head, main, nextBox, actions]);
    c.appendChild(wrap);
    this.updateTimerDom();
    const prog = c.querySelector('#prog'); if (prog) prog.style.width = `${Math.round(100 * doneCount / this.steps.length)}%`;
  }

  commonButtons() {
    const paused = this.s.pausedAt != null;
    return [
      el('button', { class: 'btn', onclick: () => (paused ? this.unpause() : this.pause()) }, paused ? 'Resume' : 'Pause'),
      el('button', { class: 'btn', onclick: () => this.back(), disabled: this.s.idx === 0 }, 'Back'),
      el('button', { class: 'btn', id: 'trim-btn', onclick: () => this.trimPreview(), hidden: true }, 'Trim'),
      el('button', { class: 'btn', onclick: () => this.confirmEnd() }, 'End')
    ];
  }

  editPanel(s, ex, open) {
    const rec = s.record || {};
    const wVal = rec.weight != null ? rec.weight : (s.target && s.target.weight != null ? s.target.weight : '');
    const rVal = rec.reps != null ? rec.reps : (s.holdSeconds ? s.holdSeconds : (s.target && s.target.reps != null ? s.target.reps : ''));
    const pVal = rec.rpe != null ? rec.rpe : (s.rpeDefault != null ? s.rpeDefault : '');
    const wStep = ex && ex.mainLift ? incrementFor(this.rules, s.exerciseId, ex) : (ex ? (this.rules.smallestJump[ex.equipment] || 5) : 5);
    const isBw = ex && ex.equipment === 'bodyweight';
    const panel = el('div', { class: 'edit-panel', id: 'edit-panel', hidden: !open });
    if (!isBw) panel.appendChild(field(ex && ex.equipment === 'weighted_bw' ? 'Added lb' : 'Weight (lb)', 'in-weight', wVal, wStep || 2.5));
    panel.appendChild(field(s.holdSeconds ? 'Seconds' : 'Reps', 'in-reps', rVal, 1));
    panel.appendChild(field('RPE', 'in-rpe', pVal, 0.5));
    if (isBw) panel.appendChild(el('div'));
    return panel;
  }
  toggleEdit() { this.editOpen = !this.editOpen; this.renderStep(); }
  openEdit() { this.editOpen = true; this.renderStep(); }

  nextStepText() {
    const i = this.s.idx + 1;
    const n = this.steps[i];
    if (!n) return 'Last step. Then the summary.';
    const after = this.steps[i + 1];
    const d = x => {
      if (!x) return '';
      if (x.kind === 'rest') return `Rest ${fmtClock(x.seconds)}`;
      if (x.kind === 'set') {
        const w = x.target && x.target.weight != null ? `${fmtWeight(x.target.weight)} lb` : '';
        const r = x.holdSeconds ? `${x.holdSeconds} s` : (x.target && x.target.reps != null ? `× ${x.target.reps}` : '');
        return `${x.name} ${w} ${r}`.replace(/\s+/g, ' ').trim();
      }
      if (x.kind === 'decision') return x.name;
      return `${x.name}${x.seconds ? ' ' + fmtClock(x.seconds) : ''}`;
    };
    const parts = [el('b', {}, 'Next: '), d(n)];
    if (after && n.kind === 'rest') parts.push(el('span', { class: 'muted' }, ` → ${d(after)}`));
    return parts;
  }

  updateTimerDom() {
    const t = this.container.querySelector('#timer');
    const s = this.step; if (!t || !s) return;
    if (this.isCountdown(s)) {
      const rem = this.remainingInStep(s);
      t.textContent = fmtClock(Math.ceil(rem));
      t.classList.toggle('warn', rem <= this.rules.timing.restWarningSeconds && rem > 0);
    } else {
      t.textContent = fmtClock(this.elapsedInStep());
    }
    const clock = this.container.querySelector('#clock');
    if (clock) {
      const p = this.projection();
      const d = p.deltaSeconds;
      const abs = Math.abs(d);
      const label = abs < 60 ? 'on time' : `${Math.round(abs / 60)} min ${d > 0 ? 'behind' : 'ahead'}`;
      clock.innerHTML = '';
      clock.appendChild(el('div', {}, `Finish ${fmtTime(p.projected)} (plan ${fmtTime(p.plannedFinish)})`));
      clock.appendChild(el('div', { class: 'delta ' + (d >= 60 ? 'behind' : (d <= -60 ? 'ahead' : '')) }, label));
      const tb = this.container.querySelector('#trim-btn');
      if (tb) tb.hidden = !(d >= 60 || p.overCapSeconds > 0);
    }
  }
}

function field(label, id, value, step) {
  const input = el('input', { type: 'number', id, value: value === '' ? '' : String(value), step: String(step), inputmode: 'decimal' });
  const minus = el('button', { type: 'button', onclick: () => { input.value = String(Math.max(0, (Number(input.value) || 0) - step)); } }, '−');
  const plus = el('button', { type: 'button', onclick: () => { input.value = String((Number(input.value) || 0) + step); } }, '+');
  return el('div', { class: 'field' }, [el('label', { for: id }, label), el('div', { class: 'stepper' }, [minus, input, plus])]);
}
