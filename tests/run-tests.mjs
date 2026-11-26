// Node tests for the Session Builder and Progression Engine. Run: node tests/run-tests.mjs
import { readFileSync } from 'node:fs';
import { buildTimeline, trimToFit, remainingSeconds, lastResults, setTiming } from '../js/builder.js';
import { applyProgression, epley, checkPR, estimateStart, effectiveTarget, flatWords, incrementFor } from '../js/progression.js';
import { effortPlain, effortLevel, spokenDuration, easyLoad, snapLoad, dumbbellOk, weekNumber, parseISODate } from '../js/data.js';
import { weekOwed, owedSetsFor, owedLines, buildCatchUpSession, slackDays, plannedDay } from '../js/catchup.js';
import { parseRepo, toBase64, fromBase64, setupLink, readSetupLink, explainStatus } from '../js/sync.js';
import { strengthSeries, adherence, weeklySets, accessoryRows, prList, yTicks, muscleSets } from '../js/progress.js';
import { changesFor, replyFor, pendingAdjustments, withRest, thread } from '../js/coach.js';
import { applyRestAdjust } from '../js/builder.js';
import { intervalPlan, longRunPlan, checkIns, fiveKProjection, runDay, fmtSeconds } from '../js/runs.js';
import { planCheck, intervalMinutes, workoutBlocks, runGoals, inDays, planRunOf } from '../js/runs.js';
import { fiveKSeconds, fiveKTests, paceFrom5k, vdotFrom5k, parseMinutes, fmtDuration, paceOf, runLine, planRunForType, longRunTarget, prescription, weekRuns, weeklyMiles, garminToRun, mergeGarmin, garminList, settleWeek, isAuto, openRunDays, needsCredit, countsFor, creditOptions, countAs, keepAsSide, countCandidates, weekRange, countsMiles } from '../js/runs.js';
import { garminLinks, GARMIN_JOB } from '../js/sync.js';
import { numberFlag, flaggedGroups, applyNumberFix, rateSavedSet, rerunLift, impossibleNumber } from '../js/sanity.js';
// v1.18
import { leadIns, setupSecondsFor, repSecondsFor } from '../js/builder.js';
import { pacingConfig, setObservation, setupObservation, learnRep, learnSetup, learnPacing, pacingLines } from '../js/pacing.js';
import { runAdherence, runSummary } from '../js/progress.js';
import { gymSecondsOf, pausedInGym, isUnchecked, fmtLong } from '../js/logger.js';
import { Player, fmtGym, speakable } from '../js/player.js';
// v1.20
import { entryG, dayEntries, dayTotal, lastDays, addDays, fmtQty, amountText, makeEntry, checkProtein, checkFood, recentRepeat, applyFoodEdit, foodsList, foodId, progressOf, validFoodOp, applyFoodOps } from '../js/nutrition.js';
// v1.18.1
import { upgrade1181, upgrade1185, upgrade11810, olderThan } from '../js/upgrade.js';

const plan = JSON.parse(readFileSync(new URL('../data/plan.json', import.meta.url)));
const rules = JSON.parse(readFileSync(new URL('../data/rules.json', import.meta.url)));
const settings = JSON.parse(readFileSync(new URL('../data/settings.json', import.meta.url)));

let failures = 0;
function check(name, cond, info) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (info ? '  ' + JSON.stringify(info) : '')); }
}

// ---- Builder: week 1, no targets (baseline) ----
console.log('Builder, week 1 (baseline, no targets)');
for (const sid of ['lift1', 'lift2', 'lift3']) {
  const tl = buildTimeline({ plan, rules, settings, sessionId: sid, week: 1, targets: {} });
  const kinds = tl.steps.map(s => s.kind);
  // v1.11: the optional if-time block is left out of the cap check
  const minutes = tl.steps.filter(s => !s.iftime).reduce((a, s) => a + (s.seconds || 0), 0) / 60;
  // v1.18: Lift 3 is 2.8 min longer on paper: the dumbbell row is timed for both arms, the stretches for their change-overs
  check(`${sid}: planned ${minutes.toFixed(1)} min without if-time is within 71 (week 1 has baseline work-ups)`, minutes <= 71 && minutes >= 45, { minutes });
  check(`${sid}: has a baseline top set for each main lift`, tl.steps.filter(s => s.baseline).length >= 1);
  check(`${sid}: ends with stretch steps (or if-time)`, ['stretch', 'decision', 'set', 'rest'].includes(kinds.at(-1)));
  // v1.18: a stretch done per side is one step (left, 6 s to change over, right), with an 8 s change-over between stretches
  check(`${sid}: stretch block is 4 stretches = 312 s, with 3 change-overs = 24 s`, tl.steps.filter(s => s.kind === 'stretch').length === 4 && tl.steps.filter(s => s.kind === 'stretch').reduce((a, s) => a + s.seconds, 0) === 312
    && tl.steps.filter(s => s.change).length === 3 && tl.steps.filter(s => s.change).reduce((a, s) => a + s.seconds, 0) === 24, tl.steps.filter(s => s.kind === 'stretch' || s.change).map(s => [s.name, s.seconds]));
  check(`${sid}: no two rests in a row`, !kinds.some((k, i) => k === 'rest' && kinds[i + 1] === 'rest'));
  check(`${sid}: no step without seconds except decision`, tl.steps.every(s => s.kind === 'decision' || s.seconds > 0));
}
const l1 = buildTimeline({ plan, rules, settings, sessionId: 'lift1', week: 1, targets: {} });
const sqSets = l1.steps.filter(s => s.exerciseId === 'back_squat' && s.kind === 'set');
check('lift1: squat = 1 baseline + 3 work sets, work sets fill from baseline', sqSets.length === 4 && sqSets.slice(1).every(s => s.fillFromBaseline), sqSets.map(s => [s.baseline, s.fillFromBaseline]));
const bSteps = l1.steps.filter(s => s.blockId === 'B' && s.kind !== 'transition');
check('lift1: superset B alternates RDL/calf with 30 s then 75 s rests (first calf rest carries 35 s machine set-up)', bSteps.map(s => s.kind === 'set' ? s.exerciseId : s.seconds).join(',') === 'rdl,65,calf_raise,75,rdl,30,calf_raise,75,rdl,30,calf_raise', bSteps.map(s => s.kind === 'set' ? s.exerciseId : s.seconds).join(','));
const fin = l1.steps.filter(s => s.blockType === 'finisher');
check('lift1: finisher = 3 rounds x 3 items + 2 round rests', fin.filter(s => s.kind === 'set').length === 9 && fin.filter(s => s.kind === 'rest').length === 2);
check('lift1: finisher items after the first get a set-up or switch step', fin.filter(s => s.kind === 'transition' && s.lead).length === 6, fin.filter(s => s.lead).map(s => s.name));

const l2 = buildTimeline({ plan, rules, settings, sessionId: 'lift2', week: 1, targets: {} });
const a = l2.steps.filter(s => s.blockId === 'A');
check('lift2: dead hang after last pull-up set', a.some(s => s.kind === 'timed' && s.name === 'Dead hang'));
const bb = l2.steps.filter(s => s.blockId === 'B' && s.kind === 'set').map(s => s.exerciseId).join(',');
check('lift2: B alternates incline press and row, 3 sets each', bb === 'incline_db_press,cs_row,incline_db_press,cs_row,incline_db_press,cs_row', bb);
// v1.11: the Engine (EMOM) replaces the old toes-to-bar / calf / face-pull block
check('lift2: old "last" block is gone', !l2.steps.some(s => s.blockId === 'last'));
const eng = wk => buildTimeline({ plan, rules, settings, sessionId: 'lift2', week: wk, targets: {} }).steps.filter(s => s.blockId === 'engine' && s.kind === 'timed');
const e1 = eng(1);
check('lift2 week 1: Engine = 9 one-minute timed steps rotating 3 stations', e1.length === 9 && e1.every(s => s.kind === 'timed' && s.seconds === 60 && s.countdown && s.blockType === 'emom') && e1[0].name.startsWith('Min 1 of 9: Echo bike') && e1[3].name.startsWith('Min 4 of 9: Echo bike') && e1[8].round === 3, e1.map(s => s.name));
check('lift2: Engine minutes by week: 9, test, 9, 12, 6 (light), 15 (heavy), test', [1, 2, 3, 4, 7, 8, 12].map(w => eng(w).length).join(',') === '9,1,9,12,6,15,1', [1, 2, 3, 4, 7, 8, 12].map(w => eng(w).length));
check('lift2 weeks 2 and 12: Engine is a 2,000 m row test (v1.21.0: his gym has no ski erg)', /2,000 m row test/.test(eng(2)[0].name) && /2,000 m row retest/.test(eng(12)[0].name) && eng(2).length === 1);
check('v1.21.0 no ski erg in any Engine station or benchmark', plan.sessions.every(l => l.blocks.filter(b => b.type === 'emom').every(b => !/ski erg/i.test(JSON.stringify([b.stations, b.schedule, b.cue])))));
check('v1.21.0 Engine week 4: rower and sled push take minutes 1 and 3; week 5: Echo bike and leg raises', /Row, 15-18 cal/.test(eng(4)[0].name) && /Sled push/.test(eng(4)[2].name) && /Kettlebell/.test(eng(4)[1].name) && /Echo bike/.test(eng(5)[0].name) && /Leg raises/.test(eng(5)[2].name) && eng(4)[0].cue.includes('Concept2'), [eng(4).slice(0, 3).map(s => s.name), eng(5).slice(0, 3).map(s => s.name)]);
check('lift2: transition into the Engine names the functional room', l2.steps.some(s => s.kind === 'transition' && /engine \(functional room\)/.test(s.name)));
const l2w4 = buildTimeline({ plan, rules, settings, sessionId: 'lift2', week: 4, targets: {} });
const engFrom = l2w4.steps.findIndex(s => s.blockId === 'engine');
const trE = trimToFit({ steps: l2w4.steps, fromIdx: engFrom - 1, overBySeconds: 400, rules });
const engLeft = trE.steps.filter(s => s.blockId === 'engine' && !s.removed);
check('trim drops Engine rounds (3 min each), keeps at least 1 round', engLeft.length >= 3 && engLeft.length < 12 && trE.notes.some(n => /engine round/.test(n)), { left: engLeft.length, notes: trE.notes });
const l3calf = buildTimeline({ plan, rules, settings, sessionId: 'lift3', week: 3, targets: {} }).steps.filter(s => s.exerciseId === 'calf_raise' && s.kind === 'set');
check('lift3: calf raise is in the finisher, 3 rounds', l3calf.length === 3 && l3calf.every(s => s.blockId === 'finisher'));

const l3 = buildTimeline({ plan, rules, settings, sessionId: 'lift3', week: 1, targets: {} });
check('lift3: if-time decision then 2 leg curl sets, after stretch', (() => { const i = l3.steps.findIndex(s => s.kind === 'decision'); return i > 0 && l3.steps[i - 1].kind === 'stretch' && l3.steps.slice(i + 1).filter(s => s.kind === 'set').length === 2; })());
check('lift3: side plank holds are countdown sets', l3.steps.filter(s => s.exerciseId === 'side_plank').every(s => s.holdSeconds === 25 && s.countdown));

// ---- Builder: week 3 with targets (ramp-ups) ----
console.log('Builder, week 3 with targets');
const targets = { back_squat: { weight: 185, reps: 4 }, rdl: { weight: 155, reps: 6 }, strict_press: { weight: 95, reps: 4 }, weighted_pullup: { weight: 25, reps: 4 }, power_clean: { weight: 135, reps: 2 }, front_squat: { weight: 155, reps: 5 }, push_press: { weight: 115, reps: 3 } };
const w3 = buildTimeline({ plan, rules, settings, sessionId: 'lift1', week: 3, targets });
const ramps = w3.steps.filter(s => s.ramp);
check('week 3 lift1: 4 ramp-up sets on easy plate loads (v1.18.5: 45, 95, 135, 155; 135 not 130)', ramps.map(s => s.target.weight).join(',') === '45,95,135,155', ramps.map(s => s.target.weight));
check('week 3 lift1: work sets pre-filled 185 x 4', w3.steps.filter(s => s.exerciseId === 'back_squat' && !s.ramp).every(s => s.target.weight === 185 && s.target.reps === 4));
check('week 3 lift1: planned within 61 min', w3.plannedSeconds / 60 <= 61, { min: w3.plannedSeconds / 60 });
const w3l2 = buildTimeline({ plan, rules, settings, sessionId: 'lift2', week: 3, targets });
check('week 3 lift2: press ramps on easy loads (95 lb target, v1.21.0: the bar and 65 only; the 50 % step waits for 185 and the 85 % step for 135)', w3l2.steps.filter(s => s.ramp).map(s => s.target.weight).join(',') === '45,65', w3l2.steps.filter(s => s.ramp).map(s => s.target.weight));
check('week 3 lift2: planned within 62 min', w3l2.plannedSeconds / 60 <= 62, { min: w3l2.plannedSeconds / 60 });
const w3l3 = buildTimeline({ plan, rules, settings, sessionId: 'lift3', week: 3, targets });
check('week 3 lift3: planned within 65 min without if-time (v1.11: calf raise in the finisher; v1.18: the row is timed per arm)', w3l3.steps.filter(s => !s.iftime).reduce((a, s) => a + s.seconds, 0) / 60 <= 65, { min: w3l3.steps.filter(s => !s.iftime).reduce((a, s) => a + s.seconds, 0) / 60 });

// ---- Builder: week 7 light, week 9 heavy, week 12 retest ----
console.log('Builder, phases');
const w7 = buildTimeline({ plan, rules, settings, sessionId: 'lift1', week: 7, targets });
check('week 7: squat 2 work sets, finisher 2 rounds', w7.steps.filter(s => s.exerciseId === 'back_squat' && !s.ramp).length === 2 && w7.steps.filter(s => s.blockType === 'finisher' && s.kind === 'set').length === 6);
const w9 = buildTimeline({ plan, rules, settings, sessionId: 'lift1', week: 9, targets: { back_squat: { weight: 195, reps: 3 } } });
check('week 9: squat rep range 3-5, target reps 3', w9.steps.filter(s => s.exerciseId === 'back_squat' && !s.ramp).every(s => s.repRange[1] === 5 && s.target.reps === 3));
const w12 = buildTimeline({ plan, rules, settings, sessionId: 'lift2', week: 12, targets });
check('week 12 lift2: retest top sets + max pull-ups + max T2B', w12.steps.filter(s => s.retest).length >= 4, w12.steps.filter(s => s.retest).map(s => s.name));

// ---- Trim to fit ----
console.log('Trim to fit');
const base = buildTimeline({ plan, rules, settings, sessionId: 'lift1', week: 3, targets });
const fromIdx = base.steps.findIndex(s => s.blockId === 'B');
const before = remainingSeconds(base.steps, fromIdx);
const tr = trimToFit({ steps: base.steps, fromIdx, overBySeconds: 300, rules });
const after = remainingSeconds(tr.steps, fromIdx);
check('trim saves at least 5 min', before - after >= 300, { before, after, notes: tr.notes });
check('trim keeps at least 1 finisher round', tr.steps.filter(s => s.blockType === 'finisher' && s.kind === 'set').length >= 3);
check('trim never touches stretch', tr.steps.filter(s => s.kind === 'stretch' && !s.removed).length === 4 && tr.steps.filter(s => s.kind === 'stretch').reduce((a, s) => a + s.seconds, 0) === 312 && tr.steps.filter(s => s.change && !s.removed).length === 3);
check('trim keeps trimmable rests >= 30 s', tr.steps.filter(s => s.kind === 'rest' && s.trimKind).every(s => s.seconds >= 30));
const tr2 = trimToFit({ steps: base.steps, fromIdx, overBySeconds: 60, rules });
check('small trim only shortens rests', tr2.notes.length === 1 && /rests/.test(tr2.notes[0]), tr2.notes);

// ---- Progression ----
console.log('Progression engine');
function mkSession(week, sets, extra) {
  return { id: 's1', sessionId: 'lift1', week, phase: { id: plan.phases.find(p => p.weeks.includes(week)).id }, endedAt: '2026-12-01T07:00:00Z', sets, ...(extra || {}) };
}
const ws = (exerciseId, weight, reps, rpe, repRange, extra) => ({ exerciseId, weight, reps, rpe, repRange, done: true, ...(extra || {}) });

// baseline
let r = applyProgression({ session: mkSession(1, [ws('back_squat', 185, 5, 8, [5, 5], { baseline: true }), ws('back_squat', 165, 4, 7, [4, 6]), ws('back_squat', 165, 4, 7, [4, 6]), ws('back_squat', 165, 4, 7, [4, 6])]), targets: {}, rules, plan, settings });
check('baseline 185x5 -> training 165, reps 4', r.targets.back_squat.weight === 165 && r.targets.back_squat.reps === 4, r.targets.back_squat);
check('baseline e1RM recorded (216, shown to 5 lb since v1.18.10: 215)', r.e1rms.back_squat === 215, r.e1rms);

// main lift pass
r = applyProgression({ session: mkSession(3, [ws('back_squat', 185, 6, 8, [4, 6]), ws('back_squat', 185, 6, 8, [4, 6]), ws('back_squat', 185, 6, 7, [4, 6])]), targets: { back_squat: { weight: 185, reps: 6, stall: 0 } }, rules, plan, settings });
check('main lift pass -> +5 lb, reps settle at 5 (v1.18.6, rules R5: was reps to the bottom, 4)', r.targets.back_squat.weight === 190 && r.targets.back_squat.reps === 5, r.targets.back_squat);
// press increments 2.5
r = applyProgression({ session: mkSession(3, [ws('strict_press', 95, 6, 8, [4, 6]), ws('strict_press', 95, 6, 8, [4, 6]), ws('strict_press', 95, 6, 8, [4, 6]), ws('strict_press', 95, 6, 8, [4, 6])]), targets: { strict_press: { weight: 95, reps: 6 } }, rules, plan, settings });
check('press pass -> +5 lb (v1.18.10: 5 lb is the smallest step)', r.targets.strict_press.weight === 100, r.targets.strict_press);
// v1.18.1 (rules R4): every set made the target's 4 reps, short of the top: same weight, one more rep, not a flat session
r = applyProgression({ session: mkSession(3, [ws('back_squat', 185, 5, 8, [4, 6]), ws('back_squat', 185, 4, 8, [4, 6]), ws('back_squat', 185, 4, 8, [4, 6])]), targets: { back_squat: { weight: 185, reps: 4, stall: 0 } }, rules, plan, settings });
check('v1.18.1 R4: target reps made short of the top -> same weight, reps 5, flat count 0', r.targets.back_squat.weight === 185 && r.targets.back_squat.reps === 5 && r.targets.back_squat.stall === 0, r.targets.back_squat);
// v1.18.1 (R4): short of the target reps is a flat session; the third in a row takes 5% off
r = applyProgression({ session: mkSession(4, [ws('back_squat', 185, 4, 9, [4, 6]), ws('back_squat', 185, 4, 9, [4, 6]), ws('back_squat', 185, 3, 10, [4, 6])]), targets: { back_squat: { weight: 185, reps: 5, stall: 1 } }, rules, plan, settings });
check('v1.18.1 R4: second flat session in a row -> same target, count 2 of 3', r.targets.back_squat.weight === 185 && r.targets.back_squat.reps === 5 && r.targets.back_squat.stall === 2 && /2 of 3/.test(r.lines[0].text), [r.targets.back_squat, r.lines[0].text]);
r = applyProgression({ session: mkSession(5, [ws('back_squat', 185, 4, 9, [4, 6]), ws('back_squat', 185, 4, 9, [4, 6]), ws('back_squat', 185, 3, 10, [4, 6])]), targets: { back_squat: { weight: 185, reps: 5, stall: 2 } }, rules, plan, settings });
check('v1.18.1 R4: third flat session -> 175 x 5 (5% off, rounded to 5 lb), count back to 0, says why', r.targets.back_squat.weight === 175 && r.targets.back_squat.reps === 5 && r.targets.back_squat.stall === 0 && r.lines[0].verdict === 'drop' && /3 flat sessions in a row/.test(r.lines[0].text), [r.targets.back_squat, r.lines[0]]);
r = applyProgression({ session: mkSession(5, [ws('strict_press', 45, 4, 9, [4, 6]), ws('strict_press', 45, 4, 9, [4, 6]), ws('strict_press', 45, 3, 10, [4, 6])]), targets: { strict_press: { weight: 45, reps: 5, stall: 2 } }, rules, plan, settings });
check('v1.18.1 R4 rule 4: a reset stops at the empty bar (45 lb) and the reps go to the bottom of the range', r.targets.strict_press.weight === 45 && r.targets.strict_press.reps === 4 && r.targets.strict_press.stall === 0, r.targets.strict_press);
// v1.18.2 (Cameron, Nov 21: "Only missed reps"): rules.stall.flatAtRpe is null, so a Hard day that made its reps holds
r = applyProgression({ session: mkSession(4, [ws('back_squat', 185, 5, 9, [4, 6]), ws('back_squat', 185, 5, 9, [4, 6]), ws('back_squat', 185, 5, 9, [4, 6])]), targets: { back_squat: { weight: 185, reps: 5, stall: 1 } }, rules, plan, settings });
check('v1.18.2 only missed reps count: the target reps made with Hard sets hold the weight and leave the count at 1', rules.stall.flatAtRpe === null && r.targets.back_squat.weight === 185 && r.targets.back_squat.reps === 5 && r.targets.back_squat.stall === 1 && r.lines[0].verdict === 'hold' && /Hard or Maxed. Same target next time\.$/.test(r.lines[0].text), [r.targets.back_squat, r.lines[0].text]);
r = applyProgression({ session: mkSession(4, [ws('back_squat', 185, 5, 10, [4, 6]), ws('back_squat', 185, 5, 10, [4, 6]), ws('back_squat', 185, 5, 10, [4, 6])]), targets: { back_squat: { weight: 185, reps: 5, stall: 2 } }, rules, plan, settings });
check('v1.18.2 only missed reps count: even Maxed sets that made the reps do not take 5% off after two flat sessions', r.targets.back_squat.weight === 185 && r.targets.back_squat.stall === 2, r.targets.back_squat);
const rules9 = { ...rules, stall: { ...rules.stall, flatAtRpe: 9 } };
r = applyProgression({ session: mkSession(4, [ws('back_squat', 185, 5, 9, [4, 6]), ws('back_squat', 185, 5, 9, [4, 6]), ws('back_squat', 185, 5, 9, [4, 6])]), targets: { back_squat: { weight: 185, reps: 5, stall: 0 } }, rules: rules9, plan, settings });
check('v1.18.1 R4 switch: with flatAtRpe 9, the target reps made with a Hard set count as flat', r.targets.back_squat.weight === 185 && r.targets.back_squat.stall === 1, r.targets.back_squat);
check('v1.18.2 flat words read from the rules: short of the target reps only', flatWords(rules) === 'Three flat sessions in a row (short of the target reps) take 5% off.' && /Hard or Maxed/.test(flatWords(rules9)), [flatWords(rules), flatWords(rules9)]);
// v1.18 (rules R4, rule 1): a set the timer logged before an effort was picked does not move the target or the count
{
  const un = { unconfirmed: true };
  const pass = [ws('back_squat', 185, 6, 8, [4, 6]), ws('back_squat', 185, 6, 8, [4, 6]), ws('back_squat', 185, 6, 8, [4, 6], un)];
  const held = applyProgression({ session: mkSession(3, pass), targets: { back_squat: { weight: 185, reps: 6, stall: 1 } }, rules, plan, settings });
  check('v1.18 R4 rule 1: a pass with one set the timer logged (no effort picked) holds: same weight, reps and flat count', held.targets.back_squat.weight === 185 && held.targets.back_squat.reps === 6 && held.targets.back_squat.stall === 1 && held.lines[0].verdict === 'hold' && held.lines[0].reason === 'effort not rated' && /no effort picked/.test(held.lines[0].text), [held.targets.back_squat, held.lines[0]]);
  const miss = applyProgression({ session: mkSession(3, [ws('back_squat', 185, 3, 10, [4, 6]), ws('back_squat', 185, 6, 8, [4, 6]), ws('back_squat', 185, 6, 8, [4, 6], un)]), targets: { back_squat: { weight: 185, reps: 5, stall: 2 } }, rules, plan, settings });
  check('v1.18 R4 rule 1: it comes before a miss (no drop, count stays 2)', miss.targets.back_squat.weight === 185 && miss.targets.back_squat.stall === 2, miss.targets.back_squat);
  const acc = applyProgression({ session: mkSession(3, [ws('curl', 30, 12, 7, [10, 12], un), ws('curl', 30, 12, 7, [10, 12], un), ws('curl', 30, 12, 7, [10, 12], un)]), targets: { curl: { weight: 30, reps: 12 } }, rules, plan, settings });
  check('v1.18 R4 rule 1: accessories hold too', acc.targets.curl.weight === 30 && acc.targets.curl.reps === 12, acc.targets.curl);
  const rated = applyProgression({ session: mkSession(3, pass.map(x => ({ ...x, unconfirmed: undefined }))), targets: { back_squat: { weight: 185, reps: 6, stall: 1 } }, rules, plan, settings });
  check('v1.18 R4 rule 1: once rated, the same sets move the target as usual', rated.targets.back_squat.weight === 190, rated.targets.back_squat);
}
// skipped set fails test
r = applyProgression({ session: mkSession(3, [ws('back_squat', 185, 6, 8, [4, 6]), ws('back_squat', 185, 6, 8, [4, 6]), { exerciseId: 'back_squat', repRange: [4, 6], done: false, skipped: true }]), targets: { back_squat: { weight: 185, reps: 6, stall: 0 } }, rules, plan, settings });
check('skipped set -> no increase', r.targets.back_squat.weight === 185 && /skipped/.test(r.lines[0].text), r.lines[0]);
// accessory reps first then weight
r = applyProgression({ session: mkSession(3, [ws('curl', 30, 10, 9, [10, 12]), ws('curl', 30, 10, 9, [10, 12]), ws('curl', 30, 10, 9, [10, 12])]), targets: { curl: { weight: 30, reps: 10 } }, rules, plan, settings });
check('accessory under top -> reps 11', r.targets.curl.weight === 30 && r.targets.curl.reps === 11, r.targets.curl);
r = applyProgression({ session: mkSession(3, [ws('curl', 30, 12, 9, [10, 12]), ws('curl', 30, 12, 9, [10, 12]), ws('curl', 30, 12, 9, [10, 12])]), targets: { curl: { weight: 30, reps: 12 } }, rules, plan, settings });
check('v1.18.15 two-dumbbell accessory at top: 15s to 20s a hand is too big a jump, so reps go past the top (30 x 13)', r.targets.curl.weight === 30 && r.targets.curl.reps === 13, r.targets.curl);
r = applyProgression({ session: mkSession(3, [ws('oh_tri_ext', 30, 12, 9, [10, 12]), ws('oh_tri_ext', 30, 12, 9, [10, 12]), ws('oh_tri_ext', 30, 12, 9, [10, 12])]), targets: { oh_tri_ext: { weight: 30, reps: 12 } }, rules, plan, settings });
check('v1.18.15 single-dumbbell accessory at top: 30 to 35 predicts 6, under 10 - 2, so reps go past the top (30 x 13)', r.targets.oh_tri_ext.weight === 30 && r.targets.oh_tri_ext.reps === 13, r.targets.oh_tri_ext);
// first time accessory with no target
r = applyProgression({ session: mkSession(1, [ws('rdl', 155, 6, 8, [6, 8]), ws('rdl', 155, 6, 8, [6, 8]), ws('rdl', 155, 7, 8, [6, 8])]), targets: {}, rules, plan, settings });
check('first log adopts weight 155, reps 6', r.targets.rdl.weight === 155 && r.targets.rdl.reps === 6, r.targets.rdl);
// light week unchanged
r = applyProgression({ session: mkSession(7, [ws('back_squat', 190, 6, 7, [4, 6]), ws('back_squat', 190, 6, 7, [4, 6])]), targets: { back_squat: { weight: 190, reps: 4, stall: 0 } }, rules, plan, settings });
check('week 7 unchanged', r.targets.back_squat.weight === 190 && r.targets.back_squat.reps === 4, r.targets.back_squat);
// transition into heavy (week 7 session -> next week 8)
check('week 7 -> heavy note present', r.lines.some(l => /weeks 8-11/.test(l.text)) === false, r.lines); // light week returns early, by design
r = applyProgression({ session: mkSession(6, [ws('back_squat', 190, 6, 8, [4, 6]), ws('back_squat', 190, 6, 8, [4, 6]), ws('back_squat', 190, 6, 8, [4, 6])]), targets: { back_squat: { weight: 190, reps: 4, stall: 0 } }, rules, plan, settings });
check('week 6 pass, 190 x 6 on a 190 x 4 target -> v1.18.16 two reps over: double step to 200 x 5 (no heavy switch yet, week 7 is light)', r.targets.back_squat.weight === 200 && r.targets.back_squat.reps === 5, r.targets.back_squat);
// power clean excluded
r = applyProgression({ session: mkSession(3, [ws('power_clean', 135, 2, 7, [2, 2]), ws('power_clean', 135, 2, 7, [2, 2]), ws('power_clean', 135, 2, 7, [2, 2]), ws('power_clean', 135, 2, 7, [2, 2])]), targets: { power_clean: { weight: 135, reps: 2 } }, rules, plan, settings });
check('v1.18.1 R4 rule 9: the power clean follows its doubles and is never raised by the app', r.targets.power_clean.weight === 135 && /never raises the clean/.test(r.lines[0].text), r.lines[0]);
r = applyProgression({ session: mkSession(1, [ws('power_clean', 155, 2, 8, [2, 2], { baseline: true }), ws('power_clean', 155, 2, 7, [2, 2])]), targets: {}, rules, plan, settings });
check('v1.18.1 R4 rule 9: a clean baseline of 155 is the target itself (no 90%)', r.targets.power_clean.weight === 155 && /That is the target/.test(r.lines[0].text), [r.targets.power_clean, r.lines[0].text]);
// v1.18.1 (R4 rule 7): the first heavy-week session of a main lift starts 5% over, at 3 reps, once
{
  const shown = (week, t) => buildTimeline({ plan, rules, settings, sessionId: 'lift1', week, targets: { back_squat: t } }).steps.find(s => s.exerciseId === 'back_squat' && s.kind === 'set' && !s.ramp).target;
  const w8 = shown(8, { weight: 185, reps: 5, stall: 2 });
  check('v1.18.1 R4 rule 7: week 8 shows the heavy start, 195 x 3 for a 185 x 5 target', w8.weight === 195 && w8.reps === 3, w8);
  const sets8 = [1, 2, 3, 4].map(() => ws('back_squat', 195, 3, 8, [3, 5]));
  const h = applyProgression({ session: mkSession(8, sets8), targets: { back_squat: { weight: 185, reps: 5, stall: 2 } }, rules, plan, settings });
  check('v1.18.1 R4 rule 7: that session is read against 195 x 3: next 200 x 3 (v1.18.6: a step every clean session), count 0, marked so it is not applied again', h.targets.back_squat.weight === 200 && h.targets.back_squat.reps === 3 && h.targets.back_squat.stall === 0 && h.targets.back_squat.heavyStart && h.targets.back_squat.heavyStart.week === 8 && h.targets.back_squat.heavyStart.from.weight === 185, h.targets.back_squat);
  const w9 = shown(9, h.targets.back_squat);
  check('v1.18.1 R4 rule 7: week 9 shows 200 x 3 (no second 5%)', w9.weight === 200 && w9.reps === 3, w9);
  const eff = effectiveTarget({ rules, plan, settings, exerciseId: 'power_clean', target: { weight: 155, reps: 2 }, phaseId: 'heavy' });
  check('v1.18.1 R4 rule 7: never on the clean', eff.weight === 155, eff);
  check('v1.18.1 R4 rule 12: the engine hands back each lift\'s target going in (null when it had none)', h.before.back_squat.weight === 185 && h.before.back_squat.stall === 2 && !h.before.back_squat.heavyStart
    && applyProgression({ session: mkSession(3, [ws('rdl', 155, 6, 8, [6, 8])]), targets: {}, rules, plan, settings }).before.rdl === null, h.before);
}
// weighted pull-up e1RM includes bodyweight
r = applyProgression({ session: mkSession(3, [ws('weighted_pullup', 25, 6, 8, [4, 6]), ws('weighted_pullup', 25, 6, 8, [4, 6]), ws('weighted_pullup', 25, 6, 8, [4, 6]), ws('weighted_pullup', 25, 6, 8, [4, 6])]), targets: { weighted_pullup: { weight: 25, reps: 6 } }, rules, plan, settings });
check('pull-up e1RM uses bodyweight (165+25)x1.2 = 228 -> 230 to 5 lb; v1.5 jump is 5 lb', r.e1rms.weighted_pullup === 230 && r.targets.weighted_pullup.weight === 30, { e: r.e1rms, t: r.targets.weighted_pullup });
check('epley 185x5 = 216 -> 215 (v1.18.10: estimates to the nearest 5 lb); 185x6 = 222 -> 220; 248 -> 250 never shows', epley(185, 5) === 215 && epley(185, 6) === 220 && [epley(225, 3), epley(212.5, 5), epley(100, 7)].every(v => v % 5 === 0));

// ---- v1.1: last-time data and PRs ----
console.log('v1.1: last time + PRs');
const prevSessions = [
  { date: '2026-11-23', sessionName: 'Lift 1: Legs', sets: [ws('back_squat', 165, 5, 8, [4, 6]), ws('back_squat', 165, 5, 8, [4, 6]), { exerciseId: 'back_squat', ramp: true, done: true, weight: 95, reps: 5 }, ws('rdl', 155, 7, 8, [6, 8])] },
  { date: '2026-11-16', sessionName: 'Lift 1: Legs', sets: [ws('back_squat', 160, 4, 8, [4, 6])] }
];
const hist = lastResults(prevSessions);
check('lastResults picks newest session, skips ramp-ups', hist.back_squat.sets.length === 2 && hist.back_squat.sets[0].weight === 165 && hist.rdl.sets.length === 1, hist);
const tlH = buildTimeline({ plan, rules, settings, sessionId: 'lift1', week: 3, targets, history: hist });
const sq = tlH.steps.find(s => s.exerciseId === 'back_squat' && s.kind === 'set' && !s.ramp);
check('work set carries last-time data', sq.last && sq.last.sets[0].weight === 165, sq.last);
check('ramp-up sets do not show last time', tlH.steps.filter(s => s.ramp).every(s => !s.last));
// engine PR tracking
r = applyProgression({ session: mkSession(3, [ws('back_squat', 185, 6, 8, [4, 6]), ws('back_squat', 185, 6, 8, [4, 6]), ws('back_squat', 185, 6, 7, [4, 6])]), targets: { back_squat: { weight: 185, reps: 6, stall: 0, bestE1rm: 200, bestWeight: 175 } }, rules, plan, settings });
check('engine reports e1RM and weight PRs', r.prs.length === 2 && r.prs.some(p => p.kind === 'e1rm' && p.value === 220) && r.prs.some(p => p.kind === 'weight' && p.value === 185), r.prs);
check('engine stores new bests', r.targets.back_squat.bestE1rm === 220 && r.targets.back_squat.bestWeight === 185, r.targets.back_squat);
r = applyProgression({ session: mkSession(1, [ws('back_squat', 185, 5, 8, [5, 5], { baseline: true }), ws('back_squat', 165, 4, 7, [4, 6])]), targets: {}, rules, plan, settings });
check('no PR reported when there was no previous best', r.prs.length === 0 && r.targets.back_squat.bestE1rm === 215, { prs: r.prs, t: r.targets.back_squat });
check('checkPR live: 190x5 beats e1RM 216', checkPR({ bestE1rm: 216, bestWeight: 185 }, 190, 5, 0).join(',') === 'e1rm,weight');
check('checkPR live: nothing without prior bests', checkPR({}, 190, 5, 0).length === 0);
check('checkPR live: pull-up adds bodyweight', checkPR({ bestE1rm: 228 }, 27.5, 6, 165).join(',') === 'e1rm');

// ---- v1.4: set timing, lead-ins, effort words, starting estimates ----
console.log('v1.4: timing, lead-ins, effort, estimates');
for (const [sid, wk, tg] of [['lift1', 1, {}], ['lift2', 1, {}], ['lift3', 1, {}], ['lift1', 3, targets], ['lift2', 3, targets], ['lift3', 3, targets], ['lift1', 7, targets], ['lift2', 12, targets]]) {
  const tl = buildTimeline({ plan, rules, settings, sessionId: sid, week: wk, targets: tg });
  const bad = tl.steps.filter((s, i) => s.kind === 'set' && !(i > 0 && ['rest', 'transition'].includes(tl.steps[i - 1].kind) && tl.steps[i - 1].countdown && tl.steps[i - 1].seconds >= rules.timing.getReadySeconds + 3));
  check(`${sid} week ${wk}: every set follows a countdown long enough for the get-ready count`, bad.length === 0, bad.map(s => s.name));
  check(`${sid} week ${wk}: idx matches position`, tl.steps.every((s, i) => s.idx === i));
}
const sqT = setTiming(rules, plan.exercises.back_squat, 5, false);
check('squat 5 reps at 6 s per rep = 6 + 30 x 1.1 = 39 s', sqT.seconds === 39 && sqT.repSeconds === 6, sqT);
const bssT = setTiming(rules, plan.exercises.bss, 8, true);
check('split squat 8/side: both sides and the switch are counted', bssT.seconds === Math.round(4 + (8 * 4.5 * 2 + 8) * 1.1), bssT);
const w3sets = w3.steps.filter(s => s.kind === 'set' && !s.holdSeconds);
check('work and ramp-up sets carry auto, repSeconds and equipment', w3sets.every(s => s.auto && s.repSeconds > 0 && s.equipment), w3sets.filter(s => !s.auto).map(s => s.name));
check('baseline sets stay manual', l1.steps.filter(s => s.baseline).every(s => !s.auto));
const firstSq = w3.steps.findIndex(s => s.exerciseId === 'back_squat');
check('barbell first set: the transition before it is the barbell set-up time', w3.steps[firstSq - 1].kind === 'transition' && w3.steps[firstSq - 1].seconds === rules.timing.firstSetSetupSeconds.barbell, w3.steps[firstSq - 1]);
check('work sets carry focus tips', w3.steps.filter(s => s.kind === 'set' && !s.ramp).every(s => s.tips && s.tips.length >= 1));
check('every exercise has tips; every non-timed one has a 4-part tempo', Object.values(plan.exercises).every(e => e.tips && e.tips.length && (e.timed || (e.tempo && e.tempo.length === 4))));
check('curl has a specific name', plan.exercises.curl.name === 'Standing dumbbell curl');
const trimmed = trimToFit({ steps: base.steps, fromIdx, overBySeconds: 600, rules });
check('trim drops a finisher round together with its switch steps', trimmed.steps.every((s, i) => s.kind !== 'set' || ['rest', 'transition'].includes(trimmed.steps[i - 1].kind)) && !trimmed.steps.some((s, i) => s.kind === 'transition' && s.lead && (!trimmed.steps[i + 1] || trimmed.steps[i + 1].kind !== 'set')), trimmed.notes);
check('effort words: RPE 7-8 -> leave 2-3', effortPlain({ kind: 'rpe', min: 7, max: 8 }) === 'Leave 2-3 in the tank');
check('effort words: 0-1 left -> push close', effortPlain({ kind: 'rir', min: 0, max: 1 }) === 'Push close: 0-1 left');
check('effort words: 2 left', effortPlain({ kind: 'rir', min: 2, max: 2 }) === 'Leave 2 in the tank');
check('effort levels: 6 easy, 7.5 and 8 and 8.5 solid, 9 and 9.5 hard, 10 maxed', [6, 7.5, 8, 8.5, 9, 9.5, 10].map(x => effortLevel(rules, x).key).join(',') === 'easy,solid,solid,solid,hard,hard,maxed');
check('effort buttons store RPE 6, 8, 9, 10; Solid passes the main-lift test', rules.effortScale.levels.map(l => l.rpe).join(',') === '6,8,9,10' && rules.effortScale.levels[1].rpe <= rules.mainLiftTest.maxRpe);
check('estimate: RDL from squat 185 -> 140', estimateStart(rules, 'rdl', { back_squat: { weight: 185 } }, settings) === 140, estimateStart(rules, 'rdl', { back_squat: { weight: 185 } }, settings));
check('v1.5 estimate: curl from bodyweight 165 -> 50 total (2 x 25)', estimateStart(rules, 'curl', {}, settings, plan.exercises.curl) === 50, estimateStart(rules, 'curl', {}, settings, plan.exercises.curl));
check('v1.5 estimate: one-dumbbell lift is not doubled', estimateStart(rules, 'oh_tri_ext', {}, settings, plan.exercises.oh_tri_ext) === 40, estimateStart(rules, 'oh_tri_ext', {}, settings, plan.exercises.oh_tri_ext));
check('v1.5 pair lifts are marked in the plan', ['bss', 'curl', 'incline_db_press', 'lateral_raise', 'incline_curl'].every(id => plan.exercises[id].pair) && !plan.exercises.db_row.pair && !plan.exercises.oh_tri_ext.pair);
check('v1.5 every curl is named by type', ['Standing dumbbell curl', 'Incline dumbbell curl', 'Dumbbell preacher curl'].join() === [plan.exercises.curl.name, plan.exercises.incline_curl.name, plan.exercises.preacher_curl.name].join());
check('estimate: none for machines, none without a base lift', estimateStart(rules, 'leg_curl', {}, settings) === null && estimateStart(rules, 'rdl', {}, settings) === null);
check('spoken duration', spokenDuration(165) === '2 minutes 45 seconds' && spokenDuration(60) === '1 minute' && spokenDuration(30) === '30 seconds');

// ---- v1.6 Progress page helpers ----
{
  const set = (exerciseId, weight, reps, extra = {}) => ({ exerciseId, weight, reps, done: true, ...extra });
  const sess = [
    { id: 'b', sessionId: 'lift1', week: 2, date: '2026-11-24', startedAt: '2026-11-24T06:00:00', status: 'complete', sets: [set('back_squat', 135, 5, { ramp: true }), set('back_squat', 190, 5), set('back_squat', 190, 4), set('leg_curl', 80, 12), set('back_squat', 250, 1, { skipped: true })], prs: [{ exerciseId: 'back_squat', name: 'Back squat', kind: 'e1rm', value: 222, prev: 216 }] },
    { id: 'a', sessionId: 'lift1', week: 1, date: '2026-11-17', startedAt: '2026-11-17T06:00:00', status: 'complete', sets: [set('back_squat', 185, 5), set('back_squat', 185, 5), set('leg_curl', 70, 12), set('leg_curl', 70, 10)], prs: [] },
    { id: 'c', sessionId: 'lift2', week: 1, date: '2026-11-18', startedAt: '2026-11-18T06:00:00', status: 'ended_early', sets: [set('weighted_pullup', 25, 5), set('curl', 50, 10), set('strict_press', null, null, { blockId: 'A', done: false, skipped: true })], prs: [] }
  ];
  const st = { ...settings, startDate: '2026-11-16', bodyweightLb: 165 };
  const series = strengthSeries(sess, plan, st);
  const sq = series.find(x => x.id === 'back_squat');
  check('v1.6 strength: one point per session, oldest first, best work set only', sq.points.length === 2 && sq.points[0].date === '2026-11-17' && sq.points[0].e1rm === epley(185, 5) && sq.points[1].e1rm === epley(190, 5), sq.points);
  check('v1.6 strength: change since the first session', sq.delta === epley(190, 5) - epley(185, 5) && sq.pct > 0, [sq.delta, sq.pct]);
  const pu = series.find(x => x.id === 'weighted_pullup');
  check('v1.6 strength: weighted pull-up counts bodyweight', pu.addsBodyweight && pu.points[0].e1rm === epley(190, 5), pu.points);
  check('v1.6 strength: lifts with nothing logged are left out', !series.some(x => x.id === 'power_clean'));
  const a = adherence(sess, plan, st, new Date(2026, 10, 30, 8));
  const row = id => a.rows.find(r => r.id === id).cells.map(c => c.status).join(',');
  check('v1.6 status: week 3, lift 1 done twice then open', a.current === 3 && row('lift1').startsWith('done,done,open,later'), row('lift1'));
  check('v1.6 status: ended-early counts as partial, an empty past week as missed', row('lift2').startsWith('partial,missed,open,later') && row('lift3').startsWith('missed,missed,open'), [row('lift2'), row('lift3')]);
  check('v1.6 status: totals', a.logged === 3 && a.missed === 3, [a.logged, a.missed]);
  const wk = weeklySets(sess);
  check('v1.6 weekly sets: ramp-ups and skipped sets do not count', wk.length === 12 && wk[0].sets === 6 && wk[0].sessions === 2 && wk[1].sets === 3 && wk[2].sets === 0, wk.slice(0, 3));
  const acc = accessoryRows(sess, plan);
  const lc = acc.find(r => r.id === 'leg_curl');
  check('v1.6 accessories: first and latest top set', lc.sessions === 2 && lc.first.weight === 70 && lc.first.reps === 12 && lc.last.weight === 80 && !acc.some(r => r.id === 'back_squat'), lc);
  check('v1.6 PR list: newest first with the date', prList(sess).length === 1 && prList(sess)[0].date === '2026-11-24');
  check('v1.6 chart ticks: three clean numbers that hold every value', yTicks([216, 222]).join() === '215,220,225' && yTicks([200]).join() === '195,200,205' && yTicks([201, 214]).join() === '200,210,220', [yTicks([216, 222]), yTicks([200]), yTicks([201, 214])]);
}

// ---- v1.7 sync helpers ----
check('v1.7 repo name: owner/name, URL and clone forms', parseRepo('cam/training-data') === 'cam/training-data' && parseRepo(' https://github.com/cam/training-data/ ') === 'cam/training-data' && parseRepo('git@github.com:cam/training-data.git') === 'cam/training-data');
check('v1.7 repo name: junk is refused', parseRepo('training-data') === null && parseRepo('https://example.com/a/b') === null && parseRepo('') === null);
check('v1.7 base64 survives accents and long text', fromBase64(toBase64('Renée × 3 – ' + 'x'.repeat(100000))) === 'Renée × 3 – ' + 'x'.repeat(100000));
{
  const link = setupLink('https://example.github.io/app/#old', { repo: 'cam/training-data', token: 'github_pat_ABC-123_xyz' });
  const back = readSetupLink(link.slice(link.indexOf('#')));
  check('v1.7 set-up link: repo and token ride after the #, and read back', link.startsWith('https://example.github.io/app/#sync=') && !link.includes('github_pat') && back.repo === 'cam/training-data' && back.token === 'github_pat_ABC-123_xyz', link);
  check('v1.7 set-up link: anything else in the address is ignored', readSetupLink('') === null && readSetupLink('#sync=notjson') === null && readSetupLink('#other=1') === null);
}
check('v1.7 GitHub errors are explained', explainStatus(401).includes('token') && explainStatus(404).includes('repo'));

// ---- v1.9: muscle sets, coach check-ins, rest adjustments ----
console.log('v1.9 muscle groups and coach check-ins');
{
  const muscles = JSON.parse(readFileSync(new URL('../data/muscles.json', import.meta.url)));
  const planIds = new Set(); for (const s of plan.sessions) for (const b of s.blocks) for (const it of b.items || []) if (it.exercise) planIds.add(it.exercise);
  check('v1.9 muscles: every exercise in the plan has muscle groups', [...planIds].every(id => muscles.exercises[id]), [...planIds].filter(id => !muscles.exercises[id]));
  const groupIds = new Set(muscles.groups.map(g => g.id));
  check('v1.9 muscles: every group named is a known group', Object.values(muscles.exercises).every(m => [...(m.main || []), ...(m.helper || [])].every(g => groupIds.has(g))));
  const sess = [{ week: 2, sets: [{ exerciseId: 'curl', done: true }, { exerciseId: 'curl', done: true }, { exerciseId: 'cs_row', done: true }, { exerciseId: 'curl', done: true, ramp: true }, { exerciseId: 'curl', done: false }] }, { week: 1, sets: [{ exerciseId: 'curl', done: true }] }];
  const rows = muscleSets(sess, plan, muscles, 2);
  const bi = rows.find(r => r.id === 'biceps');
  check('v1.9 muscles: main counts 1, helper half, ramp-ups and undone sets do not count', bi.done === 2.5 && bi.lastWeek === 1 && rows.find(r => r.id === 'back').done === 1, bi);
  check('v1.9 muscles: biceps get planned sets from the curls and rows in the plan', bi.planned >= 9, bi.planned);

  const targets = { incline_db_press: { weight: 90, reps: 8 }, back_squat: { weight: 185, reps: 4 } };
  const heavy = changesFor({ exerciseId: 'incline_db_press', tags: ['too_heavy'] }, { plan, rules, targets, restAdjust: {} });
  check('v1.9 check-in: Too heavy drops a pair lift one step (total of both dumbbells)', heavy.length === 1 && heavy[0].kind === 'weight' && heavy[0].to < 90 && heavy[0].to >= 80, heavy);
  const light = changesFor({ exerciseId: 'back_squat', tags: ['too_light'] }, { plan, rules, targets, restAdjust: {} });
  check('v1.9 check-in: Too light adds one step to the squat', light.length === 1 && light[0].to > 185 && light[0].to <= 195, light);
  check('v1.9 check-in: no target, no weight change, and the reply says why', changesFor({ exerciseId: 'rdl', tags: ['too_heavy'] }, { plan, rules, targets, restAdjust: {} }).length === 0 && replyFor({ exerciseId: 'rdl', tags: ['too_heavy'] }, [], plan).includes('No target'));
  const rest = changesFor({ exerciseId: 'cs_row', tags: ['rest_long'] }, { plan, rules, targets, restAdjust: { cs_row: -30 } });
  check('v1.9 check-in: Rest too long takes 15 s more off, up to 45 s', rest.length === 1 && rest[0].to === -45, rest);
  check('v1.9 check-in: rest stops at the 45 s limit', changesFor({ exerciseId: 'cs_row', tags: ['rest_long'] }, { plan, rules, targets, restAdjust: { cs_row: -45 } }).length === 0);
  check('v1.9 check-in: rest never goes under 15 s (RDL rests 30 s)', changesFor({ exerciseId: 'rdl', tags: ['rest_long'] }, { plan, rules, targets, restAdjust: { rdl: -15 } }).length === 0);
  const sessRest = changesFor({ sessionId: 'lift2', tags: ['rest_short'] }, { plan, rules, targets, restAdjust: {} });
  check('v1.9 check-in: a rest tag on a whole session moves that session', sessRest.length === 1 && sessRest[0].key === 'session:lift2' && sessRest[0].to === 15, sessRest);
  check('v1.9 check-in: Pain and Slept badly change nothing and answer in words', changesFor({ exerciseId: 'back_squat', tags: ['pain', 'tired'] }, { plan, rules, targets }).length === 0 && replyFor({ tags: ['pain', 'tired'] }, [], plan).includes('short version'));

  const lift2 = plan.sessions.find(s => s.id === 'lift2');
  const adj = applyRestAdjust(lift2, { cs_row: -15, 'session:lift2': 10, oh_tri_ext: 20 });
  const row = adj.blocks.flatMap(b => b.items || []).find(i => i.exercise === 'cs_row');
  const orig = lift2.blocks.flatMap(b => b.items || []).find(i => i.exercise === 'cs_row');
  check('v1.9 rest: exercise and session offsets add up, plan left as it was', row.restSeconds === orig.restSeconds - 5 && orig.restSeconds === 75, [row.restSeconds, orig.restSeconds]);
  const fin = adj.blocks.find(b => b.id === 'finisher'), finOrig = lift2.blocks.find(b => b.id === 'finisher');
  check('v1.9 rest: a finisher exercise moves its round rest', fin.roundRestSeconds === finOrig.roundRestSeconds + 30, [fin.roundRestSeconds, finOrig.roundRestSeconds]);
  const tl0 = buildTimeline({ plan, rules, settings, sessionId: 'lift2', week: 3, targets: {} });
  const tl1 = buildTimeline({ plan, rules, settings: { ...settings, restAdjust: { 'session:lift2': -15 } }, sessionId: 'lift2', week: 3, targets: {} });
  check('v1.9 rest: shorter rests make a shorter session', tl1.plannedSeconds < tl0.plannedSeconds, [tl0.plannedSeconds, tl1.plannedSeconds]);

  const file = { messages: [{ id: 'm1', at: '2026-11-18T03:00:00Z', text: 'Nice work.' }], adjustments: [{ id: 'a1', exerciseId: 'curl', weight: 50 }, { id: 'a2', exerciseId: 'nope', weight: 5 }, { id: 'a3', sessionId: 'lift1', restDelta: -15 }, { id: 'a4', exerciseId: 'curl', weight: 55 }] };
  const pend = pendingAdjustments(file, ['a4'], plan);
  check('v1.9 coach file: unknown lifts and applied ones are skipped', pend.map(a => a.id).join() === 'a1,a3', pend);
  check('v1.9 coach file: rest offsets stay inside 45 s', withRest({}, 'x', -90).x === -45 && !('x' in withRest({ x: 15 }, 'x', 0)));
  const th = thread([{ id: 'c1', at: '2026-11-18T02:00:00Z', text: 'Heavy', reply: 'Dropped.' }], file);
  check('v1.9 thread: check-in, app answer and coach reply in time order', th.map(m => m.from).join() === 'you,app,coach', th);
}

// ---- v1.8 catch-up day ----
{
  const S = (exerciseId, blockId, extra = {}) => ({ exerciseId, blockId, name: exerciseId, ramp: false, weight: 100, reps: 8, rpe: 8, done: true, skipped: false, repRange: [6, 8], ...extra });
  const skip = { done: false, skipped: true, weight: null, reps: null };
  const lift1 = { id: 'r1', sessionId: 'lift1', week: 3, date: '2026-11-30', startedAt: '2026-11-30T13:00:00Z', status: 'ended_early', whatChanged: [{ exerciseId: 'rdl', reason: 'a set was skipped' }], sets: [
    S('back_squat', 'A', { ramp: true, ...skip }), S('back_squat', 'A'), S('back_squat', 'A'), S('back_squat', 'A'),
    S('rdl', 'B'), S('calf_raise', 'B', skip), S('rdl', 'B'), S('calf_raise', 'B', skip), S('rdl', 'B', skip), S('calf_raise', 'B', skip),
    S('bss', 'C'), S('leg_curl', 'C'), S('bss', 'C'), S('leg_curl', 'C'), S('bss', 'C'), S('leg_curl', 'C'),
    S('curl', 'finisher'), S('oh_tri_ext', 'finisher'), S('ab_wheel', 'finisher'), S('curl', 'finisher'), S('oh_tri_ext', 'finisher'), S('ab_wheel', 'finisher'),
    S('curl', 'finisher', skip), S('oh_tri_ext', 'finisher', skip), S('ab_wheel', 'finisher')
  ] };
  const thu = new Date(2026, 11, 3, 8); // Thursday of week 3, a Slack day
  const owed = weekOwed({ plan, sessions: [lift1], week: 3, today: thu });
  const l1 = owed.lifts.find(l => l.id === 'lift1');
  const item = id => l1.blocks.flatMap(b => b.items).find(i => i.exerciseId === id);
  check('v1.8 owed: skipped sets are counted per exercise, ramp-ups are not', l1.sets === 6 && item('rdl').sets === 1 && item('calf_raise').sets === 3 && item('curl').sets === 1 && item('oh_tri_ext').sets === 1 && !item('back_squat'), l1);
  check('v1.8 owed: knows which exercises the session already logged (v1.18.1: no undoStall)', item('rdl').hadDone && !('undoStall' in item('rdl')) && !item('calf_raise').hadDone);
  check('v1.8 owed: a lift whose day passed with nothing logged is missed; a later one is not', owed.missed.join() === 'lift2' && owed.lifts.find(l => l.id === 'lift2').day === 'Wednesday' && !owed.lifts.some(l => l.id === 'lift3'), owed.missed);
  check('v1.8 owed: other weeks owe nothing', weekOwed({ plan, sessions: [lift1], week: 4, today: new Date(2026, 11, 7, 8) }).totalSets === 0);
  check('v1.8 Slack days come from the calendar', slackDays(plan).join() === 'Thursday,Sunday' && plannedDay(plan, 'lift3').name === 'Friday', slackDays(plan));
  check('v1.8 owed lines read plainly', owedLines(owed)[0].short === 'Legs' && owedLines(owed)[0].text.startsWith('Romanian deadlift 1 set, Standing calf raise 3 sets'), owedLines(owed));

  const cu = buildCatchUpSession(plan, rules, owed);
  check('v1.8 catch-up session: warm-up, the owed blocks in plan order, stretch', cu.blocks.map(b => `${b.id}/${b.type}`).join() === 'warmup/warmup,lift1:B/superset,lift1:finisher/finisher,stretch/stretch', cu.blocks.map(b => `${b.id}/${b.type}`));
  const tlc = buildTimeline({ plan, rules, settings, session: cu, week: 3, targets: { rdl: { weight: 150, reps: 6 }, calf_raise: { weight: 140, reps: 10 }, curl: { weight: 50, reps: 10 }, oh_tri_ext: { weight: 40, reps: 10 } } });
  const sets = tlc.steps.filter(s => s.kind === 'set' && !s.ramp);
  check('v1.8 catch-up timeline: exactly the owed sets, tagged with the lift they came from', sets.length === 6 && sets.filter(s => s.exerciseId === 'calf_raise').length === 3 && sets.every(s => s.blockId.startsWith('lift1:')) && tlc.sessionId === 'catchup' && tlc.catchUp, sets.map(s => [s.exerciseId, s.blockId]));
  check('v1.8 catch-up timeline: every set still gets a get-ready count, and it is short', tlc.plannedSeconds / 60 < 25 && tlc.steps.filter(s => s.kind === 'stretch').length === 4, tlc.plannedSeconds / 60);
  const onlyCalf = buildCatchUpSession(plan, rules, { lifts: [{ id: 'lift1', short: 'Legs', sets: 2, blocks: [{ blockId: 'B', items: [{ exerciseId: 'calf_raise', sets: 2, hadDone: true, undoStall: false }] }] }] });
  const b = onlyCalf.blocks[1];
  check('v1.8 a superset with one exercise left becomes straight sets with a full rest', b.type === 'straight' && b.items.length === 1 && b.items[0].sets === 2 && b.items[0].restSeconds >= 75, b);
  check('v1.8 nothing owed, no catch-up session', buildCatchUpSession(plan, rules, { lifts: [{ id: 'lift2', missed: true, sets: 0, blocks: [] }] }) === null);
  const w7 = buildTimeline({ plan, rules, settings, session: cu, week: 7, targets: {} });
  check('v1.8 lighter week does not halve owed sets again', w7.steps.filter(s => s.kind === 'set' && s.exerciseId === 'calf_raise').length === 3);

  // the catch-up gets logged: sets made up come off the list, and targets move only for exercises not logged before
  const made = { id: 'c1', sessionId: 'catchup', week: 3, date: '2026-12-03', startedAt: '2026-12-03T13:00:00Z', endedAt: '2026-12-03T13:30:00Z', status: 'complete', catchUp: true, catchUpInfo: cu.catchUpInfo, phase: { id: 'build' }, sets: [
    S('rdl', 'lift1:B', { weight: 150, reps: 8, repRange: [6, 8] }),
    S('calf_raise', 'lift1:B', { weight: 140, reps: 15, repRange: [10, 15] }), S('calf_raise', 'lift1:B', { weight: 140, reps: 15, repRange: [10, 15] }), S('calf_raise', 'lift1:B', { weight: 140, reps: 15, repRange: [10, 15] }),
    S('curl', 'lift1:finisher', { weight: 50, reps: 12, repRange: [10, 12] }), S('oh_tri_ext', 'lift1:finisher', skip)
  ] };
  const after = weekOwed({ plan, sessions: [lift1, made], week: 3, today: thu });
  check('v1.8 made-up sets come off the list; one skipped again stays', after.lifts.find(l => l.id === 'lift1').sets === 1 && owedSetsFor(plan, [lift1, made], 'lift1', 3) === 1, after.lifts.find(l => l.id === 'lift1'));
  const res = applyProgression({ session: made, targets: { rdl: { weight: 150, reps: 7, stall: 1 }, calf_raise: { weight: 140, reps: 10, stall: 0 }, curl: { weight: 50, reps: 11 } }, rules, plan, settings });
  const line = id => res.lines.find(l => l.exerciseId === id);
  check('v1.18.1 catch-up sets for a lift already logged do not move its target or its flat count (R4 rule 11)', res.targets.rdl.weight === 150 && res.targets.rdl.reps === 7 && res.targets.rdl.stall === 1 && line('rdl').reason === 'catch-up sets', [res.targets.rdl, line('rdl')]);
  check('v1.8 an exercise done only on the catch-up day progresses as usual', res.targets.calf_raise.weight > 140 && line('calf_raise').verdict === 'up', [res.targets.calf_raise, line('calf_raise')]);
  const a2 = adherence([lift1, made, { ...made, id: 'c2', sets: [S('oh_tri_ext', 'lift1:finisher')] }], plan, { ...settings, startDate: '2026-11-16' }, thu);
  const a1 = adherence([lift1, made], plan, { ...settings, startDate: '2026-11-16' }, thu);
  check('v1.8 Progress: ended early stays partial until everything is made up, then counts as done', a1.rows[0].cells[2].status === 'partial' && a2.rows[0].cells[2].status === 'done', [a1.rows[0].cells[2], a2.rows[0].cells[2]]);
  // v1.15: Cameron's week-1 Upper day ended early in a block the plan later dropped (the old Wednesday "last" block),
  // so nothing is owed for it; it was still ended early, not done
  const oldBlock = { id: 'u1', sessionId: 'lift2', week: 1, date: '2026-11-18', status: 'ended_early', sets: [
    S('strict_press', 'A', { weight: 95, reps: 5 }), S('t2b', 'last', { reps: 8 }), S('t2b', 'last', skip), S('face_pull', 'last', skip)] };
  const a3 = adherence([oldBlock], plan, { ...settings, startDate: '2026-11-16' }, thu);
  check('v1.15 Progress: ended early in a block no longer in the plan still shows as ended early', owedSetsFor(plan, [oldBlock], 'lift2', 1) === 0 && a3.rows[1].cells[0].status === 'partial', a3.rows[1].cells[0]);
  const mon = { id: 'm1', sessionId: 'lift1', week: 1, date: '2026-11-16', status: 'ended_early', sets: [S('back_squat', 'A', skip), S('back_squat', 'A', skip), S('rdl', 'B', skip)] };
  const tue = { id: 'm2', sessionId: 'lift1', week: 1, date: '2026-11-17', status: 'complete', sets: [S('back_squat', 'A'), S('back_squat', 'A'), S('rdl', 'B')] };
  const twice = weekOwed({ plan, sessions: [mon, tue], week: 1, today: thu });
  check('v1.15 catch-up: a lift ended early and then done in full the next day owes nothing', !twice.lifts.some(l => l.id === 'lift1') && owedSetsFor(plan, [mon, tue], 'lift1', 1) === 0, twice.lifts);
  const halfTue = { ...tue, id: 'm3', status: 'ended_early', sets: [S('back_squat', 'A'), S('back_squat', 'A', skip), S('rdl', 'B', skip)] };
  check('v1.15 catch-up: two partial attempts owe what the better one left', owedSetsFor(plan, [mon, halfTue], 'lift1', 1) === 2, weekOwed({ plan, sessions: [mon, halfTue], week: 1, today: thu }).lifts);
}

// ---- v1.16: numbers that look wrong ----
{
  const sq = plan.exercises.back_squat, lr = plan.exercises.lateral_raise, bss = plan.exercises.bss, curl = plan.exercises.leg_curl;
  const set = (extra = {}) => ({ exerciseId: 'back_squat', done: true, skipped: false, ramp: false, repRange: [4, 6], target: { weight: 170, reps: 4 }, weight: 170, reps: 4, ...extra });
  const code = (st, ex = sq) => (numberFlag(st, ex, rules) || {}).code || null;
  check('v1.16 flag: a barbell weight under the empty bar', code(set({ weight: 5, target: { weight: null } })) === 'under-bar' && code(set({ weight: 45 })) !== 'under-bar');
  check('v1.16 flag: half the target or less, and half again over it', code(set({ weight: 85 })) === 'light' && code(set({ weight: 255 })) === 'heavy' && code(set({ weight: 175 })) === null && code(set({ weight: 120 })) === null);
  check('v1.16 flag: small weights need a real gap (a 10 lb lateral raise at 15 is fine)', code({ ...set(), exerciseId: 'lateral_raise', repRange: [12, 15], target: { weight: 10, reps: 12 }, weight: 15, reps: 12 }, lr) === null);
  const one = numberFlag({ ...set(), exerciseId: 'bss', repRange: [8, 10], target: { weight: 70, reps: 8 }, weight: 35, reps: 8 }, bss, rules);
  check('v1.16 flag: a two-dumbbell lift at exactly half asks if it was one dumbbell', one && one.short === 'one dumbbell?', one);
  check('v1.16 flag: far more reps than planned, and 0 reps', code(set({ reps: 40 })) === 'reps' && code(set({ reps: 0 })) === 'reps' && code(set({ reps: 6 })) === null);
  check('v1.16 flag: no target and over 500 lb', code({ ...set(), exerciseId: 'leg_curl', target: { weight: null }, weight: 1000, repRange: [8, 12] }, curl) === 'heavy');
  check('v1.16 flag: ramp-ups, skipped sets and confirmed numbers are never flagged', code(set({ weight: 5, ramp: true })) === null && code(set({ weight: 5, skipped: true })) === null && code(set({ weight: 5, numberOk: true })) === null);
  // v1.18: reps below 0 or part of a rep were saved without a flag (the hands-on test logged -2 and 2.5 reps)
  check('v1.18 flag: reps below 0 and part of a rep', code(set({ reps: -2 })) === 'reps' && code(set({ reps: 2.5 })) === 'reps' && numberFlag(set({ reps: 2.5 }), sq, rules).short === 'part of a rep');
  check('v1.18 flag: a weight below 0 on a dumbbell lift', code({ ...set(), exerciseId: 'lateral_raise', repRange: [12, 15], target: { weight: null }, weight: -10, reps: 12 }, lr) === 'negative');
  const lrSet = w => ({ ...set(), exerciseId: 'lateral_raise', repRange: [12, 15], target: { weight: null }, weight: w, reps: 12 });
  const calf = plan.exercises.calf_raise;
  check('v1.18 flag: 0 lb or under 2.5 lb on a dumbbell, machine or cable lift, with no target or a small one (independent review)',
    code(lrSet(0), lr) === 'light' && numberFlag(lrSet(0), lr, rules).text === '0 lb on a lift that uses weight'
    && code({ ...lrSet(0), target: { weight: 10, reps: 12 } }, lr) === 'light'
    && code({ ...lrSet(0.5), exerciseId: 'calf_raise' }, calf) === 'light'
    && code(lrSet(5), lr) === null && code({ ...lrSet(2.5), exerciseId: 'calf_raise' }, calf) === null);
  const pu = plan.exercises.weighted_pullup;
  check('v1.18 refused where typed: reps below 0, part of a rep, a weight below 0 (on a pull-up added weight may be below 0)',
    impossibleNumber({ weight: 185, reps: -2 }, sq) !== '' && impossibleNumber({ weight: 185, reps: 2.5 }, sq) === 'Reps are whole numbers' && impossibleNumber({ weight: -5, reps: 5 }, sq) !== ''
    && impossibleNumber({ weight: -20, reps: 5 }, pu) === '' && impossibleNumber({ weight: 185, reps: 5 }, sq) === '' && impossibleNumber({ weight: null, reps: null }, sq) === ''
    && impossibleNumber({ reps: 22.5 }, sq, { hold: true }) === '' && impossibleNumber({ reps: -1 }, sq, { hold: true }) !== '' && impossibleNumber({ weight: 187.5, reps: 5 }, sq) === '');

  // Cameron's Nov 17 Legs: baseline saved as 5 x 5, then 10 x 4 three times; he lifted 195
  const S = (w, extra = {}) => set({ weight: w, rpe: 8, blockId: 'A', ...extra });
  const nov17 = { id: 'n17', sessionId: 'lift1', week: 1, date: '2026-11-17', startedAt: '2026-11-17T17:00:00Z', endedAt: '2026-11-17T18:00:00Z', status: 'complete', phase: { id: 'baseline' },
    sets: [S(5, { baseline: true, repRange: [5, 5], reps: 5, target: { weight: null, reps: 5 }, setIndex: 0 }), S(10, { target: { weight: 5, reps: 4 }, setIndex: 1 }), S(10, { target: { weight: 10, reps: 4 }, setIndex: 2 }), S(10, { target: { weight: 10, reps: 4 }, setIndex: 3 }),
      { exerciseId: 'rdl', done: true, ramp: false, repRange: [6, 8], target: { weight: null }, weight: 195, reps: 6, rpe: 8, blockId: 'B' }],
    whatChanged: [{ exerciseId: 'back_squat', text: 'Back squat baseline: 5 lb x 5. Training weight 5 lb through week 2.' }, { exerciseId: 'rdl', text: 'RDL line' }], e1rms: { back_squat: 11 }, prs: [] };
  const g = flaggedGroups([nov17], plan, rules);
  check('v1.16 saved sets: one group for the squat, all four sets offered, the RDL left alone', g.length === 1 && g[0].exerciseId === 'back_squat' && g[0].flagged.length === 4 && g[0].sets.join() === '0,1,2,3', g);
  const tgt = { back_squat: { weight: 5, reps: 4, source: 'baseline', e1rm: 11, bestE1rm: 11, bestWeight: 10, baselineWeight: 5 } };
  const fix = applyNumberFix({ sessions: [nov17], targets: tgt, recordId: 'n17', exerciseId: 'back_squat', weights: { 0: 195, 1: 195, 2: 195, 3: 195 }, checked: [0, 1, 2, 3], plan, rules, settings });
  check('v1.16 fix: the target is worked out again from 195 (90% of the baseline, 175 x 4)', fix.retargeted && fix.target.weight === 175 && fix.target.reps === 4 && fix.target.baselineWeight === 195, fix.target);
  check('v1.16 fix: records and e1RM come from the right numbers', fix.target.bestWeight === 195 && fix.target.bestE1rm === epley(195, 5) && fix.record.e1rms.back_squat === epley(195, 5), [fix.target, fix.record.e1rms]);
  check('v1.16 fix: what-changed says so, in place, other lines kept; input not changed', fix.record.whatChanged[0].text.includes('195') && fix.record.whatChanged[0].text.includes('corrected') && fix.record.whatChanged[1].text === 'RDL line' && nov17.sets[0].weight === 5, fix.record.whatChanged);
  check('v1.16 fix: nothing flagged afterwards', flaggedGroups([fix.record], plan, rules).length === 0);
  const kept = applyNumberFix({ sessions: [nov17], targets: tgt, recordId: 'n17', exerciseId: 'back_squat', weights: {}, checked: [0, 1, 2, 3], plan, rules, settings });
  check('v1.16 It\'s right: numbers stay and are not flagged again', kept.record.sets[0].weight === 5 && flaggedGroups([kept.record], plan, rules).length === 0);
  const later = { ...nov17, id: 'n24', date: '2026-11-24', startedAt: '2026-11-24T17:00:00Z', endedAt: '2026-11-24T18:00:00Z', sets: [S(180, { target: { weight: 175, reps: 4 } })], whatChanged: [] };
  const old = applyNumberFix({ sessions: [later, nov17], targets: { back_squat: { weight: 185, reps: 4, source: 'engine' } }, recordId: 'n17', exerciseId: 'back_squat', weights: { 0: 195, 1: 195, 2: 195, 3: 195 }, checked: [0, 1, 2, 3], plan, rules, settings });
  check('v1.16 fix of an older session keeps the newer target but updates the records', !old.retargeted && old.target.weight === 185 && old.target.bestWeight === 195, old.target);
  const hand = applyNumberFix({ sessions: [nov17], targets: { back_squat: { weight: 150, reps: 5, source: 'you', updated: '2026-11-18T09:00:00Z' } }, recordId: 'n17', exerciseId: 'back_squat', weights: { 0: 195 }, checked: [0], plan, rules, settings });
  check('v1.16 fix keeps a target set by hand after that session', !hand.retargeted && hand.target.weight === 150 && hand.target.source === 'you', hand.target);
}

// ---- v1.18.1 (rules R4, rule 12): a correction or a late rating re-runs the session from the target it had going in ----
{
  const W = (weight, reps, rpe, extra = {}) => ({ exerciseId: 'back_squat', name: 'Back squat', done: true, skipped: false, ramp: false, repRange: [4, 6], weight, reps, rpe, blockId: 'A', ...extra });
  const mkRec = (id, week, sets, start, phase = 'build') => ({ id, sessionId: 'lift1', week, phase: { id: phase }, date: start.slice(0, 10), startedAt: start, endedAt: start.replace('T17', 'T18'), status: 'complete', sets });
  // as saveSession stores it: the engine's result, and targetsBefore
  const save = (rec, targets) => { const res = applyProgression({ session: rec, targets, rules, plan, settings }); rec.targetsBefore = res.before; rec.whatChanged = res.lines; rec.prs = res.prs; return res.targets; };

  // a flat session (count 1 -> 2) saved with a typo, fixed later: the fix must not count the session again (it reset to 175)
  const t5 = { weight: 185, reps: 5 };
  const flat = mkRec('f1', 4, [W(185, 4, 9, { target: t5, setIndex: 1 }), W(185, 4, 9, { target: t5, setIndex: 2 }), W(18, 3, 10, { target: t5, setIndex: 3 })], '2026-12-08T17:00:00Z');
  const after = save(flat, { back_squat: { weight: 185, reps: 5, stall: 1, source: 'engine' } });
  check('v1.18.1 rule 12: the saved session keeps the target and flat count it had going in', flat.targetsBefore.back_squat.weight === 185 && flat.targetsBefore.back_squat.stall === 1 && after.back_squat.stall === 2, [flat.targetsBefore, after.back_squat]);
  const fx = applyNumberFix({ sessions: [flat], targets: after, recordId: 'f1', exerciseId: 'back_squat', weights: { 2: 185 }, checked: [2], plan, rules, settings });
  check('v1.18.1 rule 12: fixing a typo re-runs from count 1, so it stays 185 x 5 at count 2 (it used to reach 3 and take 5% off)', fx.retargeted && fx.target.weight === 185 && fx.target.reps === 5 && fx.target.stall === 2, fx.target);
  const fx2 = applyNumberFix({ sessions: [fx.record], targets: fx.target, recordId: 'f1', exerciseId: 'back_squat', weights: { 2: 185 }, checked: [2], plan, rules, settings });
  check('v1.18.1 rule 12: fixing it twice gives the same answer', fx2.target.weight === 185 && fx2.target.stall === 2, fx2.target);

  // week 8: the screen showed the heavy start (195 x 3) for a bare 185 x 5; a typo fix must not add it again (plan thread)
  const t8 = { weight: 195, reps: 3 };
  const heavy = mkRec('h8', 8, [W(195, 3, 8, { repRange: [3, 5], target: t8, setIndex: 1 }), W(195, 3, 8, { repRange: [3, 5], target: t8, setIndex: 2 }), W(195, 3, 8, { repRange: [3, 5], target: t8, setIndex: 3 }), W(19, 3, 8, { repRange: [3, 5], target: t8, setIndex: 4 })], '2027-01-05T17:00:00Z', 'heavy');
  const a8 = save(heavy, { back_squat: { weight: 185, reps: 5, stall: 0, source: 'engine' } });
  const f8 = applyNumberFix({ sessions: [heavy], targets: a8, recordId: 'h8', exerciseId: 'back_squat', weights: { 3: 195 }, checked: [3], plan, rules, settings });
  check('v1.18.1 rule 12, week 8: re-run from the bare 185 x 5 applies the heavy start once: 200 x 3 next (v1.18.6), marked', f8.target.weight === 200 && f8.target.reps === 3 && f8.target.stall === 0 && f8.target.heavyStart && f8.target.heavyStart.week === 8, f8.target);
  const t9 = { weight: 200, reps: 3 };
  const w9 = mkRec('h9', 9, [W(200, 3, 8, { repRange: [3, 5], target: t9, setIndex: 1 }), W(200, 3, 8, { repRange: [3, 5], target: t9, setIndex: 2 }), W(200, 3, 8, { repRange: [3, 5], target: t9, setIndex: 3 }), W(20, 3, 8, { repRange: [3, 5], target: t9, setIndex: 4 })], '2027-01-12T17:00:00Z', 'heavy');
  const a9 = save(w9, { back_squat: f8.target });
  const f9 = applyNumberFix({ sessions: [heavy, w9], targets: a9, recordId: 'h9', exerciseId: 'back_squat', weights: { 3: 200 }, checked: [3], plan, rules, settings });
  check('v1.18.1 rule 12, week 9: a marked target keeps its mark, no second 5% (205 x 3, one step)', f9.target.weight === 205 && f9.target.reps === 3 && f9.target.heavyStart && f9.target.heavyStart.week === 8, f9.target);
  const old8 = { ...heavy, id: 'o8', targetsBefore: undefined };
  const r8 = rerunLift({ record: old8, exerciseId: 'back_squat', plan, rules, settings });
  check('v1.18.1 rule 12: a session saved before v1.18.1 starts from the target it showed, at count 0, with no second heavy start', r8.going.weight === 195 && r8.going.stall === 0 && r8.target.weight === 195 && r8.target.reps === 3, [r8.going, r8.target]);
  // a re-run whose result has no heavy-start mark takes it off (the next heavy-week screen applies it again from the fixed target)
  const t6 = { weight: 185, reps: 5 };
  const w6 = mkRec('w6', 6, [W(185, 5, 8, { target: t6, setIndex: 1 }), W(185, 5, 8, { target: t6, setIndex: 2 }), W(18, 5, 8, { target: t6, setIndex: 3 })], '2026-12-22T17:00:00Z');
  const a6 = save(w6, { back_squat: { weight: 185, reps: 5, stall: 0 } });
  const marked = { ...a6.back_squat, weight: 195, reps: 3, heavyStart: { week: 8, from: { weight: a6.back_squat.weight, reps: a6.back_squat.reps } } };
  const f6 = applyNumberFix({ sessions: [w6], targets: { back_squat: marked }, recordId: 'w6', exerciseId: 'back_squat', weights: { 2: 185 }, checked: [2], plan, rules, settings });
  check('v1.18.1 rule 12: a fix to the week-6 session drops the heavy-start mark Home had put on (it comes back from the fixed target)', !f6.target.heavyStart && f6.target.weight === 190 && f6.target.reps === 5, f6.target);

  // rating a set after Save
  const t6b = { weight: 185, reps: 6 };
  const un = mkRec('u1', 3, [W(185, 6, 8, { target: t6b, setIndex: 1 }), W(185, 6, 8, { target: t6b, setIndex: 2 }), W(185, 6, 8, { target: t6b, setIndex: 3, unconfirmed: true })], '2026-12-01T17:00:00Z');
  const au = save(un, { back_squat: { weight: 185, reps: 6, stall: 1, source: 'engine' } });
  check('v1.18.1 rate after Save: saved unrated, the squat holds at 185 x 6, count 1', au.back_squat.weight === 185 && au.back_squat.stall === 1 && /no effort picked/.test(un.whatChanged[0].text), [au.back_squat, un.whatChanged[0].text]);
  const rated = rateSavedSet({ sessions: [un], targets: au, recordId: 'u1', index: 2, rpe: 8, plan, rules, settings });
  check('v1.18.1 rate after Save: rated Solid, the session counts: 190 x 5 (v1.18.6), count 0, the line says it was rated later', rated.why === 'latest' && rated.retargeted && rated.target.weight === 190 && rated.target.reps === 5 && rated.target.stall === 0 && !rated.record.sets[2].unconfirmed && rated.record.sets[2].rpe === 8 && /rated after saving/.test(rated.record.whatChanged[0].text) && un.sets[2].unconfirmed === true, [rated.target, rated.record.whatChanged[0]]);
  const two = mkRec('u2', 3, [W(185, 6, 8, { target: t6b, setIndex: 1 }), W(185, 6, 8, { target: t6b, setIndex: 2, unconfirmed: true }), W(185, 6, 8, { target: t6b, setIndex: 3, unconfirmed: true })], '2026-12-01T17:00:00Z');
  const a2 = save(two, { back_squat: { weight: 185, reps: 6, stall: 1 } });
  const one = rateSavedSet({ sessions: [two], targets: a2, recordId: 'u2', index: 1, rpe: 8, plan, rules, settings });
  check('v1.18.1 rate after Save: one of two rated, the other still holds it (185 x 6, count 1)', one.stillUnrated === 1 && one.target.weight === 185 && one.target.stall === 1 && !/rated after saving/.test(one.record.whatChanged[0].text), [one.target, one.record.whatChanged[0].text]);
  const both = rateSavedSet({ sessions: [one.record], targets: { back_squat: one.target }, recordId: 'u2', index: 2, rpe: 9, plan, rules, settings });
  check('v1.18.2 rate after Save: the second rated Hard: every set made 6 with a Hard set, so the target holds (185 x 6) and the count stays 1', both.stillUnrated === 0 && both.target.weight === 185 && both.target.reps === 6 && both.target.stall === 1, both.target);
  const newer = mkRec('u3', 4, [W(190, 4, 8, { target: { weight: 190, reps: 4 }, setIndex: 1 })], '2026-12-08T17:00:00Z');
  const late = rateSavedSet({ sessions: [newer, un], targets: { back_squat: { weight: 190, reps: 5, stall: 0 } }, recordId: 'u1', index: 2, rpe: 8, plan, rules, settings });
  check('v1.18.1 rate after Save: on an older session the rating is kept and the newer target is left alone', late.why === 'later' && !late.retargeted && late.target.weight === 190 && late.target.reps === 5 && late.record.sets[2].rpe === 8, late);
  const byHand = rateSavedSet({ sessions: [un], targets: { back_squat: { weight: 180, reps: 6, stall: 1, source: 'you', updated: un.endedAt } }, recordId: 'u1', index: 2, rpe: 8, plan, rules, settings });
  check('v1.18.1 rate after Save: a next target he typed on Review stays as he typed it', byHand.why === 'hand' && !byHand.retargeted && byHand.target.weight === 180, byHand.target);
  const byCoach = rateSavedSet({ sessions: [un], targets: { back_squat: { weight: 180, reps: 6, stall: 0, source: 'coach', updated: '2026-12-02T05:00:00.000Z' } }, recordId: 'u1', index: 2, rpe: 8, plan, rules, settings });
  check('v1.18.1 rate after Save: a target the coach set after the session stays (the nightly review or a check-in)', byCoach.why === 'coach' && !byCoach.retargeted && byCoach.target.weight === 180 && byCoach.record.sets[2].rpe === 8, byCoach.target);
  const coachBefore = rateSavedSet({ sessions: [un], targets: { back_squat: { weight: 185, reps: 6, stall: 1, source: 'coach', updated: '2026-11-29T05:00:00.000Z' } }, recordId: 'u1', index: 2, rpe: 8, plan, rules, settings });
  check('v1.18.1 rate after Save: a coach target from before the session moves as usual (190 x 5)', coachBefore.why === 'latest' && coachBefore.target.weight === 190 && coachBefore.target.reps === 5, coachBefore.target);
  const fixCoach = applyNumberFix({ sessions: [w6], targets: { back_squat: { weight: 190, reps: 5, stall: 0, source: 'coach', updated: '2026-12-23T05:00:00.000Z' } }, recordId: 'w6', exerciseId: 'back_squat', weights: { 2: 185 }, checked: [2], plan, rules, settings });
  check('v1.18.1 number fix: a target the coach set since stays; the session is still corrected', !fixCoach.retargeted && fixCoach.target.weight === 190 && fixCoach.target.reps === 5 && fixCoach.record.sets[2].weight === 185, [fixCoach.target, fixCoach.record.sets[2]]);
  const pre = { ...un, id: 'p1', targetsBefore: undefined };
  const preR = rateSavedSet({ sessions: [pre], targets: { back_squat: { weight: 185, reps: 6, stall: 0 } }, recordId: 'p1', index: 2, rpe: 8, plan, rules, settings });
  check('v1.18.1 rate after Save: a session saved before v1.18.1 re-runs from the target it showed (190 x 5)', preR.target.weight === 190 && preR.target.reps === 5, preR.target);
}

// ---- v1.10: runs and Garmin ----
{
  const st = { ...settings, startDate: '2026-11-16' };
  check('v1.10 time: 27:30, 1:02:30 and 27.5 all read as minutes; nonsense does not', parseMinutes('27:30') === 27.5 && parseMinutes('1:02:30') === 62.5 && parseMinutes('27.5') === 27.5 && parseMinutes('') === null && parseMinutes('a:b') === null && parseMinutes('abc') === null);
  check('v1.10 time prints as a clock', fmtDuration(27.5) === '27:30' && fmtDuration(62.5) === '1:02:30' && fmtDuration(8.867) === '8:52' && fmtDuration(null) === '');
  check('v1.10 one line per run; bike distance carries no pace', runLine({ type: 'Intervals', distance: 3.1, minutes: 27.5, hr: 151.6 }, rules) === '3.1 mi · 27:30 · 8:52/mi · HR 152' && runLine({ type: 'Bike/rower sub', distance: 5.59, minutes: 25 }, rules) === '5.59 mi · 25:00' && runLine({ type: 'Easy run' }, rules) === '');
  const [r1, r2] = plan.runs;
  check('v1.10 the interval set follows the week', prescription(r1, 1).text === '5 × 2 min fast, 2 min easy' && prescription(r1, 6).text === '5 × 3 min fast, 2 min easy' && prescription(r1, 11).text === '4 × 4 min fast, 2-3 min easy', [prescription(r1, 1).text, prescription(r1, 6).text, prescription(r1, 11).text]);
  // v1.22.0 (Nov 26 run plan review): 5K time trial in weeks 3 and 12, 3 rounds in the lighter week 7
  check('v1.23.0 weeks 3, 7 and 12 are a 5K check-in; the weeks around them keep their intervals', [3, 7, 12].every(w => prescription(r1, w).kind === 'test' && prescription(r1, w).text === '5K check-in' && prescription(r1, w).lines.length === 4) && /Compare it with your week 3 time/.test(prescription(r1, 12).lines[3])
    && prescription(r1, 2).text === '5 × 2 min fast, 2 min easy' && prescription(r1, 4).text === '5 × 2 min fast, 2 min easy' && prescription(r1, 6).text === '5 × 3 min fast, 2 min easy' && prescription(r1, 8).text === '5 × 3 min fast, 2 min easy' && prescription(r1, 9).text === '4 × 4 min fast, 2-3 min easy',
    [3, 7, 8, 12].map(w => prescription(r1, w).text));
  check('v1.22.0 every interval week 1-12 is covered by exactly one stage or test', Array.from({ length: 12 }, (_, i) => i + 1).every(w => r1.intervals.filter(iv => w >= iv.weeks[0] && w <= iv.weeks[1]).length === 1));
  check('v1.10 the numbers on the plan runs agree with their notes', r1.note.includes('5 x 2 min fast / 2 min easy') && r1.note.includes('5 x 3 / 2') && r1.note.includes('4 x 4 / 2-3') && r2.note.includes('Start 3.5 mi, then add 0.5 mi') && r2.distance.startMiles === 3.5 && r2.distance.stepMiles === 0.5
    && r1.note.includes('Weeks 3, 7 and 12: a 5K check-in') && r1.tests.map(t => t.week).join() === '3,7,12' && r1.note.includes(`reach ${r1.hr.fastEnd[0]}-${r1.hr.fastEnd[1]}`) && r1.note.includes(r1.goal.fiveK)
    && r2.note.includes(`never more than ${r2.distance.maxJump * 100}% past your longest run in the last ${r2.distance.windowDays} days`) && r2.note.includes(`passes ${r2.hr.easy[1]}`));
  // v1.18.4 (Cameron, Nov 24): pace targets and heart rate in place of RPE, in the plan data and the note alike
  const lines1 = prescription(r1, 1).lines || [], lines6 = prescription(r1, 6).lines || [], lines12 = prescription(r1, 11).lines || [];
  check('v1.18.4 each interval stage has its own pace, and the fast line shows it with the heart rate check', lines1[0] === 'Fast: 7:45-8:15 per mile. Heart rate 170-180 by the end of each one.' && lines6[0].startsWith('Fast: 8:00-8:25') && lines12[0].startsWith('Fast: 8:10-8:35'), [lines1, lines6[0], lines12[0]]);
  check('v1.18.4 the easy line says how far heart rate comes down, and no line uses RPE', lines1[1] === 'Easy: jog or walk until heart rate is under 160.' && ![...lines1, r1.note, r1.effort, r2.note, r2.effort].some(t => /RPE/.test(t)), lines1);
  check('v1.18.4 the paces and heart rates in the note are the plan data\'s', r1.intervals.every(iv => r1.note.includes(iv.pace)) && r1.note.includes(`${r1.hr.fastEnd[0]}-${r1.hr.fastEnd[1]}`) && r1.note.includes(`under ${r1.hr.easyUnder}`) && r2.note.includes(`${r2.hr.easy[0]}-${r2.hr.easy[1]}`) && r2.effort.includes(`${r2.hr.easy[0]}-${r2.hr.easy[1]}`));
  check('v1.18.4 a run without pace data keeps the old wording', prescription({ ...r1, hr: undefined }, 1).text === '5 × 2 min hard, 2 min easy' && !prescription({ ...r1, hr: undefined }, 1).lines);
  const lr = (d, date, type = 'Long run') => ({ id: 'r' + date, date, type, planId: 'run2', distance: d, minutes: d * 10, week: 1 });
  const oldR2 = { ...r2, distance: { startMiles: 3.5, stepMiles: 0.5, capMiles: 7 } };
  check('v1.10 long run (no maxJump): starts at 3.5, goes half a mile past the longest, a ski day does not move it, stops at the cap',
    longRunTarget(oldR2, []).miles === 3.5 && longRunTarget(oldR2, [lr(3.62, '2026-11-21')]).miles === 4 && longRunTarget(oldR2, [lr(3.62, '2026-11-21'), lr(2, '2026-11-28')]).miles === 4
    && longRunTarget(oldR2, [lr(9, '2026-11-21', 'Ski day')]).miles === 3.5 && longRunTarget(oldR2, [lr(6.8, '2026-12-20')]).miles === 7 && longRunTarget(oldR2, [lr(8, '2026-12-20')]).miles === 7,
    [longRunTarget(oldR2, [lr(3.62, '2026-11-21')]), longRunTarget(oldR2, [lr(9, '2026-11-21', 'Ski day')])]);
  // v1.22.0 (Nov 26 run plan review, Frandsen et al. BJSM 2025): at most 10% past the longest run of any kind in the last 30 days
  const ivr = (d, date) => ({ id: 'i' + date, date, type: 'Intervals', planId: 'run1', distance: d, minutes: d * 9, week: 1 });
  const lrt = (runs, asOf) => longRunTarget(r2, runs, asOf).miles;
  check('v1.22.0 long run: his Nov 22 run (3.66 mi) still gives 4.0 mi; 3.62 gives 3.75 (10%, rounded down to a quarter mile)',
    r2.distance.maxJump === 0.1 && r2.distance.windowDays === 30 && lrt([lr(3.66, '2026-11-22')], '2026-11-23') === 4 && lrt([lr(3.62, '2026-11-21')]) === 3.75 && lrt([]) === 3.5,
    [lrt([lr(3.66, '2026-11-22')], '2026-11-23'), lrt([lr(3.62, '2026-11-21')])]);
  let chain = [], d = 3.66, seq = [];
  for (let k = 0; k < 12 && seq[seq.length - 1] !== 7; k++) { chain.push(lr(d, `2026-12-${String(k + 1).padStart(2, '0')}`)); d = lrt(chain); seq.push(d); }
  check('v1.22.0 long run: run exactly as asked, it climbs 4, 4.25, 4.5, 4.75, 5, 5.5 ... to the 7 mi cap, never more than 10% or 0.5 mi a step',
    seq[0] === 4 && seq[1] === 4.25 && seq[seq.length - 1] === 7 && seq.every((m, k) => m <= (k ? seq[k - 1] : 3.66) * 1.1 + 1e-9 && m - (k ? seq[k - 1] : 3.66) <= 0.5 + 1e-9), seq);
  check('v1.22.0 long run: after 30 days with no runs it starts again at 3.5; a ski month does not keep the old distance',
    lrt([lr(6, '2026-12-01'), lr(9, '2026-12-20', 'Ski day')], '2027-01-05') === 3.5 && lrt([lr(6, '2026-12-01')], '2026-12-20') === 6.5, [lrt([lr(6, '2026-12-01'), lr(9, '2026-12-20', 'Ski day')], '2027-01-05')]);
  check('v1.22.0 long run: intervals and easy runs count toward the longest run in the window; bike and ski days do not',
    lrt([lr(6, '2026-12-01'), ivr(3, '2026-12-29')], '2027-01-05') === 3.25 && lrt([ivr(3.2, '2026-11-20')], '2026-11-23') === 3.5
    && lrt([{ id: 'b', date: '2026-12-29', type: 'Bike/rower sub', distance: 10, minutes: 30 }], '2027-01-05') === 3.5 && lrt([lr(6.8, '2026-12-20')]) === 7 && lrt([lr(8, '2026-12-20')]) === 7,
    [lrt([lr(6, '2026-12-01'), ivr(3, '2026-12-29')], '2027-01-05')]);
  const realRuns = [lr(3.66, '2026-11-22'), ivr(2.81, '2026-11-18')];
  const wk2 = weekRuns({ plan, settings: st, runs: realRuns, week: 2, today: new Date('2026-11-26T08:00:00') });
  const wk8 = weekRuns({ plan, settings: st, runs: realRuns, week: 8, today: new Date('2026-11-26T08:00:00') });
  check('v1.22.0 this week the long run reads 4 mi with the last 30 days named; a later week shows the same next step as of today',
    wk2[1].plan.text === '4 mi' && /longest run in the last 30 days 3.7 mi/.test(wk2[1].plan.detail) && /130-150/.test(wk2[1].plan.detail) && wk8[1].plan.text === '4 mi', [wk2[1].plan, wk8[1].plan.text]);
  // v1.23.0 (Cameron, Nov 26): 5K check-ins that set the interval paces
  const tt = (id, date, extra) => ({ id, date, type: '5K test', planId: 'run1', week: weekNumber(parseISODate(date), '2026-11-16'), ...extra });
  check('v1.23.0 a 5K check-in reads Garmin\'s fastest 5K inside the run, or a 3.0-3.5 mi run scaled to 5K; other run types have none',
    fiveKSeconds(tt('a', '2026-12-01', { best5k: 1600.4, distance: 4.9, minutes: 45 })) === 1600 && fiveKSeconds(tt('b', '2026-12-01', { distance: 3.11, minutes: 26.7 })) === 1600
    && fiveKSeconds(tt('c', '2026-12-01', { distance: 4.5, minutes: 45 })) === null && fiveKSeconds({ type: 'Intervals', best5k: 1500 }) === null,
    [fiveKSeconds(tt('b', '2026-12-01', { distance: 3.11, minutes: 26.7 }))]);
  const pf = r1.paceFrom5k;
  check('v1.23.0 paces from a 23:00 5K match the fit-runner numbers (Daniels interval pace, 3K pace, McMillan 15-min pace: 7:00-7:25)',
    paceFrom5k(1380, 2, pf) === '7:00-7:20' && paceFrom5k(1380, 3, pf) === '7:05-7:20' && paceFrom5k(1380, 4, pf) === '7:10-7:25' && Math.round(vdotFrom5k(1380)) === 42,
    [2, 3, 4].map(h => paceFrom5k(1380, h, pf)));
  check('v1.23.0 a slower 5K gives slower paces, and every band runs fast to slow',
    paceFrom5k(1620, 2, pf) === '8:10-8:30' && paceFrom5k(1620, 4, pf) === '8:20-8:35' && [1380, 1620, 1800].every(sec => [2, 3, 4].every(h => { const [a, b] = paceFrom5k(sec, h, pf).split('-').map(parseMinutes); return a < b; })),
    [paceFrom5k(1620, 2, pf), paceFrom5k(1620, 4, pf)]);
  const dec1 = tt('t1', '2026-12-01', { best5k: 1600 });
  const w4 = prescription(r1, 4, [dec1]);
  check('v1.23.0 after the Dec 1 check-in, week 4\'s fast parts come from it and say so; with no check-in the plan\'s bands stay',
    w4.pace === '8:05-8:25' && w4.lines[0] === 'Fast: 8:05-8:25 per mile (from your Dec 1 5K, 26:40). Heart rate 170-180 by the end of each one.' && prescription(r1, 4, []).pace === '7:45-8:15' && prescription(r1, 9, [dec1]).pace === '8:15-8:30',
    [w4.lines[0], prescription(r1, 9, [dec1]).pace]);
  const jan = tt('t2', '2026-12-29', { best5k: 1450 });
  const tests2 = fiveKTests([dec1, jan], r1.fiveKCheck);
  check('v1.23.0 a 5K more than 5% off the last one waits for his OK and does not move the paces; his OK lets it',
    tests2[1].flagged && /2:30 faster than your last 5K \(26:40\)/.test(tests2[1].why) && prescription(r1, 8, [dec1, jan]).pace === '8:10-8:25'
    && !fiveKTests([dec1, { ...jan, fiveKConfirmed: 1450 }], r1.fiveKCheck)[1].flagged && prescription(r1, 8, [dec1, { ...jan, fiveKConfirmed: 1450 }]).pace === '7:25-7:40'
    && fiveKTests([tt('t3', '2026-12-01', { best5k: 700 })], r1.fiveKCheck)[0].flagged && !fiveKTests([tt('t4', '2026-12-29', { best5k: 1560 }), dec1], r1.fiveKCheck)[1].flagged,
    [tests2[1], prescription(r1, 8, [dec1, { ...jan, fiveKConfirmed: 1450 }]).pace]);
  check('v1.23.0 Count it in a check-in week makes the run the 5K test; other weeks it stays the intervals; a bike session stays a bike session',
    countAs({ id: 'g', type: 'Easy run', week: 3 }, r1).type === '5K test' && countAs({ id: 'g', type: 'Easy run', week: 2 }, r1).type === 'Intervals' && countAs({ id: 'g', type: 'Bike/rower sub', week: 3 }, r1).type === 'Bike/rower sub');
  // v1.24.0 (Cameron, Nov 26: "lets put these 5k tests in the plan as defined points... show the plan over the 12 week sprints")
  const st24 = { startDate: '2026-11-16' };
  const nov26 = new Date('2026-11-26T13:00:00');
  const runs24 = [{ id: 'a', date: '2026-11-18', type: 'Intervals', planId: 'run1', distance: 2.81, minutes: 27.36, week: 1 }, { id: 'b', date: '2026-11-22', type: 'Long run', planId: 'run2', distance: 3.66, minutes: 36.33, week: 1 }];
  const ip = intervalPlan(plan, st24, runs24, r1, nov26);
  check('v1.24.0 run 1 over the 12 weeks: the check-ins sit in weeks 3, 7 and 12 on Tuesdays (Dec 1, Dec 29, Feb 2); the stages fill the rest',
    ip.length === 12 && ip.filter(r => r.kind === 'test').map(r => `${r.week} ${r.date}`).join() === '3 2026-12-01,7 2026-12-29,12 2027-02-02'
    && ip.map(r => r.text).join('|') === '5 × 2 min|5 × 2 min|5K check-in|5 × 2 min|5 × 3 min|5 × 3 min|5K check-in|5 × 3 min|4 × 4 min|4 × 4 min|4 × 4 min|5K check-in' && ip[0].done && ip[0].done.id === 'a' && !ip[1].done,
    ip.map(r => [r.week, r.date, r.text]));
  check('v1.24.0 before the first check-in, weeks 1-2 use the plan\'s pace and later weeks wait for the check-in before them',
    ip[0].pace === '7:45-8:15' && ip[1].pace === '7:45-8:15' && ip[3].pace === null && ip[3].waitsFor === 3 && ip[7].waitsFor === 7 && ip[10].waitsFor === 7, ip.map(r => [r.week, r.pace, r.waitsFor]));
  const withDec1 = runs24.concat([tt('t1', '2026-12-01', { best5k: 1600 })]);
  const ip2 = intervalPlan(plan, st24, withDec1, r1, new Date('2026-12-02T09:00:00'));
  check('v1.24.0 after Dec 1 (26:40), weeks 4-6 show the paces it sets; weeks 8-11 wait for the week 7 check-in',
    ip2[3].pace === '8:05-8:25' && ip2[3].paceFrom.date === '2026-12-01' && ip2[4].pace === paceFrom5k(1600, 3, r1.paceFrom5k) && ip2[2].done && ip2[7].pace === null && ip2[7].waitsFor === 7,
    ip2.map(r => [r.week, r.pace, r.waitsFor]));
  const missed3 = intervalPlan(plan, st24, runs24, r1, new Date('2026-12-08T09:00:00'));
  check('v1.24.0 a check-in week that passed with no 5K stops holding the paces: week 4 goes back to the plan\'s pace',
    missed3[3].waitsFor === null && missed3[3].pace === '7:45-8:15' && missed3[7].waitsFor === 7, missed3.map(r => [r.week, r.pace, r.waitsFor]));
  const ck = checkIns(plan, st24, withDec1, r1);
  check('v1.24.0 check-ins: the three fixed points with their dates, the Dec 1 one carrying its time',
    ck.map(c => c.week).join() === '3,7,12' && ck[0].result && ck[0].result.seconds === 1600 && !ck[1].result && ck[2].date === '2027-02-02' && runDay(plan, st24, 'run2', 2) === '2026-11-28', ck);
  const pj = fiveKProjection(r1, withDec1, st24);
  const at = (k, w) => pj.cases[k].find(x => x.week === w).seconds;
  check('v1.24.0 5K projection from Dec 1 (26:40): doing well 0.5% a week, steady 0.3%, struggling flat, out to week 12',
    pj.from.week === 3 && pj.from.seconds === 1600 && pj.cases.well.length === 10 && at('well', 3) === 1600 && at('well', 7) === Math.round(1600 * 0.995 ** 4) && at('steady', 12) === Math.round(1600 * 0.997 ** 9) && at('struggle', 12) === 1600
    && fmtSeconds(at('well', 12)) === '25:29' && fmtSeconds(at('steady', 12)) === '25:57' && fiveKProjection(r1, runs24, st24) === null,
    [fmtSeconds(at('well', 12)), fmtSeconds(at('steady', 12))]);
  check('v1.24.0 the rates rest on the plan\'s sources and stay inside them: doing well no faster than VDOT O2\'s best (1 point a 4 weeks, about 0.6% a week), struggling not slower than flat',
    r1.projection.perWeek.well <= 0.006 && r1.projection.perWeek.well > r1.projection.perWeek.steady && r1.projection.perWeek.steady > r1.projection.perWeek.struggle && r1.projection.perWeek.struggle === 0
    && ['VDOT O2', 'Gunnarsson', 'Skovgaard', 'Esfarjani'].every(n => r1.projection.why.includes(n) && r1.projection.say.includes(n)));
  check('v1.24.0 a flagged 5K does not start the projection; his OK does', fiveKProjection(r1, withDec1.concat([jan]), st24).from.seconds === 1600 && fiveKProjection(r1, withDec1.concat([{ ...jan, fiveKConfirmed: 1450 }]), st24).from.seconds === 1450);
  const lp = longRunPlan(plan, st24, runs24, r2, nov26);
  check('v1.24.0 long run over the 12 weeks from his Nov 22 run (3.66 mi), run as asked: 4, 4.25, 4.5, 4.75, 5, 5.5, 6, 6.5, then 7 from week 10',
    lp.map(r => r.miles).join() === '3.5,4,4.25,4.5,4.75,5,5.5,6,6.5,7,7,7' && lp[0].done && lp[0].done.id === 'b' && lp[0].past && lp[1].now && !lp[2].done && lp[1].date === '2026-11-28',
    lp.map(r => r.miles));
  const lpSki = longRunPlan(plan, st24, runs24.concat([{ id: 's', date: '2026-11-28', type: 'Ski day', distance: null, minutes: 240 }]), r2, new Date('2026-11-30T09:00:00'));
  check('v1.24.0 a ski day covers week 2 but adds no miles, so week 3 asks what week 2 did (4 mi)', lpSki[1].done && lpSki[1].done.type === 'Ski day' && lpSki[2].miles === 4, lpSki.map(r => r.miles));
  check('v1.10 a ski day counts for the long run, a 5K test for the intervals, an easy run for neither', planRunForType(plan, 'Ski day').id === 'run2' && planRunForType(plan, '5K test').id === 'run1' && planRunForType(plan, 'Easy run') === null);
  const wk = (runs, day) => weekRuns({ plan, settings: st, runs, week: 1, today: new Date(day + 'T08:00:00') });
  const mon = wk([], '2026-11-16'), tue = wk([], '2026-11-17'), thu = wk([], '2026-11-19'), sun = wk([], '2026-11-22');
  check('v1.10 this week: each run is later, today, or not logged yet, and the long run has the whole weekend', mon.map(r => r.status).join() === 'later,later' && tue[0].status === 'today' && thu[0].status === 'open' && thu[1].status === 'later' && sun[1].status === 'today' && tue[0].date === '2026-11-17', [mon, sun].map(x => x.map(r => r.status)));
  const done = wk([{ id: 'a', date: '2026-11-19', type: 'Intervals', planId: 'run1', distance: 3, minutes: 28 }, { id: 'b', date: '2026-11-21', type: 'Ski day', distance: null, minutes: 240 }, { id: 'c', date: '2026-11-10', type: 'Long run', distance: 5 }], '2026-11-22');
  check('v1.10 this week: a run on another day still counts, a ski day covers the long run, last week\'s run does not', done[0].status === 'done' && done[0].run.id === 'a' && done[1].status === 'done' && done[1].run.id === 'b', done.map(r => [r.status, r.run && r.run.id]));
  const miles = weeklyMiles([{ date: '2026-11-17', type: 'Intervals', distance: 3.17 }, { date: '2026-11-21', type: 'Long run', distance: 3.6 }, { date: '2026-11-18', type: 'Bike/rower sub', distance: 5.59 }, { date: '2026-11-24', type: 'Easy run', distance: 2 }, { date: '2026-11-10', type: 'Easy run', distance: 9 }], st, rules);
  check('v1.10 miles by week leave out the bike and anything before the block', miles.length === 12 && miles[0].miles === 6.8 && miles[0].runs === 2 && miles[1].miles === 2 && miles[2].miles === 0, miles.slice(0, 3));

  const g = (id, typeKey, start, meters, seconds, extra = {}) => ({ activityId: id, activityName: 'x', startTimeLocal: start, activityType: { typeKey }, distance: meters, duration: seconds, averageHR: 150, maxHR: 171, elevationGain: 30, ...extra });
  const one = garminToRun(g(7, 'trail_running', '2026-11-17 06:12:33', 5100, 1720), { rules });
  check('v1.10 Garmin: meters and seconds become miles and minutes', one.id === 'garmin-7' && one.garminId === '7' && one.date === '2026-11-17' && one.startTime === '06:12' && one.distance === 3.17 && one.minutes === 28.67 && one.hr === 150 && one.maxHr === 171 && one.climbFt === 98 && one.guess === true, one);
  check('v1.10 Garmin: lifts and walks are not runs; short jogs and short spins are left out; a ski day and a long spin count', garminToRun(g(1, 'strength_training', '2026-11-17 06:00:00', 0, 3000), { rules }) === null && garminToRun(g(2, 'walking', '2026-11-17 06:00:00', 2000, 1500), { rules }) === null
    && garminToRun(g(3, 'running', '2026-11-17 06:00:00', 500, 200), { rules }) === null && garminToRun(g(4, 'indoor_cycling', '2026-11-17 06:00:00', 5000, 720), { rules }) === null
    && garminToRun(g(5, 'resort_skiing_snowboarding_ws', '2026-11-21 09:00:00', 30000, 14400), { rules }).type === 'Ski day' && garminToRun(g(6, 'indoor_cycling', '2026-11-18 18:00:00', 9000, 1500), { rules }).type === 'Bike/rower sub');
  const other = garminToRun({ summaryId: 'abc', activityType: 'RUNNING', startTimeInSeconds: 1795155153, startTimeOffsetInSeconds: -25200, distanceInMeters: 5000, durationInSeconds: 1500, averageHeartRateInBeatsPerMinute: 149 }, { rules });
  check('v1.10 Garmin: the other field names Garmin uses are read too', other && other.garminId === 'abc' && other.distance === 3.11 && other.minutes === 25 && other.hr === 149 && /^\d{4}-\d{2}-\d{2}$/.test(other.date), other);
  check('v1.10 Garmin: the list is found whatever wraps it', garminList([1, 2]).length === 2 && garminList({ fetchedAt: 'x', activities: [1] }).length === 1 && garminList({ activityList: [1, 2, 3] }).length === 3 && garminList(null).length === 0);
  const file = { activities: [g(13, 'running', '2026-11-22 09:00:00', 3000, 1200), g(12, 'running', '2026-11-21 08:00:00', 5800, 2160), g(11, 'running', '2026-11-17 06:12:33', 5100, 1720), g(10, 'running', '2026-11-14 08:00:00', 5000, 1500)] };
  const typed = { id: 'run_1', date: '2026-11-17', type: '5K test', planId: 'run1', distance: 3.1, minutes: 27, rpe: 9, notes: 'windy', week: 1 };
  const m = mergeGarmin([typed], file, { plan, rules, settings: st, ignored: [], appVersion: 't' });
  const by = Object.fromEntries(m.put.map(r => [r.id, r]));
  check('v1.10 merge: a run typed that day takes the watch\'s numbers and keeps its type, effort and notes', m.updated === 1 && by.run_1.garminId === '11' && by.run_1.distance === 3.17 && by.run_1.type === '5K test' && by.run_1.rpe === 9 && by.run_1.notes === 'windy' && by.run_1.source === 'garmin', by.run_1);
  check('v1.18.1 merge: weekend runs from Garmin land as easy runs that count for no planned run, nothing from before the block', m.added === 2 && by['garmin-12'].type === 'Easy run' && by['garmin-12'].planId === null && by['garmin-13'].type === 'Easy run' && by['garmin-13'].planId === null && !by['garmin-10'] && by['garmin-12'].week === 1 && by['garmin-12'].rpe === null && needsCredit(by['garmin-12']), m.put.map(r => [r.id, r.type, r.planId]));
  const after = [by.run_1, { ...by['garmin-12'], type: 'Easy run', planId: null, rpe: 4, notes: 'legs heavy', typeLocked: true, autoType: false }, by['garmin-13']]; // v1.12: a type Cameron taps is locked
  settleWeek(after, 1, { plan, rules, settings: st }); // and the sheet settles the rest of that week
  const again = mergeGarmin(after, file, { plan, rules, settings: st, ignored: [], appVersion: 't' });
  check('v1.10 merge: the same file again changes nothing', again.put.length === 0 && again.added === 0 && again.updated === 0 && again.seen === 3, again);
  const fixed = mergeGarmin(after, { activities: [g(12, 'running', '2026-11-21 08:00:00', 6000, 2200)] }, { plan, rules, settings: st, ignored: [], appVersion: 't' });
  check('v1.10 merge: a corrected activity updates the numbers, not what Cameron set', fixed.updated === 1 && fixed.put[0].distance === 3.73 && fixed.put[0].type === 'Easy run' && fixed.put[0].rpe === 4 && fixed.put[0].notes === 'legs heavy', fixed.put[0]);
  const gone = mergeGarmin([], file, { plan, rules, settings: st, ignored: ['12'], appVersion: 't' });
  check('v1.10 merge: a Garmin run Cameron deleted stays out', gone.added === 2 && !gone.put.some(r => r.garminId === '12'), gone.put.map(r => r.id));
  const links = garminLinks('cam/training-data', 'main', 'name: Garmin runs\non: push\n');
  check('v1.10 set-up links point at the repo: new secret, and a new file with the job filled in', links.secret === 'https://github.com/cam/training-data/settings/secrets/actions/new' && links.job === 'https://github.com/cam/training-data/new/main?filename=.github%2Fworkflows%2Fgarmin.yml&value=name%3A%20Garmin%20runs%0Aon%3A%20push%0A' && GARMIN_JOB === '.github/workflows/garmin.yml', links);
}

// ---- v1.12: runs off schedule ----
{
  const st = { ...settings, startDate: '2026-11-16' };
  const ctx = { plan, rules, settings: st };
  const g = (id, start, meters, seconds, extra = {}) => ({ activityId: id, activityName: 'Run', startTimeLocal: start, activityType: { typeKey: 'running' }, distance: meters, duration: seconds, averageHR: 150, ...extra });
  const merge = (runs, acts, ignored = []) => mergeGarmin(runs, { activities: acts }, { ...ctx, ignored, appVersion: 't' });
  const byId = m => Object.fromEntries(m.put.map(r => [r.id, r]));
  // week 2: Mon Nov 23 .. Sun Nov 29. Intervals planned Tue 24, long run Sat 28 / Sun 29.
  // v1.18.1 (Cameron, Nov 21: "dont automatically count the Garmin run as intervals ... Maybe make me log it to take
  // credit"): a Garmin run is an easy run that counts toward miles and for no planned run until he taps Count it.
  const wed = merge([], [g(1, '2026-11-25 18:00:00', 4500, 1700)]);
  check('v1.18.1 a Wednesday run with Tuesday missed is an easy run, not the intervals, and says why', byId(wed)['garmin-1'].type === 'Easy run' && byId(wed)['garmin-1'].planId === null && /only when you say which one/.test(byId(wed)['garmin-1'].autoWhy), byId(wed)['garmin-1']);
  const wk2 = (runs, day = '2026-11-27') => weekRuns({ plan, settings: st, runs, week: 2, today: new Date(day + 'T08:00:00') });
  const w2 = wk2([byId(wed)['garmin-1']]);
  check('v1.18.1 that run leaves both planned runs open (it still counts toward the week\'s miles)', w2[0].status === 'open' && !w2[0].run && w2[1].status === 'later' && weeklyMiles([byId(wed)['garmin-1']], st, rules)[1].miles === 2.8, w2.map(r => r.status));
  const vo2 = merge([], [g(7, '2026-11-27 18:00:00', 4800, 1900, { trainingEffectLabel: 'VO2MAX' })]);
  check('v1.18.1 even a run Garmin marks as intervals waits for his tap (the sign is kept on the record)', byId(vo2)['garmin-7'].type === 'Easy run' && byId(vo2)['garmin-7'].planId === null && byId(vo2)['garmin-7'].intervalLike === true, byId(vo2)['garmin-7']);
  check('v1.12 interval signs: Garmin\'s label, its anaerobic effect, or max speed well above average', garminToRun(g(8, '2026-11-25 18:00:00', 4000, 1500, { anaerobicTrainingEffect: 2.6 }), { rules }).intervalLike === true
    && garminToRun(g(9, '2026-11-25 18:00:00', 4000, 1500, { trainingEffectLabel: 'AEROBIC_BASE' }), { rules }).intervalLike === false
    && garminToRun(g(10, '2026-11-25 18:00:00', 4000, 1500, { averageSpeed: 2.7, maxSpeed: 4.3 }), { rules }).intervalLike === true
    && garminToRun(g(11, '2026-11-25 18:00:00', 4000, 1500), { rules }).intervalLike === null);
  // Count it
  const [run1, run2] = plan.runs;
  const range2 = weekRange(st, 2);
  const two = byId(merge([], [g(3, '2026-11-26 18:00:00', 4500, 1700), g(4, '2026-11-28 08:00:00', 6400, 3500)]));
  const pool = [two['garmin-3'], two['garmin-4']];
  check('v1.18.1 Count it offers this week\'s waiting Garmin runs under each open planned run, oldest first', countCandidates(plan, pool, run1, range2).map(r => r.id).join() === 'garmin-3,garmin-4' && countCandidates(plan, pool, run2, range2).length === 2 && countCandidates(plan, pool, run1, weekRange(st, 3)).length === 0);
  const counted = countAs(two['garmin-3'], run1);
  check('v1.18.1 Count it makes it that run, for good: type, planned run and locked', counted.type === 'Intervals' && counted.planId === 'run1' && counted.typeLocked && !isAuto(counted) && !needsCredit(counted) && countsFor(plan, counted, run1) && !countsFor(plan, counted, run2), counted);
  const w2b = wk2([counted, two['garmin-4']], '2026-11-29');
  check('v1.18.1 counted, the intervals are done; the long run still waits for its tap', w2b[0].status === 'done' && w2b[0].run.id === 'garmin-3' && w2b[1].status === 'today' && !w2b[1].run && countCandidates(plan, [counted, two['garmin-4']], run1, range2).length === 1, w2b.map(r => r.status));
  const side = keepAsSide(two['garmin-4']);
  check('v1.18.1 Side run: an easy run for good, in the miles, for no planned run, and no planned run asks about it again', side.type === 'Easy run' && side.planId === null && side.typeLocked === true && !needsCredit(side) && !countsFor(plan, side, run1) && !countsFor(plan, side, run2)
    && countCandidates(plan, [counted, side], run2, range2).length === 0 && countsMiles(rules, side.type) && side.distance === two['garmin-4'].distance, side);
  const again2 = mergeGarmin([counted, two['garmin-4']], { activities: [g(3, '2026-11-26 18:00:00', 4500, 1700), g(4, '2026-11-28 08:00:00', 6400, 3500)] }, { ...ctx, ignored: [], appVersion: 't' });
  check('v1.18.1 a later Garmin pull keeps what he counted', again2.put.length === 0, again2.put);
  const hand = merge([{ id: 'run_9', date: '2026-11-24', type: 'Intervals', planId: 'run1', distance: 3, minutes: 30 }], [g(14, '2026-11-26 18:00:00', 4500, 1700)]);
  check('v1.12 a run logged by hand keeps its slot; the Garmin run is an easy run', byId(hand)['garmin-14'].type === 'Easy run' && !byId(hand)['run_9'], hand.put.map(r => [r.id, r.type]));
  check('v1.12 old Garmin runs: Easy run is still the app\'s pick, anything else was Cameron\'s', isAuto({ id: 'garmin-1', type: 'Easy run' }) && !isAuto({ id: 'garmin-1', type: 'Intervals' }) && !isAuto({ id: 'run_1', type: 'Easy run' }) && !isAuto({ id: 'garmin-1', type: 'Easy run', typeLocked: true }));
  const ski = byId(merge([], [g(15, '2026-11-28 09:00:00', 30000, 14400, { activityType: { typeKey: 'resort_skiing_snowboarding_ws' } }), g(18, '2026-11-26 07:00:00', 9000, 1800, { activityType: { typeKey: 'indoor_rowing' } })]));
  check('v1.18.1 a ski day still counts for the long run by itself, as the plan says', ski['garmin-15'].type === 'Ski day' && ski['garmin-15'].planId === 'run2' && !needsCredit(ski['garmin-15']) && wk2([ski['garmin-15']], '2026-11-29')[1].status === 'done', ski['garmin-15']);
  check('v1.18.1 a rower session (an Engine finisher on the watch) waits for his tap; counted, it stays a bike/rower sub for the intervals', ski['garmin-18'].type === 'Bike/rower sub' && ski['garmin-18'].planId === null && needsCredit(ski['garmin-18']) && wk2([ski['garmin-18']])[0].status === 'open'
    && creditOptions(plan, ski['garmin-18']).map(r => r.id).join() === 'run1' && countAs(ski['garmin-18'], run1).type === 'Bike/rower sub' && countsFor(plan, countAs(ski['garmin-18'], run1), run1), ski['garmin-18']);
  // the old app picked planned runs by itself: settling the week again (v1.18.1 upgrade) makes those easy runs; his picks stay
  const oldPick = { ...two['garmin-3'], type: 'Intervals', planId: 'run1', autoType: true, autoWhy: 'the week\'s intervals were still open' };
  const mine = { ...two['garmin-4'], type: 'Long run', planId: 'run2', typeLocked: true, autoType: false };
  const changed = settleWeek([oldPick, mine], 2, ctx);
  check('v1.18.1 settling a week turns the app\'s old picks into easy runs and leaves his alone', changed.length === 1 && changed[0].id === 'garmin-3' && oldPick.type === 'Easy run' && oldPick.planId === null && mine.type === 'Long run' && mine.planId === 'run2', [oldPick, mine].map(r => [r.id, r.type, r.planId]));
  check('v1.18.1 settling again changes nothing', settleWeek([oldPick, mine], 2, ctx).length === 0);
  // the one-time upgrade on his phone
  const before = {
    targets: { back_squat: { weight: 185, reps: 5, stall: 1, source: 'engine' }, strict_press: { weight: 95, reps: 4, stall: 0 }, curl: { weight: 40, reps: 10 } },
    runs: [
      { ...two['garmin-3'], type: 'Intervals', planId: 'run1', autoType: true, autoWhy: 'the week\'s intervals were still open' },
      { ...two['garmin-4'], type: 'Long run', planId: 'run2', typeLocked: true, autoType: false },
      { ...ski['garmin-18'], planId: 'run1', autoType: false },
      { ...ski['garmin-15'] },
      { id: 'run_5', date: '2026-11-24', type: 'Intervals', planId: 'run1', distance: 3 }
    ]
  };
  const snap = JSON.stringify(before);
  const up = upgrade1181({ ...before, rules });
  const upBy = Object.fromEntries(up.runs.map(r => [r.id, r]));
  check('v1.18.1 upgrade: flat counts from the old rule start again at 0 (R4 rule 11), nothing else in the targets moves', up.zeroed === 1 && up.targets.back_squat.stall === 0 && up.targets.back_squat.weight === 185 && up.targets.strict_press.stall === 0 && up.targets.curl.weight === 40, up.targets);
  check('v1.18.1 upgrade: the app\'s own pick becomes an easy run; a rower session loses the intervals credit the old app gave it', up.runs.length === 2 && upBy['garmin-3'].type === 'Easy run' && upBy['garmin-3'].planId === null && upBy['garmin-18'].type === 'Bike/rower sub' && upBy['garmin-18'].planId === null, up.runs.map(r => [r.id, r.type, r.planId]));
  check('v1.18.1 upgrade: his own picks, the ski day and runs logged by hand stay; the input is not changed', !upBy['garmin-4'] && !upBy['garmin-15'] && !upBy['run_5'] && JSON.stringify(before) === snap);
  check('v1.18.1 upgrade: run again on its own output, nothing changes', upgrade1181({ targets: up.targets, runs: before.runs.map(r => upBy[r.id] || r), rules }).runs.length === 0);
  check('v1.18.1 versions compare part by part (1.9 is older than 1.18.1)', olderThan('1.18.0', '1.18.1') && olderThan('1.9', '1.18.1') && olderThan('0', '1.18.1') && !olderThan('1.18.1', '1.18.1') && !olderThan('1.19.0', '1.18.1'));
  const days = (iso, id) => openRunDays({ ...ctx, runId: id, week: 2, today: new Date(iso + 'T09:00:00') }).map(d => d.name + (d.today ? '*' : ''));
  check('v1.12 open intervals can move to Thursday, Saturday or Sunday; past days and lift days drop off', days('2026-11-25', 'run1').join() === 'Thursday,Saturday,Sunday' && days('2026-11-26', 'run1').join() === 'Thursday*,Saturday,Sunday' && days('2026-11-28', 'run1').join() === 'Saturday*,Sunday' && days('2026-11-29', 'run1').join() === 'Sunday*', [days('2026-11-25', 'run1'), days('2026-11-26', 'run1')]);
  const moveDays = rules.runSchedule.moveTo;
  check('v1.12 no run is ever offered on a lift day', Object.values(moveDays).flat().every(d => !plan.sessions.some(s => s.id === plan.calendar[d])));
}

// ---- v1.18: Cameron's notes from his third workout ----
console.log('v1.18 builder: sides, change-overs, learned times');
{
  const t = rules.timing;
  const tl = buildTimeline({ plan, rules, settings, sessionId: 'lift3', week: 3, targets });
  const st = tl.steps.filter(s => s.kind === 'stretch');
  check('v1.18 a stretch done per side is one step: left, a change-over, right', st[0].perSide && st[0].sideSeconds === 60 && st[0].seconds === 120 + t.holdSwitchSeconds && st[1].perSide && st[1].sideSeconds === 45 && st[1].seconds === 90 + t.holdSwitchSeconds && !st[2].perSide && st[2].seconds === 45, st.map(x => [x.name, x.seconds, x.sideSeconds]));
  check('v1.18 the calf stretch says it is both legs at once', st[3].name === 'Calf stretch on a step' && st[3].where === 'Both legs at once' && !st[3].perSide, st[3]);
  const ch = tl.steps.filter(s => s.change);
  check('v1.18 a short change-over sits between stretches, and none before the first', ch.length === 3 && ch.every(s => s.kind === 'transition' && s.countdown && s.seconds === t.stretchSwitchSeconds && s.blockType === 'stretch') && !tl.steps[tl.steps.indexOf(st[0]) - 1].change && ch[0].name === 'Next: 90/90 hip hold', ch.map(s => s.name));
  const row = tl.steps.filter(s => s.exerciseId === 'db_row' && s.kind === 'set');
  const rowSecs = Math.round(t.setStartSeconds.dumbbell + (8 * 2 * 4 + t.sideSwitchSeconds) * (1 + t.setMarginFraction));
  check('v1.18 the dumbbell row is timed for both arms and the change-over (83 s, it was 39 s for both)', row.length === 3 && row.every(s => s.perSide && s.auto && s.seconds === rowSecs) && rowSecs === 83 && setTiming(rules, plan.exercises.db_row, 8, false).seconds === 39, row.map(s => s.seconds));
  const plank = tl.steps.filter(s => s.exerciseId === 'side_plank');
  check('v1.18 side plank: 25 s a side with the change-over planned in', plank.length === 3 && plank.every(s => s.perSide && s.holdSeconds === 25 && s.seconds === 50 + t.holdSwitchSeconds + 4), plank.map(s => s.seconds));
  // approved by Cameron on Nov 20: the calf raise loses its 1 s squeeze at the top; the 2 s pause at the bottom stays
  check('v1.18 the calf raise keeps its tempo (the 2 s pause at the bottom), with no squeeze at the top: 5 s a rep', !!plan.exercises.calf_raise.keepTempo && plan.exercises.calf_raise.tempo.join() === '2,2,1,0' && repSecondsFor(rules, plan.exercises.calf_raise) === 5 && !plan.exercises.calf_raise.tips.some(x => /squeeze/i.test(x)), plan.exercises.calf_raise);
  // approved the same day: on Friday the rest before the lighter lift of a pair is 30 s (it was 60 s)
  const l3 = plan.sessions.find(x => x.id === 'lift3');
  const restOf = id => l3.blocks.flatMap(b => b.items || []).find(i => i.exercise === id).restSeconds;
  check('v1.18 Lift 3: 30 s after the front squat and after the push press, the other rests as they were', restOf('front_squat') === 30 && restOf('push_press') === 30 && restOf('lateral_raise') === 80 && restOf('db_row') === 75 && restOf('power_clean') === 90, ['front_squat', 'push_press', 'lateral_raise', 'db_row', 'power_clean'].map(restOf));

  // learned times replace the plan's; rests stay as planned
  const pacing = { db_row: { repSeconds: 5 }, front_squat: { setupSeconds: 120 }, lateral_raise: { repSeconds: 2.5, setupSeconds: 10 } };
  const paced = buildTimeline({ plan, rules, settings, sessionId: 'lift3', week: 3, targets, pacing });
  const secsOf = (x, id) => x.steps.filter(s => s.exerciseId === id && s.kind === 'set' && !s.ramp).map(s => s.seconds);
  check('v1.18 learned seconds per rep change the set time: row 83 to 101 s, lateral raise 50 to 37 s', secsOf(paced, 'db_row').join() === '101,101,101' && secsOf(tl, 'lateral_raise').join() === '50,50,50' && secsOf(paced, 'lateral_raise').join() === '37,37,37', [secsOf(paced, 'db_row'), secsOf(tl, 'lateral_raise'), secsOf(paced, 'lateral_raise')]);
  check('v1.18 a learned set is marked, a planned one is not', paced.steps.filter(s => s.exerciseId === 'db_row' && s.kind === 'set').every(s => s.learned && s.repSeconds === 5) && !paced.steps.some(s => s.exerciseId === 'push_press' && s.learned));
  const setupOf = (x, id) => x.steps.filter(s => s.setupExercise === id).map(s => [s.kind, s.seconds, s.setupSeconds].join('/')).join();
  check('v1.18 learned set-up time: front squat 60 to 120 s; lateral raise 30 to 10 s inside its rest', setupOf(tl, 'front_squat') === 'transition/60/60' && setupOf(paced, 'front_squat') === 'transition/120/120' && setupOf(tl, 'lateral_raise') === 'rest/60/30' && setupOf(paced, 'lateral_raise') === 'rest/40/10', [setupOf(tl, 'front_squat'), setupOf(paced, 'front_squat'), setupOf(tl, 'lateral_raise'), setupOf(paced, 'lateral_raise')]);
  const pureRests = x => x.steps.filter(s => s.kind === 'rest').map(s => s.seconds - (s.setupSeconds || 0)).join();
  check('v1.18 rest times are never changed by pacing', pureRests(tl) === pureRests(paced));
  check('v1.18 setupSecondsFor: by equipment, or what was learned', setupSecondsFor(rules, plan.exercises.front_squat, null) === 60 && setupSecondsFor(rules, plan.exercises.front_squat, { setupSeconds: 95 }) === 95 && setupSecondsFor(rules, plan.exercises.lateral_raise, {}) === 30);
  check('v1.18 planned time follows the learned times', paced.plannedSeconds === tl.plannedSeconds + 3 * 18 - 3 * 13 + 60 - 20, [tl.plannedSeconds, paced.plannedSeconds]);

  // the lead-ins can be built again on what is left of a session (Equipment taken reorders sets, then calls this)
  const sig = arr => arr.map(s => [s.kind, s.seconds, s.name, s.setupSeconds || 0, s.lead ? 'L' : '', s.change ? 'C' : ''].join('|')).join('\n');
  const rebuild = at => {
    const head = tl.steps.slice(0, at);
    const seen = head.filter(x => x.kind === 'set' && x.exerciseId).map(x => x.exerciseId);
    return [...head, ...leadIns({ plan, rules, pacing: null }, tl.steps.slice(at).map(x => ({ ...x })), seen)];
  };
  // Equipment taken always rebuilds from the countdown in front of a set
  const leadAt = tl.steps.map((x, i) => ((x.kind === 'rest' || x.kind === 'transition') && tl.steps[i + 1] && tl.steps[i + 1].kind === 'set' ? i : -1)).filter(i => i >= 0);
  const differ = [0, ...leadAt].filter(at => sig(rebuild(at)) !== sig(tl.steps));
  check(`v1.18 lead-ins built again from any of the ${leadAt.length} countdowns give the same timeline`, leadAt.length > 30 && differ.length === 0, differ);
  const fromSet = rebuild(tl.steps.findIndex(x => x.kind === 'set' && x.exerciseId === 'side_plank'));
  check('v1.18 a set that lost its countdown gets one again', fromSet.length === tl.steps.length + 1 && fromSet.every((x, i) => x.kind !== 'set' || ['rest', 'transition'].includes(fromSet[i - 1].kind)), fromSet.length);
  const again2 = leadIns({ plan, rules, pacing }, paced.steps.map(x => ({ ...x })), []);
  check('v1.18 lead-ins built again keep the learned set-up times', sig(again2) === sig(paced.steps));
}

console.log('v1.18 pacing: what one set says');
{
  const cfg = pacingConfig(rules);
  check('v1.18 pacing rules: 3 sets in a row, 2 sessions for set-up, never under half or over 1.75 x the tempo', cfg.inARow === 3 && cfg.setup.inARow === 2 && cfg.minFactor === 0.5 && cfg.maxFactor === 1.75);
  // Lateral raise: 12 reps, the timer gives 50 s (4 s to start + 12 x 3.5 s + 10%)
  const rec = (secs, more = {}) => ({ exerciseId: 'lateral_raise', done: true, reps: 12, target: { reps: 12, weight: 30 }, at: '2026-11-20T18:00:00Z', secs: { plan: 50, ...secs }, ...more });
  const o = (secs, more) => setObservation(rec(secs, more), plan, rules);
  const early = o({ took: 30, by: 'done' });
  check('v1.18 Done with 20 s to spare is early; it used 2.2 s a rep of the 3.5 allowed', early && early.dir === 'early' && Math.abs(early.used - 26 / 12) < 1e-9 && Math.abs(early.allot - 46 / 1.1 / 12) < 1e-9, early);
  check('v1.18 Done 5 s before the end is not early (under 15% of the set)', o({ took: 45, by: 'done' }).dir === 'fit');
  check('v1.18 a set that ran to its timer fits', o({ took: 50, by: 'timer' }).dir === 'fit');
  const ext = o({ took: 62, by: 'timer', ext: 15 });
  check('v1.18 a set extended by 15 s is late, and needed all the time it took', ext.dir === 'late' && Math.abs(ext.used - 58 / 12) < 1e-9, ext);
  const paused = o({ took: 50, by: 'timer', paused: 12 });
  check('v1.18 a set paused for 12 s is late: the pause counts as time needed', paused.dir === 'late' && Math.abs(paused.used - 58 / 12) < 1e-9, paused);
  check('v1.18 a 3 s pause is not', o({ took: 50, by: 'timer', paused: 3 }).dir === 'fit');
  check('v1.18 a long pause counts for 30 s at most', Math.abs(o({ took: 50, by: 'timer', paused: 400 }).used - 76 / 12) < 1e-9);
  check('v1.18 Done after 6 s was a tap by mistake: it says nothing', o({ took: 6, by: 'done' }) === null);
  check('v1.18 numbers typed by hand say nothing about pace', o({ took: 30, by: 'manual' }) === null);
  check('v1.18 ramp-up, baseline, retest, all-out and skipped sets are left out', o({ took: 30, by: 'done' }, { ramp: true }) === null && o({ took: 30, by: 'done' }, { baseline: true }) === null && o({ took: 30, by: 'done' }, { retest: true }) === null && o({ took: 30, by: 'done' }, { amrap: true }) === null && o({ took: 30, by: 'done' }, { done: false, skipped: true }) === null);
  check('v1.18 a set saved before v1.18 (no timing kept) says nothing', setObservation({ exerciseId: 'lateral_raise', done: true, reps: 12, target: { reps: 12 } }, plan, rules) === null);
  const short = setObservation({ ...rec({ took: 25, by: 'done' }), reps: 8 }, plan, rules);
  check('v1.18 fewer reps than planned: early is judged against the time those reps get', short.dir === 'early' && Math.abs(short.used - 21 / 8) < 1e-9, short);
  // Dumbbell row, 8 a side: 83 s = 4 + (16 x 4 + 8) x 1.1
  const rowRec = (secs) => ({ exerciseId: 'db_row', done: true, reps: 8, perSide: true, target: { reps: 8, weight: 55 }, secs: { plan: 83, ...secs } });
  const rowFit = setObservation(rowRec({ took: 83, by: 'timer' }), plan, rules);
  check('v1.18 a set done per side counts both sides and the change-over: 4 s a rep allowed', rowFit.dir === 'fit' && Math.abs(rowFit.allot - 4) < 0.02, rowFit);
  const rowLate = setObservation(rowRec({ took: 98, by: 'timer', ext: 15 }), plan, rules);
  check('v1.18 the row extended by 15 s: 5.4 s a rep', rowLate.dir === 'late' && Math.abs(rowLate.used - 86 / 16) < 1e-9, rowLate);
  // independent review: a pause and an early Done read as late when Done came after Resume, and as early during the pause
  const brk = o({ took: 25, by: 'done', paused: 30 });
  const brkPaused = o({ took: 25, by: 'done' });
  check('v1.18 a 30 s pause and Done with 25 s to spare is early either way round (the pause was a break, not slow reps)', brk.dir === 'early' && brkPaused.dir === 'early' && brk.used === brkPaused.used, [brk, brkPaused]);
  const tight = o({ took: 47, by: 'done', paused: 20 });
  check('v1.18 a 20 s pause on a set that still used its time is late, and the pause counts as time needed', tight.dir === 'late' && Math.abs(tight.used - 63 / 12) < 1e-9, tight);
}

console.log('v1.18 pacing: when the time changes');
{
  const cfg = pacingConfig(rules);
  const ob = (dir, used, at) => ({ dir, used, allot: 3.5, at: at || null });
  const three = learnRep([ob('early', 2.17), ob('early', 2.3), ob('early', 2.0)], 3.5, cfg, false);
  check('v1.18 three sets in a row ended early: the slowest of them plus 8%, so 2.5 s a rep', three.repSeconds === 2.5 && three.changes.length === 1 && three.changes[0].dir === 'early' && three.run === null, three);
  const two = learnRep([ob('early', 2.17), ob('early', 2.3)], 3.5, cfg, false);
  check('v1.18 two in a row change nothing yet', two.repSeconds === null && two.run.dir === 'early' && two.run.n === 2, two);
  const broken = learnRep([ob('early', 2.17), ob('early', 2.3), ob('fit', 3.4), ob('early', 2.0)], 3.5, cfg, false);
  check('v1.18 a set that fit in between starts the count again', broken.repSeconds === null && broken.run.n === 1, broken);
  const mixed = learnRep([ob('early', 2.17), ob('early', 2.3), ob('late', 4.8)], 3.5, cfg, false);
  check('v1.18 early, early, late is not three in a row', mixed.repSeconds === null && mixed.run.dir === 'late' && mixed.run.n === 1, mixed);
  const late = learnRep([ob('late', 4.4), ob('late', 4.83), ob('late', 4.6)], 3.5, cfg, false);
  check('v1.18 three sets in a row extended or paused: the slowest of them, 4.8 s a rep', late.repSeconds === 4.8 && late.changes[0].dir === 'late', late);
  const cap = learnRep([ob('late', 9), ob('late', 9), ob('late', 9)], 3.5, cfg, false);
  check('v1.18 never more than 1.75 x the tempo', cap.repSeconds === 6.1, cap);
  const floor = learnRep([ob('early', 1), ob('early', 1), ob('early', 1)], 3.5, cfg, false);
  check('v1.18 never less than half the tempo', floor.repSeconds === 1.8, floor);
  const bss = learnRep([ob('late', 9), ob('late', 9), ob('late', 9)], 4.5, cfg, false);
  check('v1.18 rounding never goes past 1.75 x the tempo (4.5 s a rep: 7.8, not 7.9)', bss.repSeconds === 7.8, bss);
  const near = learnRep([ob('early', 3.1), ob('early', 3.1), ob('early', 3.1)], 3.5, cfg, false);
  check('v1.18 within 7% of the tempo it stays on the tempo', near.repSeconds === null && near.changes.length === 0, near);
  const keep = learnRep([ob('early', 3), ob('early', 3), ob('early', 3), ob('early', 3), ob('early', 3), ob('early', 3)], 6, cfg, true);
  check('v1.18 a keep-tempo lift (the calf raise pause) is never shortened, and the rushing is counted', keep.repSeconds === null && keep.nudge === 2 && keep.changes.length === 0, keep);
  const keepLate = learnRep([ob('late', 7), ob('late', 7.4), ob('late', 7.2)], 6, cfg, true);
  check('v1.18 a keep-tempo lift can still get more time', keepLate.repSeconds === 7.4, keepLate);
  const back = learnRep([ob('early', 2.17), ob('early', 2.3), ob('early', 2.0), ob('late', 3), ob('late', 3.1), ob('late', 2.9)], 3.5, cfg, false);
  check('v1.18 shortened too far, then extended three times: it comes back up to the slowest of those', back.repSeconds === 3.1 && back.changes.length === 2 && back.changes[1].from === 2.5, back);
  const again = learnRep([ob('late', 4.83), ob('late', 4.83), ob('late', 4.83), ob('early', 3.6), ob('early', 3.4), ob('early', 3.5)], 3.5, cfg, false);
  check('v1.18 lengthened, then ended early three times: back down, to the tempo when that is close', again.changes.length === 2 && again.repSeconds === 3.9, again);

  // set-up: seconds until the Set-up done tap
  const lead = (l, more = {}) => setupObservation({ exerciseId: 'front_squat', lead: l, ...more }, rules);
  const slow = lead({ plan: 60, setup: 60, by: 'tap', tap: 150 });
  check('v1.18 Set-up done after 2:30 on a 1:00 set-up: more time needed (the tap plus the 5 s count)', slow.dir === 'more' && slow.need === 155 && slow.allot === 60, slow);
  check('v1.18 a tap 8 s before the end fits', lead({ plan: 60, setup: 60, by: 'tap', tap: 52 }).dir === 'fit');
  const quick = lead({ plan: 60, setup: 60, by: 'tap', tap: 20 });
  check('v1.18 a tap after 20 s: less time needed', quick.dir === 'less' && quick.need === 25, quick);
  const inRest = lead({ plan: 90, setup: 30, by: 'tap', tap: 70 });
  check('v1.18 set-up inside a rest: only the part after the rest counts', inRest.dir === 'less' && inRest.need === 15, inRest);
  check('v1.18 a tap during the rest itself needs the least there is', lead({ plan: 90, setup: 30, by: 'tap', tap: 10 }).need === 10);
  check('v1.18 a countdown that ran out by itself is never "less"', lead({ plan: 60, setup: 60, by: 'timer', took: 60 }).dir === 'fit' && lead({ plan: 60, setup: 60, by: 'timer', took: 20 }).dir === 'fit');
  check('v1.18 a pause during set-up counts as set-up time', lead({ plan: 60, setup: 60, by: 'timer', took: 60, paused: 45 }).dir === 'more');
  // independent review: a 10-minute pause made the learned set-up 5 min
  const longPause = lead({ plan: 60, setup: 60, by: 'tap', tap: 650, tapPaused: 600 });
  check('v1.18 of a long pause before Set-up done, 1 min counts (10 min paused: 115 s, not 300)', longPause.need === 115 && longPause.dir === 'more', longPause);
  check('v1.18 the same cap when the countdown ran out by itself', lead({ plan: 60, setup: 60, by: 'timer', took: 60, paused: 600 }).need === 120);
  check('v1.18 no set-up time in the countdown: nothing to learn', lead({ plan: 60, setup: 0, by: 'tap', tap: 100 }) === null && lead({ plan: 60, setup: 0, by: 'tap', tap: 100 }, { ramp: true }) === null && setupObservation({ exerciseId: 'front_squat' }, rules) === null);
  check('v1.18 a main lift starts with a ramp-up: the set-up before that first ramp-up counts', lead({ plan: 60, setup: 60, by: 'tap', tap: 150 }, { ramp: true }).dir === 'more' && lead({ plan: 60, setup: 60, by: 'tap', tap: 150 }, { ramp: true }).need === 155);
  const su = (dir, need) => ({ dir, need, allot: 60, at: null });
  const more = learnSetup([su('more', 155), su('more', 145)], 60, cfg);
  check('v1.18 two sessions in a row with a slow set-up: their average, 2:30', more.setupSeconds === 150 && more.changes.length === 1, more);
  check('v1.18 one slow set-up changes nothing', learnSetup([su('more', 155)], 60, cfg).setupSeconds === null && learnSetup([su('more', 155), su('fit', 60), su('more', 150)], 60, cfg).setupSeconds === null);
  const less = learnSetup([su('less', 25), su('less', 31)], 60, cfg);
  check('v1.18 two quick set-ups in a row: 30 s (rounded to 5)', less.setupSeconds === 30, less);
  check('v1.18 set-up never under 10 s or over 5 min', learnSetup([su('less', 2), su('less', 3)], 60, cfg).setupSeconds === 10 && learnSetup([su('more', 900), su('more', 900)], 60, cfg).setupSeconds === 300);
}

console.log('v1.18 pacing: from saved sessions');
{
  const set = (id, i, secs, more = {}) => ({ exerciseId: id, name: id, setIndex: i, done: true, reps: more.reps || 12, target: { reps: more.reps || 12, weight: 30 }, at: `2026-11-20T18:0${i}:00Z`, secs, ...more });
  const sesA = { id: 'a', sessionId: 'lift3', week: 1, date: '2026-11-20', startedAt: '2026-11-20T18:00:00Z', sets: [
    set('lateral_raise', 1, { plan: 50, took: 30, by: 'done' }), set('lateral_raise', 2, { plan: 50, took: 31, by: 'done' }), set('lateral_raise', 3, { plan: 50, took: 29, by: 'done' }),
    set('db_row', 1, { plan: 83, took: 98, by: 'timer', ext: 15 }, { reps: 8, perSide: true }), set('db_row', 2, { plan: 83, took: 98, by: 'timer', ext: 15 }, { reps: 8, perSide: true }), set('db_row', 3, { plan: 83, took: 98, by: 'timer', ext: 15 }, { reps: 8, perSide: true }),
    set('calf_raise', 1, { plan: 76, took: 40, by: 'done' }, { reps: 11 }), set('calf_raise', 2, { plan: 76, took: 40, by: 'done' }, { reps: 11 }), set('calf_raise', 3, { plan: 76, took: 40, by: 'done' }, { reps: 11 }),
    { exerciseId: 'front_squat', name: 'Front squat', setIndex: 1, done: true, reps: 5, target: { reps: 5 }, at: '2026-11-20T18:10:00Z', lead: { plan: 60, setup: 60, by: 'tap', tap: 150 } }
  ] };
  const sesB = { id: 'b', sessionId: 'lift3', week: 2, date: '2026-11-27', startedAt: '2026-11-27T18:00:00Z', sets: [
    { exerciseId: 'front_squat', name: 'Front squat', setIndex: 1, done: true, reps: 5, target: { reps: 5 }, at: '2026-11-27T18:10:00Z', lead: { plan: 60, setup: 60, by: 'tap', tap: 140 } }
  ] };
  const one = learnPacing({ sessions: [sesA], plan, rules, settings });
  check('v1.18 after one session: lateral raise sets get shorter, the row longer', one.lateral_raise && one.lateral_raise.repSeconds === 2.4 && one.db_row && one.db_row.repSeconds === 5.4 && one.lateral_raise.tempoSeconds === 3.5 && one.db_row.tempoSeconds === 4, one);
  check('v1.18 the calf raise is not shortened, however fast it was done', one.calf_raise && one.calf_raise.repSeconds === undefined && one.calf_raise.nudge === 1, one.calf_raise);
  check('v1.18 one slow set-up is not enough to change the front squat set-up', !one.front_squat || one.front_squat.setupSeconds === undefined, one.front_squat);
  const both = learnPacing({ sessions: [sesB, sesA], plan, rules, settings });
  check('v1.18 two sessions in a row (in any order): front squat set-up 1:00 to 2:30', both.front_squat.setupSeconds === 150 && both.front_squat.defaultSetup === 60, both.front_squat);
  check('v1.18 Settings off: nothing is learned', Object.keys(learnPacing({ sessions: [sesA, sesB], plan, rules, settings: { ...settings, adaptTiming: false } })).length === 0);
  const since = learnPacing({ sessions: [sesA, sesB], plan, rules, settings: { ...settings, pacingSince: '2026-11-25T00:00:00.000Z' } });
  check('v1.18 Start over forgets the sessions before it', !since.lateral_raise && !since.db_row && (!since.front_squat || since.front_squat.setupSeconds === undefined), since);
  const live = learnPacing({ sessions: [], plan, rules, settings, extra: sesA.sets });
  check('v1.18 the sets of the session under way count too', live.lateral_raise && live.lateral_raise.repSeconds === 2.4, live.lateral_raise);
  check('v1.18 sessions saved before v1.18 teach nothing and break nothing', Object.keys(learnPacing({ sessions: [{ id: 'old', date: '2026-11-17', sets: [{ exerciseId: 'back_squat', done: true, reps: 4, weight: 185, target: { reps: 4 } }] }, { id: 'odd' }, null], plan, rules, settings })).length === 0);

  // what the start page says about it
  const plain = buildTimeline({ plan, rules, settings, sessionId: 'lift3', week: 3, targets });
  const paced = buildTimeline({ plan, rules, settings, sessionId: 'lift3', week: 3, targets, pacing: both });
  const lines = pacingLines(plain, paced);
  const line = id => (lines.find(l => l.exerciseId === id) || {}).text;
  check('v1.18 start page: lateral raise sets get 36 s, the plan gives 50', line('lateral_raise') === 'sets get 36 s (the plan\'s tempo gives 50 s)', lines);
  check('v1.18 start page: the row gets 108 s, the plan gives 83', line('db_row') === 'sets get 108 s (the plan\'s tempo gives 83 s)', lines);
  check('v1.18 start page: front squat set-up 2:30, was 1:00', line('front_squat') === 'set-up 2:30 (was 1:00)', lines);
  check('v1.18 start page: lifts that did not change are not listed', lines.length === 3 && pacingLines(plain, plain).length === 0, lines.map(l => l.exerciseId));
}

console.log('v1.18 player rules (no screen needed)');
{
  const mk = (sid, week, tg, st) => {
    const tl = buildTimeline({ plan, rules, settings: st || settings, sessionId: sid, week, targets: tg });
    const p = new Player({ timeline: tl, plan, rules, settings: st || settings, targets: tg, container: null, onFinish: () => {} });
    return { tl, p, at: pred => tl.steps.findIndex(pred) };
  };
  const tg = { ...targets, lateral_raise: { weight: 30, reps: 12 }, db_row: { weight: 55, reps: 8 }, calf_raise: { weight: 105, reps: 11 } };
  const { tl, p, at } = mk('lift3', 3, tg);
  const done = (i, w) => { const s = tl.steps[i]; s.done = true; s.record = { exerciseId: s.exerciseId, done: true, weight: w != null ? w : (s.target ? s.target.weight : null), reps: s.target ? s.target.reps : null }; };
  // confirm rules
  const firstClean = at(s => s.kind === 'set' && s.exerciseId === 'power_clean');
  check('v1.18 the countdown before the first set of an exercise waits for a tap', p.needsConfirm(firstClean - 1) === true);
  const cleans = tl.steps.map((s, i) => (s.kind === 'set' && s.exerciseId === 'power_clean' ? i : -1)).filter(i => i >= 0);
  const ramps = cleans.filter(i => tl.steps[i].ramp), work = cleans.filter(i => !tl.steps[i].ramp);
  done(cleans[0]);
  check('v1.21.0 one ramp-up to the next does not wait (rampUp.confirmBetween false)', tl.steps[cleans[1]].ramp && tl.steps[cleans[1]].target.weight !== tl.steps[cleans[0]].target.weight && p.needsConfirm(cleans[1] - 1) === false, [tl.steps[cleans[0]].target, tl.steps[cleans[1]].target]);
  cleans.slice(1, cleans.indexOf(work[0])).forEach(i => done(i));
  check('v1.18 a barbell set at a new weight waits too (the first work set after the ramp-ups: the bar has to be reloaded)', tl.steps[work[0]].target.weight !== tl.steps[ramps[ramps.length - 1]].target.weight && p.needsConfirm(work[0] - 1) === true, [tl.steps[ramps[ramps.length - 1]].target, tl.steps[work[0]].target]);
  done(work[0]);
  check('v1.18 the same weight again does not wait', tl.steps[work[1]].target.weight === tl.steps[work[0]].target.weight && p.needsConfirm(work[1] - 1) === false);
  done(work[0], 140);
  check('v1.18 a set logged at another weight than planned makes the next one wait', p.needsConfirm(work[1] - 1) === true);
  const lr = tl.steps.map((s, i) => (s.kind === 'set' && s.exerciseId === 'lateral_raise' ? i : -1)).filter(i => i >= 0);
  done(lr[0], 30); tl.steps[lr[1]].target = { ...tl.steps[lr[1]].target, weight: 40 };
  check('v1.18 dumbbells at a new weight do not wait (only the bar does)', p.needsConfirm(lr[1] - 1) === false);
  const firstStretch = at(s => s.kind === 'stretch');
  check('v1.18 the stretch block waits for Ready; the change-overs inside it do not', p.needsConfirm(firstStretch - 1) === true && tl.steps.every((s, i) => !s.change || p.needsConfirm(i) === false));
  const off = mk('lift3', 3, tg, { ...settings, confirmSetup: false });
  check('v1.18 Settings off: nothing waits', off.tl.steps.every((s, i) => off.p.needsConfirm(i) === false));
  const l2 = mk('lift2', 3, tg);
  const eng = l2.at(s => s.blockType === 'emom');
  check('v1.18 the Engine waits for Ready as well', l2.p.needsConfirm(eng - 1) === true && l2.p.needsConfirm(eng) === false);

  // what is said (Cameron: "say reps when saying workout types")
  const x = i => tl.steps[i];
  check('v1.18 voice: a barbell set says its reps and weight', p.setSpeech(x(work[1])) === 'Power clean, set 2 of 4, 2 reps at 135 pounds.', p.setSpeech(x(work[1])));
  check('v1.18 voice: two dumbbells are said as two', p.spokenTarget(x(lr[0])) === '12 reps with two 15 pound dumbbells', p.spokenTarget(x(lr[0])));
  const rowI = at(s => s.kind === 'set' && s.exerciseId === 'db_row');
  check('v1.18 voice: a lift done per side says each side', p.setSpeech(x(rowI)) === 'Dumbbell row, set 1 of 3, 8 reps each side at 55 pounds.' && p.readySpeech(x(rowI)) === 'Dumbbell row, 8 reps each side.', [p.setSpeech(x(rowI)), p.readySpeech(x(rowI))]);
  const plankI = at(s => s.exerciseId === 'side_plank');
  check('v1.18 voice: a hold says its seconds', p.readySpeech(x(plankI)) === 'Side plank, 25 seconds each side.' && p.spokenTarget(x(plankI)) === '25 seconds each side');
  check('v1.18 voice: the get-ready line is the name and the reps', p.readySpeech(x(work[1])) === 'Power clean, 2 reps.' && p.readySpeech({ name: 'Pull-up', target: { reps: 1 } }) === 'Pull-up, 1 rep.');
  const wp = l2.at(s => s.kind === 'set' && s.exerciseId === 'weighted_pullup' && !s.ramp);
  check('v1.18 voice: weighted pull-up says the added weight', l2.p.spokenTarget(l2.tl.steps[wp]) === '4 reps with 25 pounds added', l2.p.spokenTarget(l2.tl.steps[wp]));
  check('v1.18 voice: a stretch per side says the time each side', p.timedSpeech(x(firstStretch)) === 'Couch stretch. 1 minute each side. Left side first.' && p.timedSpeech(x(at(s => s.name === 'Calf stretch on a step'))) === 'Calf stretch on a step, both legs at once. 45 seconds.', [p.timedSpeech(x(firstStretch))]);
  p.s.idx = rowI - 1;
  check('v1.18 voice: a rest names the next set with its reps and weight', /^Rest, .+\. Then Dumbbell row, set 1 of 3, 8 reps each side at 55 pounds\.$/.test(p.leadSpeech(x(rowI - 1))), p.leadSpeech(x(rowI - 1)));

  // sides
  const sp = p.sidePlan(x(rowI));
  check('v1.18 sides on a set: 4 s to get set, 36 s left, 8 s to change over, 36 s right', sp.start === 4 && Math.abs(sp.leftEnd - 39.5) < 0.01 && Math.abs(sp.rightStart - 47.5) < 0.01 && sp.end === 83 && p.sided(x(rowI)), sp);
  const hp = p.sidePlan(x(plankI));
  check('v1.18 sides on a hold: 25 s, 6 s to change over, 25 s (it ran 50 s straight through)', hp.leftEnd === 25 && hp.rightStart === 31 && hp.end === 56 && p.stepSeconds(x(plankI)) === 56, hp);
  const cp = p.sidePlan(x(firstStretch));
  check('v1.18 sides on a stretch: 1:00, 6 s, 1:00', cp.leftEnd === 60 && cp.rightStart === 66 && cp.end === 126 && p.sided(x(firstStretch)) && !p.sided(x(at(s => s.name === 'Forward fold'))), cp);

  // the top row
  check('v1.18 top row: the block and its lifts in full, with a short form to fall back on', p.whereTexts(x(rowI)).full === 'Block C · Push press + Dumbbell row' && p.whereTexts(x(rowI)).short === 'Block C · Push press + DB row', p.whereTexts(x(rowI)));
  check('v1.18 top row: finisher shows the round; warm-up and stretch are named', p.whereTexts(x(plankI)).full === 'Finisher · Round 1 of 3' && p.whereTexts(x(0)).full === 'Warm-up' && p.whereTexts(x(firstStretch)).full === 'Stretch block');
  check('v1.18 strip letters: W, A, B, C, F, S, + for Lift 3 and E for the Engine', [...new Set(tl.steps.map(s => p.blockMark(s)))].join('') === 'WABCFS+' && l2.p.blockMark(l2.tl.steps[eng]) === 'E', [...new Set(tl.steps.map(s => p.blockMark(s)))].join(''));

  // Equipment taken inside a finisher (Cameron: "I don't see equipment taken on the standing calf raise finisher")
  const calfI = at(s => s.kind === 'set' && s.exerciseId === 'calf_raise');
  p.s.idx = calfI - 1;
  const cc = p.swapChoices();
  check('v1.18 Equipment taken on the calf raise: do it after the last round', cc.length === 1 && cc[0].kind === 'later' && cc[0].title === 'Do Standing calf raise after the last round' && /3 sets/.test(cc[0].sub), cc);
  const curlI = at(s => s.kind === 'set' && s.blockType === 'finisher');
  p.s.idx = curlI - 1;
  const fc = p.swapChoices();
  check('v1.18 Equipment taken on the first finisher lift: any other lift of the round first, or this one last, or... no other block', fc.filter(c => c.kind === 'first').map(c => c.title).join('; ') === 'Do Rope pushdown first; Do Side plank first; Do Standing calf raise first' && fc.filter(c => c.kind === 'later').length === 1 && fc.filter(c => c.kind === 'block').length === 0, fc.map(c => c.kind + ':' + c.title));
  const bI = at(s => s.kind === 'set' && s.blockId === 'B');
  p.s.idx = bI - 1;
  check('v1.18 Equipment taken before a block still offers the later blocks', p.swapChoices().map(c => c.kind + ':' + c.title.split(':')[0]).join() === 'block:Block C,block:Finisher', p.swapChoices().map(c => c.title));
  p.s.idx = work[2];
  check('v1.18 nothing to swap in the middle of a set', p.swapChoices().length === 0);

  // independent review: an early Right tap or +15 s changed the set itself, so after Undo or Back it ran short or long
  {
    const r = mk('lift3', 3, tg);
    const ri = r.at(s => s.kind === 'set' && s.exerciseId === 'db_row');
    r.p.tick = () => {};
    r.p.s.idx = ri; r.p.beginStep();
    const planned = r.tl.steps[ri].seconds;
    r.p.s.stepStart -= 12000;   // 12 s in: the left side is under way
    r.p.switchSideNow();
    const early = r.p.stepSeconds(r.tl.steps[ri]);
    r.p.beginStep();            // the same set again, as after Undo or Back one step
    check('v1.18 Right tapped early ends this pass sooner, but the set keeps its 83 s for the next time it runs', planned === 83 && Math.abs(early - 47.5) < 0.1 && r.tl.steps[ri].seconds === 83 && r.p.stepSeconds(r.tl.steps[ri]) === 83 && r.p.s.sideAt.end === 83, [planned, early, r.tl.steps[ri].seconds]);
    const li = r.at(s => s.kind === 'set' && s.exerciseId === 'lateral_raise');
    r.p.s.idx = li; r.p.beginStep();
    const lp = r.tl.steps[li].seconds;
    r.p.s.stepExt = 15;
    const ext = r.p.stepSeconds(r.tl.steps[li]);
    r.p.beginStep();
    check('v1.18 +15 s on a set lasts for this pass only', ext === lp + 15 && r.tl.steps[li].seconds === lp && r.p.stepSeconds(r.tl.steps[li]) === lp, [lp, ext]);
  }
  // independent review: the loud set-end and PR beeps started in the same instant and clipped
  {
    const starts = [];
    const node = () => ({ connect() {}, frequency: { value: 0 }, Q: { value: 0 }, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } });
    const audio = { currentTime: 10, state: 'running', destination: {}, createBiquadFilter: node, createGain: node, createOscillator: () => ({ ...node(), start: t => starts.push(t), stop() {} }) };
    const q = new Player({ timeline: tl, plan, rules, settings: { ...settings, cues: { ...(settings.cues || {}), beep: true, loud: true } }, targets: tg, container: null, onFinish: () => {} });
    q.audio = audio;
    q.tone('setEnd'); q.tone('pr');
    const endLen = Math.max(...rules.cues.tones.setEnd.map(([, dt, dur]) => dt + dur));
    check('v1.18 a PR beep asked for with the set-end beep starts after it ends', starts.length === 5 && starts[0] === 10 && Math.min(...starts.slice(2)) >= 10 + endLen, starts);
    audio.currentTime = 20; starts.length = 0; q.tone('tick');
    check('v1.18 a beep on its own plays at once', starts.length === 1 && starts[0] === 20, starts);
  }

  check('v1.18 gym clock: 47:12, then 1:02:45 past the hour', fmtGym(47 * 60 + 12) === '47:12' && fmtGym(3765) === '1:02:45' && fmtGym(-3) === '0:00' && fmtGym(59.9) === '0:59');
  p.s.sessionStart = 1000000; p.s.goneMs = 0;
  check('v1.18 gym time runs from Start, and leaves out a long gap with the app closed', p.gymMs(1000000 + 3600000) === 3600000 && (p.s.goneMs = 2400000, p.gymMs(1000000 + 3600000)) === 1200000 && p.gymMs(999000) === 0);
}

console.log('v1.18 runs on Progress, gym time, unchecked sets');
{
  const st = { ...settings, startDate: '2026-11-16' };
  const runs = [
    { id: 'r1', date: '2026-11-17', type: 'Intervals', planId: 'run1', distance: 2.8, minutes: 27 },
    { id: 'r2', date: '2026-11-24', type: 'Intervals', planId: 'run1', distance: 3, minutes: 29 },
    { id: 'r3', date: '2026-11-28', type: 'Long run', planId: 'run2', distance: 4, minutes: 40 },
    { id: 'r4', date: '2026-11-29', type: 'Bike/rower sub', planId: null, distance: 12, minutes: 45 }
  ];
  const ra = runAdherence(runs, plan, st, new Date(2026, 11, 2, 9));   // Wednesday of week 3
  const cells = id => ra.rows.find(r => r.id === id).cells.map(c => c.status).join();
  check('v1.18 Progress: the intervals row is done, done, open, then to come', cells('run1') === 'done,done,open,later,later,later,later,later,later,later,later,later', cells('run1'));
  check('v1.18 Progress: the long run was missed in week 1 and done in week 2', cells('run2') === 'missed,done,open,later,later,later,later,later,later,later,later,later' && ra.logged === 3 && ra.missed === 1, [cells('run2'), ra.logged, ra.missed]);
  check('v1.18 Progress: run rows carry short names that fit the grid', ra.rows.map(r => r.short).join() === 'Intervals,Long run' && ra.rows.every(r => r.isRun));
  check('v1.18 Progress: a done cell knows its date', ra.rows[1].cells[1].date === '2026-11-28' && ra.rows[1].cells[0].date === null);
  const rs = runSummary(runs, st, rules);
  check('v1.18 Running card: 4 runs, 9.8 running miles (the bike does not count), longest 4 mi', rs.count === 4 && rs.miles === 9.8 && rs.longest.id === 'r3' && rs.minutes === 141, rs);
  check('v1.18 Running card: latest pace 10:00 a mile, miles by week 2.8 then 7', rs.latestPace.date === '2026-11-28' && rs.latestPace.pace === 10 && rs.weeks[0].miles === 2.8 && rs.weeks[1].miles === 7 && rs.weeks[1].runs === 2 && rs.weeks.length === 12, [rs.latestPace, rs.weeks.slice(0, 3)]);
  const none = runSummary([], st, rules);
  check('v1.18 Running card: no runs, no numbers', none.count === 0 && none.miles === 0 && none.longest === null && none.latestPace === null);
  check('v1.18 Progress: no runs yet is all open or to come', runAdherence([], plan, st, new Date(2026, 10, 18, 9)).rows.every(r => r.cells[0].status === 'open' && r.cells[1].status === 'later'));

  check('v1.18 gym time is saved with the session; older sessions add working and paused time', gymSecondsOf({ gymSeconds: 5561, actualSeconds: 4234, pausedSeconds: 1327 }) === 5561 && gymSecondsOf({ actualSeconds: 4234, pausedSeconds: 1327 }) === 5561 && gymSecondsOf({ actualSeconds: 600 }) === 600 && gymSecondsOf(null) === 0);
  check('v1.18 paused time shown beside gym time is the pause inside it (hours with the app closed are neither)', pausedInGym({ gymSeconds: 2700, actualSeconds: 2400, pausedSeconds: 9000 }) === 300 && pausedInGym({ actualSeconds: 4234, pausedSeconds: 1327 }) === 1327 && pausedInGym({ actualSeconds: 600 }) === 0 && pausedInGym(null) === 0);
  check('v1.18 long times read 1 h 33 min', fmtLong(5561) === '1 h 33 min' && fmtLong(2820) === '47 min' && fmtLong(3600) === '1 h 00 min');
  check('v1.18 a set the timer logged counts as unchecked until it is confirmed', isUnchecked({ unconfirmed: true, done: true }) && !isUnchecked({ done: true }) && !isUnchecked({ unconfirmed: true, done: false, skipped: true }) && !isUnchecked({ unconfirmed: true, done: true, ramp: true }) && !isUnchecked(null));
  check('v1.18 exercise names written for the eye are speakable', speakable('Min 3 of 9: Kettlebell swings x 12') === 'Minute 3 of 9. Kettlebell swings, 12 reps' && speakable('Empty-bar clean + front squat complex x2') === 'Empty-bar clean and front squat complex, 2 times'
    && speakable('Bike or ski erg, 12-15 cal') === 'Bike or ski erg, 12 to 15 calories' && speakable('90/90 hip hold') === '90 90 hip hold', [speakable('Min 3 of 9: Kettlebell swings x 12'), speakable('90/90 hip hold')]);
}

{
  console.log('\nv1.18.5: easy ramp-up loads, no 27.5 lb dumbbells');
  const ramp = t => rules.rampUp.steps.slice(1).map(rs => easyLoad(rules, t * rs.fraction, t));
  check('v1.18.5 ramp-ups: squat 185 is 95, 135, 155 (his Nov 24 screen asked 130)', ramp(185).join() === '95,135,155', ramp(185));
  check('v1.18.5 ramp-ups: every ramp-up load is the bar, 45s and at most one more plate a side, and under the work weight', [95, 120, 155, 185, 200, 225, 250, 275, 300, 315].every(t => ramp(t).every(w => w < t && [0, 5, 10, 15, 25, 35].includes(((w - 45) / 2) % 45))), [200, 250, 300].map(ramp));
  check('v1.18.5 ramp-ups: heavier targets keep a real spread (315: 155, 225, 275)', ramp(315).join() === '155,225,275', ramp(315));
  const curl = plan.exercises.curl, row = plan.exercises.db_row;
  check('v1.18.5 dumbbells: 55 on a two-dumbbell curl is 2 x 27.5, which the gym does not have', !dumbbellOk(rules, curl, 55) && dumbbellOk(rules, curl, 50) && dumbbellOk(rules, curl, 60) && dumbbellOk(rules, curl, 35));
  check('v1.18.5 dumbbells: 55 -> 50 (lighter on a tie), 27.5 on a single dumbbell -> 25; good sizes stay; v1.18.10: a barbell lands on 5 lb (137.5 -> 135, 92.5 -> 90, 98 -> 100)', snapLoad(rules, curl, 55) === 50 && snapLoad(rules, row, 27.5) === 25 && snapLoad(rules, curl, 60) === 60 && snapLoad(rules, plan.exercises.back_squat, 137.5) === 135 && snapLoad(rules, plan.exercises.strict_press, 92.5) === 90 && snapLoad(rules, plan.exercises.strict_press, 98) === 100);
  const f = numberFlag({ weight: 55, reps: 10, target: { weight: 55, reps: 10 }, repRange: [10, 12], done: true }, curl, rules);
  check('v1.18.5 flag: a logged 55 lb curl asks what he really used', f && f.code === 'dumbbell' && /27\.5/.test(f.text), f);
  check('v1.18.5 flag: a 50 or 60 lb curl is fine', !numberFlag({ weight: 50, reps: 10, target: { weight: 55, reps: 10 }, repRange: [10, 12], done: true }, curl, rules) && !numberFlag({ weight: 60, reps: 10, target: { weight: 55, reps: 10 }, repRange: [10, 12], done: true }, curl, rules));
  const up = upgrade1185({ targets: { curl: { weight: 55, reps: 10 }, oh_tri_ext: { weight: 80, reps: 8 }, back_squat: { weight: 185, reps: 6 } }, rules, plan });
  check('v1.18.5 upgrade: his stored 55 lb curl target becomes 50 (2 x 25), reps and other lifts stay', up.zeroed === 1 && up.targets.curl.weight === 50 && up.targets.curl.reps === 10 && up.targets.oh_tri_ext.weight === 80 && up.targets.back_squat.weight === 185, up.targets);
  const sess = { id: 's', week: 3, phase: { id: 'build' }, endedAt: '2026-11-30T20:00:00Z', sets: [1, 2, 3].map(i => ({ exerciseId: 'curl', setIndex: i, weight: 50, reps: 12, rpe: 8, done: true })) };
  const pr = applyProgression({ session: sess, targets: { curl: { weight: 55, reps: 10 } }, rules, plan, settings });
  check('v1.18.5 progression: a 55 target reads as 50 (v1.18.15: 3 x 12 at 50 then climbs to 50 x 14, the next step is 60, never 65)', pr.targets.curl.weight === 50 && pr.targets.curl.reps === 14, pr.targets.curl);
  const hold = applyProgression({ session: { ...sess, sets: sess.sets.map(x => ({ ...x, unconfirmed: true })) }, targets: { curl: { weight: 55, reps: 10 } }, rules, plan, settings });
  check('v1.18.5 progression: an unrated session holds at 50, not 55', hold.targets.curl.weight === 50, hold.targets.curl);
}


// ---- v1.18.6: rules R5, main lifts step up every clean session (Cameron, Nov 24: "I want to be pushed") ----
{
  console.log('\nv1.18.6: weekly steps on the main lifts (rules R5)');
  const go = (id, week, t, sets, range) => applyProgression({ session: mkSession(week, sets.map(([w, r, e, x]) => ws(id, w, r, e, range, x))), targets: { [id]: { stall: 0, ...t } }, rules, plan, settings }).targets[id];
  let t = go('back_squat', 3, { weight: 195, reps: 5 }, [[195, 5, 8], [195, 5, 8], [195, 5, 6]], [4, 6]);
  check('R5 squat: 195 x 5 on all three sets at Solid or easier -> 200 x 5', t.weight === 200 && t.reps === 5 && t.stall === 0, t);
  t = go('back_squat', 3, { weight: 195, reps: 5 }, [[195, 5, 8], [195, 5, 9], [195, 5, 8]], [4, 6]);
  check('R5 squat: a Hard set that made its reps holds 195 x 5, nothing counted', t.weight === 195 && t.reps === 5 && t.stall === 0, t);
  t = go('back_squat', 3, { weight: 195, reps: 5 }, [[195, 5, 8], [195, 5, 8], [195, 4, 9]], [4, 6]);
  check('R5 squat: a missed rep holds 195 x 5 and counts one flat session', t.weight === 195 && t.reps === 5 && t.stall === 1, t);
  t = go('back_squat', 3, { weight: 195, reps: 5, stall: 2 }, [[195, 5, 8], [195, 5, 8], [195, 4, 9]], [4, 6]);
  check('R5 squat: the third flat session in a row still takes 5% off (185 x 5)', t.weight === 185 && t.reps === 5 && t.stall === 0, t);
  t = go('back_squat', 3, { weight: 185, reps: 6 }, [[185, 6, 8], [185, 6, 8], [185, 6, 8]], [4, 6]);
  check('R5 squat: a 6-rep target steps up and settles at 5 reps (190 x 5)', t.weight === 190 && t.reps === 5, t);
  t = go('back_squat', 3, { weight: 190, reps: 4 }, [[190, 4, 8], [190, 4, 8], [190, 4, 8]], [4, 6]);
  check('R5 squat: a 4-rep target gains a rep before weight (190 x 5)', t.weight === 190 && t.reps === 5, t);
  t = go('back_squat', 3, { weight: 195, reps: 5 }, [[195, 5, 8], [195, 5, 8], [195, 5, 8, { unconfirmed: true }]], [4, 6]);
  check('R5 squat: an unrated set still holds the target (R4 rule 1)', t.weight === 195 && t.reps === 5, t);
  t = go('back_squat', 3, { weight: 195, reps: 5 }, [[195, 5, 8], [195, 5, 8], [null, null, null, { done: false, skipped: true }]], [4, 6]);
  check('R5 squat: two of three sets done holds', t.weight === 195 && t.reps === 5, t);
  t = go('back_squat', 3, { weight: 195, reps: 5 }, [[200, 5, 8], [200, 5, 8], [200, 5, 8]], [4, 6]);
  check('R5 squat: 200 x 5 done against a 195 target -> 205 x 5', t.weight === 205 && t.reps === 5, t);
  t = go('back_squat', 3, { weight: 195, reps: 5 }, [[205, 4, 9], [205, 4, 9], [205, 4, 9]], [4, 6]);
  check('R5 squat: 205 x 4 at Hard against 195 x 5 -> the target follows to 205 x 4, no extra step', t.weight === 205 && t.reps === 4, t);
  t = go('strict_press', 2, { weight: 90, reps: 5 }, [[90, 5, 8], [90, 5, 8], [90, 5, 8], [90, 5, 8]], [4, 6]);
  check('R5 press: week 2 no longer blocks a step (90 x 5 -> 95 x 5; 5 lb steps since v1.18.10)', t.weight === 95 && t.reps === 5, t);
  t = go('weighted_pullup', 3, { weight: 30, reps: 5 }, [[30, 5, 8], [30, 5, 8], [30, 5, 8], [30, 5, 8]], [4, 6]);
  check('R5 pull-up: +30 x 5 -> +35 x 5', t.weight === 35 && t.reps === 5, t);
  t = go('push_press', 3, { weight: 95, reps: 5 }, [[95, 5, 8], [95, 5, 8], [95, 5, 8]], [3, 5]);
  check('R5 push press: steps are 5 lb now (95 x 5 -> 100 x 5)', t.weight === 100 && t.reps === 5, t);
  t = go('front_squat', 3, { weight: 140, reps: 5 }, [[140, 5, 8], [140, 5, 8], [140, 5, 8]], [5, 6]);
  check('R5 front squat: 140 x 5 -> 145 x 5', t.weight === 145 && t.reps === 5, t);
  t = go('back_squat', 9, { weight: 225, reps: 3, heavyStart: { week: 8, from: { weight: 215, reps: 5 } } }, [[225, 3, 8], [225, 3, 8], [225, 3, 8]], [3, 5]);
  check('R5 heavier weeks: reps stay at 3 and the weight steps (225 x 3 -> 230 x 3)', t.weight === 230 && t.reps === 3, t);
  t = go('back_squat', 7, { weight: 215, reps: 5 }, [[215, 5, 8], [215, 5, 8]], [4, 6]);
  check('R5 lighter week: nothing moves', t.weight === 215 && t.reps === 5, t);
  t = go('rdl', 3, { weight: 195, reps: 8 }, [[195, 8, 8], [195, 8, 8], [195, 8, 8]], [6, 8]);
  check('RDL: accessory rule unchanged, steps land on 10s (195 x 8 -> 200 x 6)', t.weight === 200 && t.reps === 6, t);
  t = go('rdl', 4, { weight: 200, reps: 8 }, [[200, 8, 8], [200, 8, 8], [200, 8, 8]], [6, 8]);
  check('RDL: then 10 lb a step (200 x 8 -> 210 x 6)', t.weight === 210 && t.reps === 6, t);
  t = go('rdl', 3, { weight: 195, reps: 6 }, [[195, 6, 8], [195, 6, 8], [195, 6, 9]], [6, 8]);
  check('RDL: reps first, a Hard last set adds one rep (195 x 6 -> 195 x 7)', t.weight === 195 && t.reps === 7, t);

  console.log('\nv1.18.7: the last set\'s rating sets the pace (rules.lastSetRating)');
  const U = { unconfirmed: true };
  t = go('curl', 3, { weight: 50, reps: 10 }, [[50, 10, 9, U], [50, 10, 9, U], [50, 10, 9]], [10, 12]);
  check('last set rated Hard, earlier sets unrated: the curl moves a rep (50 x 11); it used to hold', t.weight === 50 && t.reps === 11, t);
  t = go('curl', 3, { weight: 50, reps: 10 }, [[50, 10, 9], [50, 10, 9], [50, 10, 9, U]], [10, 12]);
  check('last set unrated: the curl still holds at 50 x 10', t.weight === 50 && t.reps === 10, t);
  t = go('curl', 3, { weight: 50, reps: 10 }, [[50, 10, 9, U], [50, 10, 9, U], [50, 10, 8]], [10, 12]);
  check('last set Solid: two more reps (50 x 12)', t.weight === 50 && t.reps === 12, t);
  t = go('curl', 3, { weight: 50, reps: 11 }, [[50, 11, 8], [50, 11, 8], [50, 11, 8]], [10, 12]);
  check('last set Solid near the top: v1.18.15 reps may pass the top while 60 is out of reach (50 x 13)', t.weight === 50 && t.reps === 13, t);
  t = go('curl', 3, { weight: 50, reps: 10 }, [[50, 10, 9], [50, 10, 9], [50, 10, 6]], [10, 12]);
  check('last set Easy: v1.18.15 60 is out of reach from 50 x 10 (predicts 7 with the Easy bonus), so three more reps (50 x 13)', t.weight === 50 && t.reps === 13, t);
  t = go('curl', 3, { weight: 50, reps: 10 }, [[50, 10, 6], [50, 10, 6], [50, 10, 10]], [10, 12]);
  check('Easy early, Maxed last: the last set decides, one rep (50 x 11)', t.weight === 50 && t.reps === 11, t);
  t = go('curl', 3, { weight: 50, reps: 10 }, [[50, 10, 8], [50, 10, 8], [50, 8, 6]], [10, 12]);
  check('a missed rep never earns more than one rep, whatever the rating (50 x 9 -> clamps to 10)', t.weight === 50 && t.reps === 10, t);
  t = go('curl', 3, { weight: 50, reps: 10 }, [[50, 10, 6], [50, 10, 6], [null, null, null, { done: false, skipped: true }]], [10, 12]);
  check('Easy on the last set done but a planned set missing: no weight step', t.weight === 50, t);
  t = go('leg_curl', 2, { weight: 100, reps: 10 }, [[100, 10, 9], [100, 10, 9], [100, 10, 6]], [8, 12]);
  check('week 2 no longer holds an accessory: Easy last set on the leg curl -> 105 x 8', t.weight === 105 && t.reps === 8, t);
  t = go('ab_wheel', 3, { reps: 10 }, [[null, 10, 9, U], [null, 10, 9, U], [null, 10, 8]], [10, 12]);
  check('bodyweight move, last set Solid: 10 -> 12', t.reps === 12, t);
  t = go('back_squat', 3, { weight: 195, reps: 5 }, [[195, 5, 8, U], [195, 5, 8, U], [195, 5, 8]], [4, 6]);
  check('main lift: last set rated Solid, earlier sets unrated -> steps up (200 x 5)', t.weight === 200 && t.reps === 5, t);
  t = go('back_squat', 3, { weight: 195, reps: 5 }, [[195, 5, 9], [195, 5, 8, U], [195, 5, 8]], [4, 6]);
  check('main lift: a set he rated Hard still holds it, even with a Solid last set', t.weight === 195 && t.reps === 5, t);
  t = go('back_squat', 3, { weight: 195, reps: 5 }, [[195, 5, 8, U], [195, 5, 8, U], [195, 5, 9]], [4, 6]);
  check('main lift: last set Hard holds', t.weight === 195 && t.reps === 5, t);
  const off = JSON.parse(JSON.stringify(rules)); delete off.lastSetRating;
  const h = applyProgression({ session: mkSession(3, [ws('curl', 50, 10, 9, [10, 12], U), ws('curl', 50, 10, 9, [10, 12], U), ws('curl', 50, 10, 8, [10, 12])]), targets: { curl: { weight: 50, reps: 10 } }, rules: off, plan, settings }).targets.curl;
  check('without rules.lastSetRating an unrated set holds the lift as before', h.weight === 50 && h.reps === 10, h);
  const old = JSON.parse(JSON.stringify(rules)); delete old.mainLiftTest.weekly;
  const o = applyProgression({ session: mkSession(3, [1, 2, 3].map(() => ws('back_squat', 195, 5, 8, [4, 6]))), targets: { back_squat: { weight: 195, reps: 5, stall: 0 } }, rules: old, plan, settings }).targets.back_squat;
  check('without rules.mainLiftTest.weekly the R4 rule still applies (195 x 5 -> 195 x 6)', o.weight === 195 && o.reps === 6, o);
  check('the power clean is not a weekly lift', !rules.mainLiftTest.weekly.exercises.includes('power_clean') && rules.mainLiftTest.weekly.exercises.length === 5);
}


// ---- v1.18.8: the projection's three cases ----
{
  console.log('\nv1.18.8: projection, three cases');
  const { projectExercise } = await import('../js/projection.js');
  const today = new Date('2026-11-25T12:00:00');
  const proj = (id, t) => projectExercise({ plan, rules, settings: { ...settings, startDate: '2026-11-16' }, sessions: [], targets: { [id]: t }, exerciseId: id, today });
  const sq = proj('back_squat', { weight: 195, reps: 5, stall: 0 });
  check('squat from 195 x 5: doing well 245 x 3, steady 225 x 3, struggling 220 x 3 by week 11', sq.end.well.weight === 245 && sq.end.well.reps === 3 && sq.end.steady.weight === 225 && sq.end.struggle.weight === 220, sq.end);
  check('squat: estimated max 230 now; 270, 250, 240 at the end (v1.18.10: to 5 lb, was 228, 248, 242); retest 5-rep weights 230, 210, 205', sq.now.max === 230 && sq.end.well.max === 270 && sq.end.steady.max === 250 && sq.end.struggle.max === 240 && sq.end.well.fiveRep === 230 && sq.end.steady.fiveRep === 210 && sq.end.struggle.fiveRep === 205, [sq.now, sq.end]);
  check('squat: the struggling case never resets (a rep short two weeks in three, the third clears the count)', sq.weeks.every((w, i, a) => !i || w.struggle.weight >= a[i - 1].struggle.weight - 0), sq.weeks.map(w => w.struggle.weight));
  check('squat: his old best (245) comes from plan.json', sq.oldBest === 245 && sq.weekly === true);
  check('v1.18.9 squat: the benchmark (Intermediate at 165 lb, 274, shown as 275) comes from plan.json; accessories have none', sq.standard.lb === 275 && /165/.test(sq.standard.label) && proj('curl', { weight: 50, reps: 10 }).standard === null);
  const pu = proj('weighted_pullup', { weight: 30, reps: 5, stall: 0 });
  check('pull-up: max is added weight (65 now, was 63 before 5 lb rounding) and no case passes 20% over today on bodyweight + load', pu.now.max === 65 && pu.end.well.e1rm <= Math.round(230 * 1.2) && pu.end.well.max > pu.end.steady.max && pu.end.steady.max > pu.end.struggle.max, [pu.now, pu.end]);
  const cu = proj('curl', { weight: 50, reps: 10 });
  check('curl: every case stays within 35% of today and on dumbbells the gym has', ['well', 'steady', 'struggle'].every(c => cu.end[c].e1rm <= 67 * 1.35 + 1 && cu.end[c].weight % 10 === 0) && cu.weekly === false, cu.end);
  const lr = proj('lateral_raise', { weight: 30, reps: 12 });
  check('lateral raise: no more 30 -> 80; one dumbbell step at most (40)', lr.end.well.weight <= 40, lr.end.well);
  const aw = proj('ab_wheel', { reps: 10 });
  check('ab wheel: reps only, doing well reaches the top of the range', aw.kind === 'reps' && aw.end.well.reps === 12, aw.end);
  const noCap = JSON.parse(JSON.stringify(rules)); delete noCap.projection;
  const free = projectExercise({ plan, rules: noCap, settings: { ...settings, startDate: '2026-11-16' }, sessions: [], targets: { lateral_raise: { weight: 30, reps: 12 } }, exerciseId: 'lateral_raise', today });
  check('without rules.projection the lines run free (the cap is what holds them)', free.end.well.weight > 40, free.end.well);
}

// ---- v1.18.10: every weight the app asks for or shows is a friendly one (Cameron, Nov 25) ----
{
  console.log('\nv1.18.10: 5 lb steps everywhere');
  const { projectExercise, CASES } = await import('../js/projection.js');
  const today = new Date('2026-11-25T12:00:00');
  const st = { ...settings, startDate: '2026-11-16', bodyweightLb: 165 };
  // his targets on Nov 25 (strict press put on a 2.5 step to check it comes back to the grid)
  const T = { back_squat: { weight: 195, reps: 5 }, rdl: { weight: 195, reps: 7 }, calf_raise: { weight: 105, reps: 12 }, bss: { weight: 70, reps: 8 }, leg_curl: { weight: 100, reps: 11 },
    curl: { weight: 60, reps: 10 }, oh_tri_ext: { weight: 80, reps: 8 }, strict_press: { weight: 92.5, reps: 5 }, weighted_pullup: { weight: 30, reps: 5 }, incline_db_press: { weight: 120, reps: 7 },
    cs_row: { weight: 55, reps: 8 }, lateral_raise: { weight: 30, reps: 12 }, incline_curl: { weight: 40, reps: 8 }, front_squat: { weight: 140, reps: 5 }, push_press: { weight: 95, reps: 5 },
    db_row: { weight: 55, reps: 8 }, preacher_curl: { weight: 25, reps: 8 }, rope_pushdown: { weight: 90, reps: 10 }, ab_wheel: { reps: 10 } };
  const loadable = (id, w) => { const ex = plan.exercises[id]; if (w == null) return true; const per = ex.equipment === 'dumbbell' && ex.pair ? w / 2 : w; return per % 5 === 0 && !(ex.equipment === 'dumbbell' && per === 27.5); };
  const bad = [], badMax = [];
  for (const id of Object.keys(T)) {
    const p = projectExercise({ plan, rules, settings: st, sessions: [], targets: T, exerciseId: id, today });
    if (!p || p.kind === 'self') continue;
    for (const w of [{ now: p.now }, ...p.weeks].flatMap(r => Object.values(r).filter(v => v && typeof v === 'object'))) {
      if (!loadable(id, w.weight)) bad.push(`${id} ${w.weight}`);
      if (w.max != null && w.max % 5) badMax.push(`${id} ${w.max}`);
      if (w.fiveRep != null && w.fiveRep % 5) bad.push(`${id} 5RM ${w.fiveRep}`);
    }
    if (p.standard && p.standard.lb % 5) badMax.push(`${id} standard ${p.standard.lb}`);
  }
  check('v1.18.10 Plan sheet: every target in every case, every week, on every lift is a weight he can load (5 lb steps, dumbbells per hand, no 27.5s)', !bad.length, bad.slice(0, 8));
  check('v1.18.10 Plan sheet: every estimated max and benchmark shown is on 5 lb (no 248, 242, 274)', !badMax.length, badMax.slice(0, 8));
  // the engine itself, a session at a time, from off-grid starting points
  const offs = [];
  for (const [id, w] of [['strict_press', 92.5], ['push_press', 97.5], ['back_squat', 187.5], ['front_squat', 142.5], ['weighted_pullup', 27.5], ['rope_pushdown', 92.5], ['curl', 55]]) {
    const ex = plan.exercises[id];
    const n = ex.mainLift ? 3 : 3;
    for (const rpe of [6, 8, 9]) {
      const r = applyProgression({ session: mkSession(4, Array.from({ length: n }, () => ws(id, w, 5, rpe, [3, 12]))), targets: { [id]: { weight: w, reps: 5, stall: 2 } }, rules, plan, settings: st });
      if (!loadable(id, r.targets[id].weight)) offs.push(`${id} ${w} rpe ${rpe} -> ${r.targets[id].weight}`);
    }
  }
  check('v1.18.10 engine: from an off-step target (92.5 press, 27.5 pull-up, 2 x 27.5 curl) the next target is always on a 5 lb step', !offs.length, offs);
  const missed = applyProgression({ session: mkSession(4, [1, 2, 3, 4].map(() => ws('strict_press', 95, 3, 9, [4, 6]))), targets: { strict_press: { weight: 95, reps: 5, stall: 2 } }, rules, plan, settings: st }).targets.strict_press;
  check('v1.18.10 the 5% reset on a 95 press lands on 90, not 90.25 or 92.5', missed.weight === 90, missed);
  check('v1.18.10 the strict press steps 5 lb like every other lift', incrementFor(rules, 'strict_press', plan.exercises.strict_press) === 5 && Object.values(rules.increments.byExercise).every(v => v >= 5));
  const heavy = effectiveTarget({ rules, plan, settings: st, exerciseId: 'strict_press', target: { weight: 95, reps: 5 }, phaseId: 'heavy' });
  check('v1.18.10 heavy-week start on a 95 press: 95 x 1.05 = 99.75 -> 100', heavy.weight === 100, heavy);
  const up = upgrade11810({ targets: { strict_press: { weight: 92.5, reps: 5, e1rm: 111, bestE1rm: 111 }, back_squat: { weight: 195, reps: 5, e1rm: 228, bestE1rm: 221, baselineE1rm: 216 }, curl: { weight: 55, reps: 10, bestE1rm: 73 }, ab_wheel: { reps: 10 } }, rules, plan });
  check('v1.18.10 upgrade: a 92.5 press target goes to 90, a 2 x 27.5 curl to 50, every stored estimate to 5 lb (228 -> 230, 221 -> 220)', up.targets.strict_press.weight === 90 && up.targets.curl.weight === 50 && up.targets.back_squat.e1rm === 230 && up.targets.back_squat.bestE1rm === 220 && up.targets.back_squat.baselineE1rm === 215 && up.targets.strict_press.e1rm === 110 && up.targets.ab_wheel.reps === 10 && up.zeroed === 3, up);
  check('v1.18.10 upgrade: run again on its own output, nothing changes', upgrade11810({ targets: up.targets, rules, plan }).zeroed === 0);
}

// ---- v1.18.11: a goal per lift, a hand-set target, the chart's columns (Cameron, Nov 25) ----
{
  console.log('\nv1.18.11: goals, overrides and the chart');
  const { goalPushFor, goalMax } = await import('../js/progression.js');
  const { checkGoal, checkTarget, chartColumns, weekReaching, canPush, pushStep, goalShownMax, goalAtReps } = await import('../js/lift-goal.js');
  const { projectExercise } = await import('../js/projection.js');
  const withGoal = (id, g) => ({ ...settings, startDate: '2026-11-16', liftGoals: { [id]: g } });
  const go = (id, week, t, sets, range, st) => applyProgression({ session: mkSession(week, sets.map(([w, r, e, x]) => ws(id, w, r, e, range, x))), targets: { [id]: { stall: 0, ...t } }, rules, plan, settings: st }).targets[id];
  const pushSq = withGoal('back_squat', { weight: 265, reps: 1, push: 5 });
  let t = go('back_squat', 3, { weight: 195, reps: 5 }, [[195, 5, 8], [195, 5, 8], [195, 5, 8]], [4, 6], pushSq);
  check('push: a clean squat session steps 10 lb (195 -> 205 x 5) while the goal is ahead', t.weight === 205 && t.reps === 5, t);
  t = go('back_squat', 3, { weight: 195, reps: 5 }, [[195, 5, 8], [195, 5, 8], [195, 5, 8]], [4, 6], withGoal('back_squat', { weight: 265, reps: 1, push: 0 }));
  check('a goal on normal steps changes nothing (195 -> 200)', t.weight === 200, t);
  t = go('back_squat', 3, { weight: 195, reps: 5 }, [[195, 5, 8], [195, 5, 9], [195, 5, 8]], [4, 6], pushSq);
  check('push: a Hard set still holds 195 x 5', t.weight === 195 && t.reps === 5 && t.stall === 0, t);
  t = go('back_squat', 3, { weight: 195, reps: 5 }, [[195, 5, 8], [195, 5, 8], [195, 4, 9]], [4, 6], pushSq);
  check('push: a missed rep holds and counts one flat session, as before', t.weight === 195 && t.stall === 1, t);
  t = go('back_squat', 3, { weight: 195, reps: 5 }, [[200, 5, 8], [200, 5, 8], [200, 5, 8]], [4, 6], pushSq);
  check('push: heavier than the target with every set made steps 10 from there (200 -> 210)', t.weight === 210, t);
  t = go('back_squat', 3, { weight: 230, reps: 5 }, [[230, 5, 8], [230, 5, 8], [230, 5, 8]], [4, 6], pushSq);
  check('push: a target already at the goal (230 x 5, est. 268 >= 265) is back on 5 lb steps', t.weight === 235, t);
  const lines = applyProgression({ session: mkSession(3, [195, 195, 195].map(w => ws('back_squat', w, 5, 8, [4, 6]))), targets: { back_squat: { weight: 195, reps: 5, stall: 0 } }, rules, plan, settings: pushSq }).lines;
  check('push: the what-changed line says the extra is toward his goal', /5 lb extra toward your goal/.test(lines[0].text) && /goal/.test(lines[0].reason), lines[0]);
  t = go('rdl', 3, { weight: 195, reps: 8 }, [[195, 8, 8], [195, 8, 8], [195, 8, 8]], [6, 8], withGoal('rdl', { weight: 275, reps: 1, push: 10 }));
  const t0 = go('rdl', 3, { weight: 195, reps: 8 }, [[195, 8, 8], [195, 8, 8], [195, 8, 8]], [6, 8], settings);
  check('push: an accessory (RDL) ignores a push, its rules are unchanged', t.weight === t0.weight && t.reps === t0.reps && t.weight === 200, [t, t0]);
  check('push: the power clean never pushes', goalPushFor(rules, 'power_clean', plan.exercises.power_clean, withGoal('power_clean', { weight: 185, reps: 1, push: 5 }), { weight: 155, reps: 2 }) === 0);
  const puGoal = w => goalPushFor(rules, 'weighted_pullup', plan.exercises.weighted_pullup, withGoal('weighted_pullup', { weight: w, reps: 1, push: 5 }), { weight: 30, reps: 5 });
  check('push: the pull-up goal counts bodyweight (+70 x 1 beats +30 x 5 at 165 lb, +60 x 1 does not)', puGoal(70) === 5 && puGoal(60) === 0 && goalMax(225, 1) === 225);
  check('canPush: the weekly main lifts only', canPush(rules, 'back_squat', plan.exercises.back_squat) && canPush(rules, 'weighted_pullup', plan.exercises.weighted_pullup) && !canPush(rules, 'rdl', plan.exercises.rdl) && !canPush(rules, 'power_clean', plan.exercises.power_clean) && !canPush(rules, 'curl', plan.exercises.curl) && pushStep(rules, 'back_squat', plan.exercises.back_squat) === 5);

  // goals checked before they can be saved (Cameron, Nov 19: bad numbers must not move the plan)
  const cg = (id, g, now) => checkGoal({ rules, plan, settings: { ...settings }, exerciseId: id, goal: g, now });
  const sqNow = { weight: 195, reps: 5 };
  let c = cg('back_squat', { weight: 265, reps: 1 }, sqNow);
  check('goal 265 x 1 on a 195 x 5 squat: fine, 15% over an estimated 230', c.level === 'ok' && c.max === 265 && Math.round(c.gain * 100) === 15, c);
  c = cg('back_squat', { weight: 290, reps: 1 }, sqNow);
  check('goal 290: flagged, past the 20% a block adds (needs his OK)', c.level === 'flag' && /20%/.test(c.text) && /Androulakis/.test(c.text), c);
  c = cg('back_squat', { weight: 2650, reps: 1 }, sqNow);
  check('goal 2650 (a typo): refused', c.level === 'block' && /typo/.test(c.text), c);
  c = cg('back_squat', { weight: 225, reps: 1 }, sqNow);
  check('goal under today (225 x 1 < est. 228): refused, already there', c.level === 'block' && /already there/.test(c.text), c);
  c = cg('back_squat', { weight: 30, reps: 1 }, sqNow);
  check('goal under the empty bar: refused', c.level === 'block' && /empty bar/.test(c.text), c);
  c = cg('back_squat', { weight: 225, reps: 20 }, sqNow);
  check('goal for 20 reps: refused (1 to 12)', c.level === 'block', c);
  c = cg('back_squat', { weight: '', reps: 1 }, sqNow);
  check('goal with no weight: refused', c.level === 'block', c);
  c = cg('weighted_pullup', { weight: 69, reps: 1 }, { weight: 30, reps: 5 });
  check('pull-up goal +69: shown as added weight, gain on bodyweight + load', c.level === 'ok' && c.max === 69, c);
  check('goal shown max and the 5-rep weight it gives: 265 x 1 -> 225 x 5 on 5 lb steps', goalShownMax(plan.exercises.back_squat, { weight: 265, reps: 1 }, settings) === 265 && goalAtReps(plan.exercises.back_squat, { weight: 265, reps: 1 }, 5, settings, 5) === 225);

  // a next target typed by hand
  const ct = (id, w, r, cur, range) => checkTarget({ rules, plan, exerciseId: id, current: cur, weight: w, reps: r, range });
  check('override 205 x 5 on a 195 squat: fine', ct('back_squat', 205, 5, sqNow, [4, 6]).level === 'ok');
  check('override 295: flagged (half again the target)', ct('back_squat', 295, 5, sqNow, [4, 6]).level === 'flag');
  check('override 30 on the squat: refused (under the bar)', ct('back_squat', 30, 5, sqNow, [4, 6]).level === 'block');
  check('override 197: flagged (not a 5 lb step)', ct('back_squat', 197, 5, sqNow, [4, 6]).level === 'flag');
  check('override 8 reps on a 4-6 lift: flagged', ct('back_squat', 195, 8, sqNow, [4, 6]).level === 'flag');
  check('override 55 on a curl pair (2 x 27.5): flagged, no such dumbbell', ct('curl', 55, 10, { weight: 50, reps: 10 }, [10, 12]).level === 'flag');
  check('override 235 x 5 on 195 x 5: flagged, a big jump for one session (est. max 275, 20% over)', (() => { const c = ct('back_squat', 235, 5, sqNow, [4, 6]); return c.level === 'flag' && /20% over/.test(c.text) && /big jump/.test(c.text); })(), ct('back_squat', 235, 5, sqNow, [4, 6]));
  check('override 210 x 5 on 195 x 5 (8% over): fine', ct('back_squat', 210, 5, sqNow, [4, 6]).level === 'ok');
  check('override on the pull-up counts bodyweight: +40 x 5 on +30 x 5 is fine (5% over, not 33%)', checkTarget({ rules, plan, settings, exerciseId: 'weighted_pullup', current: { weight: 30, reps: 5 }, weight: 40, reps: 5, range: [4, 6] }).level === 'ok');
  check('override with no reps: refused', ct('back_squat', 195, '', sqNow, [4, 6]).level === 'block');
  check('override reps on a bodyweight lift (ab wheel 12): fine', ct('ab_wheel', null, 12, { weight: null, reps: 10 }, [10, 12]).level === 'ok');

  // the chart's columns
  const today = new Date('2026-11-25T12:00:00');
  const sq = projectExercise({ plan, rules, settings: { ...settings, startDate: '2026-11-16' }, sessions: [], targets: { back_squat: { weight: 195, reps: 5, stall: 0 } }, exerciseId: 'back_squat', today });
  const cw = chartColumns(sq, 'weight'), cm = chartColumns(sq, 'max');
  check('chart: a column a week, 3 to 12; week 3 is the next session, at the target he has now (195 x 5)', cw.length === 10 && cw[0].week === 3 && cw[9].week === 12 && cw[0].v.well === 195 && cw[0].t.well.reps === 5, cw.map(c => c.week));
  check('chart, weight: the weight lifted that week (week 4 doing well 200, week 8 the heavier start 225 x 3, week 11 240 x 3)', cw[1].v.well === 200 && cw[5].v.well === 225 && cw[5].t.well.reps === 3 && cw[8].v.well === 240 && cw[8].t.well.reps === 3, cw.map(c => c.v.well));
  check('chart, weight: week 12 is the retest, the 5-rep weight of what the block built (doing well about 230 x 5)', cw[9].retest && cw[9].v.well === sq.end.well.fiveRep && cw[9].v.well === 230, cw[9]);
  check('chart, estimated max: never dips by the few pounds a heavier week reads lower; the retest shows the block\'s end (270)', cm.every((c, i) => !i || ['well', 'steady', 'struggle'].every(k => c.v[k] >= cm[i - 1].v[k])) && cm[9].v.well === sq.end.well.max && cm[9].v.well === 270 && cm[9].retest, cm.map(c => c.v));
  check('weekReaching: doing well reaches 265 in week 11, steady never', weekReaching(sq, 'well', 265) === 11 && weekReaching(sq, 'steady', 265) === null, [weekReaching(sq, 'well', 265), weekReaching(sq, 'steady', 265)]);
  const loadableLift = !Object.keys(plan.exercises).some(id => {
    const p = projectExercise({ plan, rules, settings: { ...settings, startDate: '2026-11-16' }, sessions: [], targets: { [id]: { weight: plan.exercises[id].equipment === 'bodyweight' ? null : 100, reps: 8 } }, exerciseId: id, today });
    return p && p.weeks && p.weeks.some(w => ['well', 'steady', 'struggle'].some(c => w.lift[c].weight != null && w.lift[c].weight % 5));
  });
  check('every week\'s lifted weight, on every lift, is a 5 lb step', loadableLift);
  const pushed = projectExercise({ plan, rules, settings: withGoal('back_squat', { weight: 265, reps: 1, push: 5 }), sessions: [], targets: { back_squat: { weight: 195, reps: 5, stall: 0 } }, exerciseId: 'back_squat', today });
  check('projection with a push: doing well reaches 265 sooner (week 6), steady gets there too, nothing past the 20% cap', weekReaching(pushed, 'well', 265) === 6 && weekReaching(pushed, 'steady', 265) === 12 && pushed.end.well.e1rm <= Math.round(228 * 1.2) + 1, [weekReaching(pushed, 'well', 265), weekReaching(pushed, 'steady', 265), pushed.end.well]);
  check('push stops at the goal: after 225 x 5 (est. 265) the steps are 5 again (230 in the lighter week)', chartColumns(pushed, 'weight')[4].v.well === 230, chartColumns(pushed, 'weight').map(c => c.v.well));
  const aw = projectExercise({ plan, rules, settings: { ...settings, startDate: '2026-11-16' }, sessions: [], targets: { ab_wheel: { reps: 10 } }, exerciseId: 'ab_wheel', today });
  check('chart, a reps lift: reps in every column, no retest column', chartColumns(aw, 'weight').every(c => !c.retest && c.v.well != null) && chartColumns(aw, 'weight')[0].v.well === 10);
  const fewer = projectExercise({ plan, rules, settings: { ...settings, startDate: '2026-11-16' }, sessions: [], targets: { back_squat: { weight: 195, reps: 5 } }, exerciseId: 'back_squat', today: new Date('2027-02-01T08:00:00') });
  check('late in the block (week 12 only): one column, the retest', chartColumns(fewer, 'weight').length === 1 && chartColumns(fewer, 'weight')[0].retest, fewer && fewer.weeks.map(w => w.week));

  // the row and the lift page read the same numbers, the way the workout builds them
  const { nextNumbers, nextWeekOf } = await import('../js/lift-goal.js');
  const placeIn = (sid, id) => { const s = plan.sessions.find(x => x.id === sid); for (const b of s.blocks) for (const it of b.items || []) if (it.exercise === id) return { b, it }; return null; };
  const nn = (sid, id, t, ph) => { const p = placeIn(sid, id); return nextNumbers({ plan, rules, settings }, p.it, p.b, t, ph); };
  const lc1 = placeIn('lift1', 'leg_curl'), lc3 = placeIn('lift3', 'leg_curl');
  check('next numbers: the leg curl has the sets of the session it sits in', nn('lift1', 'leg_curl', { weight: 100, reps: 11 }, 'build').sets === lc1.it.sets && nn('lift3', 'leg_curl', { weight: 100, reps: 11 }, 'build').sets === lc3.it.sets, [lc1.it.sets, lc3.it.sets]);
  const tri1 = placeIn('lift1', 'oh_tri_ext');
  check('next numbers: reps held inside the item\'s range, as the workout does (8 on a 10-12 item shows 10)', tri1.it.reps && nn('lift1', 'oh_tri_ext', { weight: 80, reps: 8 }, 'build').reps === Math.max(8, tri1.it.reps[0]), tri1.it.reps);
  check('next numbers: the squat in a heavier week shows its heavier start (5% up, 3 reps)', (() => { const n = nn('lift1', 'back_squat', { weight: 230, reps: 5, stall: 0 }, 'heavy'); return n.reps === 3 && n.weight > 230 && n.weight % 5 === 0; })());
  check('next numbers: the lighter week cuts the sets', nn('lift1', 'back_squat', { weight: 195, reps: 5 }, 'light').sets < placeIn('lift1', 'back_squat').it.sets);
  check('next numbers: a curl pair the rack can\'t make (2 x 27.5) shows the one it can', nn('lift1', 'curl', { weight: 55, reps: 10 }, 'build').weight === 50);
  check('nextWeekOf: Monday\'s session logged in week 2 comes round next in week 3', nextWeekOf(plan, { ...settings, startDate: '2026-11-16' }, [{ sessionId: 'lift1', week: 2 }], 'lift1', new Date('2026-11-25T12:00:00')) === 3);
}

// ---- v1.18.12: the coach file keeps the targets he set himself ----
{
  console.log('\nv1.18.12: the coach file and his own targets');
  const { keepsOwnTarget } = await import('../js/coach.js');
  const { ownTargetFlagged } = await import('../js/lift-goal.js');
  const sq = (endedAt, ex = 'back_squat') => ({ endedAt, sets: [{ exerciseId: ex, done: true, weight: 195, reps: 5 }] });
  const you = (updated, extra = {}) => ({ weight: 205, reps: 5, source: 'you', updated, ...extra });
  check('a target he set after his last squat stays', keepsOwnTarget(you('2026-11-25T15:00:00.000Z'), [sq('2026-11-24T01:00:00.000Z')], 'back_squat'));
  check('one set on that session\'s Review (same time as its end) stays', keepsOwnTarget(you('2026-11-24T01:00:00.000Z'), [sq('2026-11-24T01:00:00.000Z')], 'back_squat'));
  check('one set before a later squat session does not (that session moved on from it)', !keepsOwnTarget(you('2026-11-20T15:00:00.000Z'), [sq('2026-11-24T01:00:00.000Z')], 'back_squat'));
  check('a later session of another lift does not count', keepsOwnTarget(you('2026-11-20T15:00:00.000Z'), [sq('2026-11-18T01:00:00.000Z'), sq('2026-11-24T01:00:00.000Z', 'rdl')], 'back_squat'));
  check('a skipped or ramp-up set is not a logged session', keepsOwnTarget(you('2026-11-20T15:00:00.000Z'), [{ endedAt: '2026-11-24T01:00:00.000Z', sets: [{ exerciseId: 'back_squat', done: true, ramp: true }, { exerciseId: 'back_squat', done: false, skipped: true }] }], 'back_squat'));
  check('one he saved past a warning (flagged) does not', !keepsOwnTarget(you('2026-11-25T15:00:00.000Z', { flagged: true }), [], 'back_squat'));
  check('a coach or engine target does not', !keepsOwnTarget({ weight: 195, reps: 5, source: 'coach', updated: '2026-11-25T15:00:00.000Z' }, [], 'back_squat') && !keepsOwnTarget(null, [], 'back_squat'));
  const of = (id, before, weight, reps) => ownTargetFlagged({ rules, plan, settings, exerciseId: id, before, weight, reps });
  check('hand-set 205 x 5 over 195 x 5: not flagged', !of('back_squat', { weight: 195, reps: 5 }, 205, 5));
  check('hand-set 235 x 5 over 195 x 5 (20% jump): flagged', of('back_squat', { weight: 195, reps: 5 }, 235, 5));
  check('hand-set 30 on the squat (under the bar): flagged', of('back_squat', { weight: 195, reps: 5 }, 30, 5));
  check('a rep count off the plan alone is his call: not flagged', !of('back_squat', { weight: 195, reps: 5 }, 195, 8));
}

// ---- v1.18.13: skipping the stretch still counts as a workout ----
{
  console.log('\nv1.18.13: a workout with the stretch skipped');
  const { workLeft, stretchMissed } = await import('../js/builder.js');
  const { upgrade11813 } = await import('../js/upgrade.js');
  for (const sid of ['lift1', 'lift2', 'lift3']) {
    const tl = buildTimeline({ plan, rules, settings, sessionId: sid, week: 3, targets: {} });
    const steps = tl.steps.map(s => ({ ...s }));
    const firstStretch = steps.findIndex(s => s.blockType === 'stretch');
    check(`${sid}: has a stretch block`, firstStretch > 0);
    check(`${sid}: at the start, training is left`, workLeft(steps, 0));
    // everything before the stretch done, If time left untouched
    steps.forEach((s, i) => { if (i < firstStretch && !s.iftime) s.done = true; });
    check(`${sid}: with every set and the Engine done, only the stretch left = nothing left to train`, !workLeft(steps, firstStretch));
    check(`${sid}: ending on the step before the stretch also counts`, !workLeft(steps, firstStretch - 1));
    check(`${sid}: the stretch counts as missed`, stretchMissed(steps));
    const lastSet = steps.map((s, i) => [s, i]).filter(([s]) => s.kind === 'set' && !s.iftime).pop()[1];
    steps[lastSet].done = false;
    check(`${sid}: one work set left = still an early end`, workLeft(steps, lastSet));
    const emom = steps.findIndex(s => s.blockType === 'emom');
    if (emom >= 0) { steps[lastSet].done = true; steps[emom].done = false; check(`${sid}: an Engine minute left = still an early end`, workLeft(steps, emom)); }
    steps.forEach(s => { s.done = true; });
    check(`${sid}: stretch done = not missed`, !stretchMissed(steps));
  }
  // the Player decides when the session ends
  const tl = buildTimeline({ plan, rules, settings, sessionId: 'lift1', week: 3, targets: {} });
  const firstStretch = tl.steps.findIndex(s => s.blockType === 'stretch');
  const endAt = idx => {
    const t = JSON.parse(JSON.stringify(tl)); let draft = null;
    t.steps.forEach((s, i) => { if (i < idx && !s.iftime) { s.done = true; if (s.kind === 'set') s.record = { exerciseId: s.exerciseId, weight: 100, reps: 5, done: true, skipped: false }; } });
    const p = Object.create(Player.prototype);
    p.s = { timeline: t, idx, status: 'running', sessionStart: Date.now() - 3600e3, pausedTotal: 0, pausedAt: null, trims: [], prs: [], startedISO: new Date().toISOString(), gymStart: Date.now() - 3600e3 };
    p.teardown = () => {}; p.gymMs = () => 3600e3; p.onFinish = d => { draft = d; };
    p.finish('ended_early');
    return draft;
  };
  const a = endAt(firstStretch);
  check('End session on the stretch saves it as complete, stretch skipped', a.status === 'complete' && a.stretchSkipped === true, [a.status, a.stretchSkipped]);
  const b = endAt(firstStretch - 3);
  check('End session with sets left stays ended early', b.status === 'ended_early', b.status);
  // saved sessions: his Nov 24 Lift 1 (every set done, ended at the stretch) becomes complete
  const all = s => s.map(x => ({ exerciseId: 'back_squat', done: true, skipped: false, ...x }));
  const recs = [
    { id: 'nov24', sessionId: 'lift1', status: 'ended_early', engineMinutes: 0, sets: all([{}, {}, {}]) },
    { id: 'nov18', sessionId: 'lift2', status: 'ended_early', engineMinutes: 0, sets: all([{}, { done: false, skipped: true }]) },
    { id: 'eng', sessionId: 'lift2', status: 'ended_early', engineMinutes: 0, sets: all([{}, {}]) },
    { id: 'eng2', sessionId: 'lift2', status: 'ended_early', engineMinutes: 8, sets: all([{}, {}]) },
    { id: 'ok', sessionId: 'lift3', status: 'complete', sets: all([{}]) },
    { id: 'none', sessionId: 'lift3', status: 'ended_early', sets: [] }
  ];
  const snap = JSON.stringify(recs);
  const up = upgrade11813({ targets: {}, sessions: recs, plan });
  const ids = up.sessions.map(s => s.id).sort().join(',');
  const lift2Engine = plan.sessions.find(l => l.id === 'lift2').blocks.some(b => b.type === 'emom');
  check('upgrade: ended early with every set done becomes complete; a skipped set, a missed Engine or no sets stay', ids === (lift2Engine ? 'eng2,nov24' : 'eng,eng2,nov24'), ids);
  check('upgrade: the input is not changed and a second run changes nothing', JSON.stringify(recs) === snap && upgrade11813({ sessions: recs.map(r => up.sessions.find(x => x.id === r.id) || r), plan }).sessions.length === 0);
  check('upgrade: the week grid then shows Lift 1 week 2 as done', adherence([{ ...up.sessions.find(s => s.id === 'nov24'), week: 2 }], plan, { ...settings, startDate: '2026-11-16' }, new Date('2026-11-25T12:00:00')).rows.find(r => r.id === 'lift1').cells[1].status === 'done');
}

{
  console.log('\nv1.18.15: audit fixes (rules.accessoryJump, lastSetRating.unratedHeavierFollows; with beatPlan off, as they shipped)');
  const r1815 = JSON.parse(JSON.stringify(rules)); r1815.lastSetRating.beatPlan = false;
  const go = (id, t, sets, range, week = 3) => applyProgression({ session: mkSession(week, sets.map(([w, r, e, x]) => ws(id, w, r, e, range, x))), targets: { [id]: { ...t } }, rules: r1815, plan, settings }).targets[id];
  const U = { unconfirmed: true };
  let t = go('curl', { weight: 50, reps: 10 }, [[60, 10, 8, U], [60, 10, 9, U], [60, 10, 9, U]], [10, 12]);
  check('his Nov 24 curl: 60 x 10 on every set, last set unrated: the target follows to 60, reps stay 10', t.weight === 60 && t.reps === 10, t);
  t = go('curl', { weight: 50, reps: 10 }, [[60, 10, 8, U], [60, 10, 9, U], [50, 10, 9, U]], [10, 12]);
  check('unrated with one set at the target weight: still holds (50 x 10)', t.weight === 50 && t.reps === 10, t);
  t = go('curl', { weight: 50, reps: 10 }, [[60, 9, 8, U], [60, 9, 9, U], [60, 9, 9, U]], [10, 12]);
  check('unrated, heavier but short of the reps: holds', t.weight === 50 && t.reps === 10, t);
  t = go('back_squat', { weight: 185, reps: 5, stall: 2 }, [[195, 5, 8, U], [195, 5, 8, U], [195, 5, 8, U]], [4, 6]);
  check('a main lift done heavier with the last set unrated follows the weight, no extra step, flat count cleared', t.weight === 195 && t.reps === 5 && t.stall === 0, t);
  t = go('lateral_raise', { weight: 30, reps: 19 }, [[30, 20, 9], [30, 20, 9], [30, 20, 9]], [12, 15]);
  check('lateral raise at the extended top (30 x 20): jumps to 40 at the reps it predicts (7), marked as a jump', t.weight === 40 && t.reps === 7 && t.jumpedTo === 40, t);
  t = go('curl', { weight: 60, reps: 15 }, [[60, 15, 9], [60, 15, 9], [60, 15, 9]], [10, 12]);
  check('curl 60 x 15: 70 predicts 8, within 2 of the bottom: jumps to 70 x 8', t.weight === 70 && t.reps === 8 && t.jumpedTo === 70, t);
  const tl = buildTimeline({ plan, rules, settings, sessionId: 'lift1', week: 3, targets: { curl: t } });
  check('the workout asks for 70 x 8 after that jump (under the bottom of 10-12)', tl.steps.some(x => x.kind === 'set' && x.exerciseId === 'curl' && x.target.weight === 70 && x.target.reps === 8));
  const t2 = go('curl', t, [[70, 9, 9], [70, 9, 9], [70, 9, 9]], [10, 12]);
  check('after the jump reps build back (70 x 10)', t2.weight === 70 && t2.reps === 10 && t2.jumpedTo == null, t2);
  const tl2 = buildTimeline({ plan, rules, settings, sessionId: 'lift1', week: 3, targets: { oh_tri_ext: { weight: 80, reps: 8 } } });
  check('a target from another session\'s lower range still shows this session\'s bottom (triceps 80 x 8 shows 10 on Lift 1)', tl2.steps.some(x => x.kind === 'set' && x.exerciseId === 'oh_tri_ext' && x.target.reps === 10));
  t = go('rdl', { weight: 195, reps: 8 }, [[195, 8, 8], [195, 8, 8], [195, 8, 8]], [6, 8]);
  check('barbell RDL at the top steps as before (200 x 6)', t.weight === 200 && t.reps === 6, t);
  t = go('leg_curl', { weight: 100, reps: 12 }, [[100, 12, 9], [100, 12, 9], [100, 12, 9]], [8, 12]);
  check('machine leg curl at the top steps as before (105 x 8)', t.weight === 105 && t.reps === 8, t);
  let a = go('curl', { weight: 70, reps: 10 }, [[70, 8, 10], [70, 7, 10], [70, 7, 10]], [10, 12]);
  check('2+ reps short once: holds, short count 1', a.weight === 70 && a.reps === 10 && a.short === 1, a);
  a = go('curl', a, [[70, 8, 10], [70, 7, 10], [70, 7, 10]], [10, 12]);
  check('2+ reps short twice in a row: back one step at the reps made (60 x 7 -> reps held at the bottom, 10)', a.weight === 60 && a.reps === 10 && !a.short, a);
  a = go('curl', { weight: 70, reps: 10, short: 1 }, [[70, 10, 9], [70, 10, 9], [70, 10, 9]], [10, 12]);
  check('a session that makes the reps clears the short count', a.weight === 70 && a.reps === 11 && !a.short, a);
  let b = go('curl', { weight: 70, reps: 10 }, [[60, 10, 9], [60, 10, 9], [60, 10, 9]], [10, 12]);
  check('done lighter once: holds 70', b.weight === 70 && b.short === 1, b);
  b = go('curl', b, [[60, 10, 9], [60, 10, 9], [60, 11, 9]], [10, 12]);
  check('done lighter twice in a row: the target comes down to the weight used (60 x 10)', b.weight === 60 && b.reps === 10 && !b.short, b);
  const { stalledLifts } = await import('../js/progression.js');
  const { staleAdjustment } = await import('../js/coach.js');
  const fs = (date, w, r, ph = 'build', range = [5, 6]) => ({ id: date, endedAt: `${date}T20:00:00Z`, phase: { id: ph }, sets: [1, 2, 3].map(i => ({ exerciseId: 'front_squat', setIndex: i, weight: w, reps: r, rpe: 9, done: true, repRange: range, target: { weight: w, reps: r } })) });
  const T = { front_squat: { weight: 140, reps: 5 } };
  let st = stalledLifts({ sessions: [fs('2026-12-04', 140, 5), fs('2026-12-11', 140, 5), fs('2026-12-18', 140, 5)], targets: T, plan, rules, settings });
  check('stall note: front squat at 140 x 5 three sessions running is named; its 5-6 range has no room, so it offers 135 x 5', st.length === 1 && st[0].exerciseId === 'front_squat' && st[0].offer.weight === 135 && st[0].offer.reps === 5, st);
  st = stalledLifts({ sessions: [fs('2026-12-04', 135, 5), fs('2026-12-11', 140, 5), fs('2026-12-18', 140, 5)], targets: T, plan, rules, settings });
  check('stall note: two sessions at the same numbers is not enough', st.length === 0, st);
  st = stalledLifts({ sessions: [fs('2026-12-04', 140, 5), fs('2026-12-11', 140, 5, 'light'), fs('2026-12-18', 140, 5)], targets: T, plan, rules, settings });
  check('stall note: the light week is not counted', st.length === 0, st);
  st = stalledLifts({ sessions: [fs('2026-12-04', 140, 5), fs('2026-12-11', 140, 5), fs('2026-12-18', 140, 5)], targets: T, plan, rules, settings: { ...settings, stallNoteSeen: { front_squat: '140x5' } } });
  check('stall note: once answered at these numbers it stays away', st.length === 0, st);
  const sq = (date) => ({ ...fs(date, 195, 5, 'build', [4, 6]), sets: fs(date, 195, 5, 'build', [4, 6]).sets.map(x => ({ ...x, exerciseId: 'back_squat' })) });
  st = stalledLifts({ sessions: [sq('2026-12-01'), sq('2026-12-08'), sq('2026-12-15')], targets: { back_squat: { weight: 195, reps: 5 } }, plan, rules, settings });
  check('stall note: back squat (4-6) offers one rep fewer, 195 x 4', st.length === 1 && st[0].offer.weight === 195 && st[0].offer.reps === 4, st);
  const ss = [{ endedAt: '2026-11-24T23:53:55.873Z', sets: [{ exerciseId: 'curl', done: true }] }];
  check('coach change based on the latest session applies', !staleAdjustment({ exerciseId: 'curl', weight: 60, basedOn: '2026-11-24T23:53:55.873Z' }, ss));
  check('coach change older than a saved session of that lift is left out', staleAdjustment({ exerciseId: 'curl', weight: 60, basedOn: '2026-11-20T00:00:00Z' }, ss));
  check('coach change with no basedOn applies as before; another lift\'s session does not count', !staleAdjustment({ exerciseId: 'curl', weight: 60 }, ss) && !staleAdjustment({ exerciseId: 'rdl', weight: 200, basedOn: '2026-11-20T00:00:00Z' }, ss));
  const off = JSON.parse(JSON.stringify(rules)); off.accessoryJump.on = false; off.lastSetRating.unratedHeavierFollows = false; off.lastSetRating.beatPlan = false;
  const o1 = applyProgression({ session: mkSession(3, [1, 2, 3].map(() => ws('curl', 30, 12, 9, [10, 12]))), targets: { curl: { weight: 30, reps: 12 } }, rules: off, plan, settings }).targets.curl;
  const o2 = applyProgression({ session: mkSession(3, [1, 2, 3].map(() => ws('curl', 60, 10, 9, [10, 12], U))), targets: { curl: { weight: 50, reps: 10 } }, rules: off, plan, settings }).targets.curl;
  check('switched off, both rules go back to v1.18.14 (40 x 10; unrated holds at 50)', o1.weight === 40 && o1.reps === 10 && o2.weight === 50, [o1, o2]);
}

{
  console.log('\nv1.18.16: Easy and extra reps on main lifts (rules mainLiftTest.weekly.bigStep)');
  const go = (id, t, sets, range, week = 3) => applyProgression({ session: mkSession(week, sets.map(([w, r, e, x]) => ws(id, w, r, e, range, x))), targets: { [id]: { stall: 0, ...t } }, rules, plan, settings }).targets[id];
  const SQ = { weight: 195, reps: 5 }, R = [4, 6];
  let t = go('back_squat', SQ, [[195, 5, 8], [195, 5, 8], [195, 5, 8]], R);
  check('all Solid: one step (200 x 5)', t.weight === 200 && t.reps === 5, t);
  t = go('back_squat', SQ, [[195, 5, 6], [195, 5, 6], [195, 5, 6]], R);
  check('all Easy: two steps (205 x 5)', t.weight === 205 && t.reps === 5, t);
  t = go('back_squat', SQ, [[195, 5, 6], [195, 5, 6], [195, 5, 8]], R);
  check('Easy, Easy, Solid: one step (200)', t.weight === 200, t);
  t = go('back_squat', SQ, [[195, 5, 8], [195, 5, 8], [195, 7, 8]], R);
  check('last set 2 over the reps at Solid: two steps (205 x 5)', t.weight === 205 && t.reps === 5, t);
  t = go('back_squat', SQ, [[195, 7, 8], [195, 7, 8], [195, 6, 8]], R);
  check('last set only 1 over: one step (200)', t.weight === 200, t);
  t = go('back_squat', SQ, [[195, 7, 8], [195, 7, 8], [195, 7, 10]], R);
  check('extra reps but last set Maxed: holds, reps stay 5 (was 6)', t.weight === 195 && t.reps === 5, t);
  t = go('back_squat', SQ, [[205, 5, 6], [205, 5, 6], [205, 5, 6]], R);
  check('heavier than the target, all Easy: follows and takes two steps (215 x 5)', t.weight === 215 && t.reps === 5, t);
  t = go('back_squat', SQ, [[205, 7, 9], [205, 7, 9], [205, 7, 9]], R);
  check('heavier, Hard, extra reps: follows the weight, reps stay 5', t.weight === 205 && t.reps === 5, t);
  t = go('strict_press', { weight: 95, reps: 5 }, [[95, 5, 6], [95, 5, 6], [95, 5, 6], [95, 5, 6]], R);
  check('strict press all Easy: 105 x 5', t.weight === 105 && t.reps === 5, t);
  t = go('back_squat', SQ, [[195, 5, 6, { unconfirmed: true }], [195, 5, 6, { unconfirmed: true }], [195, 5, 6]], R);
  check('earlier sets unrated, last set Easy: the last set stands, two steps (205)', t.weight === 205, t);
  t = go('back_squat', { weight: 210, reps: 3 }, [[210, 5, 8], [210, 5, 8], [210, 5, 8]], [3, 5], 9);
  check('heavy weeks: 210 x 5 on a 210 x 3 target at Solid: two steps, reps stay 3 (220 x 3)', t.weight === 220 && t.reps === 3, t);
  t = go('rdl', { weight: 195, reps: 7 }, [[195, 7, 6], [195, 7, 6], [195, 7, 6]], [6, 8]);
  check('accessories are not on this rule (RDL Easy: one step, 200 x 6)', t.weight === 200 && t.reps === 6, t);
  const off = JSON.parse(JSON.stringify(rules)); delete off.mainLiftTest.weekly.bigStep;
  const o = applyProgression({ session: mkSession(3, [1, 2, 3].map(() => ws('back_squat', 195, 5, 6, R))), targets: { back_squat: { ...SQ, stall: 0 } }, rules: off, plan, settings }).targets.back_squat;
  check('without bigStep: one step as before (200)', o.weight === 200, o);
}

{
  console.log('\nv1.20: Nutrition tab (protein)');
  const foods = JSON.parse(readFileSync(new URL('../data/foods.json', import.meta.url)));
  const C = foods.check;
  check('settings goal is 160 g (Cameron, Nov 25)', settings.proteinGoalG === 160, settings.proteinGoalG);
  const byId = Object.fromEntries(foods.foods.map(f => [f.id, f]));
  check('starting buttons from his photo and message: whey 24, Oikos 15, Pure Protein 20, think! 20, FitCrunch 16, Chomps 10',
    byId.whey.g === 24 && byId.oikos.g === 15 && byId.pure_protein.g === 20 && byId.think_bar.g === 20 && byId.fitcrunch.g === 16 && byId.chomps.g === 10);
  check('chicken and turkey are a serving of ½ lb (half his 1 lb pack), canned chicken and rice listed, all est. ones flagged as estimates',
    byId.chicken.qty === 0.5 && byId.turkey.qty === 0.5 && byId.canned_chicken && byId.rice && ['chicken', 'turkey', 'canned_chicken', 'rice'].every(id => byId[id].source === 'estimate'));
  check('every starting button passes its own number check', foods.foods.every(f => checkFood(f, C).ok), foods.foods.filter(f => !checkFood(f, C).ok).map(f => f.id));
  check('ids are unique', new Set(foods.foods.map(f => f.id)).size === foods.foods.length);
  const e = (id, date, at, servings = 1) => makeEntry(byId[id], { id: `${id}-${at}`, date, at, servings });
  const log = [
    e('whey', '2026-11-25', '2026-11-25T14:00:00.000Z', 2),
    e('chicken', '2026-11-25', '2026-11-25T19:00:00.000Z', 1),
    e('oikos', '2026-11-25', '2026-11-25T16:00:00.000Z', 1),
    e('chomps', '2026-11-24', '2026-11-24T20:00:00.000Z', 1.5),
    makeEntry({ name: 'Eggs', g: 18 }, { id: 'o1', date: '2026-11-23', at: '2026-11-23T13:00:00.000Z', servings: 1 })
  ];
  check('an entry is protein x servings: 2 scoops = 48 g, 1.5 sticks = 15 g', entryG(log[0]) === 48 && entryG(log[3]) === 15);
  check('day total Nov 25 = 48 + 50 + 15 = 113', dayTotal(log, '2026-11-25') === 113, dayTotal(log, '2026-11-25'));
  check('day list is in time order', dayEntries(log, '2026-11-25').map(x => x.foodId).join() === 'whey,oikos,chicken');
  check('Other entry keeps its name and has no food id', log[4].foodId === null && log[4].name === 'Eggs' && dayTotal(log, '2026-11-23') === 18);
  const days = lastDays(log, '2026-11-25', 160, 7);
  check('last 7 days end today, oldest first, with totals and logged days', days.length === 7 && days[0].date === '2026-11-19' && days[6].date === '2026-11-25' && days[6].total === 113 && days[5].total === 15 && days.filter(d => d.logged).length === 3, days);
  check('a day at the goal counts as hit, under it does not', lastDays([e('chicken', '2026-11-25', 'a', 3.2)], '2026-11-25', 160, 1)[0].hit === true && days[6].hit === false);
  check('addDays crosses months (Dec 1 - 1 = Nov 30)', addDays('2026-12-01', -1) === '2026-11-30' && addDays('2026-11-30', 1) === '2026-12-01');
  check('amounts in words: ½ lb, 1 lb, 1½ bars, 1 scoop, 3 sticks',
    amountText(byId.chicken, 1) === '½ lb' && amountText(byId.chicken, 2) === '1 lb' && amountText(byId.pure_protein, 1.5) === '1½ bars' && amountText(byId.whey, 1) === '1 scoop' && amountText(byId.chomps, 3) === '3 sticks',
    [amountText(byId.chicken, 1), amountText(byId.chicken, 2), amountText(byId.pure_protein, 1.5)]);
  check('fmtQty: ¼ ½ ¾ 1½ 2', ['¼', '½', '¾', '1½', '2'].join() === [0.25, 0.5, 0.75, 1.5, 2].map(fmtQty).join(), [0.25, 0.5, 0.75, 1.5, 2].map(fmtQty));
  // Cameron's rule (Nov 19): a number that looks wrong is held for a look
  check('protein check refuses blank, text, 0, below 0 and over 300 g', ['', 'abc', 0, -5, 301].every(v => checkProtein(v, C).refuse));
  check('protein check asks Save anyway over 120 g at once, over 80 g for one serving', checkProtein(130, C).warn && checkProtein(90, C, 'serving').warn && checkProtein(90, C).ok && checkProtein(40, C, 'serving').ok);
  check('a food needs a name and a serving above 0', checkFood({ name: '', g: 20, qty: 1 }, C).refuse && checkFood({ name: 'Bar', g: 20, qty: 0 }, C).refuse && checkFood({ name: 'Bar', g: 20, qty: 1 }, C).ok);
  const tap = e('whey', '2026-11-25', '2026-11-25T20:00:00.000Z');
  check('the same food again inside a minute is a likely double tap', !!recentRepeat([tap], 'whey', '2026-11-25T20:00:40.000Z', C) && !recentRepeat([tap], 'whey', '2026-11-25T20:01:30.000Z', C) && !recentRepeat([tap], 'oikos', '2026-11-25T20:00:10.000Z', C));
  const fixed = applyFoodEdit(log, { ...byId.whey, g: 25 }, '2026-11-25');
  check('a fixed label changes today\'s entries of that food only (48 -> 50), other foods and days unchanged', entryG(fixed[0]) === 50 && entryG(fixed[1]) === 50 && fixed[3] === log[3]);
  const mine = foodsList(null, foods);
  check('no saved buttons: the starting list (a copy)', mine.length === foods.foods.length && mine[0] !== foods.foods[0]);
  check('saved buttons win over the starting list', foodsList([{ id: 'x', name: 'X', g: 5 }], foods).length === 1);
  check('a new button gets a unique id', foodId('Cottage cheese', mine) === 'cottage_cheese' && foodId('Whey', [{ id: 'whey' }]) === 'whey_2');
  const pr = progressOf(113, 160);
  check('progress: 113 of 160 = 71%, 47 to go; 170 is hit, 100% wide', pr.pct === 71 && pr.left === 47 && !pr.hit && progressOf(170, 160).hit && progressOf(170, 160).pct === 100, pr);

  console.log('\nv1.20.2: food from the computer, applied by the phone');
  const pc = makeEntry(byId.chicken, { date: '2026-11-25', at: '2026-11-25T23:00:00.000Z', servings: 1, id: 'pc1' });
  const steps = [
    { id: 'o1', type: 'add', entry: pc },
    { id: 'o2', type: 'set', entryId: log[0].id, servings: 1 },
    { id: 'o3', type: 'remove', entryId: log[3].id }
  ];
  const r1 = applyFoodOps(log, steps);
  check('add, change and delete apply in order (113 - 24 + 50 = 139 on Nov 25)', r1.applied.join() === 'o1,o2,o3' && dayTotal(r1.log, '2026-11-25') === 139 && r1.log.length === log.length, [dayTotal(r1.log, '2026-11-25'), r1.applied]);
  check('the added entry is marked as from the computer, and the old log is not changed', r1.log.find(x => x.id === 'pc1').fromComputer === true && log.length === 5 && log[0].servings === 2);
  const r2 = applyFoodOps(r1.log, steps.slice(0, 2));
  check('applying the same steps again changes nothing (no double chicken)', dayTotal(r2.log, '2026-11-25') === 139 && r2.log.filter(x => x.id === 'pc1').length === 1);
  const r3 = applyFoodOps(log, [{ id: 'a', type: 'add', entry: pc }, { id: 'b', type: 'remove', entryId: 'pc1' }]);
  check('added then deleted on the computer: nothing lands', !r3.log.some(x => x.id === 'pc1') && r3.applied.length === 2);
  const badSteps = [
    { id: 'x1', type: 'add', entry: { ...pc, id: 'big', g: 400 } },
    { id: 'x2', type: 'add', entry: { ...pc, id: 'neg', servings: -1 } },
    { id: 'x3', type: 'add', entry: { ...pc, id: 'nodate', date: 'today' } },
    { id: 'x4', type: 'set', entryId: log[0].id, g: 0 },
    { id: 'x5', type: 'eat', entryId: log[0].id },
    { id: 'x6', type: 'add', entry: { ...pc, id: 'many', servings: 8 } }
  ];
  const r4 = applyFoodOps(log, badSteps);
  check('steps with numbers that cannot be right are left out (400 g, -1 servings, no date, 0 g, unknown, 8 x 50 g)', r4.bad.join() === 'x1,x2,x3,x4,x5,x6' && r4.applied.length === 0 && dayTotal(r4.log, '2026-11-25') === 113, r4.bad);
  check('a step needs an id', !validFoodOp({ type: 'remove', entryId: 'a' }) && validFoodOp({ id: 'z', type: 'remove', entryId: 'a' }));
}

{
  console.log('\nv1.21.0: workout 5 tweaks (beat the plan, faster ramp-ups, no set-up tap on quick lifts, slow lifts, Engine)');
  const U = { unconfirmed: true };
  const go = (id, t, sets, range, week = 3) => applyProgression({ session: mkSession(week, sets.map(([w, r, e, x]) => ws(id, w, r, e, range, x))), targets: { [id]: { stall: 0, ...t } }, rules, plan, settings });
  // his Nov 25 row: target 55 x 8; 55 x 8 rated Easy, then 60 x 8 twice that the timer logged (guess Solid)
  let r = go('cs_row', { weight: 55, reps: 8 }, [[55, 8, 6], [60, 8, 8, U], [60, 8, 8, U]], [8, 10]);
  let l = r.lines.find(x => x.exerciseId === 'cs_row');
  check('his Nov 25 row (55 x 8, 60 x 8, 60 x 8, last unrated): beat the plan, so 60 x 10 next time, not 55 x 8', r.targets.cs_row.weight === 60 && r.targets.cs_row.reps === 10 && l.beat === true && /You beat the plan/.test(l.text), [r.targets.cs_row, l.text]);
  r = go('incline_curl', { weight: 40, reps: 8 }, [[50, 8, 6], [50, 8, 9, U], [50, 8, 9, U]], [8, 12]);
  check('his Nov 25 incline curl (40 asked, 50 x 8 on every set; the finisher guess is Hard): 50 x 9', r.targets.incline_curl.weight === 50 && r.targets.incline_curl.reps === 9, r.targets.incline_curl);
  r = go('lateral_raise', { weight: 30, reps: 12 }, [[30, 14, 9, U], [30, 14, 9, U], [30, 14, 9, U]], [12, 15]);
  check('more reps than asked at the same weight, all unrated: counts too (30 x 14 -> 30 x 15)', r.targets.lateral_raise.weight === 30 && r.targets.lateral_raise.reps === 15, r.targets.lateral_raise);
  r = go('lateral_raise', { weight: 30, reps: 12 }, [[30, 12, 9, U], [30, 12, 9, U], [30, 12, 9, U]], [12, 15]);
  check('exactly the plan, all unrated: still holds (nothing beaten)', r.targets.lateral_raise.weight === 30 && r.targets.lateral_raise.reps === 12 && !r.lines[0].beat, r.targets.lateral_raise);
  r = go('cs_row', { weight: 55, reps: 8 }, [[60, 8, 8, U], [60, 8, 8, U], [60, 7, 8, U]], [8, 10]);
  check('one set short of the target reps: not a beat, holds', r.targets.cs_row.weight === 55 && r.targets.cs_row.reps === 8 && !r.lines[0].beat, r.targets.cs_row);
  r = go('cs_row', { weight: 55, reps: 8 }, [[60, 8, 8, U], [60, 8, 8, U], [null, null, null, { done: false, skipped: true }]], [8, 10]);
  check('a planned set skipped (2 of 3 done): not a beat', r.targets.cs_row.weight === 55 && !r.lines[0].beat, r.targets.cs_row);
  r = go('back_squat', { weight: 185, reps: 5 }, [[195, 5, 8, U], [195, 5, 8, U], [195, 5, 8, U]], [4, 6]);
  check('main lift done heavier, last set unrated (guess Solid): steps up from what he did, 200 x 5', r.targets.back_squat.weight === 200 && r.targets.back_squat.reps === 5 && r.targets.back_squat.stall === 0, r.targets.back_squat);
  r = go('back_squat', { weight: 185, reps: 5 }, [[195, 5, 9], [195, 5, 9], [195, 5, 8, U]], [4, 6]);
  check('main lift done heavier with sets he rated Hard: the weight he used, no step (195 x 5)', r.targets.back_squat.weight === 195 && r.targets.back_squat.reps === 5, r.targets.back_squat);
  r = go('cs_row', { weight: 55, reps: 8 }, [[60, 8, 9], [60, 8, 9], [60, 8, 9]], [8, 10]);
  check('last set rated: the normal rule, no beat note (60 x 9 on Hard)', r.targets.cs_row.weight === 60 && r.targets.cs_row.reps === 9 && !r.lines[0].beat, r.targets.cs_row);
  const offB = JSON.parse(JSON.stringify(rules)); offB.lastSetRating.beatPlan = false;
  const o = applyProgression({ session: mkSession(3, [ws('cs_row', 55, 8, 6, [8, 10]), ws('cs_row', 60, 8, 8, [8, 10], U), ws('cs_row', 60, 8, 8, [8, 10], U)]), targets: { cs_row: { weight: 55, reps: 8 } }, rules: offB, plan, settings }).targets.cs_row;
  check('beatPlan false: back to holding at 55 x 8', o.weight === 55 && o.reps === 8, o);

  // the one-time pass over saved sessions
  const { upgrade1210 } = await import('../js/upgrade.js');
  const rec = { ...mkSession(2, [ws('cs_row', 55, 8, 6, [8, 10], { target: { weight: 55, reps: 8 } }), ws('cs_row', 60, 8, 8, [8, 10], U), ws('cs_row', 60, 8, 8, [8, 10], U), ws('curl', 60, 10, 9, [10, 12], U), ws('curl', 60, 10, 9, [10, 12], U), ws('curl', 60, 10, 9, [10, 12], U)]), id: 'nov25', startedAt: '2026-11-26T00:10:00Z', endedAt: '2026-11-26T01:13:00Z', targetsBefore: { cs_row: { weight: 55, reps: 8, stall: 0 }, curl: { weight: 50, reps: 10, stall: 0 } }, whatChanged: [{ exerciseId: 'cs_row', text: 'old', verdict: 'hold' }] };
  const tg0 = { cs_row: { weight: 55, reps: 8, source: 'engine', updated: '2026-11-18T17:42:06Z' }, curl: { weight: 60, reps: 10, source: 'coach', updated: '2026-11-26T04:00:00Z' } };
  const snap = JSON.stringify([rec, tg0]);
  const up = upgrade1210({ targets: tg0, sessions: [rec], rules, plan, settings });
  check('upgrade 1.21.0: his row moves to 60 x 10 and the session says why; a target the coach set since stays', up.targets.cs_row.weight === 60 && up.targets.cs_row.reps === 10 && up.targets.curl.weight === 60 && up.targets.curl.reps === 10 && up.zeroed === 1 && /beat the plan/.test(up.sessions[0].whatChanged.find(x => x.exerciseId === 'cs_row').text), [up.targets, up.lifts]);
  const again = upgrade1210({ targets: up.targets, sessions: [up.sessions[0]], rules, plan, settings });
  check('upgrade 1.21.0: the input is not changed and a second run changes nothing', JSON.stringify([rec, tg0]) === snap && again.zeroed === 0, again.lifts);

  // ramp-ups
  const rampOf = (sid, ex, t) => {
    const tl = buildTimeline({ plan, rules, settings, sessionId: sid, week: 3, targets: { ...targets, ...t } });
    const i0 = tl.steps.findIndex(x => x.ramp && x.exerciseId === ex);
    const steps = tl.steps.slice(i0, tl.steps.findIndex(x => x.kind === 'set' && x.exerciseId === ex && !x.ramp));
    return { w: steps.filter(x => x.ramp).map(x => x.target.weight).join(','), rests: steps.filter(x => x.kind === 'rest').map(x => x.seconds).join(','), secs: steps.filter(x => x.ramp).map(x => x.seconds) };
  };
  let rp = rampOf('lift2', 'strict_press', { strict_press: { weight: 95, reps: 5 } });
  check('press at 95: two ramp-ups (bar, 65), 30 s between, 60 s before the first work set', rp.w === '45,65' && rp.rests === '30,60', rp);
  check('ramp-up reps are quick (the bar x 5 is timed under 25 s, not at the press tempo)', rp.secs[0] <= 25, rp.secs);
  rp = rampOf('lift2', 'strict_press', { strict_press: { weight: 135, reps: 5 } });
  check('press at 135: the 85 % step comes back (bar, 95, 115)', rp.w === '45,95,115' && rp.rests === '30,30,60', rp);
  rp = rampOf('lift1', 'back_squat', { back_squat: { weight: 195, reps: 5 } });
  check('squat at 195 keeps all four (45, 95, 135, 165), 30 s between', rp.w === '45,95,135,165' && rp.rests === '30,30,30,60', rp);

  // set-up taps
  const tl = buildTimeline({ plan, rules, settings, sessionId: 'lift2', week: 3, targets: { ...targets, strict_press: { weight: 95, reps: 5 }, incline_db_press: { weight: 120, reps: 7 }, cs_row: { weight: 55, reps: 8 } } });
  const p = new Player({ timeline: tl, plan, rules, settings, targets, container: null, onFinish: () => {} });
  const first = ex => tl.steps.findIndex(x => x.kind === 'set' && x.exerciseId === ex);
  check('the strict press (barbell) still waits for Set-up done before its first ramp-up', p.needsConfirm(first('strict_press') - 1) === true);
  check('weighted pull-up, incline dumbbell press, row and the dumbbell finisher start on their own', ['weighted_pullup', 'incline_db_press', 'cs_row', 'lateral_raise', 'incline_curl', 'oh_tri_ext'].every(ex => p.needsConfirm(first(ex) - 1) === false), ['weighted_pullup', 'incline_db_press', 'cs_row', 'lateral_raise'].map(ex => p.needsConfirm(first(ex) - 1)));
  const plan2 = JSON.parse(JSON.stringify(plan)); plan2.exercises.incline_db_press.confirmSetup = true;
  const p2 = new Player({ timeline: tl, plan: plan2, rules, settings, targets, container: null, onFinish: () => {} });
  check('confirmSetup true on an exercise brings its tap back', p2.needsConfirm(first('incline_db_press') - 1) === true);
  const eng = tl.steps.findIndex(x => x.blockType === 'emom');
  check('the Engine still waits for Ready', p.needsConfirm(eng - 1) === true);

  // slow lifts
  const slow = Object.entries(plan.exercises).filter(([, e]) => e.slow).map(([k]) => k).sort().join(',');
  check('eight lifts are marked slow', slow === 'ab_wheel,bss,calf_raise,incline_curl,leg_curl,oh_tri_ext,preacher_curl,rdl', slow);
  check('overhead triceps extension: 3 s down (set of 8 gets about 48 s, was 39)', plan.exercises.oh_tri_ext.tempo[0] === 3 && setTiming(rules, plan.exercises.oh_tri_ext, 8, false).seconds === 48, setTiming(rules, plan.exercises.oh_tri_ext, 8, false));
  check('no main lift, clean or push press is marked slow', ['back_squat', 'front_squat', 'strict_press', 'weighted_pullup', 'power_clean', 'push_press'].every(k => !plan.exercises[k].slow));
  const early = [1, 2, 3, 4].map(i => ({ dir: 'early', used: 2.5, at: `t${i}` }));
  check('pacing never shortens a slow lift (learnRep with keep-tempo)', learnRep(early, 5, pacingConfig(rules), true).repSeconds == null && learnRep(early, 5, pacingConfig(rules), false).repSeconds != null);
  const lp = learnPacing({ sessions: [{ startedAt: '2026-12-01', sets: [1, 2, 3].map(i => ({ exerciseId: 'incline_curl', done: true, reps: 8, weight: 50, setIndex: i, secs: { plan: 48, took: 22, by: 'done' }, at: `2026-12-01T00:0${i}:00Z` })) }], plan, rules, settings });
  check('his early Done taps on the incline curl do not shorten its timer', !(lp.incline_curl && lp.incline_curl.repSeconds), lp.incline_curl);
  const sp = new Player({ timeline: tl, plan, rules, settings, targets, container: null, onFinish: () => {} });
  const curl = tl.steps[first('incline_curl')];
  const n1 = sp.slowNudge({ ...curl, record: { secs: { plan: 48, took: 25 } } }, plan.exercises.incline_curl, false);
  const n2 = sp.slowNudge({ ...curl, record: { secs: { plan: 48, took: 25 } } }, plan.exercises.incline_curl, false);
  const n3 = sp.slowNudge({ ...tl.steps[first('oh_tri_ext')], record: { secs: { plan: 48, took: 46 } } }, plan.exercises.oh_tri_ext, false);
  check('Done well before the timer on a slow lift says so once per lift; on time says nothing', /slow lift: 3 s down, pause with straight arms. Use the whole timer/.test(n1) && n2 === '' && n3 === '', [n1, n2, n3]);
}

// ---- v1.25.0: the Runs tab cleaned up (Cameron, Nov 26). Plan check, intervals as blocks, the goals card. ----
{
  console.log('v1.25.0 Runs tab: plan check, blocks, goals');
  const run1 = plan.runs.find(r => r.id === 'run1'), run2 = plan.runs.find(r => r.id === 'run2');
  const st = { ...settings, startDate: '2026-11-16' };
  const ask = w => prescription(run1, w, [], '2026-11-16');
  check('intervals take warm-up + reps + cool-down: weeks 1-4 28 min, 5-8 33, 9-12 34 (easy 2-3 counts as 2.5)', intervalMinutes(run1, ask(1)) === 28 && intervalMinutes(run1, ask(5)) === 33 && intervalMinutes(run1, ask(9)) === 34, [intervalMinutes(run1, ask(1)), intervalMinutes(run1, ask(5)), intervalMinutes(run1, ask(9))]);
  const bl = workoutBlocks(run1, ask(1));
  check('week 1 as blocks: warm-up, 5 fast and 5 easy, cool-down, 28 min in all', bl.length === 12 && bl[0].kind === 'warm' && bl[11].kind === 'cool' && bl.filter(b => b.kind === 'fast').length === 5 && bl.reduce((m, b) => m + b.min, 0) === 28, bl);
  check('no blocks for a 5K check-in week or the long run', workoutBlocks(run1, ask(3)) === null && workoutBlocks(run2, prescription(run2, 2, [], '2026-11-23')) === null);
  // made-up runs shaped like his first two weeks (his own log never goes in the app repo)
  const his = [
    { id: 'r-1', source: 'manual', date: '2026-11-18', type: 'Intervals', planId: 'run1', distance: 2.7, minutes: 27, hr: 160, week: 1 },
    { id: 'r-2', source: 'manual', date: '2026-11-22', type: 'Long run', planId: 'run2', distance: 3.6, minutes: 36, hr: 158, week: 1 },
    { id: 'r-3', source: 'manual', date: '2026-11-26', type: 'Intervals', planId: 'run1', distance: 3.4, minutes: 61, hr: 135, week: 2 }
  ];
  const pc = r => planCheck(plan, rules, st, his, r);
  check('Nov 18 intervals, 27 of 28 min: on plan', pc(his[0]).level === 'good' && pc(his[0]).label === 'On plan' && pc(his[0]).detail === '27 min of about 28', pc(his[0]));
  check('Nov 22 long run, 3.6 of the 3.5 mi week 1 asked: on plan, and no heart rate check before the Nov 26 heart rates', pc(his[1]).level === 'good' && pc(his[1]).hr === null && pc(his[1]).detail === '3.6 of 3.5 mi', pc(his[1]));
  check('Nov 26 intervals, 61 of 28 min (the watch ran on?): well over, red', pc(his[2]).level === 'off' && pc(his[2]).label === 'Well over' && pc(his[2]).ratio === 2.18, pc(his[2]));
  const lr = (d, mi, hr) => planCheck(plan, rules, st, his, { id: 'x', date: d, type: 'Long run', planId: 'run2', distance: mi, minutes: mi * 10, hr, week: 2 });
  check('the bands: 80-120% on plan, 50-79% a bit short, 121-150% a bit long, past that well off (TrainingPeaks, Final Surge)',
    lr('2026-11-28', 3.1, 140).level === 'good' && lr('2026-11-28', 2.9, 140).label === 'A bit short' && lr('2026-11-28', 5, 140).label === 'A bit long' && lr('2026-11-28', 1.8, 140).label === 'Well short' && lr('2026-11-28', 5.7, 140).label === 'Well over',
    [3.1, 2.9, 5, 1.8, 5.7].map(m => lr('2026-11-28', m, 140).label));
  check('long run heart rate from Nov 26: 150 is easy, 158 a bit high (yellow), 165 high (red), and the distance still shows', lr('2026-11-28', 3.75, 150).level === 'good' && lr('2026-11-28', 3.75, 158).level === 'near' && lr('2026-11-28', 3.75, 158).label === 'HR high' && lr('2026-11-28', 3.75, 165).level === 'off' && lr('2026-11-28', 3.75, 165).detail.startsWith('3.75 of 3.75 mi'), [lr('2026-11-28', 3.75, 158), lr('2026-11-28', 3.75, 165)]);
  check('short and too hard says both', lr('2026-11-28', 2.9, 165).label === 'A bit short · HR high', lr('2026-11-28', 2.9, 165).label);
  check('a 5K check-in is on plan once it has a 5K time', planCheck(plan, rules, st, his, { id: 'k', date: '2026-12-01', type: '5K test', planId: 'run1', distance: 4.5, minutes: 44, best5k: 1600, week: 3 }).label === '5K done');
  check('nothing for a side run, a Garmin run not counted yet, a ski day, or a run before the plan',
    planCheck(plan, rules, st, his, { id: 'garmin-1', date: '2026-11-27', type: 'Easy run', planId: null, typeLocked: true, distance: 2, minutes: 20, week: 2 }) === null &&
    planCheck(plan, rules, st, his, { id: 'garmin-2', date: '2026-11-27', type: 'Easy run', distance: 2, minutes: 20, week: 2 }) === null &&
    planCheck(plan, rules, st, his, { id: 's', date: '2026-11-28', type: 'Ski day', planId: 'run2', week: 2, minutes: 200 }) === null &&
    planCheck(plan, rules, st, his, { id: 'o', date: '2026-11-10', type: 'Intervals', planId: 'run1', distance: 2, minutes: 28, week: 0 }) === null);
  check('planRunOf follows Count it', planRunOf(plan, his[0]).id === 'run1' && planRunOf(plan, { id: 'garmin-9', type: 'Easy run' }) === null);
  check('inDays: today, tomorrow, in 5 days, in 4 weeks', inDays('2026-11-26', '2026-11-26') === 'today' && inDays('2026-11-26', '2026-11-27') === 'tomorrow' && inDays('2026-11-26', '2026-12-01') === 'in 5 days' && inDays('2026-12-01', '2026-12-29') === 'in 4 weeks');
  const g = runGoals({ plan, settings: st, runs: his, today: new Date(2026, 10, 26, 15, 15) });
  check('goals on Thu Nov 26: 5K 23:00 with no time yet, first check-in Tue Dec 1 in 5 days', g.fiveK.goal === '23:00' && g.fiveK.latest === null && g.fiveK.share === 0 && g.fiveK.next.date === '2026-12-01' && g.fiveK.next.when === 'in 5 days', g.fiveK);
  check('long run: 3.6 of 7 mi (51%), 3.75 mi this weekend (10% rule), 7 mi in week 11 if every one is done', g.long.cap === 7 && g.long.longest.miles === 3.6 && Math.round(g.long.share * 100) === 51 && g.long.ask === 3.75 && g.long.reachWeek === 11, g.long);
  check('3 planned runs done, none missed', g.done.runs === 3 && g.done.missed === 0, g.done);
  const k1 = { id: 'k1', date: '2026-12-01', type: '5K test', planId: 'run1', distance: 4.5, minutes: 44, best5k: 1620, week: 3 };
  const k2 = { id: 'k2', date: '2026-12-29', type: '5K test', planId: 'run1', distance: 4.5, minutes: 43, best5k: 1560, week: 7 };
  const g2 = runGoals({ plan, settings: st, runs: [...his, k1, k2], today: new Date(2026, 11, 30, 12) });
  check('after two check-ins (27:00, then 26:00): a quarter of the way from 27:00 to 23:00, next one Tue Feb 2', g2.fiveK.latest.seconds === 1560 && Math.round(g2.fiveK.share * 100) === 25 && g2.fiveK.next.date === '2027-02-02', g2.fiveK);
  const g3 = runGoals({ plan, settings: st, runs: [...his, k1], today: new Date(2026, 11, 15, 12) });
  check('on Dec 15 (week 5): 4 done, and 4 missed in weeks that are over (weeks 2 and 3 long runs, both runs in week 4)', g3.done.runs === 4 && g3.done.missed === 4, g3.done);
}

console.log(failures ? `\n${failures} FAILED` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
