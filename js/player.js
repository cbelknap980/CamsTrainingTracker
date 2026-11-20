// player.js - Player: walks the timeline, timestamp timers, cues, wake lock, session clock, trim to fit,
// rest-end notifications when the app is in the background, live PR check, haptics.
// v1.4: sets end on their own timer (logged at target, fixed on the rest screen), a get-ready countdown before
// every set, voice prompts, a pace bar, effort buttons, work/rest colors.
// v1.5: Pause in the header on every screen, a Set-up done tap before each new block, an Equipment taken swap,
// two-dumbbell weights as totals, and a last-set card with weight and rep steppers and a Saved check.
// State lives in `this.s` and is saved to IndexedDB on every change so a session can be resumed.

import { trimToFit, remainingSeconds } from './builder.js';
import { setInProgress, clearInProgress } from './store.js';
import { fmtClock, fmtTime, fmtWeight, fmtMinutes, repsText, roundTo, effortPlain, effortLevel, spokenDuration, isPair, pairText } from './data.js';
import { incrementFor, checkPR } from './progression.js';
import { el, showModal, closeModal, toast, hideToast, effortChips, onBack, dropBack, countUp } from './ui.js';
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
    this.pendingRpe = null; this.said = []; this.savedAt = 0;
    this._onVis = () => this.onVisibility();
  }

  // ---- lifecycle ----
  start() {
    const now = Date.now();
    this.s.sessionStart = now; this.s.startedISO = new Date(now).toISOString();
    this.s.stepStart = now;
    this.boot();
    this.announce();
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
    // v1.14: Android Back during a workout opens the menu (Pause, End early) instead of leaving the app
    const onBackPress = () => { onBack('workout', onBackPress); if (!modalOpen()) this.openMenu(); };
    onBack('workout', onBackPress);
  }

  teardown() {
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this._onVis);
    document.body.classList.remove('in-session');
    document.body.removeAttribute('data-kind');
    this.cancelScheduledNotification();
    dropBack('workout');
    try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
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
    else if (kind === 'tick') { this.tone([[880, 0, 0.09]]); this.buzz(40); }
    else if (kind === 'go') { this.tone([[1320, 0, 0.35]]); this.buzz(250); }
    else if (kind === 'setEnd') { this.tone([[880, 0, 0.14], [587, 0.17, 0.3]]); this.buzz([200, 100, 200]); }
    else { this.tone([[880, 0, 0.15], [1320, 0.18, 0.25]]); this.buzz([200, 100, 200]); }
  }

  // ---- voice (v1.4) ----
  say(text) {
    if (!text) return;
    this.said.push(text); if (this.said.length > 40) this.said.shift();
    if (!this.settings.cues || this.settings.cues.voice === false || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }
  setSpeech(x) {
    if (x.baseline || x.retest) return `${x.name}. ${x.effortText}.`;
    const parts = [x.name];
    if (x.ramp) parts.push('ramp-up');
    else if (x.round) parts.push(`round ${x.round} of ${x.roundCount}`);
    else if (x.setIndex && x.setCount) parts.push(`set ${x.setIndex} of ${x.setCount}`);
    if (x.target && x.target.weight != null) parts.push(`${fmtWeight(x.target.weight)} pounds${isPair(this.plan.exercises[x.exerciseId]) ? ' total' : ''}`);
    if (x.holdSeconds) parts.push(`${x.holdSeconds} seconds${x.perSide ? ' each side' : ''}`);
    else if (x.target && x.target.reps != null) parts.push(`${x.target.reps} reps${x.perSide ? ' each side' : ''}`);
    return parts.join(', ') + '.';
  }
  announce() {
    const s = this.step; if (!s) return;
    const prev = this.steps[this.s.idx - 1];
    if (s.kind === 'rest') this.say(`Rest. ${spokenDuration(s.seconds)}.`);
    else if (s.kind === 'transition') this.say(`${s.name.replace(/\s*\+\s*/g, ' and ').replace(/[()]/g, ',')}. ${spokenDuration(s.seconds)}.`);
    else if (s.kind === 'set') this.say(prev && this.leadsIntoSet(this.s.idx - 1) && !s.baseline && !s.retest ? 'Go.' : this.setSpeech(s));
    else if (s.kind === 'timed' || s.kind === 'stretch') this.say(`${s.name}. ${spokenDuration(s.seconds)}.`);
    else if (s.kind === 'decision') this.say(s.name);
  }

  // ---- background notifications (F1) ----
  notificationsOn() {
    return !!(this.settings.cues && this.settings.cues.notify !== false && 'Notification' in window && Notification.permission === 'granted' && this.swReg);
  }
  notificationText() {
    const n = this.steps[this.s.idx + 1];
    const body = n ? `Next: ${this.describe(n)}` : 'Last step';
    if (this.waiting()) return { title: 'Set-up time is up', body: n ? `Tap Set-up done for ${n.name}` : body };
    return { title: 'Rest done', body };
  }
  scheduleNotification() {
    if (!this.notificationsOn() || !this.step || !this.isCountdown(this.step) || this.s.pausedAt != null) return;
    const endAt = this.s.stepStart + (this.stepSeconds(this.step) - (this.waiting() ? this.holdAt() : 0)) * 1000;
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
  autoOn() { return this.settings.autoAdvance !== false; }
  /** A set that ends on its own timer: a normal work or ramp-up set, with auto-advance on. */
  isAutoSet(step = this.step) { return !!(step && step.kind === 'set' && step.auto && !step.holdSeconds && this.autoOn()); }
  /** A rest or set-up countdown whose next step is a set: it ends with the get-ready count. */
  leadsIntoSet(idx = this.s.idx) {
    const a = this.steps[idx]; const b = this.steps[idx + 1];
    return !!(a && b && (a.kind === 'rest' || a.kind === 'transition') && b.kind === 'set');
  }
  /** v1.5: does this countdown wait for a Set-up done tap? Yes before the first set of a new block (rules.timing.confirmSetup). */
  needsConfirm(idx = this.s.idx) {
    const mode = this.rules.timing.confirmSetup;
    if (this.settings.confirmSetup === false || !mode || mode === 'off' || !this.leadsIntoSet(idx)) return false;
    const next = this.steps[idx + 1];
    for (let i = idx - 1; i >= 0; i--) {
      const x = this.steps[i];
      if (x.kind !== 'set') continue;
      if (mode === 'exercise') { if (x.exerciseId === next.exerciseId) return false; }
      else return x.blockId !== next.blockId;
    }
    return true;
  }
  waiting() { return !this.s.confirmed && this.needsConfirm(); }
  /** The set-up clock has run out and the step is holding for the tap. */
  held() { return this.waiting() && this.remainingInStep() <= this.holdAt() + 0.3; }
  phaseKind(group) { return this.isReady() || this.held() ? 'ready' : group; }
  /** Seconds left on the clock where a waiting set-up step holds: the start of the get-ready count. */
  holdAt(step = this.step) { return Math.min(this.rules.timing.getReadySeconds, this.stepSeconds(step)); }
  confirmSetup() {
    if (!this.waiting()) return;
    this.s.confirmed = true; this.cue('tap');
    const total = this.stepSeconds(this.step); const g = this.holdAt();
    if (this.remainingInStep() > g) this.s.stepStart = this.now() - (total - g) * 1000; // straight to the get-ready count
    this.s.fired = false; this.s.readySaid = false; this.s.lastTickSec = null;
    this.renderStep(); this.persist();
  }
  isReady() {
    if (!this.leadsIntoSet() || this.s.pausedAt != null || this.waiting()) return false;
    const rem = this.remainingInStep();
    return rem > 0 && rem <= this.rules.timing.getReadySeconds && this.stepSeconds(this.step) > this.rules.timing.getReadySeconds;
  }

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
    if (this.isAutoSet(step)) {
      // once the edit panel has been opened the set waits for a Done tap, so typed numbers are not lost
      if (step.seconds - this.elapsedInStep() <= 0 && !this.s.fired && !this.s.manual && !modalOpen()) {
        this.s.fired = true;
        this.cue('setEnd');
        this.logSet({ auto: true });
        return;
      }
    }
    if (this.isCountdown(step) && this.waiting()) {
      // v1.5: the set-up clock runs down, then holds until Set-up done is tapped
      const g = this.holdAt(step);
      if (this.remainingInStep(step) <= g) {
        this.s.stepStart = Date.now() - (this.stepSeconds(step) - g) * 1000;
        if (!this.s.waitSaid) {
          this.s.waitSaid = true; this.cue('end'); this.say('Tap set-up done when you are ready.');
          if (document.hidden) this.showNotificationNow();
          this.renderStep();
        }
      }
      this.updateTimerDom();
      if (Date.now() - (this.s.lastTick || 0) > 5000) this.persist();
      return;
    }
    if (this.isCountdown(step)) {
      const rem = this.remainingInStep(step);
      const warnAt = this.rules.timing.restWarningSeconds;
      const lead = this.leadsIntoSet();
      const ticks = this.settings.cues && this.settings.cues.warningTick;
      if (lead && this.isReady()) {
        // get-ready count: say what is coming, then a tick on each of the last 3 seconds
        if (!this.s.readySaid) { this.s.readySaid = true; this.say(this.setSpeech(this.steps[this.s.idx + 1])); this.renderStep(); }
        const sec = Math.ceil(rem);
        if (ticks && sec <= warnAt && sec !== this.s.lastTickSec) { this.s.lastTickSec = sec; this.cue('tick'); }
      } else if (!lead && !this.s.warned && rem <= warnAt && rem > 0 && ticks && this.stepSeconds(step) > warnAt + 2) {
        this.s.warned = true; this.cue('warn');
      }
      if (rem <= 0 && !this.s.fired) {
        this.s.fired = true;
        this.cue(lead ? 'go' : 'end');
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
    this.s.readySaid = false; this.s.lastTickSec = null; this.s.manual = false; this.pendingRpe = null;
    this.s.confirmed = false; this.s.waitSaid = false;
    this.cancelScheduledNotification();
    if (idx >= this.steps.length) { this.finish('complete'); return; }
    this.renderStep();
    try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
    this.announce();
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
    const idx = this.s.idx;
    const before = { done: s.done, skipped: s.skipped, record: s.record };
    if (s.kind === 'set') { s.skipped = true; s.done = false; s.record = { ...this.baseRecord(s), done: false, skipped: true }; }
    else { s.skipped = true; s.done = true; }
    this.goTo(this.s.idx + 1);
    // v1.14: a skip by mistake comes back with one tap
    if (s.kind === 'set') toast(`Skipped ${s.name}`, 5000, { action: 'Undo', onAction: () => { if (this.s.idx !== idx + 1) return; Object.assign(s, before); if (before.record === undefined) delete s.record; this.goTo(idx); } });
  }
  /** v1.14: take back the set just logged (from the rest screen): back to that set, as it was before Done. */
  undoLast() {
    const idx = this.s.idx - 1;
    const p = this.steps[idx];
    if (!p || p.kind !== 'set' || !p.record || !p.record.done || !p.undo) return;
    const u = p.undo;
    if (u.prs != null) this.s.prs.length = u.prs;
    if (u.target !== undefined) { if (u.target) this.targets[p.exerciseId] = u.target; else delete this.targets[p.exerciseId]; }
    if (u.carried) u.carried.forEach(([i, t]) => { if (this.steps[i]) this.steps[i].target = t; });
    p.done = false; p.skipped = false; delete p.record; delete p.pr; delete p.undo;
    hideToast();
    this.goTo(idx);
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
    s.seconds = (s.seconds || 0) + n; this.s.fired = false; this.s.warned = false; this.s.waitSaid = false;
    if (this.s.readySaid && !this.isReady()) { this.s.readySaid = false; this.s.lastTickSec = null; this.renderStep(); }
    if (this.needsConfirm()) this.renderStep();
    this.updateTimerDom(); this.persist();
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
    const num = x => (x && x.value !== '' ? Number(x.value) : null);
    return { weight: num(w), reps: num(r), rpe: this.pendingRpe != null ? this.pendingRpe : this.defaultRpe(this.step) };
  }
  /** The effort button that is pre-selected for a set: the level its target falls in. */
  defaultRpe(s) {
    if (!s || s.rpeDefault == null) return null;
    const l = effortLevel(this.rules, s.rpeDefault);
    return l ? l.rpe : s.rpeDefault;
  }
  /** After a set's weight is known or corrected: carry it to the sets of that exercise still to come. */
  carryWeight(idx, s, weight, oldWeight) {
    if (weight == null) return;
    const ex = this.plan.exercises[s.exerciseId];
    if (s.baseline) {
      const inc = incrementFor(this.rules, s.exerciseId, ex);
      const tw = roundTo(weight * this.rules.baseline.trainingFraction, inc);
      this.steps.forEach((o, i) => { if (i > idx && o.exerciseId === s.exerciseId && o.fillFromBaseline && !o.done) { o.target = { ...(o.target || {}), weight: tw }; } });
      toast(`Training weight for today: ${fmtWeight(tw)} lb`);
    } else if (!s.ramp && weight !== oldWeight) {
      this.steps.forEach((o, i) => { if (i > idx && o.exerciseId === s.exerciseId && o.kind === 'set' && !o.ramp && !o.done && o.target && (o.target.weight === oldWeight || o.target.weight == null)) o.target = { ...o.target, weight }; });
    }
  }
  /** Correct a set that is already logged (from the rest screen). */
  fixRecord(idx, patch) {
    const s = this.steps[idx]; if (!s || !s.record) return;
    const old = s.record.weight;
    Object.assign(s.record, patch);
    s.record.edited = true; this.savedAt = Date.now();
    if ('weight' in patch && patch.weight !== old) this.carryWeight(idx, s, patch.weight, old != null ? old : (s.target ? s.target.weight : null));
    this.persist();
  }
  logSet({ auto } = {}) {
    const s = this.step;
    // v1.17: when the edit panel is on screen (it opens by itself on a set with no weight), a set that ends on its
    // timer keeps what was typed there instead of logging the target (the typed weight used to be lost)
    const panel = this.container.querySelector('#edit-panel');
    const typed = auto && panel && !panel.hidden ? this.readInputs() : null;
    const v = auto ? { weight: typed && typed.weight != null ? typed.weight : (s.target ? s.target.weight : null), reps: s.holdSeconds || (typed && typed.reps != null ? typed.reps : (s.target ? s.target.reps : null)), rpe: typed ? typed.rpe : this.defaultRpe(s) } : this.readInputs();
    if (s.holdSeconds && v.reps == null) v.reps = s.holdSeconds;
    const ex = this.plan.exercises[s.exerciseId];
    const needsWeight = ex && ex.equipment !== 'bodyweight' && !s.holdSeconds;
    if (needsWeight && v.weight == null && !auto && !this.isAutoSet(s)) { toast('Enter the weight you used'); this.openEdit(); return; }
    if (v.reps == null && !auto && !s.holdSeconds) { toast('Enter reps'); this.openEdit(); return; }
    // v1.14: what Undo needs to put back (PR list, the in-session best, weights carried to later sets)
    s.undo = { prs: this.s.prs.length, target: this.targets[s.exerciseId] ? { ...this.targets[s.exerciseId] } : null, carried: this.steps.map((o, i) => [i, o.target ? { ...o.target } : o.target]).filter(([i]) => i > this.s.idx && this.steps[i].exerciseId === s.exerciseId) };
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

    if (s.baseline || (s.target && v.weight !== s.target.weight)) this.carryWeight(this.s.idx, s, v.weight, s.target ? s.target.weight : null);
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

  // ---- equipment taken: do a later block now (v1.5) ----
  blockSetNames(blockId) {
    return [...new Set(this.steps.filter(st => st.blockId === blockId && st.kind === 'set').map(st => st.name))];
  }
  blockTitle(blockId) {
    const first = this.steps.find(st => st.blockId === blockId);
    const letter = first && /^[A-Z]$/.test(first.blockName);
    return `${letter ? 'Block ' + first.blockName : (first ? first.blockName : blockId)}: ${this.blockSetNames(blockId).join(', ')}`;
  }
  /** Later blocks that have not been started and can be done now instead of the one coming up. */
  swapChoices() {
    if (!this.leadsIntoSet()) return [];
    const n = this.s.idx + 1;
    const seen = new Set([this.steps[n].blockId]);
    const out = [];
    for (let i = n; i < this.steps.length; i++) {
      const st = this.steps[i];
      if (seen.has(st.blockId)) continue;
      seen.add(st.blockId);
      if (!['straight', 'superset', 'finisher'].includes(st.blockType) || st.iftime) continue;
      let to = i; while (to < this.steps.length && this.steps[to].blockId === st.blockId) to++;
      const part = this.steps.slice(i, to);
      if (part[0].kind !== 'set' || part.some(x => x.done || x.skipped)) continue;
      out.push({ blockId: st.blockId, from: i, to, title: this.blockTitle(st.blockId) });
    }
    return out;
  }
  openSwap() {
    const choices = this.swapChoices();
    if (!choices.length) { toast('Nothing later in this session to swap with'); return; }
    const cur = this.steps[this.s.idx + 1];
    showModal(el('div', {}, [
      el('h2', {}, 'Equipment taken?'),
      el('p', { class: 'muted' }, `Pick what to do now. ${this.blockSetNames(cur.blockId).join(' and ')} ${this.blockSetNames(cur.blockId).length > 1 ? 'move' : 'moves'} to right after it.`),
      el('div', { class: 'menu' }, choices.map(c => el('button', { class: 'menu-item swap-choice', onclick: () => { closeModal(); this.doSwap(c); } }, [icon('skip'), el('span', {}, c.title)]))),
      el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Cancel')
    ]));
  }
  doSwap(c) {
    const steps = this.steps;
    const n = this.s.idx + 1;
    const cur = steps[n].blockId;
    let xEnd = n; while (xEnd < steps.length && steps[xEnd].blockId === cur) xEnd++;
    if (c.from < xEnd) return;
    const next = [...steps.slice(0, n), ...steps.slice(c.from, c.to), ...steps.slice(n, xEnd), ...steps.slice(xEnd, c.from), ...steps.slice(c.to)];
    // the countdown before each block names what it now leads into
    next.forEach((st, i) => {
      st.idx = i;
      const nx = next[i + 1];
      if (!nx || (st.kind !== 'transition' && st.kind !== 'rest')) return;
      const between = st.kind === 'transition' && !st.lead && /^Set up for /.test(st.name);
      if (nx.kind !== 'set') { if (between) st.name = nx.kind === 'stretch' ? 'Set up for the stretch block' : `Set up for ${nx.name}`; return; }
      const names = [...new Set(next.filter(o => o.blockId === nx.blockId && o.kind === 'set').map(o => o.name))];
      if (between) st.name = `Set up for ${names.join(' + ')}`;
      if (st.setupFor) st.setupFor = nx.name;
    });
    const prev = { steps, names: steps.map(st => [st.name, st.setupFor]) };
    this.s.timeline.steps = next;
    this.goTo(this.s.idx);
    // v1.14: Undo puts the blocks back in their planned order
    const at = this.s.idx;
    toast(`Doing ${c.title.split(':')[0]} now`, 5000, { action: 'Undo', onAction: () => {
      if (this.s.idx !== at) return;
      prev.steps.forEach((st, i) => { st.idx = i; st.name = prev.names[i][0]; st.setupFor = prev.names[i][1]; });
      this.s.timeline.steps = prev.steps;
      this.goTo(at);
    } });
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
        this.swapChoices().length ? item('skip', 'Equipment taken: do another block now', () => this.openSwap()) : null,
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
  /** endAtMs: v1.17, when the session really stopped (Save what I did and stop, after the app was closed). */
  finish(status, endAtMs) {
    this.s.status = status;
    this.steps.forEach((s, i) => { if (i >= this.s.idx && !s.done && !s.skipped) { s.skipped = true; if (s.kind === 'set') s.record = { ...this.baseRecord(s), done: false, skipped: true }; } });
    const endedAt = endAtMs && endAtMs > this.s.sessionStart ? Math.min(endAtMs, Date.now()) : Date.now();
    const draft = {
      timeline: this.s.timeline, status, startedAt: this.s.startedISO, endedAt: new Date(endedAt).toISOString(),
      actualSeconds: Math.round((endedAt - this.s.sessionStart - this.s.pausedTotal) / 1000), pausedSeconds: Math.round(this.s.pausedTotal / 1000),
      plannedSeconds: this.s.timeline.plannedSeconds, trims: this.s.trims, livePrs: this.s.prs,
      // v1.14: minutes of the Engine finisher actually done, for the Hard efforts ring on Home
      engineMinutes: Math.round(this.steps.filter(x => x.blockType === 'emom' && x.done && !x.skipped).reduce((m, x) => m + (x.actualSeconds || x.seconds || 0), 0) / 60),
      sets: this.steps.filter(s => s.kind === 'set' && s.record).map(s => s.record)
    };
    this.teardown();
    clearInProgress().catch(() => {});
    this.onFinish(draft);
  }
  abandon() { this.teardown(); clearInProgress().catch(() => {}); }

  // ---- session progress (v1.2) ----
  blockSummary() {
    const blocks = [];
    const byId = {};
    this.steps.forEach((st, i) => {
      let b = byId[st.blockId];
      if (!b) {
        b = { id: st.blockId, name: st.blockName, type: st.blockType, label: this.blockLabel(st.blockId), planned: 0, done: 0, steps: 0, doneSteps: 0, firstIdx: i, exercises: [] };
        byId[st.blockId] = b; blocks.push(b);
      }
      const secs = st.holdSeconds ? st.holdSeconds * (st.perSide ? 2 : 1) : (st.seconds || 0);
      b.planned += secs; b.steps += 1;
      if (st.done || st.skipped) { b.doneSteps += 1; b.done += secs; }
      if (i === this.s.idx) { b.current = true; b.done += Math.min(secs, this.elapsedInStep()); }
      if (st.kind === 'set' && !st.ramp) {
        let e = b.exercises.find(x => x.exerciseId === st.exerciseId);
        if (!e) { e = { exerciseId: st.exerciseId, name: st.name, sets: [] }; b.exercises.push(e); }
        e.sets.push({ idx: i, done: !!st.done, skipped: !!st.skipped, current: i === this.s.idx, weight: st.record ? st.record.weight : (st.target ? st.target.weight : null), reps: st.record ? st.record.reps : (st.target ? st.target.reps : null), baseline: st.baseline, pr: st.pr });
      }
    });
    return blocks;
  }
  blockLabel(blockId) {
    const first = this.steps.find(st => st.blockId === blockId);
    if (!first) return blockId;
    if (first.blockType === 'warmup') return 'Warm';
    if (first.blockType === 'stretch') return 'Stretch';
    if (first.blockType === 'finisher') return first.blockName === 'Last' ? 'Last' : 'Finisher';
    if (first.blockType === 'iftime') return 'If time';
    if (first.blockType === 'emom') return first.blockName || 'Engine';
    const ids = [...new Set(this.steps.filter(st => st.blockId === blockId && st.kind === 'set' && !st.ramp).map(st => st.exerciseId))];
    const names = ids.map(id => (this.plan.exercises[id] && this.plan.exercises[id].short) || (this.plan.exercises[id] && this.plan.exercises[id].name) || id);
    return names.slice(0, 2).join(' / ');
  }
  renderStrip() {
    const blocks = this.blockSummary();
    const total = blocks.reduce((a, b) => a + b.planned, 0) || 1;
    const bar = el('div', { class: 'strip-bar' }, blocks.map(b => {
      const fill = b.planned ? Math.min(100, Math.round(100 * b.done / b.planned)) : (b.doneSteps === b.steps ? 100 : 0);
      return el('div', { class: 'seg' + (b.current ? ' current' : '') + (b.doneSteps === b.steps && !b.current ? ' finished' : ''), style: `flex: ${Math.max(b.planned, 75)} 0 0` }, [
        el('div', { class: 'seg-track' }, [el('div', { class: 'seg-fill', style: `width:${fill}%` })]),
        el('div', { class: 'seg-label' }, b.label)
      ]);
    }));
    const status = el('div', { class: 'strip-status', id: 'clock' });
    const strip = el('button', { class: 'strip', onclick: () => this.openOverview(), 'aria-label': 'Session overview' }, [bar, status]);
    return strip;
  }
  openOverview() {
    const blocks = this.blockSummary();
    const p = this.projection();
    const d = p.deltaSeconds;
    const body = el('div', { class: 'overview' }, [
      el('div', { class: 'row' }, [el('h2', {}, this.s.timeline.sessionName), el('span', { class: 'muted' }, `${fmtMinutes(p.remaining)} left · finish ${fmtTime(p.projected)}`)]),
      el('p', { class: 'muted', style: 'margin-top:-4px' }, `${Math.abs(d) < 60 ? 'On time' : `${Math.round(Math.abs(d) / 60)} min ${d > 0 ? 'behind' : 'ahead'}`} · planned ${fmtMinutes(this.s.timeline.plannedSeconds)}`),
      ...blocks.map(b => el('div', { class: 'ov-block' + (b.current ? ' current' : '') }, [
        el('div', { class: 'row' }, [
          el('b', {}, ['warmup', 'stretch', 'finisher', 'iftime'].includes(b.type) ? b.name : `${b.name} · ${b.label}`),
          el('span', { class: 'muted' }, `${b.doneSteps === b.steps ? 'done' : (b.current ? 'now' : 'up next')} · ${Math.round(b.done / 60)}/${Math.round(b.planned / 60)} min`)
        ]),
        b.exercises.length ? el('div', { class: 'ov-ex' }, b.exercises.map(e => el('div', { class: 'ov-row' }, [
          el('span', { class: 'ov-name' }, e.name),
          el('span', { class: 'ov-sets' }, e.sets.map(x => el('span', { class: 'tick' + (x.done ? ' done' : (x.skipped ? ' skipped' : (x.current ? ' current' : ''))), title: x.weight != null ? `${fmtWeight(x.weight)} × ${x.reps}` : '' }, x.done ? '✓' : (x.skipped ? '–' : (x.current ? '●' : '○'))))),
          el('span', { class: 'ov-target muted' }, e.sets[0] && e.sets[0].weight != null ? `${fmtWeight(e.sets.find(x => x.current) ? e.sets.find(x => x.current).weight : e.sets[0].weight)} lb` : '')
        ]))) : el('div', { class: 'muted', style: 'font-size:var(--t-small)' }, b.type === 'warmup' ? 'Timed holds' : (b.type === 'stretch' ? 'Couch, 90/90, forward fold, calf' : ''))
      ])),
      el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Close')
    ]);
    showModal(body);
  }
  readout(weightText, repsLabel, repsText, effortText, accent, rpe, pairSub) {
    const lvl = effortLevel(this.rules, rpe);
    return el('div', { class: 'readout step-target' + (accent ? '' : ' quiet') }, [
      el('div', { class: 'tile tile-weight' }, [el('div', { class: 'tile-label' }, pairSub ? 'Total weight' : 'Weight'), el('div', { class: 'tile-value' }, weightText), pairSub ? el('div', { class: 'tile-sub' }, pairSub + ' lb') : null]),
      el('div', { class: 'tile' }, [el('div', { class: 'tile-label' }, repsLabel), el('div', { class: 'tile-value' }, repsText)]),
      el('div', { class: 'tile tile-effort' }, [el('div', { class: 'tile-label' }, 'Effort'), el('div', { class: 'tile-value small' }, [lvl && effortText ? el('span', { class: 'dot effort-' + lvl.key }) : null, (effortText || '–').replace(' in the tank', '\nin the tank').replace('close: ', 'close:\n')])])
    ]);
  }
  /**
   * v1.14: the work-set readout. The weight is the one big number (readable from the floor mid-set); reps and
   * effort follow on one line.
   */
  heroReadout(weightText, repsLabel, repsText, effortText, rpe, pairSub) {
    const lvl = effortLevel(this.rules, rpe);
    const m = /^([+]?[\d.]+)\s*lb$/.exec(weightText || '');
    const num = m ? m[1] : weightText;
    return el('div', { class: 'readout step-target hero', id: 'hero-readout' }, [
      el('div', { class: 'hero-weight tile-weight' + (m ? '' : ' word') }, [
        el('span', { class: 'hw-num' }, num), m ? ' ' : null, m ? el('span', { class: 'hw-unit' }, pairSub ? 'lb total' : 'lb') : null,
        pairSub ? el('div', { class: 'tile-sub' }, pairSub + ' lb') : null
      ]),
      el('div', { class: 'hero-line' }, [
        el('span', { class: 'hl-reps' }, [el('b', {}, repsText), ' ', repsLabel.toLowerCase()]),
        effortText ? el('span', { class: 'hl-sep', 'aria-hidden': 'true' }, '·') : null,
        effortText ? el('span', { class: 'hl-effort' }, [lvl ? el('span', { class: 'dot effort-' + lvl.key }) : null, effortText]) : null
      ])
    ]);
  }
  cuesOpen(s) {
    const mem = this.s.cuesOpen && this.s.cuesOpen[s.exerciseId];
    if (mem != null) return mem;
    return !!(s.baseline || s.retest || s.setIndex === 1 || s.round === 1 || s.holdSeconds);
  }
  /** Effort target in plain words for a set ("Leave 2-3 in the tank"). */
  effortWords(x) {
    if (x.ramp) return 'Easy';
    if (x.baseline || x.retest) return x.effort ? effortPlain(x.effort) : '';
    return x.effort ? effortPlain(x.effort) : (x.effortText || '');
  }
  whereText(x) {
    const parts = [];
    if (x.equipment) parts.push(x.equipment);
    if (x.ramp) parts.push('Ramp-up');
    else if (x.baseline) parts.push('Baseline set');
    else if (x.retest) parts.push('Retest set');
    else if (x.round) parts.push(`Round ${x.round} of ${x.roundCount}`);
    else if (x.setIndex && x.setCount) parts.push(`Set ${x.setIndex} of ${x.setCount}`);
    return parts.join(' · ');
  }
  /**
   * Rest screen: the set that just ended, as its own card. v1.5: weight and reps change with - and + right here
   * (tap a number to type it), and a check shows that the set is logged or that a change was saved.
   */
  justDone(idx) {
    const p = this.steps[idx];
    if (!p || p.kind !== 'set' || !p.record || !p.record.done) return null;
    const ex = this.plan.exercises[p.exerciseId];
    const rec = p.record;
    const isBw = ex && ex.equipment === 'bodyweight';
    const hasWeight = !isBw && !p.holdSeconds;
    const needs = hasWeight && rec.weight == null;
    const wStep = (ex ? incrementFor(this.rules, p.exerciseId, ex) : 5) || 5;
    const change = patch => { this.fixRecord(idx, patch); this.renderStep(); };
    const stepper = (key, label, value, sub, minus, plus) => el('div', { class: 'jd-step' }, [
      el('div', { class: 'jd-step-label' }, label),
      el('div', { class: 'jd-step-row' }, [
        el('button', { type: 'button', class: 'jd-pm', id: `jd-${key}-minus`, 'aria-label': `less ${label}`, onclick: minus }, '−'),
        el('button', { type: 'button', class: 'jd-val' + (needs && key === 'w' ? ' needs' : ''), id: `jd-${key}`, 'aria-label': `type ${label}`, onclick: () => this.openFix(idx) }, [el('span', {}, value), sub ? el('small', {}, sub) : null]),
        el('button', { type: 'button', class: 'jd-pm', id: `jd-${key}-plus`, 'aria-label': `more ${label}`, onclick: plus }, '+')
      ])
    ]);
    const w = rec.weight != null ? rec.weight : (p.target && p.target.weight != null ? p.target.weight : null);
    const fresh = Date.now() - this.savedAt < 1600;
    const where = p.round ? `round ${p.round}` : (p.ramp ? 'ramp-up' : (p.setIndex ? `set ${p.setIndex}` : ''));
    return el('div', { class: 'just-done', id: 'just-done' }, [
      el('div', { class: 'row' }, [
        el('div', { class: 'label' }, p.undo && idx === this.s.idx - 1 ? 'Last set' : 'Last set · fix it here'),
        el('div', { class: 'jd-right' }, [
          el('div', { class: 'jd-saved' + (fresh ? ' flash' : ''), id: 'jd-saved' }, [icon('check'), rec.edited ? 'Saved' : 'Logged']),
          // v1.14: Done by mistake: back to that set as it was
          p.undo && idx === this.s.idx - 1 ? el('button', { type: 'button', class: 'jd-undo', id: 'jd-undo', onclick: () => this.undoLast() }, 'Undo') : null
        ])
      ]),
      el('div', { class: 'jd-name' }, `${p.name}${where ? ', ' + where : ''}`),
      el('div', { class: 'jd-steps' + (hasWeight ? '' : ' one') }, [
        hasWeight ? stepper('w', isPair(ex) ? 'Total lb' : (ex && ex.equipment === 'weighted_bw' ? 'Added lb' : 'Weight lb'), rec.weight != null ? fmtWeight(rec.weight) : '?', pairText(ex, rec.weight),
          // v1.17: with no weight yet, - and + open the type-in sheet (one tap on + used to log 5 lb)
          () => (w == null ? this.openFix(idx) : change({ weight: Math.max(0, w - wStep) })), () => (w == null ? this.openFix(idx) : change({ weight: w + wStep }))) : null,
        stepper('r', p.holdSeconds ? 'Seconds' : (p.perSide ? 'Reps / side' : 'Reps'), rec.reps != null ? `${rec.reps}` : '?', '',
          () => change({ reps: Math.max(0, (rec.reps || 0) - 1) }), () => change({ reps: (rec.reps || 0) + 1 }))
      ]),
      p.holdSeconds ? null : effortChips(this.rules, rec.rpe, lvl => change({ rpe: lvl.rpe }))
    ]);
  }
  openFix(idx) {
    const p = this.steps[idx]; if (!p || !p.record) return;
    const ex = this.plan.exercises[p.exerciseId];
    const isBw = ex && ex.equipment === 'bodyweight';
    const wStep = ex ? incrementFor(this.rules, p.exerciseId, ex) : 5;
    const wVal = p.record.weight != null ? p.record.weight : (p.target && p.target.weight != null ? p.target.weight : '');
    const num = id => { const x = document.getElementById(id); return x && x.value !== '' ? Number(x.value) : null; };
    showModal(el('div', {}, [
      el('h2', {}, `${p.name}${p.setIndex ? ', ' + (p.round ? 'round ' : 'set ') + p.setIndex : ''}`),
      el('div', { class: 'grid2' }, [
        isBw || p.holdSeconds ? el('div') : field(ex && ex.equipment === 'weighted_bw' ? 'Added lb' : (isPair(ex) ? 'Total of both (lb)' : 'Weight (lb)'), 'fix-weight', wVal, wStep || 2.5),
        field(p.holdSeconds ? 'Seconds' : 'Reps', 'fix-reps', p.record.reps != null ? p.record.reps : '', 1)
      ]),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: () => {
          const patch = { reps: num('fix-reps') };
          if (!isBw && !p.holdSeconds) patch.weight = num('fix-weight');
          this.fixRecord(idx, patch); closeModal(); this.renderStep();
        } }, 'Save')
      ])
    ]));
  }

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
    if (s.kind === 'transition') return this.leadsIntoSet() ? 'rest' : 'calm';
    if (s.kind === 'stretch' || s.blockType === 'warmup' || s.kind === 'decision') return 'calm';
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

    // a set-up step belongs to the block it leads into, so the header names that one
    const hb = this.leadsIntoSet() ? this.steps[this.s.idx + 1] : s;
    const letter = /^[A-Z]$/.test(hb.blockName);
    const where = `${letter ? 'Block ' + hb.blockName + ' · ' : ''}${this.blockLabel(hb.blockId)}`;
    // v1.5: Pause sits in the header on every screen, warm-up and stretch included
    const pauseBtn = el('button', { class: 'pause-pill' + (paused ? ' on' : ''), id: 'pause-btn', onclick: () => (paused ? this.unpause() : this.pause()) }, [icon(paused ? 'play' : 'pause'), paused ? 'Resume' : 'Pause']);
    const head = el('div', { class: 'player-head' }, [
      this.s.idx > 0 ? el('button', { class: 'icon-btn', id: 'back-btn', 'aria-label': 'Back one step', onclick: () => this.back() }, icon('back')) : el('div', { class: 'icon-btn ghost-slot' }),
      el('div', { class: 'head-left' }, [
        el('div', { class: 'label' }, tl.sessionName),
        el('div', { class: 'block' }, where)
      ]),
      el('div', { class: 'head-right' }, [
        pauseBtn,
        el('button', { class: 'icon-btn', id: 'more-btn', 'aria-label': 'More', onclick: () => this.openMenu() }, icon('more'))
      ])
    ]);
    // v1.5: in a finisher the top bar lists its exercises, with the one you are on (or about to do) picked out
    let finRow = null;
    if (hb.blockType === 'finisher') {
      const ids = [...new Set(this.steps.filter(st => st.blockId === hb.blockId && st.kind === 'set' && st.exerciseId).map(st => st.exerciseId))];
      const nowId = hb.kind === 'set' ? hb.exerciseId : null;
      const short = id => (this.plan.exercises[id] && (this.plan.exercises[id].short || this.plan.exercises[id].name)) || id;
      finRow = el('div', { class: 'fin-row', id: 'fin-row' }, [
        el('span', { class: 'fin-round' }, hb.round ? `Round ${hb.round} of ${hb.roundCount}` : hb.blockName),
        ...ids.map(id => el('span', { class: 'fin-ex' + (id === nowId ? ' now' : '') }, short(id)))
      ]);
    }
    const prog = this.renderStrip();

    const main = el('div', { class: 'step-main' });
    const next = this.steps[this.s.idx + 1];
    const kindLabel = { set: s.ramp ? 'Ramp-up' : (s.baseline ? 'Baseline' : (s.retest ? 'Retest' : (s.holdSeconds ? 'Hold' : 'Work'))), rest: 'Rest', timed: 'Timed', transition: 'Set up', stretch: 'Stretch', decision: 'Your call' }[s.kind] || s.kind;
    const pill = (text, cls) => el('div', { class: 'phase-pill step-kind ' + cls, id: 'phase-pill' }, text);
    const tipList = x => (x.tips && x.tips.length) || x.cue ? el('div', { class: 'tips' }, [
      ...(x.tips || []).map(t => el('div', { class: 'tip' }, t)),
      x.cue ? el('div', { class: 'tip note' }, x.cue) : null
    ]) : null;

    if (this.leadsIntoSet()) {
      // Rest or set-up before a set: fix the last set, watch the clock, see what is next.
      const ready = this.isReady();
      const held = this.held();
      const base = s.kind === 'rest' ? (s.setupFor ? 'Rest + set up' : 'Rest') : (s.setupFor ? 'Set up' : 'Switch');
      const phase = pill(ready ? 'Get ready' : (held ? 'Confirm set-up' : base), ready || held ? 'ready' : 'rest');
      const jd = this.justDone(this.s.idx - 1);
      if (jd) {
        // v1.5: with the last-set card on screen the clock is a compact row and bar, so everything fits without scrolling
        main.appendChild(el('div', { class: 'rest-top' }, [phase, el('div', { class: 'timer', id: 'timer' }, '0:00')]));
        main.appendChild(el('div', { class: 'rest-track' }, [el('div', { class: 'rest-fill', id: 'rest-fill' })]));
        main.appendChild(jd);
      } else {
        main.appendChild(phase);
        main.appendChild(this.timerBlock(true));
      }
      const nex = this.plan.exercises[next.exerciseId];
      const up = el('div', { class: 'up-next' + (jd ? ' split' : ''), id: 'up-next' });
      up.appendChild(el('div', { class: 'label' }, 'Up next'));
      up.appendChild(el('div', { class: 'step-name' }, next.name));
      if (this.whereText(next)) up.appendChild(el('div', { class: 'step-where small' }, this.whereText(next)));
      const w = next.target && next.target.weight != null ? `${fmtWeight(next.target.weight)} lb` : (nex && nex.equipment === 'bodyweight' ? 'BW' : (next.baseline ? 'Work up' : '–'));
      const rl = next.holdSeconds ? 'Seconds' : (next.perSide ? 'Reps / side' : 'Reps');
      const r = next.holdSeconds ? `${next.holdSeconds}` : (next.target && next.target.reps != null ? `${next.target.reps}` : (next.repRange ? repsText(next.repRange) : 'max'));
      up.appendChild(this.readout(w, rl, r, this.effortWords(next), false, next.rpeDefault, next.target ? pairText(nex, next.target.weight) : ''));
      const prevSet = this.lastSetOf(next.exerciseId);
      const prevW = prevSet ? (prevSet.record && prevSet.record.weight != null ? prevSet.record.weight : (prevSet.target ? prevSet.target.weight : null)) : null;
      if (prevW != null && next.target && next.target.weight != null && prevW !== next.target.weight) {
        up.appendChild(el('div', { class: 'step-cue' }, `Change the weight: ${fmtWeight(prevW)} → ${fmtWeight(next.target.weight)} lb`));
      } else if (next.tips && next.tips.length) {
        up.appendChild(el('div', { class: 'step-cue' }, next.tips[0]));
      }
      main.appendChild(up);
    } else if (s.kind === 'rest') {
      main.appendChild(pill('Rest', 'rest'));
      main.appendChild(this.timerBlock(true));
      if (next) {
        main.appendChild(el('div', { class: 'label', style: 'margin-top:14px' }, 'Up next'));
        main.appendChild(el('div', { class: 'step-name' }, next.name));
        if (next.seconds) main.appendChild(el('div', { class: 'step-effort' }, fmtClock(next.seconds)));
      }
    } else {
      const sideTxt = s.holdSeconds && s.perSide ? (this.s.side === 0 ? ' · left' : ' · right') : '';
      main.appendChild(pill(kindLabel + sideTxt, this.kindGroup(s) === 'work' ? 'work' : 'calm'));
      main.appendChild(el('div', { class: 'step-name' + (s.kind === 'set' ? ' big' : '') }, [s.name, s.pr ? el('span', { class: 'pr-badge' }, 'PR') : null]));
      if (s.kind === 'set') {
        const ex = this.plan.exercises[s.exerciseId];
        if (this.whereText(s)) main.appendChild(el('div', { class: 'step-where' }, this.whereText(s)));
        const w = s.target && s.target.weight != null ? `${fmtWeight(s.target.weight)} lb` : (ex && ex.equipment === 'bodyweight' ? 'BW' : (ex && ex.equipment === 'weighted_bw' ? '+0 lb' : '?'));
        const rl = s.holdSeconds ? (s.perSide ? 'Sec / side' : 'Seconds') : (s.perSide ? 'Reps / side' : 'Reps');
        const r = s.holdSeconds ? `${s.holdSeconds}` : (s.target && s.target.reps != null ? `${s.target.reps}` : (s.repRange ? repsText(s.repRange) : 'max'));
        main.appendChild(this.heroReadout(w, rl, r, this.effortWords(s), s.rpeDefault, s.target ? pairText(ex, s.target.weight) : ''));
        if (s.auto && !s.holdSeconds) {
          main.appendChild(el('div', { class: 'pace', id: 'pace' }, [
            el('div', { class: 'pace-row' }, [el('span', { class: 'pace-text', id: 'pace-text' }, ''), el('span', { class: 'pace-clock', id: 'timer' }, '0:00')]),
            el('div', { class: 'pace-track' }, [el('div', { class: 'pace-fill', id: 'pace-fill' })])
          ]));
        }
        let cuesEl = null;
        // v1.14: cues fold behind a tap. They start open on an exercise's first work set (and on baseline and
        // retest sets, whose instructions matter); after that they stay how Cameron last left them for that lift.
        const cueBits = [
          s.repRange && !s.holdSeconds && s.repRange[0] !== s.repRange[1] ? el('div', { class: 'step-effort' }, `Range ${repsText(s.repRange)} reps`) : null,
          (s.baseline || s.retest) && s.effortText ? el('div', { class: 'step-effort' }, s.effortText) : null,
          tipList(s)
        ].filter(Boolean);
        if (cueBits.length) {
          const open = this.cuesOpen(s);
          const n = ((s.tips && s.tips.length) || 0) + (s.cue ? 1 : 0);
          const det = el('details', { class: 'cues', id: 'cues', open: open || null }, [
            el('summary', {}, [el('span', {}, n ? `Cues (${n})` : 'Cues'), el('span', { class: 'cues-hint' }, open ? 'Hide' : 'Show')]),
            ...cueBits
          ]);
          // only a tap is remembered (a <details> built open also fires 'toggle')
          det.querySelector('summary').addEventListener('click', () => { (this.s.cuesOpen = this.s.cuesOpen || {})[s.exerciseId] = !det.open; this.persist(); });
          det.addEventListener('toggle', () => { const h = det.querySelector('.cues-hint'); if (h) h.textContent = det.open ? 'Hide' : 'Show'; });
          cuesEl = det;
        }
        // L2: last time
        if (s.last && ((s.last.sets && s.last.sets.length) || s.last.topSet) && !s.ramp) {
          const l = s.last.sets && s.last.sets.length ? s.last : { ...s.last, sets: [s.last.topSet] };
          const sameW = l.sets.every(x => x.weight === l.sets[0].weight);
          const reps = l.sets.map(x => x.reps == null ? '?' : x.reps).join(', ');
          const rpes = l.sets.map(x => x.rpe).filter(x => x != null);
          const lvl = rpes.length ? effortLevel(this.rules, Math.max(...rpes)) : null;
          const rpe = lvl ? ` · ${lvl.label}` : '';
          const txt = sameW && l.sets[0].weight != null ? `${fmtWeight(l.sets[0].weight)} lb × ${reps}${rpe}` : l.sets.map(x => `${x.weight != null ? fmtWeight(x.weight) : 'bw'} × ${x.reps == null ? '?' : x.reps}`).join(', ') + rpe;
          main.appendChild(el('div', { class: 'last-time' }, [el('span', { class: 'label-inline' }, 'Last time'), ' ', txt]));
        }
        if (cuesEl) main.appendChild(cuesEl);
        if (!(s.auto && !s.holdSeconds)) main.appendChild(this.timerBlock(this.isCountdown(s)));
      } else {
        if (s.cue) main.appendChild(el('div', { class: 'step-cue' }, s.cue));
        main.appendChild(this.timerBlock(this.isCountdown(s)));
      }
      if (next && s.kind !== 'set') main.appendChild(el('div', { class: 'next' }, [el('b', {}, 'Next: '), this.describe(next), (next.kind === 'rest' || next.kind === 'transition') && this.steps[this.s.idx + 2] ? el('span', { class: 'muted' }, ` → ${this.describe(this.steps[this.s.idx + 2])}`) : null]));
    }
    if (paused) main.insertBefore(el('button', { class: 'paused-banner', id: 'paused-banner', onclick: () => this.unpause() }, [icon('play'), 'Paused. Tap to resume']), main.firstChild);

    const actions = el('div', { class: 'player-actions' });
    if (s.kind === 'set') {
      const ex = this.plan.exercises[s.exerciseId];
      const showEdit = this.editOpen || (s.target && s.target.weight == null && ex && ex.equipment !== 'bodyweight' && !s.holdSeconds) || s.baseline || s.retest || (s.repRange == null && !s.holdSeconds);
      actions.appendChild(this.editPanel(s, ex, showEdit));
      actions.appendChild(el('button', { class: 'btn primary', onclick: () => this.logSet() }, [icon('check'), s.holdSeconds ? 'Done early' : 'Done']));
      actions.appendChild(el('div', { class: 'secondary' }, [
        this.isAutoSet(s) ? el('button', { class: 'btn', id: 'extend-btn', onclick: () => this.addSeconds(this.rules.timing.extendSeconds) }, [icon('plus'), `${this.rules.timing.extendSeconds} s`]) : null,
        el('button', { class: 'btn', onclick: () => this.toggleEdit() }, [icon('edit'), this.editOpen ? 'Hide' : 'Edit']),
        el('button', { class: 'btn', onclick: () => this.skip() }, [icon('skip'), 'Skip'])
      ]));
    } else if (s.kind === 'decision') {
      actions.appendChild(el('button', { class: 'btn primary', onclick: () => this.decide(true) }, 'Do it'));
      actions.appendChild(el('div', { class: 'secondary' }, [el('button', { class: 'btn', onclick: () => this.decide(false) }, 'Skip it')]));
    } else if (this.waiting()) {
      // v1.5: a new block starts only after this tap; then the get-ready count runs
      actions.appendChild(el('button', { class: 'btn primary', id: 'confirm-btn', onclick: () => this.confirmSetup() }, [icon('check'), 'Set-up done']));
      actions.appendChild(el('div', { class: 'secondary' }, [
        el('button', { class: 'btn', onclick: () => this.addSeconds(30) }, [icon('plus'), '30 s']),
        this.swapChoices().length ? el('button', { class: 'btn', id: 'swap-btn', onclick: () => this.openSwap() }, 'Equipment taken') : null
      ]));
    } else {
      actions.appendChild(el('button', { class: 'btn primary', onclick: () => this.advance() }, [icon('skip'), s.kind === 'rest' ? 'Skip rest' : (this.leadsIntoSet() ? 'Start now' : 'Next')]));
      actions.appendChild(el('div', { class: 'secondary' }, [
        el('button', { class: 'btn', onclick: () => this.addSeconds(30) }, [icon('plus'), '30 s']),
        this.swapChoices().length ? el('button', { class: 'btn', id: 'swap-btn', onclick: () => this.openSwap() }, 'Equipment taken') : null
      ]));
    }

    document.body.setAttribute('data-kind', this.phaseKind(group));
    const wrap = el('div', { class: 'player' + (paused ? ' is-paused' : ''), 'data-kind': group }, [head, finRow, prog, main, actions]);
    c.appendChild(wrap);
    this.updateTimerDom();

  }

  lastSetOf(exerciseId) {
    for (let i = this.s.idx - 1; i >= 0; i--) { const x = this.steps[i]; if (x.kind === 'set' && x.exerciseId === exerciseId && !x.ramp) return x; }
    return null;
  }

  timerBlock(countdown, compact) {
    if (!countdown) return el('div', { class: 'timer small', id: 'timer' }, '0:00');
    const ring = el('div', { class: 'ring-wrap' + (compact ? ' compact' : '') });
    ring.innerHTML = `<svg class="ring" viewBox="0 0 220 220" aria-hidden="true"><circle class="ring-bg" cx="110" cy="110" r="${RING_R}"/><circle class="ring-fg" id="ring-fg" cx="110" cy="110" r="${RING_R}" stroke-dasharray="${RING_C.toFixed(1)}" stroke-dashoffset="0"/></svg>`;
    ring.appendChild(el('div', { class: 'timer ring-timer', id: 'timer' }, '0:00'));
    return ring;
  }

  editPanel(s, ex, open) {
    const rec = s.record || {};
    const wVal = rec.weight != null ? rec.weight : (s.target && s.target.weight != null ? s.target.weight : '');
    const rVal = rec.reps != null ? rec.reps : (s.holdSeconds ? s.holdSeconds : (s.target && s.target.reps != null ? s.target.reps : ''));
    const pVal = this.pendingRpe != null ? this.pendingRpe : (rec.rpe != null ? rec.rpe : this.defaultRpe(s));
    const wStep = ex ? incrementFor(this.rules, s.exerciseId, ex) : 5;
    const isBw = ex && ex.equipment === 'bodyweight';
    const panel = el('div', { class: 'edit-panel', id: 'edit-panel', hidden: !open });
    // v1.15: on a barbell lift, + on an empty box starts at the empty bar (one tap used to log 5 lb)
    const bar = ex && ex.equipment === 'barbell' && this.rules.rampUp ? this.rules.rampUp.barWeightLb : null;
    if (!isBw) panel.appendChild(field(ex && ex.equipment === 'weighted_bw' ? 'Added lb' : (isPair(ex) ? 'Total of both (lb)' : 'Weight (lb)'), 'in-weight', wVal, wStep || 2.5, bar));
    panel.appendChild(field(s.holdSeconds ? 'Seconds' : 'Reps', 'in-reps', rVal, 1));
    if (isBw) panel.appendChild(el('div'));
    if (!s.holdSeconds && !s.ramp) {
      const chips = effortChips(this.rules, pVal, lvl => {
        this.pendingRpe = lvl.rpe;
        chips.querySelectorAll('.effort-chip').forEach(b => b.classList.toggle('on', b.dataset.key === lvl.key));
      });
      chips.classList.add('span-all');
      panel.appendChild(chips);
    }
    return panel;
  }
  toggleEdit() { this.editOpen = !this.editOpen; if (this.editOpen) this.s.manual = true; this.renderStep(); }
  openEdit() { this.editOpen = true; this.s.manual = true; this.renderStep(); }

  updateTimerDom() {
    const t = this.container.querySelector('#timer');
    const s = this.step; if (!t || !s) return;
    const want = this.phaseKind(this.kindGroup(s));
    if (document.body.getAttribute('data-kind') !== want) document.body.setAttribute('data-kind', want);
    if (s.kind === 'set' && s.auto && !s.holdSeconds) {
      // pace bar: which rep the tempo says you should be on
      const e = this.elapsedInStep();
      const auto = this.autoOn();
      t.textContent = auto ? fmtClock(Math.ceil(Math.max(0, s.seconds - e))) : fmtClock(e);
      const reps = s.target && s.target.reps ? s.target.reps : null;
      const pt = this.container.querySelector('#pace-text');
      const pf = this.container.querySelector('#pace-fill');
      if (pt && reps) {
        const w = e - (s.startSeconds || 0);
        const per = reps * s.repSeconds;
        let txt;
        if (w < 0) txt = 'Get set';
        else if (!s.perSide) txt = w < per ? `Rep ${Math.min(reps, Math.floor(w / s.repSeconds) + 1)} of ${reps}` : 'Finish the set';
        else if (w < per) txt = `First side · rep ${Math.min(reps, Math.floor(w / s.repSeconds) + 1)} of ${reps}`;
        else if (w < per + this.rules.timing.sideSwitchSeconds) txt = 'Switch sides';
        else { const w2 = w - per - this.rules.timing.sideSwitchSeconds; txt = w2 < per ? `Second side · rep ${Math.min(reps, Math.floor(w2 / s.repSeconds) + 1)} of ${reps}` : 'Finish the set'; }
        if (pt.textContent !== txt) pt.textContent = txt;
      }
      if (pf) pf.style.width = `${Math.min(100, 100 * e / (s.seconds || 1)).toFixed(1)}%`;
    } else if (this.isCountdown(s)) {
      // v1.5: a set-up step that waits for the tap counts down to zero and holds there
      const hold = this.waiting() ? this.holdAt(s) : 0;
      const rem = Math.max(0, this.remainingInStep(s) - hold);
      t.textContent = fmtClock(Math.ceil(rem));
      t.classList.toggle('warn', !this.leadsIntoSet() && rem <= this.rules.timing.restWarningSeconds && rem > 0);
      const fg = this.container.querySelector('#ring-fg');
      const total = (this.stepSeconds(s) - hold) || 1;
      if (fg) fg.setAttribute('stroke-dashoffset', (RING_C * (1 - rem / total)).toFixed(1));
      const bar = this.container.querySelector('#rest-fill');
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, 100 * rem / total)).toFixed(1)}%`;
    } else {
      t.textContent = fmtClock(this.elapsedInStep());
    }
    const clock = this.container.querySelector('#clock');
    if (clock) {
      const p = this.projection();
      const d = p.deltaSeconds;
      const abs = Math.abs(d);
      const label = abs < 60 ? 'on time' : `${Math.round(abs / 60)} min ${d > 0 ? 'behind' : 'ahead'}`;
      const blocks = this.blockSummary();
      const bi = blocks.findIndex(b => b.current);
      const doneSteps = this.steps.filter(x => x.done || x.skipped).length;
      clock.innerHTML = '';
      clock.appendChild(el('span', {}, `Block ${bi + 1} of ${blocks.length} · ${doneSteps}/${this.steps.length} steps · ${fmtMinutes(p.remaining)} left · finish ${fmtTime(p.projected)}`));
      clock.appendChild(el('span', { class: 'delta ' + (d >= 60 ? 'behind' : (d <= -60 ? 'ahead' : '')) }, label));
      if (d >= 60 || p.overCapSeconds > 0) {
        clock.appendChild(el('span', { class: 'chip-btn', id: 'trim-btn', onclick: e => { e.stopPropagation(); this.trimPreview(); } }, [icon('scissors'), 'Trim']));
      }
      // keep segment fills moving with the clock
      const segs = this.container.querySelectorAll('.strip-bar .seg');
      blocks.forEach((b, i) => { const f = segs[i] && segs[i].querySelector('.seg-fill'); if (f) f.style.width = `${b.planned ? Math.min(100, Math.round(100 * b.done / b.planned)) : (b.doneSteps === b.steps ? 100 : 0)}%`; });
    }
  }
}

function modalOpen() {
  const m = document.getElementById('modal');
  return !!(m && !m.hidden);
}

function field(label, id, value, step, start) {
  const input = el('input', { type: 'number', id, value: value === '' ? '' : String(value), step: String(step), inputmode: 'decimal' });
  const minus = el('button', { type: 'button', 'aria-label': 'less', onclick: () => { input.value = String(Math.max(0, (Number(input.value) || 0) - step)); } }, '−');
  const plus = el('button', { type: 'button', 'aria-label': 'more', onclick: () => { input.value = String(input.value === '' && start ? start : (Number(input.value) || 0) + step); } }, '+');
  return el('div', { class: 'field' }, [el('label', { for: id }, label), el('div', { class: 'stepper' }, [minus, input, plus])]);
}
