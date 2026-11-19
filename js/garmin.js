// garmin.js - v1.10: brings Garmin activities into the run log.
// The Garmin key stays off the phone and out of the app: a small job in Cameron's private repo
// (data/garmin-job.yml, copied there during set-up) holds it as a GitHub secret, does the asking and writes
// garmin-activities.json. This file reads that through the sync that already exists and saves what is new.
// Only the phone adds runs; a computer set to "only views" sees them after the phone uploads.

import { kvGet, kvSet, getRuns, putRun, getSettings, getGarminIgnored } from './store.js';
import { getSync, readGarminFile, requestGarminPull } from './sync.js';
import { mergeGarmin, garminList } from './runs.js';
import { APP_VERSION } from './data.js';

export const getGarminState = async () => (await kvGet('garmin')) || {};
// v1.12: bump when the merge rules change, so the phone re-reads the last Garmin file once and re-settles the weeks
const MERGE_VERSION = 2;
const saveState = async patch => { const next = { ...(await getGarminState()), ...patch }; await kvSet('garmin', next); return next; };

/** What went wrong on Garmin's side, in words Cameron can act on. */
export function explainGarmin(data) {
  if (!data || data.ok !== false) return null;
  if (data.status === 401 || data.status === 403) return 'Garmin did not accept the key. It may have expired. Make a new one in Garmin Connect and save it as the secret again.';
  if (data.status === 429) return 'Garmin says too many requests. It will try again on its own.';
  return data.error || 'The Garmin job could not get your activities.';
}

/**
 * Read the Garmin file and save new or changed runs. Safe to call often: it does nothing when the file has not
 * changed since the last look. returns { ok, missing, added, updated, activities, fetchedAt, error, changed }
 */
export async function importFromGarmin({ plan, rules, force } = {}) {
  const cfg = await getSync();
  if (!cfg || !cfg.repo || !cfg.token) return { ok: false, skipped: true };
  const got = await readGarminFile();
  const now = new Date().toISOString();
  if (!got.ok) { await saveState({ lastCheckedAt: now, lastError: got.error }); return got; }
  if (got.missing) { await saveState({ lastCheckedAt: now, found: false, lastError: null }); return { ok: true, missing: true }; }
  const data = got.data || {};
  const state = await getGarminState();
  const problem = explainGarmin(data);
  const base = { found: true, lastCheckedAt: now, fetchedAt: data.fetchedAt || null, activities: garminList(data).length, lastError: problem };
  if (cfg.role !== 'phone' || (!force && state.importedFetchedAt === data.fetchedAt && state.mergeVersion === MERGE_VERSION)) {
    await saveState(base);
    return { ok: true, added: 0, updated: 0, changed: false, ...base, error: problem };
  }
  const settings = await getSettings();
  const merged = mergeGarmin(await getRuns(), data, { plan, rules, settings, ignored: await getGarminIgnored(), appVersion: APP_VERSION });
  for (const r of merged.put) await putRun(r);
  await saveState({ ...base, importedFetchedAt: data.fetchedAt || null, mergeVersion: MERGE_VERSION, lastAdded: merged.added, runsSeen: merged.seen });
  return { ok: true, added: merged.added, updated: merged.updated, changed: merged.put.length > 0, ...base, error: problem };
}

/**
 * Ask the job to pull from Garmin now, wait for its answer, then import. `say` gets short progress lines.
 * The wait is rules.garmin.checkWaitSeconds; a job that has not answered by then still gets picked up on the next open.
 */
export async function checkGarminNow({ plan, rules }, say = () => {}) {
  const before = await readGarminFile();
  if (!before.ok) return before;
  say('Asking Garmin...');
  const asked = await requestGarminPull();
  if (!asked.ok) return asked;
  const was = before.data ? before.data.fetchedAt : null;
  const limit = Date.now() + (((rules && rules.garmin && rules.garmin.checkWaitSeconds) || 150) * 1000);
  while (Date.now() < limit) {
    await new Promise(r => setTimeout(r, 5000));
    const got = await readGarminFile();
    if (got.ok && got.data && got.data.fetchedAt && got.data.fetchedAt !== was) return importFromGarmin({ plan, rules, force: true });
    say('Waiting for the answer...');
  }
  return { ok: false, slow: true, error: before.missing ? 'No answer yet. Check that the secret and the job file are both saved in the repo, then try again.' : 'No answer yet. GitHub may be busy. New runs will show up the next time you open the app.' };
}
