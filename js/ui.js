// ui.js - tiny DOM helpers: el(), toast(), modal. v1.14: tap haptics, undo toasts, info sheets, count-up numbers,
// view transitions, the Android back gesture for sheets and the workout, swipe to delete, status bar color per phase.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'hidden' || k === 'disabled' || k === 'checked' || k === 'selected') { if (v) node.setAttribute(k, ''); if (k === 'checked') node.checked = !!v; }
    else if (k === 'value') node.value = v;
    else node.setAttribute(k, v);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  if (children === null || children === undefined) return;
  if (Array.isArray(children)) { children.forEach(c => append(node, c)); return; }
  if (children instanceof Node) { node.appendChild(children); return; }
  node.appendChild(document.createTextNode(String(children)));
}

let toastTimer = null;
/**
 * A short message at the bottom. v1.14: pass { action: 'Undo', onAction } to add a button; the toast then stays
 * up a little longer (5 s by default) so there is time to reach it.
 */
export function toast(msg, ms, opts = {}) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerHTML = '';
  t.appendChild(el('span', { class: 'toast-msg' }, msg));
  t.classList.toggle('has-action', !!opts.action);
  // v1.18: step: about the workout screen it was shown on, so it goes when that screen does (dropStepToast)
  t.dataset.step = opts.step ? '1' : '';
  if (opts.action) {
    t.appendChild(el('button', { type: 'button', class: 'toast-action', id: 'toast-action', onclick: e => {
      e.stopPropagation(); clearTimeout(toastTimer); t.hidden = true; haptic('undo');
      try { opts.onAction(); } catch (err) { /* ignore */ }
    } }, opts.action));
  }
  // restart the slide-in when one toast replaces another
  t.hidden = true; void t.offsetWidth; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; if (opts.onExpire) opts.onExpire(); }, ms || (opts.action ? 5000 : 2200));
}
export function hideToast() { const t = document.getElementById('toast'); if (t) t.hidden = true; clearTimeout(toastTimer); }
/** v1.18: hides a toast shown with { step: true } (it stayed over the next workout screen). */
export function dropStepToast() { const t = document.getElementById('toast'); if (t && !t.hidden && t.dataset.step === '1') hideToast(); }

// ---- v1.14: haptics. A short buzz when a button is pressed (Android Chrome; iPhone web apps cannot vibrate).
// Follows Settings > "Vibrate when a set or rest ends". ----
let hapticsOn = true;
export function setHaptics(on) { hapticsOn = !!on; }
const PATTERNS = { tap: 8, press: 14, undo: [10, 40, 10], delete: 22, warn: [30, 60, 30] };
export function haptic(kind = 'tap') {
  if (!hapticsOn || !navigator.vibrate) return;
  try { navigator.vibrate(PATTERNS[kind] || kind); } catch (e) { /* ignore */ }
}
const TAPPABLE = '.btn, .tab, .effort-chip, .jd-pm, .jd-val, .menu-item, .icon-btn, .pause-pill, .segmented button, .tag-btn, .stepper button, .chip-btn, .toggle input, .sess-btn, .ring-btn, .info-btn, .paused-banner, tr.tappable, .list-item, .plan-pill, .plan-chip, .day-row.tappable, .strip, button.side, .jd-undo, .jd-title';
export function installHaptics() {
  // on press, not release, so it lands with the finger; the main button gets a firmer one
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    const t = e.target.closest && e.target.closest(TAPPABLE);
    if (!t || t.disabled) return;
    haptic(t.classList.contains('primary') ? 'press' : 'tap');
  }, { passive: true });
}

// ---- v1.14: the Android back gesture. While a sheet, the workout or a tab other than Home is open, the app keeps
// one extra history entry; Back runs the top layer (close the sheet, open the workout menu, go Home) instead of
// leaving the app. ----
const layers = [];
let armed = false, backing = false;
function arm() {
  if (armed || backing) return;
  try { history.pushState({ ctt: 1 }, ''); armed = true; } catch (e) { /* ignore */ }
}
function disarm() {
  if (!armed) return;
  armed = false; backing = true;
  try { history.back(); } catch (e) { backing = false; }
}
if (typeof window !== 'undefined') window.addEventListener('popstate', () => {
  if (backing) { backing = false; if (layers.length) arm(); return; }
  armed = false;
  const top = layers.pop();
  if (top) { try { top.fn(); } catch (e) { /* ignore */ } }
  if (layers.length) arm();
});
/** Register what Back should do; returns a function that removes it. `key` replaces an earlier layer of that key. */
export function onBack(key, fn) {
  dropBack(key);
  layers.push({ key, fn });
  arm();
  return () => dropBack(key);
}
export function dropBack(key) {
  const i = layers.findIndex(l => l.key === key);
  if (i < 0) return;
  layers.splice(i, 1);
  if (!layers.length) disarm();
}

export function showModal(content) {
  const m = document.getElementById('modal');
  m.innerHTML = '';
  const sheet = el('div', { class: 'sheet' }, content);
  m.appendChild(sheet);
  m.hidden = false;
  m.onclick = e => { if (e.target === m) closeModal(); };
  onBack('sheet', () => closeModal(true));
}

export function closeModal(fromBack) {
  const m = document.getElementById('modal');
  m.hidden = true; m.innerHTML = '';
  if (!fromBack) dropBack('sheet');
}

/** v1.14: a small (i) button that opens a sheet with the explanation, so pages lead with the numbers. */
export function infoBtn(title, text, label) {
  return el('button', { type: 'button', class: 'info-btn', 'aria-label': label || `About ${title}`, onclick: e => {
    e.stopPropagation();
    showModal(el('div', { class: 'info-sheet' }, [
      el('h2', {}, title),
      ...(Array.isArray(text) ? text : [text]).map(t => (typeof t === 'string' ? el('p', { class: 'muted' }, t) : t)),
      el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Close')
    ]));
  } }, 'i');
}

const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** v1.14: roll a number up to its value (a PR, a session total). Shows the final value at once under reduced motion. */
export function countUp(node, to, { ms = 700, from = 0, fmt = v => String(Math.round(v)) } = {}) {
  if (!node) return node;
  node.textContent = fmt(to);
  if (reducedMotion() || !(to > from)) return node;
  const t0 = performance.now();
  node.textContent = fmt(from);
  const step = now => {
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    node.textContent = fmt(k >= 1 ? to : from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return node;
}

/**
 * v1.14: run a DOM change as a view transition (Chrome on Android, Safari 18) so the old screen slides or fades
 * into the new one. `dir` is 'fwd', 'back' or 'fade'. Without support, or under reduced motion, it just runs.
 */
export function transition(update, dir = 'fade') {
  if (!document.startViewTransition || reducedMotion() || document.body.classList.contains('computer')) return Promise.resolve(update());
  document.documentElement.dataset.nav = dir;
  try {
    const vt = document.startViewTransition(() => update());
    vt.finished.finally(() => { delete document.documentElement.dataset.nav; });
    return vt.updateCallbackDone;
  } catch (e) { return Promise.resolve(update()); }
}

/**
 * v1.14: swipe a list row left to delete it. Past a third of its width it slides out and onDelete runs (which
 * should offer Undo); short of that it springs back. Vertical scrolling is left alone.
 */
export function swipeToDelete(row, onDelete) {
  row.classList.add('swipeable');
  const wrap = el('div', { class: 'swipe-wrap' });
  let x0 = null, y0 = null, dx = 0, locked = null, id = null;
  const reset = () => { row.style.transform = ''; row.classList.remove('dragging'); wrap.classList.remove('armed'); x0 = null; locked = null; dx = 0; };
  row.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; x0 = e.clientX; y0 = e.clientY; id = e.pointerId; locked = null; dx = 0; });
  row.addEventListener('pointermove', e => {
    if (x0 == null || e.pointerId !== id) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (locked == null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) locked = Math.abs(mx) > Math.abs(my) * 1.3 && mx < 0 ? 'x' : 'y';
    if (locked !== 'x') return;
    dx = Math.min(0, mx);
    row.classList.add('dragging');
    row.style.transform = `translateX(${dx}px)`;
    const armedNow = -dx > row.offsetWidth / 3;
    if (armedNow !== wrap.classList.contains('armed')) { wrap.classList.toggle('armed', armedNow); if (armedNow) haptic('tap'); }
  });
  const end = () => {
    if (x0 == null) return;
    if (locked === 'x') {
      // the click that follows a drag must not open the row
      const eat = ev => ev.stopImmediatePropagation();
      row.addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => row.removeEventListener('click', eat, { capture: true }), 60);
    }
    if (locked === 'x' && -dx > row.offsetWidth / 3) {
      row.classList.remove('dragging'); row.classList.add('gone'); row.style.transform = 'translateX(-110%)';
      haptic('delete');
      setTimeout(() => { wrap.classList.add('collapsed'); onDelete(); }, 180);
      x0 = null; return;
    }
    reset();
  };
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', end);
  row.style.touchAction = 'pan-y';
  wrap.appendChild(el('div', { class: 'swipe-under', 'aria-hidden': 'true' }, 'Delete'));
  wrap.appendChild(row);
  return wrap;
}

// ---- v1.14: on Android the status bar takes the page color; during a workout it follows the phase ----
const PHASE_BAR = { work: '#12432f', rest: '#1a3c73', ready: '#5c3c00', calm: '#1b202c', paused: '#7d1b21' };
export function syncStatusBar() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const set = () => { const k = document.body.getAttribute('data-kind'); meta.setAttribute('content', PHASE_BAR[k] || '#0d0f13'); };
  new MutationObserver(set).observe(document.body, { attributes: true, attributeFilter: ['data-kind'] });
  set();
}

export function confirmDialog(title, text, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    showModal(el('div', {}, [
      el('h2', {}, title),
      text ? el('p', { class: 'muted' }, text) : null,
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn ghost', onclick: () => { closeModal(); resolve(false); } }, 'Cancel'),
        el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { closeModal(); resolve(true); } }, okLabel)
      ])
    ]));
  });
}

/**
 * v1.4: the four effort buttons (levels come from rules.effortScale). `rpe` picks the one that is on;
 * onPick gets the level that was tapped.
 */
export function effortChips(rules, rpe, onPick) {
  const levels = (rules && rules.effortScale && rules.effortScale.levels) || [];
  const cur = rpe == null ? null : (levels.find(l => rpe <= l.upTo) || levels[levels.length - 1]);
  return el('div', { class: 'effort-chips' }, levels.map(l => el('button', {
    type: 'button', class: 'effort-chip effort-' + l.key + (cur && cur.key === l.key ? ' on' : ''), 'data-key': l.key,
    onclick: () => onPick(l)
  }, [el('span', { class: 'ec-label' }, l.label), el('span', { class: 'ec-hint' }, l.hint)])));
}
