// share-card.js (v1.14) - the Session done card as an image (1080 x 1350, the 4:5 shape photo apps and chats
// show whole). Drawn on a canvas on the phone; nothing is uploaded. On Android, Save image opens the share
// sheet (Photos, Drive, Messages); elsewhere it downloads the PNG.

import { fmtWeight, fmtDate, roundEst } from './data.js';

const W = 1080, H = 1350;
const C = { bg: '#0d0f13', card: '#161a20', edge: 'rgba(255,255,255,0.07)', text: '#f3f4f6', muted: '#959cab', accent: '#f5a524', good: '#3dcc7a', ring: 'rgba(255,255,255,0.10)' };
const RING_COLOR = { lifts: '#f5a524', runs: '#6ea8ff', hard: '#ff7a59' };

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const font = (weight, size) => `${weight} ${size}px Inter, system-ui, sans-serif`;
function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}
const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

/** Numbers for the card, shared with the on-screen Session done page. */
export function sessionNumbers(record, prev) {
  const work = s => s.done && !s.ramp && !s.skipped;
  const vol = r => Math.round((r.sets || []).filter(s => work(s) && s.weight != null && s.reps && !s.holdSeconds).reduce((m, s) => m + s.weight * s.reps, 0));
  const done = record.sets.filter(s => s.done && !s.ramp).length;
  const planned = record.sets.filter(s => !s.ramp).length;
  const volume = vol(record);
  const prevVolume = prev ? vol(prev) : null;
  const change = prevVolume ? Math.round(100 * (volume - prevVolume) / prevVolume) : null;
  return { done, planned, minutes: Math.round(record.actualSeconds / 60), volume, prevVolume, change };
}

/** Draw the card; resolves to a PNG Blob. */
export async function drawShareCard(record, { prev, rings, weekLabel } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  try { await Promise.all([document.fonts.load(font(800, 80)), document.fonts.load(font(600, 40))]); } catch (e) { /* system font */ }
  const n = sessionNumbers(record, prev);

  // background with a warm glow from the top left
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(120, 80, 20, 120, 80, 900);
  g.addColorStop(0, 'rgba(245,165,36,0.28)'); g.addColorStop(1, 'rgba(245,165,36,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // header: the app mark and the date
  const logo = await loadImg('icons/icon-192.png');
  if (logo) { ctx.save(); rr(ctx, 72, 72, 72, 72, 18); ctx.clip(); ctx.drawImage(logo, 72, 72, 72, 72); ctx.restore(); }
  ctx.fillStyle = C.muted; ctx.font = font(600, 34); ctx.textBaseline = 'middle';
  ctx.fillText(`${fmtDate(record.date)} · ${weekLabel || `Week ${record.week}`}`, 168, 108);
  ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(149,156,171,0.7)'; ctx.font = font(600, 26);
  ctx.fillText("Cam's Training Tracker", W - 72, 108); ctx.textAlign = 'left';

  // the session
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.text; ctx.font = font(800, 92);
  ctx.fillText(fit(ctx, record.sessionName, W - 144), 72, 290);
  ctx.fillStyle = record.status === 'complete' ? C.good : C.accent; ctx.font = font(700, 38);
  ctx.fillText(record.status === 'complete' ? 'Session done' : 'Ended early', 72, 350);

  // three numbers
  const stats = [
    [`${n.done}`, `/${n.planned}`, 'sets'],
    [`${n.minutes}`, 'min', 'time'],
    n.volume ? [n.volume.toLocaleString(), 'lb', n.change != null ? `lifted, ${n.change >= 0 ? '+' : '−'}${Math.abs(n.change)}%` : 'lifted'] : null
  ].filter(Boolean);
  const sw = (W - 144 - 24 * (stats.length - 1)) / stats.length;
  stats.forEach(([big, unit, label], i) => {
    const x = 72 + i * (sw + 24), y = 410;
    rr(ctx, x, y, sw, 200, 28); ctx.fillStyle = C.card; ctx.fill(); ctx.strokeStyle = C.edge; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = C.text; ctx.font = font(800, 76);
    ctx.fillText(big, x + 32, y + 110);
    const bw = ctx.measureText(big).width;
    ctx.fillStyle = C.muted; ctx.font = font(650, 34); ctx.fillText(unit, x + 40 + bw, y + 110);
    ctx.font = font(600, 28); ctx.fillText(fit(ctx, label, sw - 56), x + 32, y + 162);
  });

  // records
  let y = 690;
  const prs = record.prs || [];
  ctx.fillStyle = C.muted; ctx.font = font(650, 32);
  ctx.fillText(prs.length ? (prs.length === 1 ? 'Personal record' : `${prs.length} personal records`) : 'No records today. Next targets are set.', 72, y);
  y += 30;
  // two records fit with the rings; more say how many more
  const shown = prs.slice(0, rings && rings.length ? 2 : 4);
  shown.forEach(p => {
    y += 20;
    rr(ctx, 72, y, W - 144, 96, 24); ctx.fillStyle = 'rgba(245,165,36,0.12)'; ctx.fill();
    rr(ctx, 100, y + 28, 72, 40, 12); ctx.fillStyle = C.accent; ctx.fill();
    ctx.fillStyle = '#1a1200'; ctx.font = font(800, 24); ctx.textAlign = 'center'; ctx.fillText('PR', 136, y + 57); ctx.textAlign = 'left';
    ctx.fillStyle = C.text; ctx.font = font(700, 36);
    const what = p.kind === 'e1rm' ? `est. 1RM ${roundEst(p.value)} lb` : `${fmtWeight(p.value)} lb`;
    ctx.fillText(fit(ctx, p.name, W - 144 - 160 - ctx.measureText(what).width - 40), 196, y + 61);
    ctx.textAlign = 'right'; ctx.fillStyle = C.accent; ctx.fillText(what, W - 104, y + 61); ctx.textAlign = 'left';
    y += 96;
  });
  if (prs.length > shown.length) { y += 44; ctx.fillStyle = C.muted; ctx.font = font(600, 28); ctx.fillText(`and ${prs.length - shown.length} more`, 72, y); }

  // the week's rings
  if (rings && rings.length) {
    const top = Math.max(y + 60, 880);
    ctx.fillStyle = C.muted; ctx.font = font(650, 32); ctx.fillText(`${weekLabel || `Week ${record.week}`} so far`, 72, top);
    const cw = (W - 144) / rings.length;
    rings.forEach((r, i) => {
      const cx = 72 + cw * i + cw / 2, cy = top + 100, rad = 56;
      ctx.lineWidth = 16; ctx.lineCap = 'round';
      ctx.strokeStyle = C.ring; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
      const k = r.of ? Math.min(1, r.done / r.of) : 0;
      if (k > 0) { ctx.strokeStyle = RING_COLOR[r.key] || C.accent; ctx.beginPath(); ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke(); }
      ctx.textAlign = 'center';
      ctx.fillStyle = C.text; ctx.font = font(800, 38); ctx.fillText(`${r.done}/${r.of}`, cx, cy + 13);
      ctx.font = font(650, 32); ctx.fillText(r.label, cx, cy + rad + 52);
      ctx.fillStyle = C.muted; ctx.font = font(500, 25); ctx.fillText(fit(ctx, r.detail, cw - 24), cx, cy + rad + 88);
      ctx.textAlign = 'left';
    });
  }

  return new Promise(res => canvas.toBlob(b => res(b), 'image/png'));
}

/** Share the image (Android share sheet) or download it. Returns 'shared', 'saved' or 'cancelled'. */
export async function shareOrSave(blob, name) {
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare && navigator.share) {
    try {
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return 'shared'; }
    } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'saved';
}
