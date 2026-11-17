// player.js - Player: walks the timeline, timestamp timers, cues, wake lock, session clock, trim to fit,
// rest-end notifications when the app is in the background, live PR check, haptics.
// State lives in `this.s` and is saved to IndexedDB on every change so a session can be resumed.

import { trimToFit, remainingSeconds } from './builder.js';
import { setInProgress, clearInProgress } from './store.js';
import { fmtClock, fmtTime, fmtWeight, repsText, roundTo } from './data.js';
import { incrementFor, checkPR } from './progression.js';
import { el, showModal, closeModal, toast } from './ui.js';
import { icon } from './icons.js';

const RING_R = 92;
const RING_C = 2 * Math.PI * RING_R;

export class Player {
  constructor({ timeline, plan, rules, settings, targets, container, onFinish }) {
    this.plan = plan; this.rules = rules; this.settings = settings; this.targets = targets || {};
    this.container = container; this.onFinish = onFinish;
    this.s = {
      timeline, idx: 0, stepStart: null, side: 0,
      sessionStart: null, pausedAt: null, pausedTotal: 0,
      trims: [], warned: false, fired: false, status: 'running', startedISO: null, prs: []
    };
    this.audio = null; this.wakeLock = null; this.timer = null; this.editOpen = false; this.swReg = null;
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
    if (!this.s.prs) this.s.prs = [];
    if (this.s.pausedAt == null && this.s.status === 'running') {
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
    if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(r => { this.swReg = r; }).catch(() => {});
    this.renderStep();
    this.timer = setInterval(() => this.tick(), 250);
    this.persist();
  }

  teardown() {
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this._onVis);
    document.body.classList.remove('in-session');
    document.body.removeAttribute('data-kind');
    this.cancelScheduledNotification();
    if (this.wakeLock) { try { this.wakeLock.release(); } catch (e) { /* ignore */ } this.wakeLock = null; }
  }

  async requestWakeLock() {
    if (!(this.settings.keepScreenOn !== false) || !('wakeLock' in navigator)) return;
    try { this.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ }
  }

  onVisibility() {
    if (document.visibilityState === 'visible') {
      this.requestWakeLock();
      this.cancelScheduledNotification();
      this.tick(true);
    } else {
      this.scheduleNotification();
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
  tone(seq) {
    if (!this.settings.cues || !this.settings.cues.beep || !this.audio) return;
    try {
      if (this.audio.state === 'suspended') this.audio.resume();
      const t0 = this.audio.currentTime;
      seq.forEach(([f, dt, dur]) => {
        const o = this.audio.createOscillator(); const g = this.audio.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(0.4, t0 + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + dur);
        o.connect(g); g.connect(this.audio.destination); o.start(t0 + dt); o.stop(t0 + dt + dur + 0.05);
      });
    } catch (e) { /* ignore */ }
  }
  buzz(pattern) {
    if (!this.settings.cues || !this.settings.cues.vibrate || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
  }
  cue(kind) {
    if (kind === 'warn') { this.tone([[880, 0, 0.08]]); this.buzz(60); }
    else if (kind === 'pr') { this.tone([[660, 0, 0.12], [880, 0.14, 0.12], [1320, 0.28, 0.3]]); this.buzz([40, 60, 40, 60, 120]); }
    else if (kind === 'tap') { this.buzz(15); }
    else { this.tone([[880, 0, 0.15], [1320, 0.18, 0.25]]); this.buzz([200, 100, 200]); }
  }

  // ---- background notifications (F1) ----
  notificationsOn() {
    return !!(this.settings.cues && this.settings.cues.notify !== false && 'Notification' in window && Notification.permission === 'granted' && this.swReg);
  }
  notificationText() {
    const n = this.steps[this.s.idx + 1];
    const body = n ? `Next: ${this.describe(n)}` : 'Last step';
    return { title: 'Rest done', body };
  }
  scheduleNotification() {
    if (!this.notificationsOn() || !this.step || !this.isCountdown(this.step) || this.s.pausedAt != null) return;
    const endAt = this.s.stepStart + this.stepSeconds(this.step) * 1000;
    if (endAt <= Date.now()) return;
    const { title, body } = this.notificationText();
    if (this.swReg.active) this.swReg.active.postMessage({ type: 'schedule-rest-end', endAt, title, body });
  }
  cancelScheduledNotification() {
    if (this.swReg && this.swReg.active) this.swReg.active.postMessage({ type: 'cancel-rest-end' });
  }
  showNotificationNow() {
    if (!this.notificationsOn()) return;
    const { title, body } = this.notificationText();
    this.swReg.showNotification(title, { body, tag: 'rest-end', renotify: true, vibrate: [200, 100, 200], icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' }).catch(() => {});
  }

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
        if (document.hidden) this.showNotificationNow(); else this.cancelScheduledNotification();
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
    this.cancelScheduledNotification();
    if (idx >= this.steps.length) { this.finish('complete'); return; }
    this.renderStep();
    this.persist();
    if (document.hidden) this.scheduleNotification();
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
    this.s.pausedAt = Date.now(); this.cancelScheduledNotification(); this.renderStep(); this.persist();
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
    if (document.hidden) this.scheduleNotification();
  }
  decide(doIt) {
    const s = this.step;
    s.done = true;
    if (doIt) { this.goTo(this.s.idx + 1); return; }
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
    if (!auto) this.cue('tap');
    s.done = true; s.skipped = false; s.actualSeconds = Math.round(this.elapsedInStep());
    s.record = { ...this.baseRecord(s), weight: v.weight, reps: v.reps, rpe: v.rpe, done: true, skipped: false, at: new Date().toISOString() };

    // live PR check (work sets only; baseline/retest top sets count too, ramp-ups do not)
    if (!s.ramp && !s.holdSeconds && ex && v.weight != null && v.reps) {
      const bwAdd = ex.equipment === 'weighted_bw' ? (this.settings.bodyweightLb || 0) : 0;
      const kinds = checkPR(this.targets[s.exerciseId], v.weight, v.reps, bwAdd);
      if (kinds.length) {
        s.record.pr = kinds; s.pr = kinds;
        this.s.prs.push({ exerciseId: s.exerciseId, name: s.name, kinds, weight: v.weight, reps: v.reps });
        // keep the in-session best so a second PR in the same session is measured against it
        const t = this.targets[s.exerciseId] = { ...(this.targets[s.exerciseId] || {}) };
        const e = Math.round((v.weight + bwAdd) * (1 + v.reps / 30));
        if (kinds.includes('e1rm')) t.bestE1rm = e;
        if (kinds.includes('weight')) t.bestWeight = v.weight;
        this.cue('pr');
        toast(kinds.includes('e1rm') ? `PR: ${s.name} e1RM ${e} lb` : `PR: heaviest ${s.name} ${fmtWeight(v.weight)} lb`, 3000);
      }
    }

    if (s.baseline && v.weight != null) {
      const inc = incrementFor(this.rules, s.exerciseId, ex);
      const tw = roundTo(v.weight * this.rules.baseline.trainingFraction, inc);
      this.steps.forEach((o, i) => { if (i > this.s.idx && o.exerciseId === s.exerciseId && o.fillFromBaseline && !o.done) { o.target = { ...(o.target || {}), weight: tw }; } });
      toast(`Training weight for today: ${fmtWeight(tw)} lb`);
    } else if (!s.ramp && v.weight != null && s.target && v.weight !== s.target.weight) {
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
    showModal(el('div', {}, [
      el('h2', {}, 'Trim to fit'),
      el('p', { class: 'muted' }, `About ${Math.round(over / 60)} min to make up. This would:`),
      el('ul', { class: 'lines' }, res.notes.map(n => el('li', {}, n))),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: () => { this.applyTrim(res); closeModal(); } }, 'Apply')
      ])
    ]));
  }
  applyTrim(res) {
    this.s.timeline.steps = res.steps;
    this.s.trims.push(...res.notes);
    this.renderStep(); this.persist();
    toast(`Trimmed about ${Math.round(res.savedSeconds / 60)} min`);
  }

  // ---- menu (L5) ----
  openMenu() {
    const paused = this.s.pausedAt != null;
    const p = this.projection();
    const behind = p.deltaSeconds >= 60 || p.overCapSeconds > 0;
    const item = (ic, label, fn, cls) => el('button', { class: 'menu-item ' + (cls || ''), onclick: () => { closeModal(); fn(); } }, [icon(ic), el('span', {}, label)]);
    showModal(el('div', {}, [
      el('div', { class: 'menu' }, [
        item(paused ? 'play' : 'pause', paused ? 'Resume' : 'Pause', () => (paused ? this.unpause() : this.pause())),
        this.s.idx > 0 ? item('back', 'Back one step', () => this.back()) : null,
        behind ? item('scissors', `Trim to fit (${Math.round(Math.max(p.deltaSeconds, p.overCapSeconds) / 60)} min over)`, () => this.trimPreview()) : null,
        item('stop', 'End session early', () => this.confirmEnd(), 'danger')
      ]),
      el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Close')
    ]));
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
      plannedSeconds: this.s.timeline.plannedSeconds, trims: this.s.trims, livePrs: this.s.prs,
      sets: this.steps.filter(s => s.kind === 'set' && s.record).map(s => s.record)
    };
    this.teardown();
    clearInProgress().catch(() => {});
    this.onFinish(draft);
  }
  abandon() { this.teardown(); clearInProgress().catch(() => {}); }

  // ---- rendering ----
  describe(x) {
    if (!x) return '';
    if (x.kind === 'rest') return `Rest ${fmtClock(x.seconds)}`;
    if (x.kind === 'set') {
      const w = x.target && x.target.weight != null ? `${fmtWeight(x.target.weight)} lb` : '';
      const r = x.holdSeconds ? `${x.holdSeconds} s` : (x.target && x.target.reps != null ? `× ${x.target.reps}` : '');
      return `${x.name} ${w} ${r}`.replace(/\s+/g, ' ').trim();
    }
    if (x.kind === 'decision') return x.name;
    return `${x.name}${x.seconds ? ' ' + fmtClock(x.seconds) : ''}`;
  }

  kindGroup(s) {
    if (s.kind === 'rest') return 'rest';
    if (s.kind === 'stretch' || s.blockType === 'warmup' || s.kind === 'transition') return 'calm';
    return 'work';
  }

  renderStep() {
    const s = this.step; if (!s) return;
    const c = this.container; c.innerHTML = '';
    const tl = this.s.timeline;
    const doneCount = this.steps.filter(x => x.done || x.skipped).length;
    const paused = this.s.pausedAt != null;
    const group = this.kindGroup(s);
    document.body.setAttribute('data-kind', group);

    const where = `${s.blockName}${s.setIndex && s.setCount && !s.round ? ` · set ${s.setIndex} of ${s.setCount}` : ''}${s.round ? ` · round ${s.round} of ${s.roundCount}` : ''}`;
    const head = el('div', { class: 'player-head' }, [
      el('div', { class: 'head-left' }, [
        el('div', { class: 'label' }, tl.sessionName),
        el('div', { class: 'block' }, where)
      ]),
      el('div', { class: 'head-right' }, [
        el('div', { class: 'clock', id: 'clock' }),
        el('button', { class: 'icon-btn', 'aria-label': 'More', onclick: () => this.openMenu() }, icon('more'))
      ])
    ]);
    const prog = el('div', { class: 'progress' }, [el('div', { id: 'prog' })]);

    const main = el('div', { class: 'step-main' });
    const next = this.steps[this.s.idx + 1];
    const kindLabel = { set: s.ramp ? 'Ramp-up' : (s.baseline ? 'Baseline' : (s.retest ? 'Retest' : (s.holdSeconds ? 'Hold' : 'Work set'))), rest: 'Rest', timed: 'Timed', transition: 'Transition', stretch: 'Stretch', decision: 'Your call' }[s.kind] || s.kind;

    if (s.kind === 'rest') {
      // L3: compact rest screen. The timer leads; the next set is the content.
      main.appendChild(el('div', { class: 'label step-kind' }, 'Rest'));
      main.appendChild(this.timerBlock(true));
      if (next) {
        const after = this.steps[this.s.idx + 2];
        main.appendChild(el('div', { class: 'label', style: 'margin-top:14px' }, 'Up next'));
        main.appendChild(el('div', { class: 'step-name' }, next.name));
        if (next.kind === 'set') {
          const w = next.target && next.target.weight != null ? `${fmtWeight(next.target.weight)} lb` : '';
          const r = next.holdSeconds ? `${next.holdSeconds} s` : (next.target && next.target.reps != null ? `× ${next.target.reps}` : '');
          main.appendChild(el('div', { class: 'step-target muted-target' }, [w, ' ', el('small', {}, r)]));
          const prevSet = this.lastSetOf(next.exerciseId);
          const prevW = prevSet ? (prevSet.record && prevSet.record.weight != null ? prevSet.record.weight : (prevSet.target ? prevSet.target.weight : null)) : null;
          if (prevW != null && next.target && next.target.weight != null && prevW !== next.target.weight) {
            main.appendChild(el('div', { class: 'step-cue' }, `Change the bar: ${fmtWeight(prevW)} → ${fmtWeight(next.target.weight)} lb`));
          }
          if (next.effortText) main.appendChild(el('div', { class: 'step-effort' }, next.effortText));
        } else if (next.seconds) {
          main.appendChild(el('div', { class: 'step-effort' }, fmtClock(next.seconds)));
        }
        if (after && after.kind !== 'rest') main.appendChild(el('div', { class: 'step-cue' }, `Then: ${this.describe(after)}`));
      }
    } else {
      main.appendChild(el('div', { class: 'label step-kind' }, kindLabel + (s.holdSeconds && s.perSide ? (this.s.side === 0 ? ' · left' : ' · right') : '')));
      main.appendChild(el('div', { class: 'step-name' }, [s.name, s.pr ? el('span', { class: 'pr-badge' }, 'PR') : null]));
      if (s.kind === 'set') {
        const ex = this.plan.exercises[s.exerciseId];
        const w = s.target && s.target.weight != null ? `${fmtWeight(s.target.weight)} lb` : (ex && ex.equipment === 'bodyweight' ? 'Bodyweight' : (ex && ex.equipment === 'weighted_bw' ? '+0 lb' : 'Pick a weight'));
        const r = s.holdSeconds ? `${s.holdSeconds} s${s.perSide ? ' per side' : ''}` : (s.target && s.target.reps != null ? `× ${s.target.reps}${s.perSide ? '/side' : ''}` : (s.repRange ? `× ${repsText(s.repRange)}` : 'max reps'));
        main.appendChild(el('div', { class: 'step-target' }, [w, ' ', el('small', {}, r)]));
        if (s.repRange && !s.holdSeconds && s.repRange[0] !== s.repRange[1]) main.appendChild(el('div', { class: 'step-effort' }, `Range ${repsText(s.repRange)} · ${s.effortText}`));
        else if (s.effortText) main.appendChild(el('div', { class: 'step-effort' }, s.effortText));
        // L2: last time
        if (s.last && ((s.last.sets && s.last.sets.length) || s.last.topSet) && !s.ramp) {
          const l = s.last.sets && s.last.sets.length ? s.last : { ...s.last, sets: [s.last.topSet] };
          const sameW = l.sets.every(x => x.weight === l.sets[0].weight);
          const reps = l.sets.map(x => x.reps == null ? '?' : x.reps).join(', ');
          const rpes = l.sets.map(x => x.rpe).filter(x => x != null);
          const rpe = rpes.length ? ` @ RPE ${Math.max(...rpes)}` : '';
          const txt = sameW && l.sets[0].weight != null ? `${fmtWeight(l.sets[0].weight)} lb × ${reps}${rpe}` : l.sets.map(x => `${x.weight != null ? fmtWeight(x.weight) : 'bw'} × ${x.reps == null ? '?' : x.reps}`).join(', ') + rpe;
          main.appendChild(el('div', { class: 'last-time' }, [el('span', { class: 'label-inline' }, 'Last time'), ' ', txt]));
        }
        if (s.cue) main.appendChild(el('div', { class: 'step-cue' }, s.cue));
      } else if (s.cue) {
        main.appendChild(el('div', { class: 'step-cue' }, s.cue));
      }
      main.appendChild(this.timerBlock(this.isCountdown(s)));
      if (next) main.appendChild(el('div', { class: 'next' }, [el('b', {}, 'Next: '), this.describe(next), next.kind === 'rest' && this.steps[this.s.idx + 2] ? el('span', { class: 'muted' }, ` → ${this.describe(this.steps[this.s.idx + 2])}`) : null]));
    }
    if (paused) main.appendChild(el('div', { class: 'badge' }, 'Paused'));

    const actions = el('div', { class: 'player-actions' });
    if (s.kind === 'set') {
      const ex = this.plan.exercises[s.exerciseId];
      const showEdit = this.editOpen || (s.target && s.target.weight == null && ex && ex.equipment !== 'bodyweight' && !s.holdSeconds) || s.baseline || s.retest || (s.repRange == null && !s.holdSeconds);
      actions.appendChild(this.editPanel(s, ex, showEdit));
      actions.appendChild(el('button', { class: 'btn primary', onclick: () => this.logSet() }, [icon('check'), s.holdSeconds ? 'Done early' : 'Done']));
      actions.appendChild(el('div', { class: 'secondary' }, [
        el('button', { class: 'btn', onclick: () => this.toggleEdit() }, [icon('edit'), this.editOpen ? 'Hide' : 'Edit']),
        el('button', { class: 'btn', onclick: () => this.skip() }, [icon('skip'), 'Skip set'])
      ]));
    } else if (s.kind === 'decision') {
      actions.appendChild(el('button', { class: 'btn primary', onclick: () => this.decide(true) }, 'Do it'));
      actions.appendChild(el('div', { class: 'secondary' }, [el('button', { class: 'btn', onclick: () => this.decide(false) }, 'Skip it')]));
    } else {
      actions.appendChild(el('button', { class: 'btn primary', onclick: () => this.advance() }, [icon('skip'), s.kind === 'rest' ? 'Skip rest' : 'Next']));
      actions.appendChild(el('div', { class: 'secondary' }, [el('button', { class: 'btn', onclick: () => this.addSeconds(30) }, [icon('plus'), '30 s'])]));
    }

    const wrap = el('div', { class: 'player', 'data-kind': group }, [head, prog, main, actions]);
    c.appendChild(wrap);
    this.updateTimerDom();
    const pg = c.querySelector('#prog'); if (pg) pg.style.width = `${Math.round(100 * doneCount / this.steps.length)}%`;
  }

  lastSetOf(exerciseId) {
    for (let i = this.s.idx - 1; i >= 0; i--) { const x = this.steps[i]; if (x.kind === 'set' && x.exerciseId === exerciseId && !x.ramp) return x; }
    return null;
  }

  timerBlock(countdown) {
    if (!countdown) return el('div', { class: 'timer small', id: 'timer' }, '0:00');
    const ring = el('div', { class: 'ring-wrap' });
    ring.innerHTML = `<svg class="ring" viewBox="0 0 220 220" aria-hidden="true"><circle class="ring-bg" cx="110" cy="110" r="${RING_R}"/><circle class="ring-fg" id="ring-fg" cx="110" cy="110" r="${RING_R}" stroke-dasharray="${RING_C.toFixed(1)}" stroke-dashoffset="0"/></svg>`;
    ring.appendChild(el('div', { class: 'timer ring-timer', id: 'timer' }, '0:00'));
    return ring;
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

  updateTimerDom() {
    const t = this.container.querySelector('#timer');
    const s = this.step; if (!t || !s) return;
    if (this.isCountdown(s)) {
      const rem = this.remainingInStep(s);
      t.textContent = fmtClock(Math.ceil(rem));
      t.classList.toggle('warn', rem <= this.rules.timing.restWarningSeconds && rem > 0);
      const fg = this.container.querySelector('#ring-fg');
      if (fg) { const total = this.stepSeconds(s) || 1; fg.setAttribute('stroke-dashoffset', (RING_C * (1 - rem / total)).toFixed(1)); }
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
      clock.appendChild(el('div', { class: 'delta ' + (d >= 60 ? 'behind' : (d <= -60 ? 'ahead' : '')) }, label));
      clock.appendChild(el('div', { class: 'finish' }, `Finish ${fmtTime(p.projected)}`));
      if (d >= 60 || p.overCapSeconds > 0) {
        clock.appendChild(el('button', { class: 'chip-btn', id: 'trim-btn', onclick: () => this.trimPreview() }, [icon('scissors'), 'Trim']));
      }
    }
  }
}

function field(label, id, value, step) {
  const input = el('input', { type: 'number', id, value: value === '' ? '' : String(value), step: String(step), inputmode: 'decimal' });
  const minus = el('button', { type: 'button', 'aria-label': 'less', onclick: () => { input.value = String(Math.max(0, (Number(input.value) || 0) - step)); } }, '−');
  const plus = el('button', { type: 'button', 'aria-label': 'more', onclick: () => { input.value = String((Number(input.value) || 0) + step); } }, '+');
  return el('div', { class: 'field' }, [el('label', { for: id }, label), el('div', { class: 'stepper' }, [minus, input, plus])]);
}
