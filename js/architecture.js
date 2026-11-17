// architecture.js - Architecture tab: draws the block diagram from data/architecture.json and lists every part, searchable.

import { el } from './ui.js';
import { APP_VERSION } from './data.js';

const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, text) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}

// Layout: three columns. App parts stack in order; inputs and outputs sit on the row of the app part they connect to.
export function layout(arch) {
  const BW = 200, AW = 232, BH = 72, LX = 24, AX = 264, RX = 536, TOP = 100, GAP = 32;
  const appParts = arch.parts.filter(p => p.column === 'app');
  const rows = {};
  appParts.forEach((p, i) => { rows[p.id] = i; });
  const used = { inputs: new Set(), outputs: new Set() };
  const place = (col, flowDir) => {
    arch.parts.filter(p => p.column === col).forEach(p => {
      const f = arch.flows.find(fl => (flowDir === 'from' ? fl.from === p.id && rows[fl.to] != null : fl.to === p.id && rows[fl.from] != null));
      let r = f ? rows[flowDir === 'from' ? f.to : f.from] : 0;
      while (used[col].has(r)) r++;
      used[col].add(r); rows[p.id] = r;
    });
  };
  place('inputs', 'from');
  place('outputs', 'to');
  const maxRow = Math.max(...Object.values(rows));
  const boxes = {};
  arch.parts.forEach(p => {
    const r = rows[p.id];
    const y = TOP + r * (BH + GAP);
    const x = p.column === 'inputs' ? LX : (p.column === 'app' ? AX : RX);
    const w = p.column === 'app' ? AW : BW;
    boxes[p.id] = { x, y, w, h: BH, cx: x + w / 2, cy: y + BH / 2, part: p };
  });
  const appBottom = TOP + (appParts.length - 1) * (BH + GAP) + BH;
  const container = { x: 248, y: 68, w: 264, h: appBottom + 16 - 68 };
  const height = Math.max(appBottom, TOP + maxRow * (BH + GAP) + BH) + 40;
  return { boxes, container, height, width: 760 };
}

export function drawSVG(arch, query) {
  const L = layout(arch);
  const q = (query || '').trim().toLowerCase();
  const hit = id => q && matches(arch.parts.find(p => p.id === id), q);
  const svg = svgEl('svg', { viewBox: `0 0 ${L.width} ${L.height}`, width: L.width, height: L.height, class: 'arch-svg', role: 'img', 'aria-label': arch.title });
  const defs = svgEl('defs');
  const marker = svgEl('marker', { id: 'arch-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse' });
  const mp = svgEl('path', { d: 'M0 0L10 5L0 10z' }); mp.style.fill = 'var(--muted)';
  marker.appendChild(mp); defs.appendChild(marker); svg.appendChild(defs);

  svg.appendChild(svgEl('text', { x: 24, y: 28, 'font-size': 15, 'font-weight': 600 }, arch.title));
  arch.columns.forEach(c => {
    if (c.id === 'app') return;
    const x = c.id === 'inputs' ? 124 : 636;
    svg.appendChild(svgEl('text', { x, y: 60, 'font-size': 11.5, 'text-anchor': 'middle', class: 'quiet' }, c.name));
  });
  const C = L.container;
  svg.appendChild(svgEl('rect', { x: C.x, y: C.y, width: C.w, height: C.h, rx: 8, class: 'container' }));
  svg.appendChild(svgEl('text', { x: C.x + C.w / 2, y: C.y + 24, 'font-size': 13, 'font-weight': 600, 'text-anchor': 'middle' }, arch.columns.find(c => c.id === 'app').name));

  // flows
  const upCount = {};
  arch.flows.forEach(f => {
    const to = L.boxes[f.to]; if (!to) return;
    const from = L.boxes[f.from];
    let d;
    const cls = 'flow' + ((hit(f.from) || hit(f.to)) ? ' hit' : '');
    if (f.static || !from) {
      d = `M${C.x + C.w} ${to.cy}H${to.x}`;
    } else if (from.part.column === 'inputs') {
      d = from.cy === to.cy ? `M${from.x + from.w} ${from.cy}H${C.x}` : `M${from.x + from.w} ${from.cy}H${(from.x + from.w + C.x) / 2}V${to.cy}H${C.x}`;
    } else if (to.part.column === 'outputs') {
      d = from.cy === to.cy ? `M${from.x + from.w} ${from.cy}H${to.x}` : `M${from.x + from.w} ${from.cy}H${(from.x + from.w + to.x) / 2}V${to.cy}H${to.x}`;
    } else if (to.y > from.y) {
      d = `M${from.cx} ${from.y + from.h}V${to.y}`;
    } else {
      // upward loop on the left; stagger when the same source has several
      const n = (upCount[f.from] = (upCount[f.from] || 0) + 1);
      const gap = 8 + (n - 1) * 6;
      d = `M${from.x} ${from.cy + (n - 1) * 10}H${from.x - gap}V${to.cy + (n - 1) * 10}H${to.x}`;
    }
    const p = svgEl('path', { d, class: cls, 'marker-end': 'url(#arch-arrow)' });
    if (f.static) p.setAttribute('stroke-dasharray', '4 4');
    const title = svgEl('title', {}, `${f.from} → ${f.to}: ${f.label}`);
    p.appendChild(title);
    svg.appendChild(p);
  });

  // boxes
  Object.values(L.boxes).forEach(b => {
    const g = svgEl('g', { 'data-part': b.part.id });
    const isHit = hit(b.part.id);
    g.appendChild(svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 8, class: 'box' + (isHit ? ' hit' : (q ? ' dim' : '')) }));
    g.appendChild(svgEl('text', { x: b.x + 12, y: b.y + 24, 'font-size': 13, 'font-weight': 600 }, b.part.name));
    (b.part.lines || []).forEach((ln, i) => g.appendChild(svgEl('text', { x: b.x + 12, y: b.y + 40 + 16 * i, 'font-size': 11.5, class: 'quiet' }, ln)));
    svg.appendChild(g);
  });
  return svg;
}

function matches(p, q) {
  if (!p) return false;
  const hay = [p.name, p.description, p.file, ...(p.lines || [])].join(' ').toLowerCase();
  return hay.includes(q);
}

function highlight(text, q) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text;
  return [text.slice(0, i), el('mark', {}, text.slice(i, i + q.length)), text.slice(i + q.length)];
}

export function renderArchitecture(container, arch, plan) {
  container.innerHTML = '';
  let q = '';
  const search = el('input', { type: 'search', placeholder: 'Search parts, files, flows (e.g. trim, e1RM, backup)', oninput: e => { q = e.target.value; update(); } });
  const svgWrap = el('div', { style: 'overflow-x:auto; margin: 10px 0;' });
  const list = el('div');
  const flowsBox = el('div', { class: 'card' });
  const meta = el('p', { class: 'muted' }, `App v${APP_VERSION} · plan v${plan.planVersion}. This diagram is drawn from data/architecture.json, which changes in the same commit as the code.`);
  container.append(el('h1', {}, 'How the app works'), meta, search, svgWrap, list, flowsBox);

  function update() {
    const qq = q.trim().toLowerCase();
    svgWrap.innerHTML = ''; svgWrap.appendChild(drawSVG(arch, qq));
    list.innerHTML = '';
    const parts = arch.parts.filter(p => !qq || matches(p, qq));
    if (!parts.length) list.appendChild(el('p', { class: 'muted' }, 'No part matches that.'));
    parts.forEach(p => {
      list.appendChild(el('div', { class: 'arch-part' + (qq ? ' hit' : '') }, [
        el('div', { class: 'row' }, [el('b', {}, highlight(p.name, qq)), el('span', { class: 'badge' }, arch.columns.find(c => c.id === p.column).name.split(' ')[0])]),
        p.file ? el('div', { class: 'file' }, highlight(p.file, qq)) : null,
        el('p', { style: 'margin-top:6px' }, highlight(p.description, qq))
      ]));
    });
    flowsBox.innerHTML = '';
    const flows = arch.flows.filter(f => !qq || `${f.from} ${f.to} ${f.label}`.toLowerCase().includes(qq) || matches(arch.parts.find(p => p.id === f.from), qq) || matches(arch.parts.find(p => p.id === f.to), qq));
    flowsBox.append(el('h2', {}, 'Flows'), el('table', {}, [
      el('tr', {}, [el('th', {}, 'From'), el('th', {}, 'To'), el('th', {}, 'Carries')]),
      ...flows.map(f => el('tr', {}, [el('td', {}, nameOf(arch, f.from)), el('td', {}, nameOf(arch, f.to)), el('td', {}, highlight(f.label, qq))]))
    ]));
  }
  update();
}

function nameOf(arch, id) {
  const p = arch.parts.find(x => x.id === id);
  if (p) return p.name;
  const c = arch.columns.find(x => x.id === id);
  return c ? c.name : id;
}
