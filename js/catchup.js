// catchup.js - v1.8: what is still owed this week, and a catch-up session built from it.
// Owed = sets that were skipped or never reached in a session saved this week (minus any already made up),
// plus whole lifts whose day has passed with nothing logged. Sets cut by Trim to fit and the if-time block are not owed.
// Nothing carries past the end of the week. Pure functions, no DOM, no storage.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekPos = dow => (dow + 6) % 7; // the plan's week starts on Monday
export const CATCHUP_ID = 'catchup';
export const shortName = lift => (lift.name.includes(': ') ? lift.name.split(': ')[1] : lift.name);
const isWorkStep = st => !st.ramp;

/** The weekday a lift is planned on, from plan.calendar: { dow, name } or null. */
export function plannedDay(plan, liftId) {
  const hit = Object.entries(plan.calendar || {}).find(([, id]) => id === liftId);
  return hit ? { dow: Number(hit[0]), name: DAYS[Number(hit[0])] } : null;
}

/** Days with nothing planned, in week order: the Slack days. */
export function slackDays(plan) {
  return Object.entries(plan.calendar || {}).filter(([, id]) => !id).map(([d]) => Number(d)).sort((a, b) => weekPos(a) - weekPos(b)).map(d => DAYS[d]);
}

/**
 * weekOwed({ plan, sessions, week, today })
 * returns { week, lifts: [{ id, name, short, missed, day, sets, blocks: [{ blockId, items: [{ exerciseId, name, sets, hadDone }] }] }],
 *           totalSets, missed: [lift ids] }
 * `today` decides which lifts count as missed; leave it out to skip that check (past weeks).
 */
export function weekOwed({ plan, sessions, week, today }) {
  const inWeek = (sessions || []).filter(s => s.week === week);
  const madeUp = {}; // "lift:block:exercise" -> sets already made up in a catch-up session this week
  for (const s of inWeek) {
    if (s.sessionId !== CATCHUP_ID) continue;
    for (const st of s.sets || []) {
      if (!isWorkStep(st) || !st.done || st.skipped) continue;
      const key = `${st.blockId}:${st.exerciseId}`;
      madeUp[key] = (madeUp[key] || 0) + 1;
    }
  }
  const lifts = [];
  for (const lift of plan.sessions) {
    const recs = inWeek.filter(s => s.sessionId === lift.id);
    const day = plannedDay(plan, lift.id);
    const out = { id: lift.id, name: lift.name, short: shortName(lift), missed: false, day: day ? day.name : null, sets: 0, blocks: [] };
    if (!recs.length) {
      out.missed = !!(today && day && weekPos(day.dow) < weekPos(today.getDay()));
      if (out.missed) lifts.push(out);
      continue;
    }
    for (const block of lift.blocks) {
      if (!block.items || block.type === 'warmup' || block.type === 'stretch' || block.type === 'iftime') continue;
      const items = [];
      for (const item of block.items) {
        if (!item.exercise) continue;
        // v1.15: a lift done twice in a week owes only what is still missing after the better attempt (Cameron ended
        // Monday's Legs early with nothing done, then did all of it Tuesday; it used to owe Monday's sets as well)
        const per = recs.map(r => (r.sets || []).filter(st => st.exerciseId === item.exercise && st.blockId === block.id && isWorkStep(st))).filter(a => a.length);
        const skipped = per.length ? Math.min(...per.map(a => a.filter(st => st.skipped || !st.done).length)) : 0;
        const left = skipped - (madeUp[`${lift.id}:${block.id}:${item.exercise}`] || 0);
        if (left <= 0) continue;
        const ex = plan.exercises[item.exercise];
        items.push({
          exerciseId: item.exercise, name: ex ? ex.name : item.exercise, sets: left,
          // v1.18.1 (rules R4 rule 11): no undoStall any more. A skipped set never adds to the flat count, so making
          // it up has nothing to take back.
          hadDone: recs.some(r => (r.sets || []).some(st => st.exerciseId === item.exercise && isWorkStep(st) && st.done && !st.skipped))
        });
      }
      if (items.length) { out.blocks.push({ blockId: block.id, items }); out.sets += items.reduce((a, i) => a + i.sets, 0); }
    }
    if (out.sets) lifts.push(out);
  }
  return { week, lifts, totalSets: lifts.reduce((a, l) => a + l.sets, 0), missed: lifts.filter(l => l.missed).map(l => l.id) };
}

/** Sets a lift still owes this week (0 when everything skipped has been made up). */
export function owedSetsFor(plan, sessions, liftId, week) {
  const l = weekOwed({ plan, sessions, week }).lifts.find(x => x.id === liftId);
  return l ? l.sets : 0;
}

/** One line per lift for the Home card: "Romanian deadlift 1 set, Standing calf raise 2 sets". */
export function owedLines(owed) {
  return owed.lifts.filter(l => l.sets).map(l => ({
    id: l.id, short: l.short,
    text: l.blocks.flatMap(b => b.items).map(i => `${i.name} ${i.sets} ${i.sets === 1 ? 'set' : 'sets'}`).join(', ')
  }));
}

/**
 * A session made of the leftover sets, in the shape plan.sessions use, or null when no sets are left over.
 * Each block keeps its type where it can: a superset with one exercise left becomes straight sets with a full rest,
 * a finisher runs as many rounds as its most-owed exercise. Block ids are "lift:block", which is how saved sets
 * are matched back to the session they came from.
 */
export function buildCatchUpSession(plan, rules, owed) {
  const cfg = rules.catchUp || {};
  const blocks = [];
  const info = {};
  for (const l of owed.lifts) {
    if (!l.sets) continue;
    const lift = plan.sessions.find(s => s.id === l.id);
    for (const ob of l.blocks) {
      const src = lift.blocks.find(b => b.id === ob.blockId);
      const count = Object.fromEntries(ob.items.map(i => [i.exerciseId, i.sets]));
      ob.items.forEach(i => { const cur = info[i.exerciseId] || { hadDone: false }; info[i.exerciseId] = { hadDone: cur.hadDone || i.hadDone }; });
      const kept = src.items.filter(it => count[it.exercise]);
      const label = /^[A-Z]$/.test(src.name) ? `block ${src.name}` : src.name.toLowerCase();
      const base = { id: `${l.id}:${src.id}`, name: `${l.short} · ${label}`, minutes: src.minutes };
      if (src.type === 'finisher') {
        const rounds = Math.max(...kept.map(it => count[it.exercise]));
        blocks.push({ ...base, type: 'finisher', rounds, roundRestSeconds: src.roundRestSeconds,
          items: kept.map(it => ({ ...it, rounds: Array.from({ length: count[it.exercise] }, (_, k) => k + 1) })) });
      } else if (src.type === 'superset' && kept.length === 2) {
        blocks.push({ ...base, type: 'superset', items: kept.map(it => ({ ...it, sets: count[it.exercise] })) });
      } else {
        const restSeconds = Math.max(cfg.singleRestSeconds || 0, ...src.items.map(it => it.restSeconds || 0));
        blocks.push({ ...base, type: 'straight', items: kept.map(it => ({ ...it, sets: count[it.exercise], restSeconds: src.type === 'superset' ? restSeconds : it.restSeconds })) });
      }
    }
  }
  if (!blocks.length) return null;
  return {
    id: CATCHUP_ID, name: 'Catch-up', logName: 'Catch-up', catchUp: true, catchUpInfo: info,
    goal: 'The sets you skipped or did not reach this week, in the order they were planned.',
    blocks: [
      { id: 'warmup', type: 'warmup', name: 'Warm-up', items: cfg.warmup || [{ name: 'Bike, easy', seconds: 180 }] },
      ...blocks,
      ...(cfg.includeStretch === false ? [] : [{ id: 'stretch', type: 'stretch', name: 'Stretch', minutes: 5 }])
    ]
  };
}
