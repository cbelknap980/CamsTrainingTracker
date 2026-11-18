// sync.js - v1.7: optional copy of the backup JSON in a private GitHub repo that belongs to Cameron, so a
// computer can show what the phone logged. Off until a repo and token are entered in Settings.
// The phone uploads after every change; a device set to "only views" downloads when the app opens and never uploads.
// The repo name and token live in IndexedDB on the device (kv "sync"). They are never part of a backup file,
// and nothing here writes to the app's own repo.

import { kvGet, kvSet, kvDel, exportAll, importAll, onDataChange } from './store.js';

export const SYNC_FILE = 'tracker-data.json';
export const COACH_FILE = 'coach.json'; // v1.9: written by the coach review, read by the app
const API = 'https://api.github.com';

// ---- pure helpers (tested in node) ----

/** "owner/name" from what was typed: owner/name, a github.com URL, or a clone URL. null if it is neither. */
export function parseRepo(text) {
  const m = String(text || '').trim().replace(/\.git$/, '').replace(/\/+$/, '').match(/^(?:(?:https?:\/\/)?github\.com\/|git@github\.com:)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Text to base64 by way of UTF-8 (the GitHub contents API wants base64). */
export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** A link that sets up another device: the repo and token ride in the part after #, which is never sent to a server. */
export function setupLink(base, cfg) {
  const packed = toBase64(JSON.stringify({ r: cfg.repo, t: cfg.token })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${String(base).split('#')[0]}#sync=${packed}`;
}

export function readSetupLink(hash) {
  const m = String(hash || '').match(/[#&]sync=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const o = JSON.parse(fromBase64(m[1].replace(/-/g, '+').replace(/_/g, '/')));
    const repo = parseRepo(o.r);
    return repo && o.t ? { repo, token: String(o.t) } : null;
  } catch (e) { return null; }
}

/** What a GitHub status code means, in words Cameron can act on. */
export function explainStatus(status) {
  if (status === 401) return 'GitHub did not accept the token. It may have expired or been deleted. Make a new one and paste it in Settings.';
  if (status === 403) return 'The token is not allowed to do that. It needs Contents: Read and write on this repo.';
  if (status === 404) return 'GitHub cannot find that repo with this token. Check the name, and that the token covers it.';
  return `GitHub answered ${status}. Try again in a minute.`;
}

// ---- settings on this device ----
export const getSync = async () => (await kvGet('sync')) || null;
export async function saveSync(patch) {
  const next = { ...((await getSync()) || {}), ...patch };
  await kvSet('sync', next);
  return next;
}
export const clearSync = () => kvDel('sync');

// ---- GitHub ----
function call(cfg, path, { method = 'GET', body, raw } = {}) {
  return fetch(`${API}/repos/${cfg.repo}${path}`, {
    method, cache: 'no-store',
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}
const offline = e => (e instanceof TypeError ? new Error('No connection to GitHub right now.') : e);

/** Does the token reach the repo, is the repo private, and (for the phone) can it write? Throws with the reason if not. */
export async function checkAccess(cfg, needsWrite) {
  let res;
  try { res = await call(cfg, ''); } catch (e) { throw offline(e); }
  if (!res.ok) throw new Error(explainStatus(res.status));
  const repo = await res.json();
  if (!repo.private) throw new Error('That repo is public. Use a private one, so your logs stay yours.');
  if (needsWrite && repo.permissions && repo.permissions.push === false) throw new Error(explainStatus(403));
  return true;
}

/** Upload everything on this device as one file. Remembers a failed upload so the next open retries it. */
export async function pushNow(appVersion, planVersion) {
  const cfg = await getSync();
  if (!cfg || !cfg.repo || !cfg.token) return { ok: false, skipped: true };
  try {
    const data = await exportAll(appVersion, planVersion);
    const content = toBase64(JSON.stringify(data));
    for (let attempt = 0; attempt < 2; attempt++) {
      const head = await call(cfg, `/contents/${SYNC_FILE}`);
      if (!head.ok && head.status !== 404) throw new Error(explainStatus(head.status));
      const sha = head.ok ? (await head.json()).sha : undefined;
      const put = await call(cfg, `/contents/${SYNC_FILE}`, { method: 'PUT', body: { message: `Tracker data ${data.exportedAt}`, content, ...(sha ? { sha } : {}) } });
      if (put.ok) {
        await saveSync({ dirty: false, lastPushedAt: data.exportedAt, lastError: null });
        return { ok: true, at: data.exportedAt, sessions: data.sessions.length, runs: data.runs.length };
      }
      if (put.status !== 409 && put.status !== 422) throw new Error(explainStatus(put.status)); // 409: the file changed under us, read it again
    }
    throw new Error('GitHub kept refusing the upload. Tap Sync now to try again.');
  } catch (e) {
    const err = offline(e);
    await saveSync({ dirty: true, lastError: String(err.message || err) });
    return { ok: false, error: String(err.message || err) };
  }
}

/** Download the phone's file and replace what this device holds, if the file is newer than the last one loaded. */
export async function pullNow() {
  const cfg = await getSync();
  if (!cfg || !cfg.repo || !cfg.token) return { ok: false, skipped: true };
  try {
    const res = await call(cfg, `/contents/${SYNC_FILE}`, { raw: true });
    if (res.status === 404) {
      const probe = await call(cfg, '');
      if (!probe.ok) throw new Error(explainStatus(probe.status));
      await saveSync({ lastError: null });
      return { ok: true, empty: true };
    }
    if (!res.ok) throw new Error(explainStatus(res.status));
    const data = await res.json();
    if (!data || data.app !== 'CamsTrainingTracker') throw new Error(`${SYNC_FILE} in that repo is not a tracker file.`);
    const changed = cfg.lastPulledExport !== data.exportedAt;
    if (changed) await importAll(data, { quiet: true });
    await saveSync({ lastPulledExport: data.exportedAt, lastPulledAt: new Date().toISOString(), lastError: null });
    return { ok: true, changed, at: data.exportedAt, sessions: (data.sessions || []).length, runs: (data.runs || []).length };
  } catch (e) {
    const err = offline(e);
    await saveSync({ lastError: String(err.message || err) });
    return { ok: false, error: String(err.message || err) };
  }
}

/**
 * v1.9: the coach's replies and adjustments (coach.json in the same private repo). Both devices read it; only the
 * phone applies adjustments. Keeps the last copy on the device so it shows with no signal.
 */
export async function pullCoach() {
  const cfg = await getSync();
  if (!cfg || !cfg.repo || !cfg.token) return { ok: false, skipped: true, file: (await kvGet('coach')) || null };
  try {
    const res = await call(cfg, `/contents/${COACH_FILE}`, { raw: true });
    if (res.status === 404) return { ok: true, empty: true, file: (await kvGet('coach')) || null };
    if (!res.ok) throw new Error(explainStatus(res.status));
    const file = await res.json();
    if (!file || typeof file !== 'object') throw new Error(`${COACH_FILE} is not a coach file.`);
    await kvSet('coach', file);
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: String(offline(e).message || e), file: (await kvGet('coach')) || null };
  }
}

// ---- automatic upload on the phone ----
let timer = null;
/** Call once at start-up. After any saved change the phone uploads a few seconds later; a failed upload retries when signal returns. */
export function startAutoSync(versions, onResult) {
  const run = async () => {
    const cfg = await getSync();
    if (!cfg || cfg.role !== 'phone') return;
    const v = versions();
    const r = await pushNow(v.appVersion, v.planVersion);
    if (onResult && !r.skipped) onResult(r);
  };
  const soon = () => { clearTimeout(timer); timer = setTimeout(run, 2500); };
  onDataChange(soon);
  window.addEventListener('online', async () => { const cfg = await getSync(); if (cfg && cfg.role === 'phone' && cfg.dirty) soon(); });
  getSync().then(cfg => { if (cfg && cfg.role === 'phone' && cfg.dirty) soon(); });
}
