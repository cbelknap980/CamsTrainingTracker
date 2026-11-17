// ui.js - tiny DOM helpers: el(), toast(), modal.

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
export function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function showModal(content) {
  const m = document.getElementById('modal');
  m.innerHTML = '';
  const sheet = el('div', { class: 'sheet' }, content);
  m.appendChild(sheet);
  m.hidden = false;
  m.onclick = e => { if (e.target === m) closeModal(); };
}

export function closeModal() {
  const m = document.getElementById('modal');
  m.hidden = true; m.innerHTML = '';
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
