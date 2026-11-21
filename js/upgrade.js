// upgrade.js (v1.18.1) - one-time changes to data an older version saved. They run when the app starts, and again
// after a restore or (on the computer) a pull brings in data an older version wrote: importAll keeps that data's
// appVersion as dataVersion, and every change for a newer version runs once.

import { getTargets, setTargets, getRuns, putRun, kvGet, kvSet } from './store.js';
import { APP_VERSION, getData } from './data.js';
import { settleRun } from './runs.js';

/** a < b for versions like 1.9 and 1.18.1. */
export function olderThan(a, b) {
  const x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0;
  }
  return false;
}

/**
 * v1.18.1, on plain data (no storage): every flat count starts again at 0 under the new reset rule (rules R4, rule 11:
 * counts from the old two-misses rule do not carry over), and Garmin activities lose credit for a planned run the app
 * gave by itself (Cameron, Nov 21). Runs he typed or counted stay as they are.
 * Returns { targets, zeroed, runs } with runs = the run records that changed (new objects).
 */
export function upgrade1181({ targets, runs, rules }) {
  const next = JSON.parse(JSON.stringify(targets || {}));
  let zeroed = 0;
  for (const t of Object.values(next)) if (t && t.stall) { t.stall = 0; zeroed += 1; }
  const changed = [];
  for (const r of runs || []) {
    const copy = { ...r };
    if (settleRun(copy, rules)) changed.push(copy);
  }
  return { targets: next, zeroed, runs: changed };
}

const UPGRADES = [{ version: '1.18.1', run: upgrade1181 }];

/**
 * Run each upgrade newer than the data on this device, once. Returns { zeroed, runs } (counts) when something ran,
 * else null.
 */
export async function runUpgrades() {
  const from = (await kvGet('dataVersion')) || '0';
  const due = UPGRADES.filter(u => olderThan(from, u.version));
  if (!due.length) {
    if (olderThan(from, APP_VERSION)) await kvSet('dataVersion', APP_VERSION);
    return null;
  }
  const { rules } = getData();
  let zeroed = 0, runsChanged = 0;
  for (const u of due) {
    const [targets, runs] = await Promise.all([getTargets(), getRuns()]);
    const out = u.run({ targets, runs, rules });
    if (out.zeroed) await setTargets(out.targets);
    for (const r of out.runs) await putRun(r);
    zeroed += out.zeroed; runsChanged += out.runs.length;
  }
  await kvSet('dataVersion', APP_VERSION);
  return { zeroed, runs: runsChanged };
}
