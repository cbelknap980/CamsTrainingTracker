// store.js - IndexedDB wrapper, settings, backup and restore.
// All of Cameron's data lives here, on the phone. Nothing in this file ever reaches the repo.

const DB_NAME = 'cams-training-tracker';
const DB_VERSION = 1;
const STORES = ['kv', 'sessions', 'runs'];

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('runs')) db.createObjectStore('runs', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const result = fn(store);
    t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqToPromise(storeName, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const req = fn(t.objectStore(storeName));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

// ---- key/value ----
export const kvGet = key => reqToPromise('kv', 'readonly', s => s.get(key));
export const kvSet = (key, value) => tx('kv', 'readwrite', s => s.put(value, key));
export const kvDel = key => tx('kv', 'readwrite', s => s.delete(key));

// ---- targets ----
// { exerciseId: { weight, reps, e1rm, stall, source: 'engine'|'you'|'baseline', updated, sessionId } }
export async function getTargets() { return (await kvGet('targets')) || {}; }
export async function setTargets(targets) { return kvSet('targets', targets); }
export async function setTarget(exerciseId, target) {
  const all = await getTargets();
  all[exerciseId] = { ...(all[exerciseId] || {}), ...target };
  await setTargets(all);
  return all[exerciseId];
}

// ---- sessions ----
export const putSession = s => tx('sessions', 'readwrite', st => st.put(s));
export const getSession = id => reqToPromise('sessions', 'readonly', st => st.get(id));
export const deleteSession = id => tx('sessions', 'readwrite', st => st.delete(id));
export async function getSessions() {
  const all = await reqToPromise('sessions', 'readonly', st => st.getAll());
  return all.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}

// ---- runs ----
export const putRun = r => tx('runs', 'readwrite', st => st.put(r));
export const deleteRun = id => tx('runs', 'readwrite', st => st.delete(id));
export async function getRuns() {
  const all = await reqToPromise('runs', 'readonly', st => st.getAll());
  return all.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

// ---- in-progress session (for Resume) ----
export const getInProgress = () => kvGet('inProgress');
export const setInProgress = state => kvSet('inProgress', state);
export const clearInProgress = () => kvDel('inProgress');

// ---- settings: defaults from data/settings.json + overrides in kv ----
let defaults = null;
export function setSettingsDefaults(d) { defaults = d; }
export async function getSettings() {
  const overrides = (await kvGet('settings')) || {};
  const merged = deepMerge(defaults || {}, overrides);
  return merged;
}
export async function saveSettings(partial) {
  const overrides = (await kvGet('settings')) || {};
  const next = deepMerge(overrides, partial);
  await kvSet('settings', next);
  return getSettings();
}

function deepMerge(a, b) {
  const out = { ...(a || {}) };
  for (const k of Object.keys(b || {})) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) out[k] = deepMerge(a ? a[k] : {}, b[k]);
    else out[k] = b[k];
  }
  return out;
}

// ---- backup and restore ----
export async function exportAll(appVersion, planVersion) {
  return {
    app: 'CamsTrainingTracker',
    appVersion,
    planVersion,
    exportedAt: new Date().toISOString(),
    targets: await getTargets(),
    sessions: await getSessions(),
    runs: await getRuns(),
    settings: (await kvGet('settings')) || {}
  };
}

export async function importAll(backup) {
  if (!backup || backup.app !== 'CamsTrainingTracker') throw new Error('Not a Cam\'s Training Tracker backup file.');
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const t = db.transaction(STORES, 'readwrite');
    t.objectStore('sessions').clear();
    t.objectStore('runs').clear();
    for (const s of backup.sessions || []) t.objectStore('sessions').put(s);
    for (const r of backup.runs || []) t.objectStore('runs').put(r);
    t.objectStore('kv').put(backup.targets || {}, 'targets');
    t.objectStore('kv').put(backup.settings || {}, 'settings');
    t.objectStore('kv').delete('inProgress');
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  return { sessions: (backup.sessions || []).length, runs: (backup.runs || []).length };
}

export async function wipeAll() {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const t = db.transaction(STORES, 'readwrite');
    for (const s of STORES) t.objectStore(s).clear();
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
