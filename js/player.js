// player.js - Player: walks the timeline, timestamp timers, cues, wake lock, session clock, trim to fit,
// rest-end notifications when the app is in the background, live PR check, haptics.
// v1.4: sets end on their own timer (logged at target, fixed on the rest screen), a get-ready countdown before
// every set, voice prompts, a pace bar, effort buttons, work/rest colors.
// v1.5: Pause in the header on every screen, a Set-up done tap before each new block, an Equipment taken swap,
// two-dumbbell weights as totals, and a last-set card with weight and rep steppers and a Saved check.
// v1.18 (Cameron's notes from his third workout): the screen is a fixed shell that fits one phone screen (top,
// middle, buttons; the middle sheds detail before anything scrolls or is cut off), a gym clock that never stops,
// a red paused state, Left and Right on their own clocks, a ready tap before each exercise, each bar change and
// the stretch block, what comes next with reps and weight, the whole plan one tap away, louder beeps, reps in
// every voice line, Equipment taken inside a finisher, and set times that follow his pace (pacing.js).
// State lives in `this.s` and is saved to IndexedDB on every change so a session can be resumed.

import { trimToFit, remainingSeconds, leadIns, setTiming, blankStep } from './builder.js';
import { setInProgress, clearInProgress, setPendingReview, newId } from './store.js';
import { fmtClock, fmtTime, fmtWeight, fmtMinutes, repsText, roundTo, effortPlain, effortLevel, spokenDuration, isPair, pairText } from './data.js';
import { incrementFor, checkPR } from './progression.js';
import { el, showModal, closeModal, toast, hideToast, effortChips, onBack, dropBack, haptic } from './ui.js';
import { numberFlag, impossibleNumber } from './sanity.js';
import { icon } from './icons.js';
import { learnPacing } from './pacing.js';

const RING_R = 92;
const RING_C = 2 * Math.PI * RING_R;
const round1 = v => Math.round(v * 10) / 10;
const TIGHTEST = 4;   // how many steps fit() has to make the middle of the screen fit (css: .tight-1 .. .tight-4)

// Used only if rules.json has no cues block (an old copy of the rules with this code).
const FALLBACK_TONES = { warn: [[1175, 0, 0.12]], tick: [[1175, 0, 0.14]], go: [[1568, 0, 0.6]], setEnd: [[1175, 0, 0.2], [784, 0.24, 0.42]], end: [[1175, 0, 0.2], [1568, 0.24, 0.36]], side: [[1047, 0, 0.16], [1047, 0.26, 0.16]], pr: [[784, 0, 0.14], [1047, 0.16, 0.14], [1568, 0.32, 0.42]] };
const FALLBACK_VOICE = { loud: { wave: 'square', gain: 0.8, lowpassHz: 5200, sustain: true }, normal: { wave: 'sine', gain: 0.4, lowpassHz: 0, sustain: false } };
const BUZZ = { warn: 60, pr: [40, 60, 40, 60, 120], tap: 15, tick: 40, go: 250, setEnd: [200, 100, 200], end: [200, 100, 200], side: [120, 80, 120] };

/**
 * v1.18: play a beep. seq = [[frequency Hz, start s, length s]], voice = { wave, gain, lowpassHz, sustain }.
 * A sustained tone holds its level until just before it ends; the old beeps faded from the first instant, which is
 * why they were hard to hear. Works on an AudioContext or an OfflineAudioContext (the loudness test renders it).
 */
export function playTones(ctx, dest, seq, voice, at) {
  const t0 = at != null ? at : ctx.currentTime;
  const v = voice || FALLBACK_VOICE.normal;
  let out = dest;
  if (v.lowpassHz > 0) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = v.lowpassHz; f.Q.value = 0.7;
    f.connect(dest); out = f;
  }
  const peak = v.gain || 0.4;
  (seq || []).forEach(([freq, dt, dur]) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = v.wave || 'sine'; o.frequency.value = freq;
    const a = t0 + dt;
    g.gain.setValueAtTime(0.0001, a);
    g.gain.exponentialRampToValueAtTime(peak, a + 0.012);
    if (v.sustain) g.gain.setValueAtTime(peak, a + Math.max(0.02, dur - 0.04));
    g.gain.exponentialRampToValueAtTime(0.0001, a + dur);
    o.connect(g); g.connect(out); o.start(a); o.stop(a + dur + 0.05);
  });
}

/** "47:12", then "1:02:45" past the hour. */
export function fmtGym(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** Names written for the eye ("Kettlebell swings x 12", "Bike or ski erg, 12-15 cal") made speakable. */
export function speakable(name) {
  return String(name || '')
    .replace(/^Min (\d+) of (\d+):\s*/, 'Minute $1 of $2. ')
    .replace(/(\d+)\s+x\s+(\d+)\s*-\s*(\d+)/g, '$1 sets of $2 to $3')
    .replace(/\s+x\s?(\d+)\s*-\s*(\d+)/g, ', $1 to $2 reps')
    .replace(/\s+x(\d+)\b/g, ', $1 times')
    .replace(/\s+x\s(\d+)\b/g, ', $1 reps')
    .replace(/(\d+)\s*-\s*(\d+)/g, '$1 to $2')
    .replace(/\bcal\b/g, 'calories')
    .replace(/(\d+)\/(\d+)/g, '$1 $2')            // "90/90 hip hold" is said "90 90", not "90 slash 90"
    .replace(/\s*\+\s*/g, ' and ')
    .replace(/\s*\(([^)]*)\)/g, ', $1')
    .replace(/\s+,/g, ',')
    .trim();
}

/** Shrink one line of text until it fits its box (never below `min` px), so nothing is cut off with dots. */
export function fitText(node, min) {
  if (!node) return;
  node.style.fontSize = '';
  node.classList.remove('wrap');
  let size = parseFloat(getComputedStyle(node).fontSize) || 16;
  let guard = 0;
  while (node.scrollWidth > node.clientWidth + 1 && size > min && guard++ < 30) {
    size = Math.max(min, size * 0.94);
    node.style.fontSize = `${size.toFixed(2)}px`;
  }
  if (node.scrollWidth > node.clientWidth + 1) node.classList.add('wrap');
}

export class Player {
  constructor({ timeline, plan, rules, settings, targets, container, onFinish, sessions, pacing }) {
    this.plan = plan; this.rules = rules; this.settings = settings; this.targets = targets || {};
    this.container = container; this.onFinish = onFinish;
    // v1.18: saved sessions and what pacing.js learned from them (set times that follow Cameron's pace)
    this.history = sessions || []; this.pacing = pacing || null;
    this.s = {
      timeline, idx: 0, stepStart: null,
      sessionStart: null, pausedAt: null, pausedTotal: 0,
      trims: [], warned: false, fired: false, status: 'running', startedISO: null, prs: [],
      sideAt: null, sidePhase: null, stepT0: null, stepPausedMs: 0, stepExt: 0, stepPlan: 0
    };
    this.audio = null; this.wakeLock = null; this.timer = null; this.editOpen = false; this.swReg = null;
    this.pendingRpe = null; this.said = []; this.savedAt = 0; this.confirmedMs = 0; this.mainTapMs = 0;
    this._onVis = () => this.onVisibility();
    this._onResize = () => this.fit();
  }

  // ---- lifecycle ----
  start() {
    const now = Date.now();
    this.s.sessionStart = now; this.s.startedISO = new Date(now).toISOString();
    this.beginStep();
    this.boot();
    this.announce();
  }

  resume(saved) {
    this.s = saved;
    if (!this.s.prs) this.s.prs = [];
    const st = this.step;
    // a session saved by an older version of the app
    if (this.s.stepT0 == null) { this.s.stepT0 = this.s.stepStart; this.s.stepPausedMs = 0; this.s.stepExt = 0; this.s.stepPlan = st ? (st.seconds || 0) : 0; }
    if (st && this.sided(st) && !this.s.sideAt) {
      this.s.sideAt = this.sidePlan(st); this.s.sidePhase = null;
      if (this.s.side === 1) this.s.stepStart -= this.s.sideAt.rightStart * 1000;
    }
    const away = Date.now() - (this.s.lastTick || Date.now());
    if (this.s.pausedAt == null && this.s.status === 'running') {
      if (away > 2000) { this.s.pausedTotal += away; this.s.stepStart += away; this.s.stepPausedMs = (this.s.stepPausedMs || 0) + away; }
    }
    // v1.18: the gym clock runs through pauses, but not through hours with the app closed (he had left the gym)
    if (away > ((this.rules.timing && this.rules.timing.gymAwayMinutes) || 30) * 60000) this.s.goneMs = (this.s.goneMs || 0) + away;
    this.boot();
  }
  /** v1.18: milliseconds in the gym: start to now, pauses included (Cameron: "I want to see total time in gym"). */
  gymMs(at = Date.now()) { return Math.max(0, at - this.s.sessionStart - (this.s.goneMs || 0)); }

  boot() {
    document.body.classList.add('in-session');
    document.addEventListener('visibilitychange', this._onVis);
    window.addEventListener('resize', this._onResize);
    this.requestWakeLock();
    this.ensureAudio();
    if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(r => { this.swReg = r; }).catch(() => {});
    this.renderStep();
    this.timer = setInterval(() => this.tick(), 250);
    this.persist();
    // the typeface can arrive after the first screen is drawn: fit again with the real widths
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (this.timer) this.fit(); }).catch(() => {});
    // v1.14: Android Back during a workout opens the menu (Pause, End early) instead of leaving the app
    const onBackPress = () => { onBack('workout', onBackPress); if (!modalOpen()) this.openMenu(); };
    onBack('workout', onBackPress);
  }

  teardown() {
    clearInterval(this.timer); this.timer = null;
    document.removeEventListener('visibilitychange', this._onVis);
    window.removeEventListener('resize', this._onResize);
    document.body.classList.remove('in-session');
    document.body.removeAttribute('data-kind');
    document.body.style.removeProperty('--actions-h');
    document.body.style.removeProperty('--strip-top');
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
  /** v1.18: the beeps are data (rules.json > cues). Loud by default; Settings > Loud beeps goes back to the soft ones. */
  tone(kind) {
    const c = this.settings.cues;
    if (!c || !c.beep || !this.audio) return;
    const cfg = this.rules.cues || {};
    const seq = (cfg.tones && cfg.tones[kind]) || FALLBACK_TONES[kind] || FALLBACK_TONES.end;
    const which = c.loud === false ? 'normal' : 'loud';
    try {
      if (this.audio.state === 'suspended') this.audio.resume();
      playTones(this.audio, this.audio.destination, seq, cfg[which] || FALLBACK_VOICE[which]);
    } catch (e) { /* ignore */ }
  }
  buzz(pattern) {
    if (!this.settings.cues || !this.settings.cues.vibrate || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
  }
  cue(kind) {
    if (kind !== 'tap') this.tone(kind);
    this.buzz(BUZZ[kind] || BUZZ.end);
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
  /**
   * v1.18 (Cameron: "say reps when saying workout types"): the reps and the weight in words, said with every
   * exercise name. "5 reps at 130 pounds", "12 reps with two 15 pound dumbbells", "25 seconds each side".
   */
  spokenTarget(x) {
    if (x.holdSeconds) return `${x.holdSeconds} seconds${x.perSide ? ' each side' : ''}`;
    const ex = this.plan.exercises[x.exerciseId];
    const reps = x.target && x.target.reps != null ? x.target.reps : null;
    const w = x.target && x.target.weight != null ? x.target.weight : null;
    const r = reps != null ? `${reps} rep${reps === 1 ? '' : 's'}${x.perSide ? ' each side' : ''}` : 'as many reps as you can';
    if (w == null || (ex && ex.equipment === 'bodyweight')) return r;
    if (ex && ex.equipment === 'weighted_bw') return w > 0 ? `${r} with ${fmtWeight(w)} pounds added` : `${r}, bodyweight`;
    if (isPair(ex)) return `${r} with two ${fmtWeight(w / 2)} pound dumbbells`;
    return `${r} at ${fmtWeight(w)} pounds`;
  }
  setSpeech(x) {
    if (x.baseline || x.retest) return `${x.name}. ${x.effortText}.`;
    const parts = [x.name];
    if (x.ramp) parts.push('ramp-up');
    else if (x.round) parts.push(`round ${x.round} of ${x.roundCount}`);
    else if (x.setIndex && x.setCount) parts.push(`set ${x.setIndex} of ${x.setCount}`);
    parts.push(this.spokenTarget(x));
    return parts.join(', ') + '.';
  }
  /** The short line in the get-ready count: the name and the reps again, nothing else. */
  readySpeech(x) {
    if (x.baseline || x.retest) return `${x.name}.`;
    if (x.holdSeconds) return `${x.name}, ${x.holdSeconds} seconds${x.perSide ? ' each side' : ''}.`;
    const reps = x.target && x.target.reps;
    return reps != null ? `${x.name}, ${reps} rep${reps === 1 ? '' : 's'}${x.perSide ? ' each side' : ''}.` : `${x.name}.`;
  }
  /** A warm-up drill, a stretch or an Engine minute in words. */
  timedSpeech(x, brief) {
    const name = speakable(x.name);
    if (x.blockType === 'emom') return `${name}.`;
    if (x.perSide && x.sideSeconds) return `${name}. ${spokenDuration(x.sideSeconds)} each side.${brief ? '' : ' Left side first.'}`;
    return `${name}${x.where ? ', ' + x.where.toLowerCase() : ''}. ${spokenDuration(x.seconds)}.`;
  }
  /** What is said when a rest or a set-up countdown starts: how long, then what comes next with its reps and weight. */
  leadSpeech(s) {
    const next = this.steps[this.s.idx + 1];
    const dur = spokenDuration(s.seconds);
    if (!next || !this.leadsIn()) return s.kind === 'rest' ? `Rest. ${dur}.` : `${speakable(s.name)}. ${dur}.`;
    if (next.kind === 'set') {
      const what = this.setSpeech(next);
      if (s.kind === 'rest') return `Rest, ${dur}. Then ${what}`;
      if (!s.setupFor && s.lead) return `Switch to ${what}`;
      // a new block: the other lift of a superset is named too, so both can be set up
      let partner = '';
      if (!s.lead && next.blockType === 'superset') {
        const other = this.steps.slice(this.s.idx + 2).find(o => o.kind === 'set' && o.blockId === next.blockId && o.exerciseId !== next.exerciseId && !o.ramp);
        if (other) partner = ` Then ${other.name}, ${this.spokenTarget(other)}.`;
      }
      return `Set up for ${what}${partner} ${dur}.`;
    }
    const what = this.timedSpeech(next, true);
    if (s.kind === 'rest') return `Rest, ${dur}. Then ${what}`;
    if (s.change) return `Next: ${what}`;
    return `${speakable(s.name)}. First: ${what} ${this.needsConfirm() ? 'Tap ready when you are set.' : dur + '.'}`;
  }
  announce() {
    const s = this.step; if (!s) return;
    const led = this.leadsIn(this.s.idx - 1);
    const left = this.sided(s) ? ' Left side.' : '';
    if (s.kind === 'rest' || s.kind === 'transition') this.say(this.leadSpeech(s));
    else if (s.kind === 'set') this.say(led && !s.baseline && !s.retest ? `Go.${left}` : this.setSpeech(s) + (left ? ' Left side first.' : ''));
    else if (s.kind === 'timed' || s.kind === 'stretch') this.say(led ? `Go.${left}` : this.timedSpeech(s));
    else if (s.kind === 'decision') this.say(speakable(s.name));
  }

  // ---- background notifications (F1) ----
  notificationsOn() {
    return !!(this.settings.cues && this.settings.cues.notify !== false && 'Notification' in window && Notification.permission === 'granted' && this.swReg);
  }
  notificationText() {
    const n = this.steps[this.s.idx + 1];
    const body = n ? `Next: ${this.describe(n)}` : 'Last step';
    if (this.waiting()) return { title: 'Set-up time is up', body: n ? `Tap ${n.kind === 'set' ? 'Set-up done' : 'Ready'} for ${n.name}` : body };
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
  /** v1.18: seconds really spent in this step, pauses left out. Unlike elapsedInStep it never jumps (a tap can move the countdown). */
  stepActive() { return Math.max(0, (this.now() - (this.s.stepT0 != null ? this.s.stepT0 : this.s.stepStart) - (this.s.stepPausedMs || 0)) / 1000); }
  /**
   * v1.18 (Cameron: "distinguish which side I should work and make that obvious with the timer"): holds, stretches
   * and timed sets done one side at a time run left, a change-over, then right, each with its own clock.
   */
  sided(step = this.step) { return !!(step && step.perSide && (step.holdSeconds || step.sideSeconds || (step.kind === 'set' && step.auto))); }
  /** Seconds from the start of the step where the left side ends, the right side starts and the step ends. */
  sidePlan(step) {
    const t = this.rules.timing;
    if (step.holdSeconds || step.sideSeconds) {
      const side = step.holdSeconds || step.sideSeconds;
      const sw = t.holdSwitchSeconds != null ? t.holdSwitchSeconds : 6;
      return { start: 0, leftEnd: side, rightStart: side + sw, end: side * 2 + sw };
    }
    const start = step.startSeconds || 0;
    const body = Math.max(0, (step.seconds || 0) - start);
    const sw = Math.min(t.sideSwitchSeconds || 0, body / 3);
    const side = (body - sw) / 2;
    return { start, leftEnd: start + side, rightStart: start + side + sw, end: start + body };
  }
  /** Where the clock is inside a step done one side at a time: { phase: 'set' | 'left' | 'switch' | 'right' | 'over', rem }. */
  sideInfo() {
    const a = this.s.sideAt;
    if (!a) return null;
    const e = this.elapsedInStep();
    if (e < a.start) return { phase: 'set', rem: a.start - e };
    if (e < a.leftEnd) return { phase: 'left', rem: a.leftEnd - e };
    if (e < a.rightStart) return { phase: 'switch', rem: a.rightStart - e };
    if (e < a.end) return { phase: 'right', rem: a.end - e };
    return { phase: 'over', rem: 0 };
  }
  /** He finished the left side early: the right side starts now and keeps its full time. */
  switchSideNow() {
    const a = this.s.sideAt; const step = this.step;
    if (!a || !step || this.s.pausedAt != null) return;
    const e = this.elapsedInStep();
    // only while the left side runs or during the change-over (a tap in the get-set seconds once broke the clocks)
    if (e < a.start || e >= a.rightStart) return;
    const rightLen = a.end - a.rightStart;
    a.leftEnd = Math.min(a.leftEnd, e); a.rightStart = e; a.end = e + rightLen;
    if (step.kind === 'set' && step.auto && !step.holdSeconds) step.seconds = a.end;
    this.s.fired = false; this.s.warned = false;
    this.tick(true);
  }
  stepSeconds(step) {
    if (!step) return 0;
    if (step.perSide && (step.holdSeconds || step.sideSeconds)) return (step === this.step && this.s.sideAt ? this.s.sideAt : this.sidePlan(step)).end;
    return step.holdSeconds ? step.holdSeconds : (step.seconds || 0);
  }
  remainingInStep(step = this.step) {
    if (!step) return 0;
    return Math.max(0, this.stepSeconds(step) - this.elapsedInStep());
  }
  isCountdown(step = this.step) { return !!(step && (step.countdown || step.holdSeconds)); }
  autoOn() { return this.settings.autoAdvance !== false; }
  /** A set that ends on its own timer: a normal work or ramp-up set, with auto-advance on. */
  isAutoSet(step = this.step) { return !!(step && step.kind === 'set' && step.auto && !step.holdSeconds && this.autoOn()); }
  /** A rest or set-up countdown whose next step is something to do (a set, a stretch, a drill): it ends with the get-ready count. */
  leadsIn(idx = this.s.idx) {
    const a = this.steps[idx]; const b = this.steps[idx + 1];
    return !!(a && b && (a.kind === 'rest' || a.kind === 'transition') && (b.kind === 'set' || b.kind === 'timed' || b.kind === 'stretch'));
  }
  leadsIntoSet(idx = this.s.idx) { return this.leadsIn(idx) && this.steps[idx + 1].kind === 'set'; }
  /**
   * Does this countdown wait for a tap instead of starting what comes next by itself? (rules.timing.confirmSetup)
   * v1.5: before the first set of a new block. v1.18 (Cameron: "for things setting up bar, ensure I'm good to go",
   * "for the stretch section, do a check also"): before the first set of every exercise, before a set whose bar
   * weight differs from the set before it, and before the stretch block and the Engine.
   */
  needsConfirm(idx = this.s.idx) {
    const t = this.rules.timing;
    const mode = t.confirmSetup;
    if (this.settings.confirmSetup === false || !mode || mode === 'off' || !this.leadsIn(idx)) return false;
    const cur = this.steps[idx];
    const next = this.steps[idx + 1];
    if (next.kind !== 'set') return !cur.change && (t.confirmBeforeBlocks || []).includes(next.blockType) && cur.blockId !== next.blockId;
    let prevSet = null;        // the set before this one, whatever it was
    let sameDone = null;       // the last set of this exercise that was really done
    for (let i = idx - 1; i >= 0; i--) {
      const x = this.steps[i];
      if (x.kind !== 'set') continue;
      if (!prevSet) prevSet = x;
      if (x.exerciseId === next.exerciseId && x.record && x.record.done) { sameDone = x; break; }
    }
    if (mode === 'exercise' ? !sameDone : (!prevSet || prevSet.blockId !== next.blockId)) return true;
    // the bar has to be reloaded
    const ex = this.plan.exercises[next.exerciseId];
    if (sameDone && ex && (t.confirmWeightChange || []).includes(ex.equipment)) {
      const was = sameDone.record.weight != null ? sameDone.record.weight : (sameDone.target ? sameDone.target.weight : null);
      const will = next.target ? next.target.weight : null;
      if (was != null && will != null && was !== will) return true;
    }
    return false;
  }
  waiting() { return !this.s.confirmed && this.needsConfirm(); }
  /** A countdown before something he has to set up (it waits, or waited, for his tap): fit() keeps its up-next details longest. */
  setupScreen() { return this.leadsIn() && this.needsConfirm(); }
  /** The set-up clock has run out and the step is holding for the tap. */
  held() { return this.waiting() && this.remainingInStep() <= this.holdAt() + 0.3; }
  phaseKind(group) { return this.s.pausedAt != null ? 'paused' : (this.isReady() || this.held() ? 'ready' : group); }
  /** Seconds left on the clock where a waiting set-up step holds: the start of the get-ready count. */
  holdAt(step = this.step) { return Math.min(this.rules.timing.getReadySeconds, this.stepSeconds(step)); }
  confirmSetup() {
    if (!this.waiting()) return;
    const step = this.step;
    this.s.confirmed = true; this.confirmedMs = Date.now();
    this.s.tapAt = round1((this.now() - (this.s.stepT0 != null ? this.s.stepT0 : this.s.stepStart)) / 1000);
    this.cue('tap');
    const total = this.stepSeconds(step); const g = this.holdAt(step);
    // v1.18: a tap during a rest keeps the rest; only the set-up time added to it is dropped. With no rest left
    // (or on a set-up step) it goes straight to the get-ready count.
    const restPart = step.kind === 'rest' ? Math.max(0, total - (step.setupSeconds || 0)) : 0;
    const want = Math.max(g, restPart - this.elapsedInStep());
    if (this.remainingInStep(step) > want) this.s.stepStart = this.now() - (total - want) * 1000;
    this.s.fired = false; this.s.readySaid = false; this.s.lastTickSec = null;
    this.renderStep(); this.persist();
    // a rest with time left runs on: say so once, at the tap (the chip beside the clock stays)
    if (step.kind === 'rest' && !this.isReady()) toast('It starts when the rest ends.', 2600);
    if (document.hidden) this.scheduleNotification();
  }
  isReady() {
    if (!this.leadsIn() || this.s.pausedAt != null || this.waiting()) return false;
    const rem = this.remainingInStep();
    return rem > 0 && rem <= this.rules.timing.getReadySeconds && this.stepSeconds(this.step) > this.rules.timing.getReadySeconds;
  }

  projection() {
    const tl = this.s.timeline;
    const now = this.now();
    let remaining = remainingSeconds(this.steps, this.s.idx + 1);
    const cur = this.step;
    if (cur) {
      const total = this.s.sideAt && this.sided(cur) ? this.s.sideAt.end : (cur.seconds || 0);
      remaining += Math.max(0, total - this.elapsedInStep());
    }
    const plannedFinish = this.s.sessionStart + tl.plannedSeconds * 1000 + this.s.pausedTotal;
    const capFinish = this.s.sessionStart + (this.plan.sessionCapMinutes || 60) * 60000 + this.s.pausedTotal;
    const projected = now + remaining * 1000;
    // finishAt is the time on the wall: while paused it moves later, the plan numbers hold still
    return { remaining, plannedFinish, capFinish, projected, finishAt: Date.now() + remaining * 1000, deltaSeconds: Math.round((projected - plannedFinish) / 1000), overCapSeconds: Math.round((projected - capFinish) / 1000) };
  }

  /** Left / right: the beeps and words at each change, and a redraw so the lit half moves. */
  sideTick(step) {
    const info = this.sideInfo();
    if (!info) return;
    const warnAt = this.rules.timing.restWarningSeconds;
    const ticks = this.settings.cues && this.settings.cues.warningTick;
    if (info.phase !== this.s.sidePhase) {
      const from = this.s.sidePhase;
      this.s.sidePhase = info.phase; this.s.sideWarned = false; this.s.lastTickSec = null;
      if (from != null && info.phase === 'switch') { this.cue('side'); this.say('Switch sides.'); }
      else if (from != null && info.phase === 'right') { this.cue('go'); this.say('Right side.'); }
      if (from != null) { this.renderStep(); this.persist(); }
    }
    if (info.phase === 'switch' && ticks) {
      const sec = Math.ceil(info.rem);
      if (sec <= warnAt && sec !== this.s.lastTickSec) { this.s.lastTickSec = sec; this.cue('tick'); }
    }
    if (info.phase === 'left' && (step.holdSeconds || step.sideSeconds) && ticks && !this.s.sideWarned && info.rem <= warnAt && (step.holdSeconds || step.sideSeconds) > warnAt + 2) {
      this.s.sideWarned = true; this.cue('warn');
    }
  }

  tick(force) {
    if (!this.step || this.s.status !== 'running') return;
    if (this.s.pausedAt != null && !force) { this.updateTimerDom(); return; }
    const step = this.step;
    if (this.s.pausedAt == null && this.sided(step)) this.sideTick(step);
    if (this.isAutoSet(step)) {
      // once the edit panel has been opened the set waits for a Done tap, so typed numbers are not lost
      if (step.seconds - this.elapsedInStep() <= 0 && !this.s.fired && !this.s.manual && !modalOpen() && this.s.pausedAt == null) {
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
        this.s.stepStart = this.now() - (this.stepSeconds(step) - g) * 1000;
        if (!this.s.waitSaid && this.s.pausedAt == null) {
          this.s.waitSaid = true; this.cue('end');
          this.say(this.steps[this.s.idx + 1].kind === 'set' ? 'Tap set-up done when you are ready.' : 'Tap ready when you are set.');
          if (document.hidden) this.showNotificationNow();
          this.renderStep();
        }
      }
      this.updateTimerDom();
      if (Date.now() - (this.s.lastTick || 0) > 5000) this.persist();
      return;
    }
    if (this.isCountdown(step) && this.s.pausedAt == null) {
      const rem = this.remainingInStep(step);
      const warnAt = this.rules.timing.restWarningSeconds;
      const lead = this.leadsIn();
      const ticks = this.settings.cues && this.settings.cues.warningTick;
      if (lead && this.isReady()) {
        // get-ready count: a tick on each of the last 3 seconds. v1.18: the full line (name, reps, weight) was said
        // when this countdown began, so here it is only the name and the reps again, and only if that was a while ago.
        if (!this.s.readySaid) {
          this.s.readySaid = true;
          const next = this.steps[this.s.idx + 1];
          if (next.kind === 'set' && (this.stepActive() >= 20 || this.s.confirmed)) this.say(this.readySpeech(next));
          this.renderStep();
        }
        const sec = Math.ceil(rem);
        if (ticks && sec <= warnAt && sec !== this.s.lastTickSec) { this.s.lastTickSec = sec; this.cue('tick'); }
      } else if (!lead && !this.s.warned && rem <= warnAt && rem > 0 && ticks && this.stepSeconds(step) > warnAt + 2) {
        this.s.warned = true; this.cue('warn');
      }
      if (rem <= 0 && !this.s.fired) {
        this.s.fired = true;
        this.cue(lead ? 'go' : 'end');
        if (document.hidden) this.showNotificationNow(); else this.cancelScheduledNotification();
        if (step.kind === 'set') this.logSet({ auto: true });
        else this.advance('timer');
        return;
      }
    }
    this.updateTimerDom();
    if (Date.now() - (this.s.lastTick || 0) > 5000) this.persist();
  }

  // ---- navigation ----
  /** Everything that starts fresh with a step. v1.18: uses now() so a step entered while paused keeps its full time. */
  beginStep() {
    const t = this.now();
    const st = this.step;
    Object.assign(this.s, {
      stepStart: t, stepT0: t, stepPausedMs: 0, stepExt: 0, stepPlan: st ? (st.seconds || 0) : 0,
      warned: false, fired: false, readySaid: false, lastTickSec: null, manual: false, confirmed: false, waitSaid: false, tapAt: null,
      sideAt: st && this.sided(st) ? this.sidePlan(st) : null, sidePhase: null, sideWarned: false
    });
  }
  goTo(idx) {
    this.s.idx = idx; this.editOpen = false; this.pendingRpe = null;
    this.cancelScheduledNotification();
    if (idx >= this.steps.length) { this.finish('complete'); return; }
    this.beginStep();
    this.renderStep();
    this.announce();
    this.persist();
    if (document.hidden) this.scheduleNotification();
  }
  /** v1.18: how the countdown before a set went, kept for that set's record (pacing.js reads set-up time from it). */
  noteLead(by) {
    const s = this.step;
    if (!s || !this.leadsIntoSet()) { this.s.leadObs = null; return; }
    this.s.leadObs = {
      idx: this.s.idx + 1, plan: this.s.stepPlan, setup: s.setupSeconds || 0, took: round1(this.stepActive()),
      paused: Math.round((this.s.stepPausedMs || 0) / 1000), by: this.s.confirmed && this.s.tapAt != null ? 'tap' : by,
      ...(this.s.tapAt != null ? { tap: this.s.tapAt } : {}), ...(this.s.stepExt ? { ext: this.s.stepExt } : {})
    };
  }
  advance(by) {
    const s = this.step;
    // a double tap on Set-up done must not also skip the rest it just kept
    if (!by && Date.now() - this.confirmedMs < 600) return;
    if (s && s.kind !== 'set') { s.done = true; s.actualSeconds = Math.round(this.stepActive()); }
    this.noteLead(by || 'skip');
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
    // v1.18: and the set times, if this set had changed them
    if (u.paced) u.paced.forEach(([i, seconds, repSeconds, learned]) => { const o = this.steps[i]; if (!o) return; o.seconds = seconds; o.repSeconds = repSeconds; if (learned) o.learned = true; else delete o.learned; });
    if (u.nudged !== undefined && this.s.nudged) this.s.nudged[p.exerciseId] = u.nudged;
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
    this.s.pausedTotal += away; this.s.stepStart += away; this.s.stepPausedMs = (this.s.stepPausedMs || 0) + away; this.s.pausedAt = null;
    this.renderStep(); this.persist();
  }
  addSeconds(n) {
    const s = this.step; if (!s) return;
    // v1.18: on a step done one side at a time the extra seconds go to the side under way
    const a = this.s.sideAt;
    if (a && this.sided(s)) {
      const e = this.elapsedInStep();
      if (e < a.leftEnd) { a.leftEnd += n; a.rightStart += n; } else if (e < a.rightStart) a.rightStart += n;
      a.end += n;
    }
    s.seconds = (s.seconds || 0) + n; this.s.stepExt = (this.s.stepExt || 0) + n;
    this.s.fired = false; this.s.warned = false; this.s.waitSaid = false;
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
      holdSeconds: s.holdSeconds, perSide: s.perSide, repRange: s.repRange, target: { ...(s.target || {}) }, blockId: s.blockId, ...(s.amrap ? { amrap: true } : {}) };
  }
  readInputs() {
    const w = this.container.querySelector('#in-weight');
    const r = this.container.querySelector('#in-reps');
    const num = x => (x && x.value !== '' ? Number(x.value) : null);
    const prior = this.priorRecord(this.step);
    return { weight: num(w), reps: num(r), rpe: this.pendingRpe != null ? this.pendingRpe : (prior && prior.rpe != null ? prior.rpe : this.defaultRpe(this.step)) };
  }
  /** What this set was logged as before he went Back onto it (null for a set not yet done, or skipped). */
  priorRecord(s) { return s && s.record && s.record.done && !s.record.skipped ? s.record : null; }
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
    s.record.edited = true; delete s.record.unconfirmed; this.savedAt = Date.now();
    if ('weight' in patch && patch.weight !== old) this.carryWeight(idx, s, patch.weight, old != null ? old : (s.target ? s.target.weight : null));
    this.persist();
  }
  logSet({ auto } = {}) {
    const s = this.step;
    // v1.15.1: when the edit panel is on screen (it opens by itself on a set with no weight), a set that ends on its
    // timer keeps what was typed there instead of logging the target (the typed weight used to be lost)
    const panel = this.container.querySelector('#edit-panel');
    const panelOpen = !!(panel && !panel.hidden);
    const ex = this.plan.exercises[s.exerciseId];
    let typed = auto && panelOpen ? this.readInputs() : null;
    // v1.18: a number that cannot be right (reps below 0, part of a rep) typed there is not logged by the timer
    if (typed && impossibleNumber(typed, ex, { hold: !!s.holdSeconds })) typed = { ...typed, weight: null, reps: null };
    // v1.18: a set already logged once (he went Back onto it) keeps what was logged or corrected on its card when its
    // timer runs out again; it used to be logged a second time with the target numbers
    const prior = this.priorRecord(s);
    const planned = k => (prior && prior[k] != null ? prior[k] : (s.target ? s.target[k] : null));
    const v = auto ? { weight: typed && typed.weight != null ? typed.weight : planned('weight'), reps: s.holdSeconds || (typed && typed.reps != null ? typed.reps : planned('reps')), rpe: typed ? typed.rpe : (prior && prior.rpe != null ? prior.rpe : this.defaultRpe(s)) } : this.readInputs();
    if (s.holdSeconds && v.reps == null) v.reps = s.holdSeconds;
    // v1.18: refused on Done, with the sheet left open to fix it
    const bad = auto ? '' : impossibleNumber(v, ex, { hold: !!s.holdSeconds });
    if (bad) { toast(bad); haptic('warn'); this.openEdit(); return; }
    const needsWeight = ex && ex.equipment !== 'bodyweight' && !s.holdSeconds;
    if (needsWeight && v.weight == null && !auto && !this.isAutoSet(s)) { toast('Enter the weight you used'); this.openEdit(); return; }
    if (v.reps == null && !auto && !s.holdSeconds) { toast('Enter reps'); this.openEdit(); return; }
    // v1.16: a number that looks wrong waits for a second Done (Cameron: flag it, don't let a typo move the plan).
    // Sets that log themselves are checked on the review screen instead.
    let numberOk = false;
    if (!auto) {
      const f = numberFlag({ ramp: s.ramp, holdSeconds: s.holdSeconds, target: s.target, repRange: s.repRange, weight: v.weight, reps: v.reps, done: true }, ex, this.rules);
      const key = `${this.s.idx}:${v.weight}:${v.reps}`;
      if (f && this.flag && this.flag.key === key) numberOk = true;
      else if (f) {
        this.flag = { key, idx: this.s.idx, text: f.text, weight: v.weight, reps: v.reps };
        haptic('warn');
        this.editOpen = true; this.s.manual = true; this.renderStep();
        return;
      }
    }
    this.flag = null;
    // v1.14: what Undo needs to put back (PR list, the in-session best, weights carried to later sets)
    s.undo = { prs: this.s.prs.length, target: this.targets[s.exerciseId] ? { ...this.targets[s.exerciseId] } : null, carried: this.steps.map((o, i) => [i, o.target ? { ...o.target } : o.target]).filter(([i]) => i > this.s.idx && this.steps[i].exerciseId === s.exerciseId) };
    s.done = true; s.skipped = false; s.actualSeconds = Math.round(this.stepActive());
    s.record = { ...this.baseRecord(s), weight: v.weight, reps: v.reps, rpe: v.rpe, done: true, skipped: false, at: new Date().toISOString() };
    if (numberOk) s.record.numberOk = true;
    if (prior && prior.weight === v.weight && prior.reps === v.reps) {
      if (prior.numberOk) s.record.numberOk = true;
      if (prior.edited) s.record.edited = true;
    }
    // v1.18: a set that ended on its own timer with no effort picked is logged as planned (target weight, target
    // reps, the usual effort). Nobody confirmed that, so it is marked: the last-set card and Review show it. What he
    // had already confirmed for this set (before going Back onto it) stays confirmed.
    if (auto && !s.holdSeconds && !s.ramp && this.pendingRpe == null && !(prior && !prior.unconfirmed)) s.record.unconfirmed = true;
    // v1.18: how long the set took against its timer, and how the countdown before it went (pacing.js). A set whose
    // numbers were typed while its clock ran says nothing about pace.
    if (s.auto && !s.ramp && !s.baseline && !s.retest && !s.holdSeconds && !s.amrap) {
      s.record.secs = {
        plan: this.s.stepPlan, took: round1(this.stepActive()), by: auto ? 'timer' : (panelOpen || this.s.manual ? 'manual' : 'done'),
        ...(this.s.stepExt ? { ext: this.s.stepExt } : {}), ...((this.s.stepPausedMs || 0) >= 1000 ? { paused: Math.round(this.s.stepPausedMs / 1000) } : {})
      };
    }
    if (this.s.leadObs && this.s.leadObs.idx === this.s.idx) { const { idx: _i, ...lead } = this.s.leadObs; s.record.lead = lead; }
    this.s.leadObs = null;

    // live PR check (work sets only; baseline/retest top sets count too, ramp-ups do not)
    let gotPr = false;
    if (!s.ramp && !s.holdSeconds && ex && v.weight != null && v.reps) {
      const bwAdd = ex.equipment === 'weighted_bw' ? (this.settings.bodyweightLb || 0) : 0;
      const kinds = checkPR(this.targets[s.exerciseId], v.weight, v.reps, bwAdd);
      if (kinds.length) {
        gotPr = true;
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

    const carried = s.baseline || (s.target && v.weight !== s.target.weight);
    if (carried) this.carryWeight(this.s.idx, s, v.weight, s.target ? s.target.weight : null);
    const note = this.adaptPace(s);
    this.goTo(this.s.idx + 1);
    if (note && !gotPr && !(s.baseline && carried)) toast(note, 5000);
  }

  /**
   * v1.18 (Cameron: "confirm you are dynamically updating time if I consistently end early or pause"): after each
   * logged set, ask pacing.js what the saved sessions plus this one say about the exercise. When a streak completes,
   * the sets of it still to come in this session get the new time. Returns a line to show, or ''.
   */
  adaptPace(s) {
    if (this.settings.adaptTiming === false || !s.record || !s.record.secs) return '';
    const id = s.exerciseId;
    const ex = this.plan.exercises[id];
    if (!ex) return '';
    const mine = this.steps.filter(x => x.kind === 'set' && x.record && x.record.done).map(x => x.record);
    const e = learnPacing({ sessions: this.history, plan: this.plan, rules: this.rules, settings: this.settings, extra: mine })[id] || {};
    const paced = [];
    let change = null;
    this.steps.forEach((o, i) => {
      if (i <= this.s.idx || o.kind !== 'set' || o.exerciseId !== id || !o.auto || o.ramp || o.holdSeconds || o.done || o.skipped) return;
      const tm = setTiming(this.rules, ex, o.target && o.target.reps, o.perSide, e);
      if (tm.seconds === o.seconds) return;
      paced.push([i, o.seconds, o.repSeconds, !!o.learned]);
      change = change || { from: o.seconds, to: tm.seconds };
      o.seconds = tm.seconds; o.repSeconds = tm.repSeconds;
      if (tm.learned) o.learned = true; else delete o.learned;
    });
    const nudged = this.s.nudged = this.s.nudged || {};
    if (nudged[id] == null) {
      if (!this.basePacing) this.basePacing = learnPacing({ sessions: this.history, plan: this.plan, rules: this.rules, settings: this.settings });
      nudged[id] = (this.basePacing[id] && this.basePacing[id].nudge) || 0;
    }
    if (s.undo) { s.undo.paced = paced; s.undo.nudged = nudged[id]; }
    const more = (e.nudge || 0) > nudged[id];
    nudged[id] = e.nudge || 0;
    if (change) return `${s.name}: sets now get ${change.to} s (was ${change.from} s), to match your pace`;
    if (more && ex.keepTempo) return `${s.name}: you keep finishing early. ${ex.keepTempo}`;
    return '';
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

  // ---- equipment taken: do something else now (v1.5 a later block; v1.18 also inside a finisher) ----
  blockSetNames(blockId) {
    return [...new Set(this.steps.filter(st => st.blockId === blockId && st.kind === 'set').map(st => st.name))];
  }
  blockTitle(blockId) {
    const first = this.steps.find(st => st.blockId === blockId);
    const letter = first && /^[A-Z]$/.test(first.blockName);
    return `${letter ? 'Block ' + first.blockName : (first ? first.blockName : blockId)}: ${this.blockSetNames(blockId).join(', ')}`;
  }
  /**
   * What can be done now instead of the set coming up.
   * v1.18 (Cameron: "I don't see equipment taken on the standing calf raise finisher"): inside a finisher, another
   * exercise of this round first, or this exercise after the last round. v1.5: a later block that has not been started.
   */
  swapChoices() {
    if (!this.leadsIntoSet()) return [];
    const n = this.s.idx + 1;
    const cur = this.steps[n];
    const out = [];
    if (cur.blockType === 'finisher' && cur.exerciseId) {
      const open = st => st.kind === 'set' && st.blockId === cur.blockId && !st.done && !st.skipped;
      const seen = new Set([cur.exerciseId]);
      for (let i = n + 1; i < this.steps.length; i++) {
        const st = this.steps[i];
        if (st.blockId !== cur.blockId || st.kind === 'rest' || (st.kind === 'transition' && !st.lead)) break;   // the round ends here
        if (!open(st) || seen.has(st.exerciseId)) continue;
        seen.add(st.exerciseId);
        out.push({ kind: 'first', idx: i, title: `Do ${st.name} first`, sub: `${cur.name} comes right after it` });
      }
      const mine = this.steps.filter((st, i) => i >= n && open(st) && st.exerciseId === cur.exerciseId);
      const others = this.steps.some((st, i) => i > n && open(st) && st.exerciseId !== cur.exerciseId);
      if (others) out.push({ kind: 'later', exerciseId: cur.exerciseId, title: `Do ${cur.name} after the last round`, sub: mine.length === 1 ? 'This set moves to the end of the finisher' : `Its ${mine.length} sets move to the end of the finisher` });
    }
    const seenBlocks = new Set([cur.blockId]);
    for (let i = n; i < this.steps.length; i++) {
      const st = this.steps[i];
      if (seenBlocks.has(st.blockId)) continue;
      seenBlocks.add(st.blockId);
      if (!['straight', 'superset', 'finisher'].includes(st.blockType) || st.iftime) continue;
      let to = i; while (to < this.steps.length && this.steps[to].blockId === st.blockId) to++;
      const part = this.steps.slice(i, to);
      if (part[0].kind !== 'set' || part.some(x => x.done || x.skipped)) continue;
      // only from the countdown in front of a block: a block that is under way stays in one piece
      if (this.steps[this.s.idx].blockId === cur.blockId) continue;
      out.push({ kind: 'block', blockId: st.blockId, from: i, to, title: this.blockTitle(st.blockId), sub: `${this.blockSetNames(cur.blockId).join(' and ')} ${this.blockSetNames(cur.blockId).length > 1 ? 'move' : 'moves'} to right after it` });
    }
    return out;
  }
  openSwap() {
    const choices = this.swapChoices();
    if (!choices.length) { toast('Nothing later in this session to swap with'); return; }
    showModal(el('div', {}, [
      el('h2', {}, 'Equipment taken?'),
      el('p', { class: 'muted' }, 'Pick what to do now.'),
      el('div', { class: 'menu' }, choices.map(c => el('button', { class: 'menu-item swap-choice', 'data-kind': c.kind, onclick: () => { closeModal(); this.doSwap(c); } }, [icon('skip'), el('span', { class: 'swap-text' }, [el('b', {}, c.title), c.sub ? el('small', {}, c.sub) : null])]))),
      el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Cancel')
    ]));
  }
  doSwap(c) {
    const steps = this.steps;
    const at = this.s.idx;
    const n = at + 1;
    const cur = steps[n];
    if (!cur || cur.kind !== 'set') return;
    const before = JSON.parse(JSON.stringify(steps));     // Undo puts the session back exactly as it was
    let order;
    let label;
    if (c.kind === 'first') {
      const pick = steps[c.idx];
      if (!pick || pick.kind !== 'set' || pick.done) return;
      order = steps.filter(x => x !== pick);
      order.splice(order.indexOf(cur), 0, pick);
      label = `${pick.name} first`;
    } else if (c.kind === 'later') {
      const moved = steps.filter((x, i) => i >= n && x.kind === 'set' && x.blockId === cur.blockId && x.exerciseId === c.exerciseId && !x.done && !x.skipped);
      order = steps.filter(x => !moved.includes(x));
      let end = -1;
      order.forEach((x, i) => { if (i >= at && x.blockId === cur.blockId && x.kind === 'set') end = i; });
      if (!moved.length || end < 0) return;
      // between its sets it gets the finisher's round rest
      const rr = steps.find(x => x.blockId === cur.blockId && x.kind === 'rest' && x.trimKind === 'finisherRound');
      const restSeconds = rr ? Math.max(15, rr.seconds - (rr.setupSeconds || 0)) : 45;
      const add = [];
      moved.forEach((m, k) => {
        if (k > 0) add.push({ ...blankStep(), kind: 'rest', blockId: m.blockId, blockName: m.blockName, blockType: m.blockType, name: 'Rest', seconds: restSeconds, countdown: true, trimKind: 'rest', round: m.round, roundCount: m.roundCount, protectedBlock: m.protectedBlock });
        add.push(m);
      });
      order.splice(end + 1, 0, ...add);
      label = `${cur.name} after the last round`;
    } else {
      let xEnd = n; while (xEnd < steps.length && steps[xEnd].blockId === cur.blockId) xEnd++;
      if (c.from < xEnd) return;
      order = [...steps.slice(0, n), ...steps.slice(c.from, c.to), ...steps.slice(n, xEnd), ...steps.slice(xEnd, c.from), ...steps.slice(c.to)];
      label = `${c.title.split(':')[0]} now`;
    }
    // every set gets its countdown again: set-up time goes to whichever exercise now comes first
    const head = order.slice(0, at);
    const seen = head.filter(x => x.kind === 'set' && x.exerciseId).map(x => x.exerciseId);
    const next = [...head, ...leadIns({ plan: this.plan, rules: this.rules, pacing: this.pacing }, order.slice(at), seen)];
    // the countdown before each block names what it now leads into
    next.forEach((st, i) => {
      st.idx = i;
      const nx = next[i + 1];
      if (!nx || st.kind !== 'transition' || st.lead || st.change || !/^Set up for /.test(st.name)) return;
      if (nx.kind === 'set') st.name = `Set up for ${[...new Set(next.filter(o => o.blockId === nx.blockId && o.kind === 'set').map(o => o.name))].join(' + ')}`;
      else if (nx.kind === 'stretch') st.name = 'Set up for the stretch block';
      else if (nx.blockType === 'emom') st.name = `Set up for ${(nx.blockName || 'the Engine').toLowerCase()}`;
      else st.name = `Set up for ${nx.name}`;
    });
    this.s.timeline.steps = next;
    this.goTo(at);
    toast(`Doing ${label}`, 5000, { action: 'Undo', onAction: () => {
      if (this.s.idx !== at) return;
      this.s.timeline.steps = before;
      this.goTo(at);
    } });
  }

  // ---- menu (L5) ----
  openMenu() {
    const paused = this.s.pausedAt != null;
    const p = this.projection();
    const behind = p.deltaSeconds >= 60 || p.overCapSeconds > 0;
    const s = this.step;
    const item = (ic, label, fn, cls) => el('button', { class: 'menu-item ' + (cls || ''), onclick: () => { closeModal(); fn(); } }, [icon(ic), el('span', {}, label)]);
    // v1.18: the set has started and the equipment turns out to be taken: step back to its countdown and choose there
    const onSet = s && s.kind === 'set' && !s.done && this.s.idx > 0 && this.leadsIntoSet(this.s.idx - 1);
    const cue = this.cueStep();
    showModal(el('div', {}, [
      el('div', { class: 'menu' }, [
        item(paused ? 'play' : 'pause', paused ? 'Resume' : 'Pause', () => (paused ? this.unpause() : this.pause())),
        item('list', 'Whole workout: sets and weights', () => this.openPlan()),
        cue ? item('plan', `Cues: ${cue.name}`, () => this.openCues(cue), 'cues-item') : null,
        this.s.idx > 0 ? item('back', 'Back one step', () => this.back()) : null,
        this.swapChoices().length ? item('skip', 'Equipment taken: do something else now', () => this.openSwap()) : null,
        onSet ? item('skip', 'Equipment taken: do something else now', () => { this.back(); if (this.swapChoices().length) this.openSwap(); else toast('Nothing later in this session to swap with'); }) : null,
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
  /** endAtMs: v1.15.1, when the session really stopped (Save what I did and stop, after the app was closed). */
  finish(status, endAtMs) {
    this.s.status = status;
    this.steps.forEach((s, i) => { if (i >= this.s.idx && !s.done && !s.skipped) { s.skipped = true; if (s.kind === 'set') s.record = { ...this.baseRecord(s), done: false, skipped: true }; } });
    const endedAt = endAtMs && endAtMs > this.s.sessionStart ? Math.min(endAtMs, Date.now()) : Date.now();
    // v1.18: a pause still under way when the session ends is paused time, not working time
    const pausedMs = this.s.pausedTotal + (this.s.pausedAt != null ? Math.max(0, endedAt - this.s.pausedAt) : 0);
    const draft = {
      timeline: this.s.timeline, status, startedAt: this.s.startedISO, endedAt: new Date(endedAt).toISOString(),
      actualSeconds: Math.max(0, Math.round((endedAt - this.s.sessionStart - pausedMs) / 1000)), pausedSeconds: Math.round(pausedMs / 1000),
      // v1.18: time in the gym, start to finish, pauses included (Cameron: "I want to see total time in gym")
      gymSeconds: Math.round(this.gymMs(endedAt) / 1000),
      plannedSeconds: this.s.timeline.plannedSeconds, trims: this.s.trims, livePrs: this.s.prs,
      // v1.14: minutes of the Engine finisher actually done, for the Hard efforts ring on Home
      engineMinutes: Math.round(this.steps.filter(x => x.blockType === 'emom' && x.done && !x.skipped).reduce((m, x) => m + (x.actualSeconds || x.seconds || 0), 0) / 60),
      sets: this.steps.filter(s => s.kind === 'set' && s.record).map(s => s.record),
      // v1.18: the id the record gets on Save, fixed now so a review restored after a reload saves the same session
      recordId: newId('ses')
    };
    this.teardown();
    // v1.18: the review is kept until it is saved, so a reload or a closed app on the Review page does not lose the
    // workout. The in-progress copy goes once the review is stored (if storing fails, Resume still has the session).
    setPendingReview(draft).then(() => clearInProgress()).catch(() => {});
    this.onFinish(draft);
  }
  abandon() { this.teardown(); clearInProgress().catch(() => {}); }

  // ---- session progress (v1.2) ----
  /** The step the top of the screen talks about: on a countdown, what it leads into. */
  headStep() { return this.leadsIn() ? this.steps[this.s.idx + 1] : this.step; }
  blockSummary() {
    const blocks = [];
    const byId = {};
    const nextSet = this.leadsIntoSet() ? this.s.idx + 1 : -1;
    const headId = this.headStep() ? this.headStep().blockId : null;
    this.steps.forEach((st, i) => {
      let b = byId[st.blockId];
      if (!b) {
        b = { id: st.blockId, name: st.blockName, type: st.blockType, label: this.blockLabel(st.blockId), mark: this.blockMark(st), planned: 0, done: 0, steps: 0, doneSteps: 0, firstIdx: i, exercises: [], items: [], current: st.blockId === headId };
        byId[st.blockId] = b; blocks.push(b);
      }
      const secs = st.seconds || 0;
      b.planned += secs; b.steps += 1;
      if (st.done || st.skipped) { b.doneSteps += 1; b.done += secs; }
      if (i === this.s.idx) b.done += Math.min(secs, Math.max(0, this.elapsedInStep()));
      const current = i === this.s.idx || i === nextSet;
      if (st.kind === 'set') {
        let e = b.exercises.find(x => x.exerciseId === st.exerciseId);
        if (!e) { e = { exerciseId: st.exerciseId, name: st.name, sets: [], ramps: [] }; b.exercises.push(e); }
        (st.ramp ? e.ramps : e.sets).push({ idx: i, done: !!st.done, skipped: !!st.skipped, current, hold: st.holdSeconds, perSide: st.perSide,
          weight: st.record && st.record.done ? st.record.weight : (st.target ? st.target.weight : null), reps: st.record && st.record.done ? st.record.reps : (st.target ? st.target.reps : null),
          baseline: st.baseline, retest: st.retest, fill: st.fillFromBaseline, pr: st.pr });
      } else if (st.kind === 'timed' || st.kind === 'stretch') {
        b.items.push({ idx: i, name: st.name, seconds: st.seconds, side: st.perSide ? st.sideSeconds : null, done: !!st.done, skipped: !!st.skipped, current: i === this.s.idx });
      }
    });
    return blocks;
  }
  blockLabel(blockId) {
    const first = this.steps.find(st => st.blockId === blockId);
    if (!first) return blockId;
    if (first.blockType === 'warmup') return 'Warm-up';
    if (first.blockType === 'stretch') return 'Stretch';
    if (first.blockType === 'finisher') return first.blockName === 'Last' ? 'Last' : 'Finisher';
    if (first.blockType === 'iftime') return 'If time';
    if (first.blockType === 'emom') return first.blockName || 'Engine';
    return this.blockNames(blockId, true).slice(0, 2).join(' / ');
  }
  blockNames(blockId, short) {
    const ids = [...new Set(this.steps.filter(st => st.blockId === blockId && st.kind === 'set' && st.exerciseId).map(st => st.exerciseId))];
    return ids.map(id => { const e = this.plan.exercises[id]; return e ? (short ? (e.short || e.name) : e.name) : id; });
  }
  /** v1.18: one letter per block for the strip (W warm-up, A B C, F finisher, E Engine, S stretch, + if time). */
  blockMark(st) {
    const t = st.blockType;
    if (t === 'warmup') return 'W';
    if (t === 'stretch') return 'S';
    if (t === 'iftime') return '+';
    if (t === 'emom') return 'E';
    if (t === 'finisher') return 'F';
    const m = /\b([A-Z])$/.exec(st.blockName || '');
    return m ? m[1] : (st.blockName || '?').charAt(0).toUpperCase();
  }
  /**
   * v1.18 (Cameron: "on the top row most of the detail is cut off"): the line under the header that says where he
   * is, full names first, short names if those do not fit (fit() picks).
   */
  whereTexts(hb) {
    const t = hb.blockType;
    if (t === 'warmup') return { full: 'Warm-up', short: 'Warm-up' };
    if (t === 'stretch') return { full: 'Stretch block', short: 'Stretch' };
    if (t === 'emom') { const n = hb.blockName || 'Engine'; return { full: n, short: n }; }
    if (t === 'finisher') { const x = `Finisher${hb.round ? ` · Round ${hb.round} of ${hb.roundCount}` : ''}`; return { full: x, short: x }; }
    const letter = /^[A-Z]$/.test(hb.blockName || '');
    const pre = t === 'iftime' ? 'If time · ' : (letter ? `Block ${hb.blockName} · ` : (hb.blockName ? `${hb.blockName} · ` : ''));
    return { full: pre + this.blockNames(hb.blockId, false).join(' + '), short: pre + this.blockNames(hb.blockId, true).join(' + ') };
  }
  renderStrip() {
    const blocks = this.blockSummary();
    const bar = el('div', { class: 'strip-bar' }, blocks.map(b => {
      const fill = b.planned ? Math.min(100, Math.round(100 * b.done / b.planned)) : (b.doneSteps === b.steps ? 100 : 0);
      return el('div', { class: 'seg' + (b.current ? ' current' : '') + (b.doneSteps === b.steps && !b.current ? ' finished' : ''), style: `flex: ${Math.max(b.planned, 75)} 0 0` }, [
        el('div', { class: 'seg-track' }, [el('div', { class: 'seg-fill', style: `width:${fill}%` })]),
        el('div', { class: 'seg-label' }, b.mark)
      ]);
    }));
    const status = el('div', { class: 'strip-status', id: 'clock' });
    return el('button', { class: 'strip', onclick: () => this.openPlan(), 'aria-label': 'Whole workout: every block with its sets and weights' }, [bar, status]);
  }
  /** "170 lb × 4", "60 lb (2 × 30) × 12", "25 s / side", "× 10" for a set, wherever a short form is needed. */
  shortTarget(st) {
    if (st.holdSeconds) return `${st.holdSeconds} s${st.perSide ? ' / side' : ''}`;
    const ex = this.plan.exercises[st.exerciseId];
    const w = st.target && st.target.weight != null ? st.target.weight : null;
    const reps = st.target && st.target.reps != null ? `${st.target.reps}` : (st.repRange ? repsText(st.repRange) : 'max');
    const r = `× ${reps}${st.perSide ? ' / side' : ''}`;
    if (w == null) return st.fillFromBaseline ? `90% of the top set ${r}`.replace('90%', `${Math.round(this.rules.baseline.trainingFraction * 100)}%`) : r;
    const pair = pairText(ex, w);
    return `${ex && ex.equipment === 'weighted_bw' ? '+' : ''}${fmtWeight(w)} lb${pair ? ` (${pair})` : ''} ${r}`;
  }
  /**
   * v1.18 (Cameron: "allow the screen to show the overall workout planned with details and weights while the
   * workout is going"): every block, each lift's sets × reps and weight, what is done (with what was logged), what
   * is next. Opened from Plan in the header, from the strip, or from the menu.
   */
  openPlan() {
    const blocks = this.blockSummary();
    const p = this.projection();
    const d = p.deltaSeconds;
    const pace = Math.abs(d) < 60 ? 'on time' : `${Math.round(Math.abs(d) / 60)} min ${d > 0 ? 'behind' : 'ahead'}`;
    const clock = sec => fmtClock(sec);
    const chip = x => {
      const cls = x.done ? ' done' : (x.skipped ? ' skipped' : (x.current ? ' current' : ''));
      const nums = x.hold ? `${x.reps != null ? x.reps : x.hold} s` : (x.weight != null ? `${fmtWeight(x.weight)}×${x.reps == null ? '?' : x.reps}` : (x.reps != null ? `×${x.reps}` : '?'));
      return el('span', { class: 'tick' + cls }, [x.done ? '✓ ' : (x.skipped ? '– ' : (x.current ? '● ' : '')), x.skipped ? 'skipped' : ((x.baseline ? 'top ' : '') + (x.fill && x.weight == null && !x.done ? `×${x.reps}` : nums)), x.pr ? ' PR' : '']);
    };
    const exRow = (b, e) => {
      const stepOf = x => this.steps[x.idx];
      const open = e.sets.find(x => !x.done && !x.skipped && !x.baseline && !x.retest) || e.sets.find(x => !x.baseline && !x.retest) || e.sets[0];
      const n = e.sets.filter(x => !x.baseline && !x.retest).length;
      const top = e.sets.some(x => x.baseline || x.retest);
      const count = n ? `${n} ${b.type === 'finisher' ? (n === 1 ? 'round' : 'rounds') : (n === 1 ? 'set' : 'sets')}` : '';
      const os = open ? stepOf(open) : null;
      const ex = this.plan.exercises[e.exerciseId];
      let what = '';
      if (os && top && os.fillFromBaseline && !(os.target && os.target.weight != null)) {
        // week 1 and week 12: the weight comes from the top set, so say that in one short line
        what = `top set, then ${count} of ${os.target && os.target.reps != null ? os.target.reps : '?'} at ${Math.round(this.rules.baseline.trainingFraction * 100)}%`;
      } else if (os) {
        const noWeight = !os.holdSeconds && !(os.target && os.target.weight != null) && ex && ex.equipment !== 'bodyweight';
        what = `${top ? 'top set, then ' : ''}${count ? count + ' · ' : ''}${noWeight ? 'pick a weight ' : ''}${this.shortTarget(os)}`;
      }
      return el('div', { class: 'ov-ex-row' }, [
        el('div', { class: 'ov-row' }, [el('span', { class: 'ov-name' }, e.name), el('span', { class: 'ov-target' }, what)]),
        e.ramps.length ? el('div', { class: 'ov-sets ramps' }, [el('span', { class: 'ov-lab' }, 'Ramp-up'), ...e.ramps.map(chip)]) : null,
        el('div', { class: 'ov-sets' }, e.sets.map(chip))
      ]);
    };
    const itemRows = b => {
      if (b.type === 'emom') {
        const stations = [...new Set(b.items.map(x => x.name.replace(/^Min \d+ of \d+:\s*/, '')))];
        const done = b.items.filter(x => x.done).length;
        return [el('div', { class: 'ov-line' }, `${b.items.length} min, one station a minute${done ? ` · ${done} done` : ''}`), ...stations.map(n => el('div', { class: 'ov-line sub' }, n))];
      }
      const groups = [];
      b.items.forEach(x => { const g = groups.find(y => y.name === x.name && y.seconds === x.seconds); if (g) g.items.push(x); else groups.push({ name: x.name, seconds: x.seconds, side: x.side, items: [x] }); });
      return groups.map(g => el('div', { class: 'ov-row item' + (g.items.every(x => x.done || x.skipped) ? ' done' : (g.items.some(x => x.current) ? ' current' : '')) }, [
        el('span', { class: 'ov-name' }, g.name),
        el('span', { class: 'ov-target' }, `${g.items.length > 1 ? g.items.length + ' × ' : ''}${g.side ? clock(g.side) + ' / side' : clock(g.seconds)}`)
      ]));
    };
    const title = b => {
      if (b.type === 'warmup') return 'Warm-up';
      if (b.type === 'stretch') return 'Stretch block';
      if (b.type === 'finisher') return 'Finisher';
      if (b.type === 'iftime') return 'If time';
      if (b.type === 'emom') return b.name || 'Engine';
      return /^[A-Z]$/.test(b.name || '') ? `Block ${b.name}` : (b.name || b.label);
    };
    const body = el('div', { class: 'overview plan-sheet', id: 'plan-sheet' }, [
      el('h2', {}, this.s.timeline.sessionName),
      el('p', { class: 'muted ov-sub' }, `${fmtMinutes(p.remaining)} left · ends ${fmtTime(p.finishAt)} · ${pace} · ${fmtGym(this.gymMs() / 1000)} in the gym`),
      ...blocks.map(b => {
        const finished = b.doneSteps === b.steps && !b.current;
        return el('div', { class: 'ov-block' + (b.current ? ' current' : '') + (finished ? ' finished' : '') }, [
          el('div', { class: 'ov-head' }, [
            el('span', { class: 'ov-mark' }, b.mark), el('b', {}, title(b)),
            el('span', { class: 'muted ov-state' }, `${finished ? 'done' : (b.current ? 'now' : 'to come')} · ${Math.max(1, Math.round(b.planned / 60))} min`)
          ]),
          b.exercises.length ? el('div', { class: 'ov-ex' }, b.exercises.map(e => exRow(b, e))) : el('div', { class: 'ov-ex' }, itemRows(b))
        ]);
      }),
      el('button', { class: 'btn ghost', id: 'plan-close', onclick: () => closeModal() }, 'Close')
    ]);
    showModal(body);
    // a target too long to sit beside its lift's name goes under it, left-aligned (it used to wrap to the right edge)
    body.querySelectorAll('.ov-row').forEach(r => {
      const a = r.firstElementChild, t = r.lastElementChild;
      if (a && t && a !== t && t.getBoundingClientRect().top > a.getBoundingClientRect().top + 4) r.classList.add('stack');
    });
  }
  openOverview() { this.openPlan(); }

  /** Scroll the middle just far enough to show the cues he opened (their title stays in view). */
  revealCues(det) {
    const main = det.closest('.step-main');
    if (!main) return;
    const m = main.getBoundingClientRect(), d = det.getBoundingClientRect();
    const below = d.bottom - m.bottom;
    if (below > 0) main.scrollTop += Math.min(below + 24, Math.max(0, d.top - m.top));
  }
  /** The step whose cues the ⋯ menu offers: the set on screen, or the one this countdown leads into. */
  cueStep() {
    const s = this.step;
    const x = s && s.kind !== 'set' && this.leadsIn() ? this.steps[this.s.idx + 1] : s;
    return x && ((x.tips && x.tips.length) || x.cue) ? x : null;
  }
  /** v1.18: a lift's cues on a sheet. On a full screen the Cues row is the first thing to go, so they are always here. */
  openCues(x) {
    showModal(el('div', { class: 'cues-sheet', id: 'cues-sheet' }, [
      el('h2', {}, x.name),
      el('div', { class: 'tips' }, [...(x.tips || []).map(t => el('div', { class: 'tip' }, t)), x.cue ? el('div', { class: 'tip note' }, x.cue) : null]),
      el('button', { class: 'btn ghost', id: 'cues-close', onclick: () => closeModal() }, 'Close')
    ]));
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
    if (x.ramp) parts.push('Ramp-up');
    else if (x.baseline) parts.push('Baseline set');
    else if (x.retest) parts.push('Retest set');
    else if (x.round && x.blockType !== 'finisher') parts.push(`Round ${x.round} of ${x.roundCount}`);
    else if (!x.round && x.setIndex && x.setCount) parts.push(`Set ${x.setIndex} of ${x.setCount}`);
    if (x.equipment) parts.push(x.equipment);
    return parts.join(' · ');
  }
  /** The set whose card shows on this countdown: the one just before it (a timed hang after the set may sit between). */
  lastSetIdx() {
    let i = this.s.idx - 1;
    while (i >= 0 && this.steps[i].kind === 'timed' && this.steps[i].blockType !== 'warmup' && this.steps[i].blockType !== 'emom') i--;
    return i >= 0 && this.steps[i].kind === 'set' ? i : -1;
  }
  /**
   * Rest screen: the set that just ended, as its own card. v1.5: weight and reps change with - and + right here
   * (tap a number to type it), and a check shows that the set is logged or that a change was saved.
   * v1.18: three compact rows (logged + name + Undo, the two steppers, effort) so it fits above Up next, and it
   * shows after every set, also the last set of a block (the calf raise in the finisher had no effort check).
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
    const stepper = (key, label, value, unit, minus, plus) => el('div', { class: 'jd-step jd-step-' + key }, [
      el('button', { type: 'button', class: 'jd-pm', id: `jd-${key}-minus`, 'aria-label': `less ${label}`, onclick: minus }, '−'),
      el('button', { type: 'button', class: 'jd-val' + (needs && key === 'w' ? ' needs' : ''), 'aria-label': `type ${label}`, onclick: () => this.openFix(idx) }, [el('span', { class: 'jd-num', id: `jd-${key}` }, value), el('small', {}, unit)]),
      el('button', { type: 'button', class: 'jd-pm', id: `jd-${key}-plus`, 'aria-label': `more ${label}`, onclick: plus }, '+')
    ]);
    const w = rec.weight != null ? rec.weight : (p.target && p.target.weight != null ? p.target.weight : null);
    const fresh = Date.now() - this.savedAt < 1600;
    const where = p.round ? `round ${p.round}` : (p.ramp ? 'ramp-up' : (p.baseline ? 'top set' : (p.setIndex ? `set ${p.setIndex}` : '')));
    const canUndo = p.undo && idx === this.s.idx - 1;
    const pair = hasWeight ? pairText(ex, rec.weight) : '';
    // v1.18: a ramp-up set feeds nothing (no effort, no progression), so its card is one line: on the rest where the
    // bar changes, the room goes to the plates to add and the sets to come. The title still opens the type-in sheet.
    const slim = !!p.ramp;
    // on a screen that waits for his tap there is something to set up, so the steppers fold before the up-next
    // details go; on a plain rest it is the other way round (see fit())
    const fold = this.setupScreen() ? 3 : 4;
    // a set the timer logged shows its effort as an outline (the app's guess) until he taps one
    return el('div', { class: 'just-done' + (rec.unconfirmed ? ' unconfirmed' : '') + (slim ? ' slim' : ''), id: 'just-done' }, [
      el('div', { class: 'jd-head' }, [
        el('div', { class: 'jd-check' + (fresh ? ' flash' : ''), 'aria-hidden': 'true' }, icon('check')),
        // the title opens the type-in sheet; when the screen is short the steppers fold away and the numbers show here
        el('button', { type: 'button', class: 'jd-title', 'aria-label': 'Fix the numbers of this set', onclick: () => this.openFix(idx) }, [
          el('div', { class: 'jd-name' }, p.name),
          el('div', { class: 'jd-sub' }, [
            el('span', slim ? {} : { class: `fit-${fold}` }, [el('span', { class: 'jd-saved' + (fresh ? ' flash' : ''), id: 'jd-saved' }, rec.edited ? 'Saved' : (rec.unconfirmed ? 'Logged as planned' : 'Logged')), where ? ' · ' : '']),
            where || null,
            el('span', slim ? { id: 'jd-nums' } : { class: `only-${fold}`, id: 'jd-nums' }, `${where ? ' · ' : ''}${hasWeight ? `${rec.weight != null ? fmtWeight(rec.weight) : '?'} lb × ` : ''}${rec.reps != null ? rec.reps : '?'}${p.holdSeconds ? ' s' : ''} ›`)
          ])
        ]),
        // v1.14: Done by mistake: back to that set as it was
        canUndo ? el('button', { type: 'button', class: 'jd-undo', id: 'jd-undo', onclick: () => this.undoLast() }, 'Undo') : null
      ]),
      slim ? null : el('div', { class: `jd-steps fit-${fold}` + (hasWeight ? '' : ' one') }, [
        hasWeight ? stepper('w', isPair(ex) ? 'total weight' : (ex && ex.equipment === 'weighted_bw' ? 'added weight' : 'weight'), rec.weight != null ? fmtWeight(rec.weight) : '?',
          pair ? `lb (${pair.replace(/\s+/g, '')})` : (ex && ex.equipment === 'weighted_bw' ? 'lb added' : 'lb'),
          // v1.15.1: with no weight yet, - and + open the type-in sheet (one tap on + used to log 5 lb)
          () => (w == null ? this.openFix(idx) : change({ weight: Math.max(0, w - wStep) })), () => (w == null ? this.openFix(idx) : change({ weight: w + wStep }))) : null,
        stepper('r', p.holdSeconds ? 'seconds' : 'reps', rec.reps != null ? `${rec.reps}` : '?', p.holdSeconds ? (p.perSide ? 's / side' : 'seconds') : (p.perSide ? '/ side' : 'reps'),
          () => change({ reps: Math.max(0, (rec.reps || 0) - 1) }), () => change({ reps: (rec.reps || 0) + 1 }))
      ]),
      p.holdSeconds || slim ? null : effortChips(this.rules, rec.rpe, lvl => change({ rpe: lvl.rpe }))
    ]);
  }
  openFix(idx) {
    const p = this.steps[idx]; if (!p || !p.record) return;
    const ex = this.plan.exercises[p.exerciseId];
    const isBw = ex && ex.equipment === 'bodyweight';
    const wStep = ex ? incrementFor(this.rules, p.exerciseId, ex) : 5;
    const wVal = p.record.weight != null ? p.record.weight : (p.target && p.target.weight != null ? p.target.weight : '');
    const num = id => { const x = document.getElementById(id); return x && x.value !== '' ? Number(x.value) : null; };
    // v1.18: a number that cannot be right is refused here, said inside the sheet (a toast sits behind it)
    const refused = el('div', { class: 'num-flag', id: 'fix-refused', role: 'alert', hidden: true });
    showModal(el('div', { class: 'fix-set' }, [
      el('h2', {}, `${p.name}${p.setIndex ? ', ' + (p.round ? 'round ' : 'set ') + p.setIndex : ''}`),
      el('div', { class: 'num-fields' + (isBw || p.holdSeconds ? ' one' : '') }, [
        isBw || p.holdSeconds ? null : field(ex && ex.equipment === 'weighted_bw' ? 'Added lb' : (isPair(ex) ? 'Total of both (lb)' : 'Weight (lb)'), 'fix-weight', wVal, wStep || 2.5),
        field(p.holdSeconds ? 'Seconds' : 'Reps', 'fix-reps', p.record.reps != null ? p.record.reps : '', 1)
      ]),
      refused,
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Cancel'),
        el('button', { class: 'btn primary', id: 'jd-fix-save', onclick: () => {
          const patch = { reps: num('fix-reps') };
          if (!isBw && !p.holdSeconds) patch.weight = num('fix-weight');
          // v1.18: reps below 0 or part of a rep are refused here; the sheet stays open
          const bad = impossibleNumber(patch, ex, { hold: !!p.holdSeconds });
          if (bad) { refused.textContent = `${bad}.`; refused.hidden = false; haptic('warn'); return; }
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
      const r = x.holdSeconds ? `${x.holdSeconds} s${x.perSide ? ' / side' : ''}` : (x.target && x.target.reps != null ? `× ${x.target.reps}` : '');
      return `${x.name} ${w} ${r}`.replace(/\s+/g, ' ').trim();
    }
    if (x.kind === 'decision') return x.name;
    if (x.perSide && x.sideSeconds) return `${x.name} ${fmtClock(x.sideSeconds)} / side`;
    return `${x.name}${x.seconds ? ' ' + fmtClock(x.seconds) : ''}`;
  }

  kindGroup(s) {
    if (s.kind === 'rest') return 'rest';
    if (s.kind === 'transition') return this.leadsIn() ? 'rest' : 'calm';
    if (s.kind === 'stretch' || s.blockType === 'warmup' || s.kind === 'decision') return 'calm';
    return 'work';
  }

  pill(text, cls, hidden) { return el('div', { class: 'phase-pill step-kind ' + cls, id: 'phase-pill', hidden: !!hidden }, text); }
  /** v1.18 (Cameron: "make it obvious I'm paused"): red, counting how long, one tap to go on. */
  pausedBanner() {
    return el('button', { class: 'paused-banner', id: 'paused-banner', onclick: () => this.unpause() }, [
      icon('play'),
      el('span', { class: 'pb-text' }, [el('b', {}, ['Paused ', el('span', { id: 'paused-for' }, '0:00')]), el('small', {}, 'Tap to resume')])
    ]);
  }

  /**
   * v1.18: the screen is three parts in a shell exactly as tall as the phone: the top (header, where he is, the
   * strip), the middle (what to do), the buttons. Nothing scrolls. fit() then tightens the middle until it fits.
   */
  renderStep() {
    const s = this.step; if (!s) return;
    const c = this.container; c.innerHTML = '';
    const paused = this.s.pausedAt != null;
    const group = this.kindGroup(s);
    const lead = this.leadsIn();
    const next = this.steps[this.s.idx + 1];
    const hb = this.headStep();

    const top = el('div', { class: 'player-top' }, [this.renderHead(hb, paused), this.renderFinRow(hb), this.renderStrip()]);
    const main = el('div', { class: 'step-main ' + (lead ? 'lead' : (s.kind === 'set' ? 'work' : 'calm')) });
    if (lead) this.renderLead(main, s, next, paused);
    else if (s.kind === 'set') this.renderSet(main, s, paused);
    else this.renderOther(main, s, next, paused);
    const actions = this.renderActions(s);

    document.body.setAttribute('data-kind', this.phaseKind(group));
    c.appendChild(el('div', { class: 'player' + (paused ? ' is-paused' : ''), 'data-kind': group, 'data-step': String(this.s.idx) }, [top, main, actions]));
    this.updateTimerDom();
    this.fit();
  }

  renderHead(hb, paused) {
    const where = this.whereTexts(hb);
    return el('div', { class: 'player-head' }, [
      el('div', { class: 'head-row' }, [
        el('button', { class: 'plan-pill', id: 'plan-btn', 'aria-label': 'Whole workout: every block with its sets and weights', onclick: () => this.openPlan() }, [icon('list'), el('span', {}, 'Plan')]),
        el('div', { class: 'gym-clock' }, [el('b', { id: 'gym-clock' }, '0:00'), el('small', {}, 'in the gym')]),
        // v1.5: Pause sits in the header on every screen, warm-up and stretch included. v1.18: red while paused.
        el('button', { class: 'pause-pill' + (paused ? ' on' : ''), id: 'pause-btn', onclick: () => (paused ? this.unpause() : this.pause()) }, [icon(paused ? 'play' : 'pause'), el('span', {}, paused ? 'Resume' : 'Pause')]),
        el('button', { class: 'icon-btn', id: 'more-btn', 'aria-label': 'More', onclick: () => this.openMenu() }, icon('more'))
      ]),
      el('div', { class: 'where-line', id: 'where' }, [el('span', { class: 'block', 'data-full': where.full, 'data-short': where.short }, where.full)])
    ]);
  }
  /** v1.5: in a finisher the top lists its exercises, with the one he is on (or about to do) picked out. */
  renderFinRow(hb) {
    if (!hb || hb.blockType !== 'finisher') return null;
    const ids = [...new Set(this.steps.filter(st => st.blockId === hb.blockId && st.kind === 'set' && st.exerciseId).map(st => st.exerciseId))];
    const nowId = hb.kind === 'set' ? hb.exerciseId : null;
    const short = id => (this.plan.exercises[id] && (this.plan.exercises[id].short || this.plan.exercises[id].name)) || id;
    return el('div', { class: 'fin-row', id: 'fin-row' }, ids.map(id => el('span', { class: 'fin-ex' + (id === nowId ? ' now' : '') }, short(id))));
  }

  /** A rest, a set-up or a change-over before something to do: the clock, the set just done (to fix), what is next. */
  renderLead(main, s, next, paused) {
    const ready = this.isReady();
    const held = this.held();
    // the tap is in and the rest is not over: it runs to its end. The set-up part is done, so what is left is a rest.
    const early = this.s.confirmed && this.needsConfirm() && !ready && s.kind === 'rest';
    const base = s.change ? 'Change over' : (s.kind === 'rest' ? (s.setupFor && !early ? 'Rest + set up' : 'Rest') : (s.lead && !s.setupFor ? 'Switch' : 'Set up'));
    const text = ready ? 'Get ready' : (held ? (next.kind === 'set' ? 'Confirm set-up' : 'Ready?') : base);
    const jd = this.justDone(this.lastSetIdx());
    main.appendChild(el('div', { class: 'lead-top' + (jd ? '' : ' big') }, [
      paused ? this.pausedBanner() : null, this.pill(text, ready || held ? 'ready' : 'rest', paused),
      el('div', { class: 'timer', id: 'timer' }, '0:00'),
      // beside the clock, so it costs no height and nothing else on the screen moves when he taps
      early && !paused ? el('div', { class: 'ready-note', id: 'ready-note' }, [icon('check'), el('span', { class: 'rn-text' }, next.kind === 'set' ? 'Set-up done' : 'Ready')]) : null
    ]));
    main.appendChild(el('div', { class: 'rest-track' }, [el('div', { class: 'rest-fill', id: 'rest-fill' })]));
    if (jd) main.appendChild(jd);
    main.appendChild(this.upNext(next, s));
  }

  /** "130 lb × 5 reps": the one line that says what to load and how many (used on the countdown before a set). */
  targetLine(x, ex) {
    if (x.holdSeconds) return el('div', { class: 'un-target step-target' }, [el('span', { class: 'un-reps' }, [el('b', {}, `${x.holdSeconds}`), x.perSide ? ' s each side' : ' s'])]);
    const w = x.target && x.target.weight != null ? x.target.weight : null;
    const reps = x.target && x.target.reps != null ? `${x.target.reps}` : (x.repRange ? repsText(x.repRange) : 'max');
    const pair = w != null ? pairText(ex, w) : '';
    const isBw = ex && ex.equipment === 'bodyweight';
    let weight;
    if (w != null) weight = el('span', { class: 'tile-weight' }, [el('b', {}, `${ex && ex.equipment === 'weighted_bw' ? '+' : ''}${fmtWeight(w)}`), ' lb', pair ? el('small', {}, ` (${pair})`) : null]);
    else weight = el('span', { class: 'tile-weight word' }, isBw ? 'Bodyweight' : (x.baseline ? 'Work up' : (x.fillFromBaseline ? `${Math.round(this.rules.baseline.trainingFraction * 100)}% of the top set` : 'Pick a weight')));
    return el('div', { class: 'un-target step-target' }, [
      weight, el('span', { class: 'un-x', 'aria-hidden': 'true' }, '×'),
      el('span', { class: 'un-reps' }, [el('b', {}, reps), x.perSide ? ' / side' : (reps === '1' ? ' rep' : ' reps')])
    ]);
  }
  /** The weight of the last set of this exercise before step idx, ramp-ups included (what is on the bar now). */
  weightBefore(idx, exerciseId) {
    for (let i = idx - 1; i >= 0; i--) {
      const x = this.steps[i];
      if (x.kind !== 'set' || x.exerciseId !== exerciseId || x.skipped) continue;
      return x.record && x.record.weight != null ? x.record.weight : (x.target ? x.target.weight : null);
    }
    return null;
  }
  /**
   * v1.18 (Cameron: "for upcoming sets, show reps and weight, to help with set-up"): what follows the next set in
   * this block. Before a ramp-up or a top set: the weights still to come on that bar. In a superset or a finisher:
   * the other lifts with their reps and weight, so everything can be set up at once.
   */
  thenRows(x) {
    const n = this.s.idx + 1;
    const rows = [];
    const later = this.steps.slice(n + 1).filter(st => st.kind === 'set' && st.blockId === x.blockId && !st.done && !st.skipped);
    const same = later.filter(st => st.exerciseId === x.exerciseId);
    if (x.ramp || x.baseline || x.retest) {
      const ramps = same.filter(st => st.ramp);
      const work = same.filter(st => !st.ramp);
      if (ramps.length) rows.push({ name: 'Then ramp-up', text: ramps.map(st => `${fmtWeight(st.target.weight)} × ${st.target.reps}`).join(', ') });
      if (work.length) rows.push({ name: `Then ${work.length} work set${work.length === 1 ? '' : 's'}`, text: this.shortTarget(work[0]) });
    }
    const seen = new Set([x.exerciseId]);
    for (const st of later) {
      if (seen.has(st.exerciseId)) continue;
      // a finisher: only the rest of this round (later rounds are the same lifts again)
      if (x.blockType === 'finisher' && st.round !== x.round) continue;
      seen.add(st.exerciseId);
      rows.push({ name: st.name, text: this.shortTarget(st) });
    }
    return rows.slice(0, 4);
  }
  upNext(x, lead) {
    const up = el('div', { class: 'up-next', id: 'up-next' });
    const head = where => el('div', { class: 'un-head' }, [el('span', { class: 'label' }, 'Up next'), where ? el('span', { class: 'step-where small' }, where) : null]);
    // what follows the next set, and the plates per side: the last things to go on a screen that waits for his tap
    const keep = this.setupScreen() ? 4 : 3;
    const rowsEl = rows => (rows.length ? el('div', { class: `un-then fit-${keep}`, id: 'un-then' }, rows.map((r, i) => el('div', { class: 'un-row' + (i > 0 ? ' fit-2' : '') }, [el('span', { class: 'un-row-name' }, r.name), el('span', { class: 'un-row-text' }, r.text)]))) : null);
    if (x.kind !== 'set') {
      // a stretch, a warm-up drill or the Engine
      const emom = x.blockType === 'emom';
      const where = emom ? `Minute ${x.setIndex} of ${x.setCount}` : (x.where || (x.setCount ? `${x.setIndex} of ${x.setCount}` : ''));
      up.appendChild(head(where));
      up.appendChild(el('div', { class: 'step-name' }, emom ? x.name.replace(/^Min \d+ of \d+:\s*/, '') : x.name));
      up.appendChild(el('div', { class: 'un-target step-target' }, [el('span', { class: 'un-reps' }, [el('b', {}, fmtClock(x.perSide && x.sideSeconds ? x.sideSeconds : x.seconds)), x.perSide && x.sideSeconds ? ' each side' : ''])]));
      // entering a block: the rest of it, so he knows what he is setting up for
      if (lead && lead.blockId !== x.blockId) {
        const rest = this.steps.slice(this.s.idx + 2).filter(st => st.blockId === x.blockId && (st.kind === 'timed' || st.kind === 'stretch'));
        const rows = [];
        if (emom) [...new Set(rest.map(st => st.name.replace(/^Min \d+ of \d+:\s*/, '')))].filter(nm => nm !== x.name.replace(/^Min \d+ of \d+:\s*/, '')).forEach(nm => rows.push({ name: nm, text: '' }));
        else rest.forEach(st => rows.push({ name: st.name, text: st.perSide && st.sideSeconds ? `${fmtClock(st.sideSeconds)} / side` : fmtClock(st.seconds) }));
        const r = rowsEl(rows.slice(0, 4));
        if (r) up.appendChild(r);
      }
      if (x.cue) up.appendChild(el('div', { class: 'step-cue fit-1' }, x.cue));
      return up;
    }
    const ex = this.plan.exercises[x.exerciseId];
    up.appendChild(head(this.whereText(x)));
    up.appendChild(el('div', { class: 'step-name' }, x.name));
    up.appendChild(this.targetLine(x, ex));
    const words = this.effortWords(x);
    const lvl = effortLevel(this.rules, x.rpeDefault);
    if (words) up.appendChild(el('div', { class: 'un-sub fit-3' }, [lvl ? el('span', { class: 'dot effort-' + lvl.key }) : null, x.baseline || x.retest ? (x.effortText || words) : words]));
    // the bar (or the pin, or the dumbbells) has to change
    const was = this.weightBefore(this.s.idx + 1, x.exerciseId);
    const will = x.target ? x.target.weight : null;
    const first = was == null && !this.steps.slice(0, this.s.idx + 1).some(st => st.kind === 'set' && st.exerciseId === x.exerciseId && st.done);
    if (was != null && will != null && was !== will) {
      // on a barbell: what that is per side
      const side = ex && ex.equipment === 'barbell' ? ` (${will > was ? 'add' : 'take off'} ${fmtWeight(Math.abs(will - was) / 2)} a side)` : '';
      up.appendChild(el('div', { class: 'step-cue change', id: 'change-weight' }, [`Change the weight: ${fmtWeight(was)} → ${fmtWeight(will)} lb`, side ? el('span', { class: `fit-${keep}`, id: 'change-side' }, side) : null]));
    }
    const rows = rowsEl(this.thenRows(x));
    if (rows) up.appendChild(rows);
    if (first && x.tips && x.tips.length) up.appendChild(el('div', { class: 'tips fit-1' }, x.tips.slice(0, 2).map(t => el('div', { class: 'tip' }, t))));
    return up;
  }

  /**
   * v1.14: the work-set readout. The weight is the one big number (readable from the floor mid-set); reps and
   * effort follow on one line. v1.18: a bodyweight lift shows its reps big; a hold leaves the room to its clock.
   */
  heroReadout(s, ex) {
    const lvl = effortLevel(this.rules, s.rpeDefault);
    const effort = this.effortWords(s);
    const isBw = ex && ex.equipment === 'bodyweight';
    const added = ex && ex.equipment === 'weighted_bw';
    const w = s.target && s.target.weight != null ? s.target.weight : null;
    const reps = s.target && s.target.reps != null ? `${s.target.reps}` : (s.repRange ? repsText(s.repRange) : 'max');
    const repsLabel = s.perSide ? 'reps / side' : (reps === '1' ? 'rep' : 'reps');
    const pair = w != null ? pairText(ex, w) : '';
    let big = null;
    let repsInLine = true;
    if (s.holdSeconds) big = null;
    else if (w != null) big = el('div', { class: 'hero-weight tile-weight' }, [el('span', { class: 'hw-num' }, fmtWeight(w)), el('span', { class: 'hw-unit' }, pair ? 'lb total' : (added ? 'lb added' : 'lb')), pair ? el('div', { class: 'tile-sub' }, pair + ' lb') : null]);
    else if (isBw) { big = el('div', { class: 'hero-weight tile-weight' }, [el('span', { class: 'hw-num' }, reps), el('span', { class: 'hw-unit' }, repsLabel)]); repsInLine = false; }
    else big = el('div', { class: 'hero-weight tile-weight word' }, [el('span', { class: 'hw-num' }, added ? '+0' : (s.baseline || s.retest ? 'Work up' : '?')), added ? el('span', { class: 'hw-unit' }, 'lb added') : null]);
    const bits = [];
    if (s.holdSeconds) bits.push(el('span', { class: 'hl-reps' }, [el('b', {}, `${s.holdSeconds}`), s.perSide ? ' s each side' : ' seconds']));
    else if (repsInLine) bits.push(el('span', { class: 'hl-reps' }, [el('b', {}, reps), ' ', repsLabel]));
    if (effort) {
      if (bits.length) bits.push(el('span', { class: 'hl-sep', 'aria-hidden': 'true' }, '·'));
      bits.push(el('span', { class: 'hl-effort' }, [lvl ? el('span', { class: 'dot effort-' + lvl.key }) : null, effort]));
    }
    return el('div', { class: 'readout step-target hero' + (big ? '' : ' no-weight'), id: 'hero-readout' }, [big, el('div', { class: 'hero-line' }, bits)]);
  }

  /**
   * v1.18: Left and Right side by side, each with its own clock and color. The side to work is lit, the other is
   * dim; a done side shows a check. Tapping Right while Left is still running starts it now (he finished early).
   * Right cannot be tapped in the get-set seconds before the left side starts: there is no left side to cut short.
   */
  sidesPanel(s) {
    const info = this.sideInfo() || { phase: 'left' };
    const ph = info.phase;
    const hold = !!(s.holdSeconds || s.sideSeconds);
    const leftState = ph === 'set' ? 'next' : (ph === 'left' ? 'active' : 'done');
    const rightState = ph === 'right' ? 'active' : (ph === 'over' ? 'done' : (ph === 'switch' ? 'next' : 'later'));
    const half = (side, state, tap) => el(tap ? 'button' : 'div', { class: `side ${side} ${state}`, id: `side-${side}`, type: tap ? 'button' : null, 'aria-label': tap ? 'Start the right side now' : null, onclick: tap ? () => this.switchSideNow() : null }, [
      el('span', { class: 'side-name' }, side === 'left' ? 'Left' : 'Right'),
      el('span', { class: 'side-time', id: `side-${side}-time` }, state === 'done' ? '✓' : '0:00'),
      el('small', { class: 'side-note', id: `side-${side}-note` }, state === 'active' ? (hold ? 'hold' : 'now') : (state === 'done' ? 'done' : (side === 'left' ? 'get set' : (ph === 'switch' ? 'switch sides' : (ph === 'set' ? 'next' : 'tap to start now')))))
    ]);
    return el('div', { class: `sides phase-${ph}${hold ? ' is-hold' : ''}`, id: 'sides' }, [
      half('left', leftState, false),
      half('right', rightState, ph === 'left' || ph === 'switch')
    ]);
  }

  renderSet(main, s, paused) {
    const ex = this.plan.exercises[s.exerciseId];
    const kind = s.ramp ? 'Ramp-up' : (s.baseline ? 'Baseline' : (s.retest ? 'Retest' : (s.holdSeconds ? 'Hold' : 'Work')));
    // the pill already says Ramp-up, Baseline or Retest: the line beside it does not say it twice
    const where = this.whereText(s).replace(/^(Ramp-up|Baseline set|Retest set)(?: · |$)/, '');
    const sided = this.sided(s);
    main.appendChild(el('div', { class: 'work-top' }, [
      paused ? this.pausedBanner() : null, this.pill(kind, 'work', paused),
      where && !paused ? el('div', { class: 'step-where' }, where) : null
    ]));
    main.appendChild(el('div', { class: 'step-name big' }, [el('span', { class: 'sn-text' }, s.name), s.pr ? el('span', { class: 'pr-badge' }, 'PR') : null]));
    main.appendChild(this.heroReadout(s, ex));
    if (sided) main.appendChild(this.sidesPanel(s));
    if (s.auto && !s.holdSeconds) {
      main.appendChild(el('div', { class: 'pace', id: 'pace' }, [
        el('div', { class: 'pace-row' }, [el('span', { class: 'pace-text', id: 'pace-text' }, ''), el('span', { class: 'pace-clock', id: 'timer' }, '0:00')]),
        el('div', { class: 'pace-track' }, [el('div', { class: 'pace-fill', id: 'pace-fill' })])
      ]));
    } else if (!sided) main.appendChild(this.timerBlock(this.isCountdown(s)));
    // L2: last time
    if (s.last && ((s.last.sets && s.last.sets.length) || s.last.topSet) && !s.ramp) {
      const l = s.last.sets && s.last.sets.length ? s.last : { ...s.last, sets: [s.last.topSet] };
      const sameW = l.sets.every(x => x.weight === l.sets[0].weight);
      const reps = l.sets.map(x => x.reps == null ? '?' : x.reps).join(', ');
      const rpes = l.sets.map(x => x.rpe).filter(x => x != null);
      const lvl = rpes.length ? effortLevel(this.rules, Math.max(...rpes)) : null;
      const rpe = lvl ? ` · ${lvl.label}` : '';
      const txt = sameW && l.sets[0].weight != null ? `${fmtWeight(l.sets[0].weight)} lb × ${reps}${rpe}` : l.sets.map(x => `${x.weight != null ? fmtWeight(x.weight) : 'bw'} × ${x.reps == null ? '?' : x.reps}`).join(', ') + rpe;
      main.appendChild(el('div', { class: 'last-time fit-2' }, [el('span', { class: 'label-inline' }, 'Last time'), ' ', txt]));
    }
    // v1.14: cues fold behind a tap. They start open on an exercise's first work set (and on baseline and
    // retest sets, whose instructions matter); after that they stay how Cameron last left them for that lift.
    // v1.18: when the screen is short they start closed instead of pushing anything off it (fit()).
    const tipList = (s.tips && s.tips.length) || s.cue ? el('div', { class: 'tips' }, [
      ...(s.tips || []).map(t => el('div', { class: 'tip' }, t)),
      s.cue ? el('div', { class: 'tip note' }, s.cue) : null
    ]) : null;
    const cueBits = [
      s.repRange && !s.holdSeconds && s.repRange[0] !== s.repRange[1] ? el('div', { class: 'step-effort' }, `Range ${repsText(s.repRange)} reps`) : null,
      (s.baseline || s.retest) && s.effortText ? el('div', { class: 'step-effort' }, s.effortText) : null,
      tipList
    ].filter(Boolean);
    if (cueBits.length) {
      const mem = this.s.cuesOpen && this.s.cuesOpen[s.exerciseId];
      const open = this.cuesOpen(s);
      const n = ((s.tips && s.tips.length) || 0) + (s.cue ? 1 : 0);
      // cues he opened with a tap are his to close: fit() never sheds them (no fit-2), the middle scrolls to them instead
      const det = el('details', { class: 'cues' + (mem === true ? '' : ' fit-2'), id: 'cues', open: open || null, 'data-auto': mem == null ? '1' : null }, [
        el('summary', {}, [el('span', {}, n ? `Cues (${n})` : 'Cues'), el('span', { class: 'cues-hint' }, open ? 'Hide' : 'Show')]),
        ...cueBits
      ]);
      // only a tap is remembered (a <details> built open also fires 'toggle')
      det.querySelector('summary').addEventListener('click', () => {
        const opening = !det.open;
        (this.s.cuesOpen = this.s.cuesOpen || {})[s.exerciseId] = opening; det.removeAttribute('data-auto'); det.classList.toggle('fit-2', !opening);
        this.persist(); setTimeout(() => { this.fit(); if (det.open) this.revealCues(det); }, 0);
      });
      det.addEventListener('toggle', () => { const h = det.querySelector('.cues-hint'); if (h) h.textContent = det.open ? 'Hide' : 'Show'; });
      main.appendChild(det);
    }
  }

  /** A warm-up drill, a stretch, an Engine minute, the if-time question. */
  renderOther(main, s, next, paused) {
    const label = { rest: 'Rest', timed: 'Timed', transition: 'Set up', stretch: 'Stretch', decision: 'Your call' }[s.kind] || s.kind;
    const emom = s.blockType === 'emom';
    const sided = this.sided(s);
    const where = emom ? `Minute ${s.setIndex} of ${s.setCount}` : (s.where || (s.setCount ? `${s.setIndex} of ${s.setCount}` : ''));
    const calm = this.kindGroup(s) === 'work' ? 'work' : (s.kind === 'rest' ? 'rest' : 'calm');
    main.appendChild(el('div', { class: 'work-top' }, [
      paused ? this.pausedBanner() : null, this.pill(label, calm, paused),
      where && !paused ? el('div', { class: 'step-where' }, where) : null
    ]));
    main.appendChild(el('div', { class: 'step-name' + (s.kind === 'decision' ? '' : ' big') }, [el('span', { class: 'sn-text' }, emom ? s.name.replace(/^Min \d+ of \d+:\s*/, '') : s.name)]));
    if (s.kind !== 'decision') main.appendChild(sided ? this.sidesPanel(s) : this.timerBlock(this.isCountdown(s)));
    if (s.cue) main.appendChild(el('div', { class: 'step-cue fit-2' }, s.cue));
    if (next) {
      const after = this.steps[this.s.idx + 2];
      const through = (next.kind === 'rest' || next.kind === 'transition') && after;
      // a change-over between two stretches is not news: name what follows it
      main.appendChild(el('div', { class: 'next fit-3' }, next.change && after ? [el('b', {}, 'Next: '), this.describe(after)] : [el('b', {}, 'Next: '), this.describe(next), through ? el('span', { class: 'muted' }, ` → ${this.describe(after)}`) : null]));
    }
  }

  /**
   * v1.18: the big button changes under his thumb (Done becomes Skip rest or Set-up done). A second tap on it within
   * 0.6 s is taken as the same tap, so a double tap cannot skip the rest or confirm a bar change he has not made.
   */
  mainTap(fn) {
    return () => {
      const now = Date.now();
      if (now - this.mainTapMs < 600) return;
      this.mainTapMs = now; fn();
    };
  }
  renderActions(s) {
    const actions = el('div', { class: 'player-actions' });
    const swap = () => (this.swapChoices().length ? el('button', { class: 'btn', id: 'swap-btn', onclick: () => this.openSwap() }, 'Equipment taken') : null);
    if (s.kind === 'set') {
      const ex = this.plan.exercises[s.exerciseId];
      const showEdit = this.editOpen || (s.target && s.target.weight == null && ex && ex.equipment !== 'bodyweight' && !s.holdSeconds) || s.baseline || s.retest || (s.repRange == null && !s.holdSeconds);
      actions.appendChild(this.editPanel(s, ex, showEdit));
      actions.appendChild(el('button', { class: 'btn primary', onclick: this.mainTap(() => this.logSet()) }, [icon('check'), s.holdSeconds ? 'Done early' : 'Done']));
      actions.appendChild(el('div', { class: 'secondary' }, [
        this.isAutoSet(s) ? el('button', { class: 'btn', id: 'extend-btn', onclick: () => this.addSeconds(this.rules.timing.extendSeconds) }, [icon('plus'), `${this.rules.timing.extendSeconds} s`]) : null,
        el('button', { class: 'btn', onclick: () => this.toggleEdit() }, [icon('edit'), this.editOpen ? 'Hide' : 'Edit']),
        el('button', { class: 'btn', onclick: () => this.skip() }, [icon('skip'), 'Skip'])
      ]));
    } else if (s.kind === 'decision') {
      actions.appendChild(el('button', { class: 'btn primary', onclick: this.mainTap(() => this.decide(true)) }, 'Do it'));
      actions.appendChild(el('div', { class: 'secondary' }, [el('button', { class: 'btn', onclick: () => this.decide(false) }, 'Skip it')]));
    } else if (this.waiting()) {
      // v1.5: what comes next starts only after this tap; then the get-ready count runs
      const next = this.steps[this.s.idx + 1];
      actions.appendChild(el('button', { class: 'btn primary', id: 'confirm-btn', onclick: this.mainTap(() => this.confirmSetup()) }, [icon('check'), next && next.kind === 'set' ? 'Set-up done' : 'Ready']));
      actions.appendChild(el('div', { class: 'secondary' }, [el('button', { class: 'btn', onclick: () => this.addSeconds(30) }, [icon('plus'), '30 s']), swap()]));
    } else {
      actions.appendChild(el('button', { class: 'btn primary', id: 'next-btn', onclick: this.mainTap(() => this.advance()) }, [icon('skip'), s.kind === 'rest' ? 'Skip rest' : (this.leadsIn() ? 'Start now' : 'Next')]));
      actions.appendChild(el('div', { class: 'secondary' }, [el('button', { class: 'btn', onclick: () => this.addSeconds(30) }, [icon('plus'), '30 s']), swap()]));
    }
    return actions;
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
    // v1.16: a flagged number stays in the boxes while it waits for a fix or a second Done
    const held = this.flag && this.flag.idx === this.s.idx ? this.flag : null;
    const wVal = held ? (held.weight == null ? '' : held.weight) : (rec.weight != null ? rec.weight : (s.target && s.target.weight != null ? s.target.weight : ''));
    const rVal = held ? (held.reps == null ? '' : held.reps) : (rec.reps != null ? rec.reps : (s.holdSeconds ? s.holdSeconds : (s.target && s.target.reps != null ? s.target.reps : '')));
    const pVal = this.pendingRpe != null ? this.pendingRpe : (rec.rpe != null ? rec.rpe : this.defaultRpe(s));
    const wStep = ex ? incrementFor(this.rules, s.exerciseId, ex) : 5;
    const isBw = ex && ex.equipment === 'bodyweight';
    const panel = el('div', { class: 'edit-panel' + (isBw ? ' one' : ''), id: 'edit-panel', hidden: !open });
    if (held) panel.appendChild(el('div', { class: 'num-flag', id: 'num-flag', role: 'alert' }, [el('b', {}, 'Check this number. '), `${held.text}. Fix it, or tap Done again to keep it.`]));
    // v1.15: on a barbell lift, + on an empty box starts at the empty bar (one tap used to log 5 lb)
    const bar = ex && ex.equipment === 'barbell' && this.rules.rampUp ? this.rules.rampUp.barWeightLb : null;
    if (!isBw) panel.appendChild(field(ex && ex.equipment === 'weighted_bw' ? 'Added lb' : (isPair(ex) ? 'Total of both (lb)' : 'Weight (lb)'), 'in-weight', wVal, wStep || 2.5, bar));
    panel.appendChild(field(s.holdSeconds ? 'Seconds' : 'Reps', 'in-reps', rVal, 1));
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

  /**
   * v1.18 (Cameron: "have to scroll down to see everything", "3 digits in weight cut off", "too busy"): make the
   * middle of the screen fit. Text on one line is shrunk until it fits its box, never cut. If the middle is still
   * taller than its space it sheds detail in steps (the cues of a first set close; tight-1: smaller numbers, and if
   * that alone is enough the closed Cues row goes; tight-2: last time, cues and the second "then" rows go; tight-3: effort words and notes go; then two things in an order that depends on
   * the screen: the last-set steppers fold into its title, and the first "then" row and the plates per side go. On a
   * screen that waits for his tap, what to set up outlasts the steppers (they fold at 3, the rest goes at 4); on a
   * plain rest the steppers outlast the list of what follows). Only if all of that is not enough does the middle
   * scroll inside itself; the header and the buttons never move.
   */
  fit() {
    const c = this.container;
    const p = c && c.querySelector('.player');
    const main = p && p.querySelector('.step-main');
    if (!main) return;
    const act = p.querySelector('.player-actions');
    if (act) document.body.style.setProperty('--actions-h', `${Math.round(act.getBoundingClientRect().height)}px`);
    // a toast sits over the strip: the one part of the screen that is not needed for the next few seconds
    const strip = p.querySelector('.strip');
    if (strip) document.body.style.setProperty('--strip-top', `${Math.round(strip.getBoundingClientRect().top)}px`);
    // where he is: full names, then short names, then a smaller size
    const blk = p.querySelector('#where .block');
    if (blk) {
      blk.textContent = blk.dataset.full; fitText(blk, 13.5);
      if (blk.style.fontSize || blk.classList.contains('wrap')) { blk.textContent = blk.dataset.short; fitText(blk, 12); }
    }
    fitText(p.querySelector('#fin-row'), 12);
    const texts = () => {
      p.querySelectorAll('.step-name, .un-target, .hero-weight, .hero-line, .step-where, .jd-name, .jd-sub, .jd-num, .un-row, .last-time, .side-time').forEach(n => fitText(n, n.classList.contains('step-name') ? 18 : (n.classList.contains('hero-weight') ? 30 : 12)));
    };
    const cues = p.querySelector('details.cues');
    const cuesAuto = cues && cues.getAttribute('data-auto') === '1' && this.cuesOpen(this.step);
    // cues he opened with a tap stay open whatever the room: the rest is fitted as if they were closed
    const cuesByHand = !!cues && !cues.hasAttribute('data-auto') && cues.open;
    if (cuesAuto) cues.open = true;
    if (cuesByHand) cues.open = false;
    p.classList.remove('overflowing', 'no-cues');
    const fits = () => main.scrollHeight <= main.clientHeight + 1;
    let level = 0;
    for (; level <= TIGHTEST; level++) {
      for (let k = 1; k <= TIGHTEST; k++) p.classList.toggle(`tight-${k}`, k <= level);
      if (cuesAuto) cues.open = level === 0;
      texts();
      if (fits()) break;
      // the cues of a first set do not fit open: closed at full size comes before smaller numbers
      if (level === 0 && cuesAuto) { cues.open = false; texts(); if (fits()) break; }
      // half a step between 1 and 2: the closed Cues row goes first (the cues are also in the ⋯ menu); "last time"
      // and the size of the numbers stay
      if (level === 1 && cues && !cuesByHand) {
        p.classList.add('no-cues'); texts();
        if (fits()) break;
        p.classList.remove('no-cues');
      }
    }
    if (cuesByHand) cues.open = true;
    p.setAttribute('data-fit', String(Math.min(level, TIGHTEST)));
    p.classList.toggle('overflowing', main.scrollHeight > main.clientHeight + 1);
  }

  updateTimerDom() {
    const c = this.container;
    const s = this.step; if (!s) return;
    const paused = this.s.pausedAt != null;
    const want = this.phaseKind(this.kindGroup(s));
    if (document.body.getAttribute('data-kind') !== want) document.body.setAttribute('data-kind', want);
    const set = (id, text) => { const n = c.querySelector(id); if (n && n.textContent !== text) n.textContent = text; return n; };
    // v1.18: time in the gym keeps running whatever the session clock does
    set('#gym-clock', fmtGym(this.gymMs() / 1000));
    if (paused) set('#paused-for', fmtGym((Date.now() - this.s.pausedAt) / 1000));
    const t = c.querySelector('#timer');
    const info = this.sided(s) ? this.sideInfo() : null;
    if (info) {
      // left and right, each with its own clock
      const a = this.s.sideAt;
      const lt = info.phase === 'set' ? a.leftEnd - a.start : (info.phase === 'left' ? info.rem : null);
      const rt = info.phase === 'right' ? info.rem : (info.phase === 'over' ? null : a.end - a.rightStart);
      if (lt != null) set('#side-left-time', fmtClock(Math.ceil(lt)));
      if (rt != null) set('#side-right-time', fmtClock(Math.ceil(rt)));
      if (info.phase === 'switch') set('#side-right-note', `switch sides · ${Math.ceil(info.rem)}`);
    }
    if (t && s.kind === 'set' && s.auto && !s.holdSeconds) {
      // pace bar: which rep the tempo says you should be on
      const e = this.elapsedInStep();
      const auto = this.autoOn();
      const tt = auto ? fmtClock(Math.ceil(Math.max(0, s.seconds - e))) : fmtClock(e);
      if (t.textContent !== tt) t.textContent = tt;
      const reps = s.target && s.target.reps ? s.target.reps : null;
      const pt = c.querySelector('#pace-text');
      const pf = c.querySelector('#pace-fill');
      if (pt && reps) {
        let txt;
        if (info) {
          const a = this.s.sideAt;
          // each side paced on its own clock: Right started early or given more time keeps its own rep count
          const repAt = (from, to) => { const per = Math.max(0.5, (to - from) / reps); return `rep ${Math.min(reps, Math.floor(Math.max(0, e - from) / per) + 1)} of ${reps}`; };
          if (info.phase === 'set') txt = 'Get set';
          else if (info.phase === 'left') txt = `Left · ${repAt(a.start, a.leftEnd)}`;
          else if (info.phase === 'switch') txt = 'Switch sides';
          else if (info.phase === 'right') txt = `Right · ${repAt(a.rightStart, a.end)}`;
          else txt = 'Finish the set';
        } else {
          const w = e - (s.startSeconds || 0);
          txt = w < 0 ? 'Get set' : (w < reps * s.repSeconds ? `Rep ${Math.min(reps, Math.floor(w / s.repSeconds) + 1)} of ${reps}` : 'Finish the set');
        }
        if (pt.textContent !== txt) pt.textContent = txt;
      }
      if (pf) pf.style.width = `${Math.min(100, 100 * e / (s.seconds || 1)).toFixed(1)}%`;
    } else if (t && this.isCountdown(s)) {
      // v1.5: a set-up step that waits for the tap counts down to zero and holds there. v1.18: after a tap during
      // a rest the clock runs on to that same zero (the get-ready count follows it), so it does not jump at the tap
      const tapped = this.s.confirmed && s.kind === 'rest' && this.needsConfirm() && !this.isReady();
      const hold = this.waiting() || tapped ? this.holdAt(s) : 0;
      const rem = Math.max(0, this.remainingInStep(s) - hold);
      const tt = fmtClock(Math.ceil(rem));
      if (t.textContent !== tt) t.textContent = tt;
      t.classList.toggle('warn', !this.leadsIn() && rem <= this.rules.timing.restWarningSeconds && rem > 0);
      const fg = c.querySelector('#ring-fg');
      const total = (this.stepSeconds(s) - hold) || 1;
      if (fg) fg.setAttribute('stroke-dashoffset', (RING_C * (1 - rem / total)).toFixed(1));
      const bar = c.querySelector('#rest-fill');
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, 100 * rem / total)).toFixed(1)}%`;
    } else if (t) {
      const tt = fmtClock(this.elapsedInStep());
      if (t.textContent !== tt) t.textContent = tt;
    }
    const clock = c.querySelector('#clock');
    if (clock) {
      const p = this.projection();
      const d = p.deltaSeconds;
      const abs = Math.abs(d);
      const label = abs < 60 ? 'on time' : `${Math.round(abs / 60)} min ${d > 0 ? 'behind' : 'ahead'}`;
      // v1.18: a session that is planned longer than the cap no longer shows Trim from the first minute (the menu
      // still offers it); the chip is for falling behind
      const trim = d >= 60 || (p.overCapSeconds > 0 && this.s.timeline.plannedSeconds <= (this.plan.sessionCapMinutes || 60) * 60);
      const key = `${fmtMinutes(p.remaining)}|${fmtTime(p.finishAt)}|${label}|${trim}`;
      if (clock.dataset.key !== key) {
        clock.dataset.key = key;
        clock.innerHTML = '';
        clock.classList.toggle('has-trim', trim);
        clock.appendChild(el('span', { class: 'st-left' }, [`${fmtMinutes(p.remaining)} left`, el('span', { class: 'st-ends' }, ` · ends ${fmtTime(p.finishAt)}`)]));
        clock.appendChild(el('span', { class: 'delta ' + (d >= 60 ? 'behind' : (d <= -60 ? 'ahead' : '')) }, label));
        if (trim) clock.appendChild(el('span', { class: 'chip-btn', id: 'trim-btn', onclick: e => { e.stopPropagation(); this.trimPreview(); } }, [icon('scissors'), 'Trim']));
      }
      // keep segment fills moving with the clock
      const blocks = this.blockSummary();
      const segs = c.querySelectorAll('.strip-bar .seg');
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
