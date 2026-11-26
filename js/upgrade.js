// upgrade.js (v1.18.1) - one-time changes to data an older version saved. They run when the app starts, and again
// after a restore or (on the computer) a pull brings in data an older version wrote: importAll keeps that data's
// appVersion as dataVersion, and every change for a newer version runs once.

import { getTargets, setTargets, getRuns, putRun, getSessions, putSession, kvGet, kvSet, getSettings } from './store.js';
import { APP_VERSION, getData, snapLoad, roundEst } from './data.js';
import { settleRun } from './runs.js';
import { rerunBeatPlan } from './sanity.js';

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

/**
 * v1.18.5 (Cameron, Nov 24: the gym has no 27.5 lb dumbbells): a stored dumbbell target the rack can't make moves to
 * the nearest weight it can (the lighter one on a tie), so Home, Plan and the next workout agree. Reps stay.
 * Returns { targets, zeroed (targets changed), runs: [] }.
 */
export function upgrade1185({ targets, rules, plan }) {
  const next = JSON.parse(JSON.stringify(targets || {}));
  let moved = 0;
  for (const [id, t] of Object.entries(next)) {
    const ex = plan && plan.exercises ? plan.exercises[id] : null;
    if (!t || t.weight == null || !ex) continue;
    const w = snapLoad(rules, ex, t.weight);
    if (w !== t.weight) { t.rackFrom = t.weight; t.weight = w; moved += 1; }
  }
  return { targets: next, zeroed: moved, runs: [] };
}

/**
 * v1.18.10 (Cameron, Nov 25: "Smallest increment for these types of weights should be 5lb"): every stored target lands
 * on a weight he can load (a strict press at 92.5 goes to 90), and the estimated maxes kept with it go to the nearest
 * 5 lb, so Home, Plan and the PR checks read the same numbers. Returns { targets, zeroed (targets changed), runs: [] }.
 */
export function upgrade11810({ targets, rules, plan }) {
  const before = targets || {};
  const out = upgrade1185({ targets, rules, plan });
  let changed = 0;
  for (const [id, t] of Object.entries(out.targets)) {
    if (!t) continue;
    let touched = before[id] && t.weight !== before[id].weight;
    for (const k of ['e1rm', 'bestE1rm', 'baselineE1rm', 'retestE1rm']) {
      if (typeof t[k] === 'number') { const r = roundEst(t[k], rules); if (r !== t[k]) { t[k] = r; touched = true; } }
    }
    if (touched) changed += 1;                                        // each lift counted once
  }
  return { targets: out.targets, zeroed: changed, runs: [] };
}

/**
 * v1.18.13 (Cameron, Nov 25: "if I skip stretching it still count as a workout"): a saved session marked ended early
 * with every set done (none skipped or missing) and the Engine done where the session has one only left out the
 * stretch, so it becomes complete. His Lift 1 on Nov 24 is one. Sessions with a skipped set stay as they are.
 * Returns { targets, zeroed: 0, runs: [], sessions } with sessions = the records that changed (new objects).
 */
export function upgrade11813({ targets, sessions, plan }) {
  const changed = [];
  for (const s of sessions || []) {
    const sets = s && s.sets ? s.sets : [];
    if (!s || s.status !== 'ended_early' || !sets.length || sets.some(x => x.skipped || !x.done)) continue;
    const lift = plan && plan.sessions ? plan.sessions.find(l => l.id === s.sessionId) : null;
    const engine = lift && (lift.blocks || []).some(b => b.type === 'emom');
    if (engine && !(s.engineMinutes > 0)) continue;
    changed.push({ ...s, status: 'complete', stretchSkipped: true, upgradedFrom: 'ended_early' });
  }
  return { targets, zeroed: 0, runs: [], sessions: changed };
}

/**
 * v1.21.0 (rules.lastSetRating.beatPlan, Cameron Nov 25): sessions saved before the rule are worked out again where
 * he beat the plan and left the last set unrated, so his Nov 25 row (55 x 8, 60 x 8, 60 x 8: it held at 55) and arm
 * lifts move on from what he did. Only each lift's latest session, and only when he or the coach has not set the
 * target since. Returns { targets, zeroed (lifts changed), runs: [], sessions, lifts }.
 */
export function upgrade1210({ targets, sessions, rules, plan, settings }) {
  const out = rerunBeatPlan({ sessions, targets, plan, rules, settings });
  return { targets: out.targets, zeroed: out.lifts.length, runs: [], sessions: out.sessions, lifts: out.lifts };
}

const UPGRADES = [{ version: '1.18.1', run: upgrade1181 }, { version: '1.18.5', run: upgrade1185 }, { version: '1.18.10', run: upgrade11810 }, { version: '1.18.13', run: upgrade11813 }, { version: '1.21.0', run: upgrade1210 }];

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
  const { rules, plan } = getData();
  let zeroed = 0, runsChanged = 0;
  for (const u of due) {
    const [targets, runs, sessions, settings] = await Promise.all([getTargets(), getRuns(), getSessions(), getSettings()]);
    const out = u.run({ targets, runs, sessions, rules, plan, settings });
    if (out.zeroed) await setTargets(out.targets);
    for (const r of out.runs) await putRun(r);
    for (const s of out.sessions || []) await putSession(s);
    zeroed += out.zeroed; runsChanged += out.runs.length;
  }
  await kvSet('dataVersion', APP_VERSION);
  return { zeroed, runs: runsChanged };
}
