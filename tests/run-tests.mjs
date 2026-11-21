// Node tests for the Session Builder and Progression Engine. Run: node tests/run-tests.mjs
import { readFileSync } from 'node:fs';
import { buildTimeline, trimToFit, remainingSeconds, lastResults, setTiming } from '../js/builder.js';
import { applyProgression, epley, checkPR, estimateStart } from '../js/progression.js';
import { effortPlain, effortLevel, spokenDuration } from '../js/data.js';
import { weekOwed, owedSetsFor, owedLines, buildCatchUpSession, slackDays, plannedDay } from '../js/catchup.js';
import { parseRepo, toBase64, fromBase64, setupLink, readSetupLink, explainStatus } from '../js/sync.js';
import { strengthSeries, adherence, weeklySets, accessoryRows, prList, yTicks, muscleSets } from '../js/progress.js';
import { changesFor, replyFor, pendingAdjustments, withRest, thread } from '../js/coach.js';
import { applyRestAdjust } from '../js/builder.js';
import { parseMinutes, fmtDuration, paceOf, runLine, planRunForType, longRunTarget, prescription, weekRuns, weeklyMiles, garminToRun, mergeGarmin, garminList, settleWeek, isAuto, openRunDays } from '../js/runs.js';
import { garminLinks, GARMIN_JOB } from '../js/sync.js';
import { numberFlag, flaggedGroups, applyNumberFix } from '../js/sanity.js';
import { markAmrap, amrapCheck, amrapRepsText, isAmrapWeek } from '../js/amrap.js';
import { undoKneeSwap } from '../js/knee.js';
import { swapScore, latestScore, applyKneeSwap, swappable, askIdx, morningDue, kneeHeld, kneeTrend, kneeEntry } from '../js/knee.js';

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
  check(`${sid}: planned ${minutes.toFixed(1)} min without if-time is within 68 (week 1 has baseline work-ups)`, minutes <= 68 && minutes >= 45, { minutes });
  check(`${sid}: has a baseline top set for each main lift`, tl.steps.filter(s => s.baseline).length >= 1);
  check(`${sid}: ends with stretch steps (or if-time)`, ['stretch', 'decision', 'set', 'rest'].includes(kinds.at(-1)));
  check(`${sid}: stretch block is 6 steps = 300 s`, tl.steps.filter(s => s.kind === 'stretch').length === 6 && tl.steps.filter(s => s.kind === 'stretch').reduce((a, s) => a + s.seconds, 0) === 300);
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
check('lift2 week 1: Engine = 9 one-minute timed steps rotating 3 stations', e1.length === 9 && e1.every(s => s.kind === 'timed' && s.seconds === 60 && s.countdown && s.blockType === 'emom') && e1[0].name.startsWith('Min 1 of 9: Bike') && e1[3].name.startsWith('Min 4 of 9: Bike') && e1[8].round === 3, e1.map(s => s.name));
check('lift2: Engine minutes by week: 9, test, 9, 12, 6 (light), 15 (heavy), test', [1, 2, 3, 4, 7, 8, 12].map(w => eng(w).length).join(',') === '9,1,9,12,6,15,1', [1, 2, 3, 4, 7, 8, 12].map(w => eng(w).length));
check('lift2 weeks 2 and 12: Engine is a 2,000 m ski erg test', /2,000 m ski erg/.test(eng(2)[0].name) && /2,000 m ski erg/.test(eng(12)[0].name));
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
check('week 3 lift1: 4 ramp-up sets (45, 95, 130, 155)', ramps.map(s => s.target.weight).join(',') === '45,95,130,155', ramps.map(s => s.target.weight));
check('week 3 lift1: work sets pre-filled 185 x 4', w3.steps.filter(s => s.exerciseId === 'back_squat' && !s.ramp).every(s => s.target.weight === 185 && s.target.reps === 4));
check('week 3 lift1: planned within 61 min', w3.plannedSeconds / 60 <= 61, { min: w3.plannedSeconds / 60 });
const w3l2 = buildTimeline({ plan, rules, settings, sessionId: 'lift2', week: 3, targets });
check('week 3 lift2: press ramps (95 lb target: 45, 50, 65, 80)', w3l2.steps.filter(s => s.ramp).map(s => s.target.weight).join(',') === '45,50,65,80', w3l2.steps.filter(s => s.ramp).map(s => s.target.weight));
check('week 3 lift2: planned within 62 min', w3l2.plannedSeconds / 60 <= 62, { min: w3l2.plannedSeconds / 60 });
const w3l3 = buildTimeline({ plan, rules, settings, sessionId: 'lift3', week: 3, targets });
check('week 3 lift3: planned within 62 min without if-time (v1.11: calf raise in the finisher)', w3l3.steps.filter(s => !s.iftime).reduce((a, s) => a + s.seconds, 0) / 60 <= 62, { min: w3l3.plannedSeconds / 60 });

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
check('trim never touches stretch', tr.steps.filter(s => s.kind === 'stretch').length === 6);
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
check('baseline e1RM recorded (216)', r.e1rms.back_squat === 216, r.e1rms);

// main lift pass
r = applyProgression({ session: mkSession(3, [ws('back_squat', 185, 6, 8, [4, 6]), ws('back_squat', 185, 6, 8, [4, 6]), ws('back_squat', 185, 6, 7, [4, 6])]), targets: { back_squat: { weight: 185, reps: 6, stall: 0 } }, rules, plan, settings });
check('main lift pass -> +5 lb, reps to bottom', r.targets.back_squat.weight === 190 && r.targets.back_squat.reps === 4, r.targets.back_squat);
// press increments 2.5
r = applyProgression({ session: mkSession(3, [ws('strict_press', 95, 6, 8, [4, 6]), ws('strict_press', 95, 6, 8, [4, 6]), ws('strict_press', 95, 6, 8, [4, 6]), ws('strict_press', 95, 6, 8, [4, 6])]), targets: { strict_press: { weight: 95, reps: 6 } }, rules, plan, settings });
check('press pass -> +2.5 lb', r.targets.strict_press.weight === 97.5, r.targets.strict_press);
// main lift miss, nudge reps
r = applyProgression({ session: mkSession(3, [ws('back_squat', 185, 5, 8, [4, 6]), ws('back_squat', 185, 4, 8, [4, 6]), ws('back_squat', 185, 4, 8, [4, 6])]), targets: { back_squat: { weight: 185, reps: 4, stall: 0 } }, rules, plan, settings });
check('main lift miss -> same weight, reps 5, stall 1', r.targets.back_squat.weight === 185 && r.targets.back_squat.reps === 5 && r.targets.back_squat.stall === 1, r.targets.back_squat);
// second miss -> drop 10%
r = applyProgression({ session: mkSession(4, [ws('back_squat', 185, 4, 9, [4, 6]), ws('back_squat', 185, 4, 9, [4, 6]), ws('back_squat', 185, 3, 10, [4, 6])]), targets: { back_squat: { weight: 185, reps: 5, stall: 1 } }, rules, plan, settings });
check('second miss -> 165 (down 10%), stall reset', r.targets.back_squat.weight === 165 && r.targets.back_squat.stall === 0, r.targets.back_squat);
// skipped set fails test
r = applyProgression({ session: mkSession(3, [ws('back_squat', 185, 6, 8, [4, 6]), ws('back_squat', 185, 6, 8, [4, 6]), { exerciseId: 'back_squat', repRange: [4, 6], done: false, skipped: true }]), targets: { back_squat: { weight: 185, reps: 6, stall: 0 } }, rules, plan, settings });
check('skipped set -> no increase', r.targets.back_squat.weight === 185 && /skipped/.test(r.lines[0].text), r.lines[0]);
// accessory reps first then weight
r = applyProgression({ session: mkSession(3, [ws('curl', 30, 10, 9, [10, 12]), ws('curl', 30, 10, 9, [10, 12]), ws('curl', 30, 10, 9, [10, 12])]), targets: { curl: { weight: 30, reps: 10 } }, rules, plan, settings });
check('accessory under top -> reps 11', r.targets.curl.weight === 30 && r.targets.curl.reps === 11, r.targets.curl);
r = applyProgression({ session: mkSession(3, [ws('curl', 30, 12, 9, [10, 12]), ws('curl', 30, 12, 9, [10, 12]), ws('curl', 30, 12, 9, [10, 12])]), targets: { curl: { weight: 30, reps: 12 } }, rules, plan, settings });
check('v1.5 two-dumbbell accessory at top -> +10 lb total (5 a hand), reps 10', r.targets.curl.weight === 40 && r.targets.curl.reps === 10, r.targets.curl);
r = applyProgression({ session: mkSession(3, [ws('oh_tri_ext', 30, 12, 9, [10, 12]), ws('oh_tri_ext', 30, 12, 9, [10, 12]), ws('oh_tri_ext', 30, 12, 9, [10, 12])]), targets: { oh_tri_ext: { weight: 30, reps: 12 } }, rules, plan, settings });
check('single-dumbbell accessory at top -> +5 lb, reps 10', r.targets.oh_tri_ext.weight === 35 && r.targets.oh_tri_ext.reps === 10, r.targets.oh_tri_ext);
// first time accessory with no target
r = applyProgression({ session: mkSession(1, [ws('rdl', 155, 6, 8, [6, 8]), ws('rdl', 155, 6, 8, [6, 8]), ws('rdl', 155, 7, 8, [6, 8])]), targets: {}, rules, plan, settings });
check('first log adopts weight 155, reps 6', r.targets.rdl.weight === 155 && r.targets.rdl.reps === 6, r.targets.rdl);
// light week unchanged
r = applyProgression({ session: mkSession(7, [ws('back_squat', 190, 6, 7, [4, 6]), ws('back_squat', 190, 6, 7, [4, 6])]), targets: { back_squat: { weight: 190, reps: 4, stall: 0 } }, rules, plan, settings });
check('week 7 unchanged', r.targets.back_squat.weight === 190 && r.targets.back_squat.reps === 4, r.targets.back_squat);
// transition into heavy (week 7 session -> next week 8)
check('week 7 -> heavy note present', r.lines.some(l => /weeks 8-11/.test(l.text)) === false, r.lines); // light week returns early, by design
r = applyProgression({ session: mkSession(6, [ws('back_squat', 190, 6, 8, [4, 6]), ws('back_squat', 190, 6, 8, [4, 6]), ws('back_squat', 190, 6, 8, [4, 6])]), targets: { back_squat: { weight: 190, reps: 4, stall: 0 } }, rules, plan, settings });
check('week 6 pass -> 195 (no heavy switch yet, week 7 is light)', r.targets.back_squat.weight === 195, r.targets.back_squat);
// power clean excluded
r = applyProgression({ session: mkSession(3, [ws('power_clean', 135, 2, 7, [2, 2]), ws('power_clean', 135, 2, 7, [2, 2]), ws('power_clean', 135, 2, 7, [2, 2]), ws('power_clean', 135, 2, 7, [2, 2])]), targets: { power_clean: { weight: 135, reps: 2 } }, rules, plan, settings });
check('power clean not auto-progressed', r.targets.power_clean.weight === 135 && /Not auto-progressed/.test(r.lines[0].text), r.lines[0]);
// weighted pull-up e1RM includes bodyweight
r = applyProgression({ session: mkSession(3, [ws('weighted_pullup', 25, 6, 8, [4, 6]), ws('weighted_pullup', 25, 6, 8, [4, 6]), ws('weighted_pullup', 25, 6, 8, [4, 6]), ws('weighted_pullup', 25, 6, 8, [4, 6])]), targets: { weighted_pullup: { weight: 25, reps: 6 } }, rules, plan, settings });
check('pull-up e1RM uses bodyweight (165+25)x1.2 = 228; v1.5 jump is 5 lb', r.e1rms.weighted_pullup === 228 && r.targets.weighted_pullup.weight === 30, { e: r.e1rms, t: r.targets.weighted_pullup });
check('epley 185x5 = 216', epley(185, 5) === 216);

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
check('engine reports e1RM and weight PRs', r.prs.length === 2 && r.prs.some(p => p.kind === 'e1rm' && p.value === 222) && r.prs.some(p => p.kind === 'weight' && p.value === 185), r.prs);
check('engine stores new bests', r.targets.back_squat.bestE1rm === 222 && r.targets.back_squat.bestWeight === 185, r.targets.back_squat);
r = applyProgression({ session: mkSession(1, [ws('back_squat', 185, 5, 8, [5, 5], { baseline: true }), ws('back_squat', 165, 4, 7, [4, 6])]), targets: {}, rules, plan, settings });
check('no PR reported when there was no previous best', r.prs.length === 0 && r.targets.back_squat.bestE1rm === 216, { prs: r.prs, t: r.targets.back_squat });
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
  check('v1.8 owed: knows which exercises the session already logged', item('rdl').hadDone && item('rdl').undoStall && !item('calf_raise').hadDone);
  check('v1.8 owed: a lift whose day passed with nothing logged is missed; a later one is not', owed.missed.join() === 'lift2' && owed.lifts.find(l => l.id === 'lift2').day === 'Wednesday' && !owed.lifts.some(l => l.id === 'lift3'), owed.missed);
  check('v1.8 owed: other weeks owe nothing', weekOwed({ plan, sessions: [lift1], week: 4, today: new Date(2026, 11, 7, 8) }).totalSets === 0);
  check('v1.8 Slack days come from the calendar', slackDays(plan).join() === 'Thursday,Sunday' && plannedDay(plan, 'lift3').name === 'Friday', slackDays(plan));
  check('v1.8 owed lines read plainly', owedLines(owed)[0].short === 'Legs' && owedLines(owed)[0].text.startsWith('Romanian deadlift 1 set, Standing calf raise 3 sets'), owedLines(owed));

  const cu = buildCatchUpSession(plan, rules, owed);
  check('v1.8 catch-up session: warm-up, the owed blocks in plan order, stretch', cu.blocks.map(b => `${b.id}/${b.type}`).join() === 'warmup/warmup,lift1:B/superset,lift1:finisher/finisher,stretch/stretch', cu.blocks.map(b => `${b.id}/${b.type}`));
  const tlc = buildTimeline({ plan, rules, settings, session: cu, week: 3, targets: { rdl: { weight: 150, reps: 6 }, calf_raise: { weight: 140, reps: 10 }, curl: { weight: 50, reps: 10 }, oh_tri_ext: { weight: 40, reps: 10 } } });
  const sets = tlc.steps.filter(s => s.kind === 'set' && !s.ramp);
  check('v1.8 catch-up timeline: exactly the owed sets, tagged with the lift they came from', sets.length === 6 && sets.filter(s => s.exerciseId === 'calf_raise').length === 3 && sets.every(s => s.blockId.startsWith('lift1:')) && tlc.sessionId === 'catchup' && tlc.catchUp, sets.map(s => [s.exerciseId, s.blockId]));
  check('v1.8 catch-up timeline: every set still gets a get-ready count, and it is short', tlc.plannedSeconds / 60 < 25 && tlc.steps.filter(s => s.kind === 'stretch').length === 6, tlc.plannedSeconds / 60);
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
  check('v1.8 catch-up sets for a lift already logged do not move its target, and take back the skipped-set miss', res.targets.rdl.weight === 150 && res.targets.rdl.reps === 7 && res.targets.rdl.stall === 0 && line('rdl').reason === 'catch-up sets', [res.targets.rdl, line('rdl')]);
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

// ---- v1.10: runs and Garmin ----
{
  const st = { ...settings, startDate: '2026-11-16' };
  check('v1.10 time: 27:30, 1:02:30 and 27.5 all read as minutes; nonsense does not', parseMinutes('27:30') === 27.5 && parseMinutes('1:02:30') === 62.5 && parseMinutes('27.5') === 27.5 && parseMinutes('') === null && parseMinutes('a:b') === null && parseMinutes('abc') === null);
  check('v1.10 time prints as a clock', fmtDuration(27.5) === '27:30' && fmtDuration(62.5) === '1:02:30' && fmtDuration(8.867) === '8:52' && fmtDuration(null) === '');
  check('v1.10 one line per run; bike distance carries no pace', runLine({ type: 'Intervals', distance: 3.1, minutes: 27.5, hr: 151.6 }, rules) === '3.1 mi · 27:30 · 8:52/mi · HR 152' && runLine({ type: 'Bike/rower sub', distance: 5.59, minutes: 25 }, rules) === '5.59 mi · 25:00' && runLine({ type: 'Easy run' }, rules) === '');
  const [r1, r2] = plan.runs;
  check('v1.10 the interval set follows the week', prescription(r1, 1).text === '5 × 2 min hard, 2 min easy' && prescription(r1, 6).text === '5 × 3 min hard, 2 min easy' && prescription(r1, 12).text === '4 × 4 min hard, 2-3 min easy', [prescription(r1, 1).text, prescription(r1, 6).text, prescription(r1, 12).text]);
  check('v1.10 the numbers on the plan runs agree with their notes', r1.note.includes('5 x 2 min hard / 2 min easy') && r1.note.includes('5 x 3 / 2') && r1.note.includes('4 x 4 / 2-3') && r2.note.includes('Start 3.5 mi, add 0.5 mi') && r2.distance.startMiles === 3.5 && r2.distance.stepMiles === 0.5);
  const lr = (d, date, type = 'Long run') => ({ id: 'r' + date, date, type, planId: 'run2', distance: d, minutes: d * 10, week: 1 });
  check('v1.10 long run: starts at 3.5, goes half a mile past the longest, a ski day does not move it, stops at the cap',
    longRunTarget(r2, []).miles === 3.5 && longRunTarget(r2, [lr(3.62, '2026-11-21')]).miles === 4 && longRunTarget(r2, [lr(3.62, '2026-11-21'), lr(2, '2026-11-28')]).miles === 4
    && longRunTarget(r2, [lr(9, '2026-11-21', 'Ski day')]).miles === 3.5 && longRunTarget(r2, [lr(6.8, '2026-12-20')]).miles === 7 && longRunTarget(r2, [lr(8, '2026-12-20')]).miles === 7,
    [longRunTarget(r2, [lr(3.62, '2026-11-21')]), longRunTarget(r2, [lr(9, '2026-11-21', 'Ski day')])]);
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
  check('v1.10 merge: Saturday is the long run, a second weekend run is an easy run, and nothing from before the block', m.added === 2 && by['garmin-12'].type === 'Long run' && by['garmin-12'].planId === 'run2' && by['garmin-13'].type === 'Easy run' && by['garmin-13'].planId === null && !by['garmin-10'] && by['garmin-12'].week === 1 && by['garmin-12'].rpe === null, m.put.map(r => [r.id, r.type]));
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
  const wed = merge([], [g(1, '2026-11-25 18:00:00', 4500, 1700)]);
  check('v1.12 a run on Wednesday, with Tuesday missed, counts as the intervals and says why', byId(wed)['garmin-1'].type === 'Intervals' && byId(wed)['garmin-1'].planId === 'run1' && byId(wed)['garmin-1'].autoWhy === 'the week\'s intervals were still open', byId(wed)['garmin-1']);
  const longTue = merge([], [g(2, '2026-11-24 07:00:00', 6000, 3300)]);
  check('v1.12 a long run done on Tuesday counts as the long run, not the intervals', byId(longTue)['garmin-2'].type === 'Long run' && byId(longTue)['garmin-2'].autoWhy === 'it was long enough for the long run', byId(longTue)['garmin-2']);
  const two = merge([], [g(3, '2026-11-26 18:00:00', 4500, 1700), g(4, '2026-11-28 08:00:00', 6400, 3500), g(5, '2026-11-29 08:00:00', 3000, 1200)]);
  const t = byId(two);
  check('v1.12 Thursday fills the intervals, Saturday the long run, a third run is an easy run', t['garmin-3'].type === 'Intervals' && t['garmin-4'].type === 'Long run' && t['garmin-5'].type === 'Easy run' && t['garmin-5'].autoWhy === 'both planned runs were already done', [t['garmin-3'].type, t['garmin-4'].type, t['garmin-5'].type]);
  const signal = merge([], [g(6, '2026-11-25 18:00:00', 4000, 1500), g(7, '2026-11-27 18:00:00', 4800, 1900, { trainingEffectLabel: 'VO2MAX' })]);
  const sg = byId(signal);
  check('v1.12 a run that looks like intervals takes the intervals from an earlier run that only filled the slot', sg['garmin-7'].type === 'Intervals' && sg['garmin-7'].autoWhy === 'it looked like intervals' && sg['garmin-6'].type === 'Easy run', [sg['garmin-6'].type, sg['garmin-7'].type]);
  check('v1.12 interval signs: Garmin\'s label, its anaerobic effect, or max speed well above average', garminToRun(g(8, '2026-11-25 18:00:00', 4000, 1500, { anaerobicTrainingEffect: 2.6 }), { rules }).intervalLike === true
    && garminToRun(g(9, '2026-11-25 18:00:00', 4000, 1500, { trainingEffectLabel: 'AEROBIC_BASE' }), { rules }).intervalLike === false
    && garminToRun(g(10, '2026-11-25 18:00:00', 4000, 1500, { averageSpeed: 2.7, maxSpeed: 4.3 }), { rules }).intervalLike === true
    && garminToRun(g(11, '2026-11-25 18:00:00', 4000, 1500), { rules }).intervalLike === null);
  const sat = merge([], [g(12, '2026-11-28 08:00:00', 2400, 1000)]);
  check('v1.12 a short Saturday jog is not taken for the long run; it fills the open intervals', byId(sat)['garmin-12'].type === 'Intervals', byId(sat)['garmin-12']);
  const short = merge([], [g(13, '2026-11-25 07:00:00', 1600, 720)]);
  check('v1.12 a 12-minute jog fills nothing', byId(short)['garmin-13'].type === 'Easy run' && byId(short)['garmin-13'].autoWhy === 'it did not fit a planned run', byId(short)['garmin-13']);
  // Cameron's pick sticks, and the rest of the week follows it
  const all = [{ ...t['garmin-3'], type: 'Easy run', planId: null, typeLocked: true, autoType: false }, t['garmin-4'], t['garmin-5']];
  const changed = settleWeek(all, 2, ctx);
  check('v1.12 when Cameron re-types a run, the others in the week settle around it', changed.length === 1 && changed[0].id === 'garmin-5' && changed[0].type === 'Intervals' && all[0].type === 'Easy run' && all[1].type === 'Long run', changed.map(r => [r.id, r.type]));
  check('v1.12 settling again changes nothing', settleWeek(all, 2, ctx).length === 0);
  const hand = merge([{ id: 'run_9', date: '2026-11-24', type: 'Intervals', planId: 'run1', distance: 3, minutes: 30 }], [g(14, '2026-11-26 18:00:00', 4500, 1700)]);
  check('v1.12 a run logged by hand keeps its slot; the Garmin run goes elsewhere', byId(hand)['garmin-14'].type === 'Easy run' && !byId(hand)['run_9'], hand.put.map(r => [r.id, r.type]));
  check('v1.12 old Garmin runs: Easy run is still the app\'s pick, anything else was Cameron\'s', isAuto({ id: 'garmin-1', type: 'Easy run' }) && !isAuto({ id: 'garmin-1', type: 'Intervals' }) && !isAuto({ id: 'run_1', type: 'Easy run' }) && !isAuto({ id: 'garmin-1', type: 'Easy run', typeLocked: true }));
  const ski = merge([], [g(15, '2026-11-28 09:00:00', 30000, 14400, { activityType: { typeKey: 'resort_skiing_snowboarding_ws' } }), g(16, '2026-11-29 08:00:00', 4500, 1700), g(17, '2026-11-29 17:00:00', 6000, 3300)]);
  check('v1.12 a ski day takes the long run; a 28-minute Sunday run fills the open intervals, an hour-long one is an easy run', byId(ski)['garmin-15'].type === 'Ski day' && byId(ski)['garmin-16'].type === 'Intervals' && byId(ski)['garmin-17'].type === 'Easy run', ski.put.map(r => [r.id, r.type]));
  const days = (iso, id) => openRunDays({ ...ctx, runId: id, week: 2, today: new Date(iso + 'T09:00:00') }).map(d => d.name + (d.today ? '*' : ''));
  check('v1.12 open intervals can move to Thursday, Saturday or Sunday; past days and lift days drop off', days('2026-11-25', 'run1').join() === 'Thursday,Saturday,Sunday' && days('2026-11-26', 'run1').join() === 'Thursday*,Saturday,Sunday' && days('2026-11-28', 'run1').join() === 'Saturday*,Sunday' && days('2026-11-29', 'run1').join() === 'Sunday*', [days('2026-11-25', 'run1'), days('2026-11-26', 'run1')]);
  const moveDays = rules.runSchedule.moveTo;
  check('v1.12 no run is ever offered on a lift day', Object.values(moveDays).flat().every(d => !plan.sessions.some(s => s.id === plan.calendar[d])));
}

// ---- v1.19 all-out last set (rules.amrap) ----
console.log('v1.19 all-out set');
{
  const tg = { back_squat: { weight: 185, reps: 5 }, strict_press: { weight: 95, reps: 5 }, weighted_pullup: { weight: 25, reps: 5 }, front_squat: { weight: 135, reps: 5 }, push_press: { weight: 115, reps: 4 }, power_clean: { weight: 135, reps: 2 }, rdl: { weight: 155, reps: 6 } };
  const amraps = (sid, week) => buildTimeline({ plan, rules, settings, sessionId: sid, week, targets: tg }).steps.filter(s => s.amrap);
  check('weeks 4, 6, 9 and 11 have all-out sets; 1-3, 5, 7, 8, 10 and 12 do not', [4, 6, 9, 11].every(w => isAmrapWeek(rules, w)) && [1, 2, 3, 5, 7, 8, 10, 12].every(w => !isAmrapWeek(rules, w)));
  const a1 = amraps('lift1', 4);
  check('lift1 week 4: only the last back squat set is all-out', a1.length === 1 && a1[0].exerciseId === 'back_squat' && a1[0].setIndex === 3, a1.map(s => [s.exerciseId, s.setIndex]));
  check('the all-out set ends on Done, not its timer, and asks for at least the target', a1[0].auto === false && a1[0].amrapFloor === 5 && /at least 5, then as many good reps as you can/.test(a1[0].effortText) && amrapRepsText(a1[0]) === '5+', a1[0]);
  check('its first tip is the stop rule, and it is planned longer than a normal set', a1[0].tips[0] === rules.amrap.stopWhen && a1[0].seconds > buildTimeline({ plan, rules, settings, sessionId: 'lift1', week: 3, targets: tg }).steps.filter(s => s.exerciseId === 'back_squat' && !s.ramp && s.kind === 'set').at(-1).seconds);
  const a2 = amraps('lift2', 6).map(s => s.exerciseId).sort().join();
  check('lift2 week 6: press and pull-up each get one, the 4th set', a2 === 'strict_press,weighted_pullup' && amraps('lift2', 6).every(s => s.setIndex === 4), a2);
  const a3 = amraps('lift3', 9).map(s => s.exerciseId).sort().join();
  check('lift3 week 9: front squat and push press, never the power clean', a3 === 'front_squat,push_press', a3);
  check('a ramp-up, the RDL and accessories are never all-out', [4, 6, 9, 11].every(w => ['lift1', 'lift2', 'lift3'].every(sid => amraps(sid, w).every(s => !s.ramp && rules.amrap.exercises.includes(s.exerciseId)))));
  const cu = buildCatchUpSession(plan, rules, { lifts: [{ id: 'lift1', short: 'Legs', sets: 2, blocks: [{ blockId: 'A', items: [{ exerciseId: 'back_squat', sets: 2, hadDone: true, undoStall: false }] }] }] });
  check('a catch-up session in week 4 has no all-out set', !buildTimeline({ plan, rules, settings, session: cu, week: 4, targets: tg }).steps.some(s => s.amrap));
  check('the other steps still number 0..n', buildTimeline({ plan, rules, settings, sessionId: 'lift1', week: 4, targets: tg }).steps.every((s, i) => s.idx === i));

  const sq = (w, reps, rpe, extra) => ws('back_squat', w, reps, rpe, [4, 6], extra);
  const run = (sets, t = { back_squat: { weight: 185, reps: 6, stall: 0, bestE1rm: 230 } }) => applyProgression({ session: mkSession(4, sets), targets: t, rules, plan, settings });
  let r4 = run([sq(185, 6, 8), sq(185, 6, 8), sq(185, 8, 10, { amrap: true })]);
  check('all sets at 6, all-out 8 at Maxed: the Maxed tap does not fail the test, normal +5', r4.targets.back_squat.weight === 190 && r4.lines[0].verdict === 'up' && /All-out set: 8 reps, about 3 left at 6/.test(r4.lines[0].text), r4.lines[0]);
  r4 = run([sq(185, 6, 8), sq(185, 6, 8), sq(185, 6, 10, { amrap: true })]);
  check('all-out only 6 (the top): the Solid taps were optimistic, weight holds, no miss counted', r4.targets.back_squat.weight === 185 && r4.targets.back_squat.reps === 6 && (r4.targets.back_squat.stall || 0) === 0 && r4.lines[0].verdict === 'hold' && /harder than they felt/.test(r4.lines[0].text), [r4.targets.back_squat, r4.lines[0]]);
  r4 = run([sq(185, 6, 8), sq(185, 6, 8), sq(185, 12, 9.5, { amrap: true })]);
  // e1RM = 185 x (1 + 13/30) = 265; for 6 reps with 2 left: 265 / (1 + 8/30) = 209 -> 205, capped at +3 steps = 200
  check('all-out 12 at 185: more in the tank, jumps to 200 (3 steps, the cap) instead of 190', r4.targets.back_squat.weight === 200 && r4.targets.back_squat.reps === 4 && r4.lines[0].verdict === 'up' && /More in the tank/.test(r4.lines[0].text), [r4.targets.back_squat, r4.lines[0].text]);
  r4 = run([sq(185, 6, 8), sq(185, 6, 8), sq(185, 10, 9.5, { amrap: true })]);
  // e1RM = 185 x (1 + 11/30) = 253; 253 / (1 + 8/30) = 199.7 -> 195
  check('all-out 10 at 185: next target 195 from the e1RM rule', r4.targets.back_squat.weight === 195, r4.targets.back_squat);
  r4 = run([sq(185, 4, 8), sq(185, 4, 8), sq(185, 11, 9.5, { amrap: true })], { back_squat: { weight: 185, reps: 4, stall: 1 } });
  check('sets logged at the target 4 but all-out 11: the all-out set raises the weight instead of a second miss', r4.targets.back_squat.weight > 185 && r4.targets.back_squat.stall === 0 && r4.lines[0].verdict === 'up', [r4.targets.back_squat, r4.lines[0]]);
  r4 = run([sq(185, 4, 8, { target: { weight: 185, reps: 6 } }), sq(185, 6, 8, { target: { weight: 185, reps: 6 } }), sq(185, 12, 9.5, { amrap: true, target: { weight: 185, reps: 6 } })]);
  check('a set short of its target that day: no jump, the normal result stands', r4.targets.back_squat.weight === 185 && r4.lines[0].verdict === 'hold' && !/More in the tank/.test(r4.lines[0].text), [r4.targets.back_squat, r4.lines[0].text]);
  r4 = run([sq(175, 6, 8, { target: { weight: 185, reps: 6 } }), sq(185, 6, 8, { target: { weight: 185, reps: 6 } }), sq(185, 12, 9.5, { amrap: true, target: { weight: 185, reps: 6 } })]);
  check('a set under its target weight that day: no jump either', r4.targets.back_squat.weight <= 190 && !/More in the tank/.test(r4.lines[0].text), [r4.targets.back_squat, r4.lines[0].text]);
  r4 = run([sq(185, 6, 8), sq(185, 6, 8), sq(185, 3, 10, { amrap: true })]);
  check('all-out under the target (3): not every set at 6, weight holds, a miss counts', r4.targets.back_squat.weight === 185 && r4.targets.back_squat.stall === 1 && r4.lines[0].verdict === 'hold', r4.targets.back_squat);
  const pu = applyProgression({ session: mkSession(6, [ws('weighted_pullup', 25, 6, 8, [4, 6]), ws('weighted_pullup', 25, 6, 8, [4, 6]), ws('weighted_pullup', 25, 6, 8, [4, 6]), ws('weighted_pullup', 25, 11, 9.5, [4, 6], { amrap: true })]), targets: { weighted_pullup: { weight: 25, reps: 6 } }, rules, plan, settings: { ...settings, bodyweightLb: 165 } });
  // (165 + 25) x (1 + 12/30) = 266; 266 / (1 + 8/30) - 165 = 45 -> capped at 25 + 15 = 40
  check('weighted pull-up: bodyweight counts in the all-out e1RM, capped at +15', pu.targets.weighted_pullup.weight === 40, pu.targets.weighted_pullup);
  check('amrapCheck: reserve is reps + 1 - top', amrapCheck({ rules, set: { weight: 100, reps: 8 }, top: 6, bottom: 4, baseWeight: 100, inc: 5, up: true }).reserve === 3);
  check('the all-out set still counts for PRs', r4.prs.length >= 0 && run([sq(185, 6, 8), sq(185, 6, 8), sq(185, 12, 9.5, { amrap: true })]).prs.some(p => p.kind === 'e1rm'));
}

// ---- v1.19 knee check (rules.knee) ----
console.log('v1.19 knee check');
{
  const at = (iso, score, when = 'morning', extra = {}) => ({ ...kneeEntry(score, when, extra, new Date(iso)) });
  const now = new Date('2026-11-27T08:00:00');
  check('no scores: the swaps are off', swapScore(rules, [], now) === null && latestScore(rules, [], now) === null);
  check(`a score of ${rules.knee.swapAt} on Tuesday turns the swaps on for Friday`, swapScore(rules, [at('2026-11-24T07:30:00', rules.knee.swapAt)], now) !== null);
  check(`a score of ${rules.knee.swapAt - 1} does not`, swapScore(rules, [at('2026-11-24T07:30:00', rules.knee.swapAt - 1)], now) === null);
  check('a newer low score turns them off again', swapScore(rules, [at('2026-11-24T07:30:00', 6), at('2026-11-27T07:50:00', 2, 'before')], now) === null);
  check(`a high score older than ${rules.knee.carryDays} days no longer counts`, swapScore(rules, [at('2026-11-20T07:30:00', 7)], now) === null);
  const tg = { back_squat: { weight: 185, reps: 5 }, power_clean: { weight: 135, reps: 2 }, front_squat: { weight: 135, reps: 5 } };
  const l1k = buildTimeline({ plan, rules, settings, sessionId: 'lift1', week: 3, targets: tg });
  const ch = applyKneeSwap(l1k.steps, rules, plan);
  check('lift1: the back squat becomes the box squat, same weight, marked kneeSwap', ch.length === 1 && ch[0].id === 'back_squat' && l1k.steps.filter(s => s.exerciseId === 'back_squat' && s.kind === 'set').every(s => s.kneeSwap && s.name === rules.knee.fallbacks.back_squat.name && (s.ramp || s.target.weight === 185)), ch);
  check('lift1: the set-up step names the box squat; RDL and split squat are left alone', l1k.steps.some(s => s.kind !== 'set' && /Box squat/.test(s.name + ' ' + (s.setupFor || ''))) && !l1k.steps.some(s => s.kind !== 'set' && /Back squat/.test(s.name + ' ' + (s.setupFor || ''))) && l1k.steps.filter(s => ['rdl', 'bss'].includes(s.exerciseId)).every(s => !s.kneeSwap));
  const l3k = buildTimeline({ plan, rules, settings, sessionId: 'lift3', week: 3, targets: tg });
  check('lift3: hang power clean and box front squat', swappable(rules, plan, l3k.steps).map(x => x.to).join() === 'Hang power clean,Box front squat, 3-s lowering', swappable(rules, plan, l3k.steps));
  const i1 = askIdx(rules, l3k.steps);
  check('lift3 asks after the first front squat work set (not the clean)', l3k.steps[i1].exerciseId === 'front_squat' && l3k.steps[i1].setIndex === 1 && !l3k.steps[i1].ramp, l3k.steps[i1]);
  const l1a = buildTimeline({ plan, rules, settings, sessionId: 'lift1', week: 3, targets: tg });
  const fromSet2 = l1a.steps.findIndex(s => s.exerciseId === 'back_squat' && s.setIndex === 2);
  applyKneeSwap(l1a.steps, rules, plan, { fromIdx: fromSet2 });
  check('a mid-session swap changes only the sets still to come', l1a.steps.filter(s => s.exerciseId === 'back_squat' && s.kind === 'set' && !s.ramp).map(s => !!s.kneeSwap).join() === 'false,true,true');
  l1a.steps.find(s => s.exerciseId === 'back_squat' && s.setIndex === 2).done = true;
  const undone = undoKneeSwap(l1a.steps, { fromIdx: fromSet2 });
  check('a lower score puts the regular squat back on the sets not done yet', undone === 1 && l1a.steps.filter(s => s.exerciseId === 'back_squat' && s.kind === 'set' && !s.ramp).map(s => `${!!s.kneeSwap}:${s.name}`).join() === 'false:Back squat,true:Box squat, 3-s lowering,false:Back squat', l1a.steps.filter(s => s.exerciseId === 'back_squat' && s.kind === 'set' && !s.ramp).map(s => s.name));
  const l2k = buildTimeline({ plan, rules, settings, sessionId: 'lift2', week: 3, targets: tg });
  check('lift2 (upper) has nothing to swap and no knee question', applyKneeSwap(l2k.steps, rules, plan).length === 0 && askIdx(rules, l2k.steps) === -1);

  const legSession = { id: 'ses_a', date: '2026-11-23', sessionName: 'Lift 1: Legs', sets: [ws('back_squat', 185, 5, 8, [4, 6])] };
  check('Home asks the day after a squat day', morningDue(rules, [], [legSession], new Date('2026-11-24T07:00:00'))?.session.id === 'ses_a');
  check('not two days after, and not once a morning score is in', morningDue(rules, [], [legSession], new Date('2026-11-25T07:00:00')) === null && morningDue(rules, [at('2026-11-24T06:50:00', 2)], [legSession], new Date('2026-11-24T07:00:00')) === null);
  check('not after an upper day', morningDue(rules, [], [{ id: 'ses_b', date: '2026-11-25', sessionName: 'Lift 2', sets: [ws('strict_press', 95, 5, 8, [4, 6])] }, legSession], new Date('2026-11-26T07:00:00')) === null);

  const held = applyProgression({ session: mkSession(3, [ws('back_squat', 185, 6, 8, [4, 6], { knee: 5 }), ws('back_squat', 205, 6, 8, [4, 6], { kneeSwap: true }), ws('back_squat', 205, 6, 8, [4, 6], { kneeSwap: true })]), targets: { back_squat: { weight: 185, reps: 6, stall: 1, bestE1rm: 225, bestWeight: 190 } }, rules, plan, settings });
  check('a knee swap holds the weight and the reps, and is not a miss', held.targets.back_squat.weight === 185 && held.targets.back_squat.reps === 6 && held.targets.back_squat.stall === 1 && held.lines[0].verdict === 'hold' && /Knee 5\/10: 2 sets done as box squat/.test(held.lines[0].text), [held.targets.back_squat, held.lines[0].text]);
  check('heavier box squat sets do not set a back squat PR', !held.prs.length && held.targets.back_squat.bestE1rm === 225 && held.targets.back_squat.bestWeight === 190, [held.prs, held.targets.back_squat]);
  const high = applyProgression({ session: mkSession(3, [ws('back_squat', 185, 6, 8, [4, 6], { knee: rules.knee.swapAt }), ws('back_squat', 185, 6, 8, [4, 6]), ws('back_squat', 185, 6, 8, [4, 6])]), targets: { back_squat: { weight: 185, reps: 6 } }, rules, plan, settings });
  check('a high score with the regular lift kept still holds the weight', high.targets.back_squat.weight === 185 && high.lines[0].verdict === 'hold' && high.lines[0].reason === `knee ${rules.knee.swapAt}/10`, high.lines[0]);
  const low = applyProgression({ session: mkSession(3, [ws('back_squat', 185, 6, 8, [4, 6], { knee: 2 }), ws('back_squat', 185, 6, 8, [4, 6]), ws('back_squat', 185, 6, 8, [4, 6])]), targets: { back_squat: { weight: 185, reps: 6 } }, rules, plan, settings });
  check('a low score changes nothing: +5 as usual', low.targets.back_squat.weight === 190 && low.lines[0].verdict === 'up');
  check('kneeHeld: nothing without a score or a swap', kneeHeld(rules, [ws('back_squat', 185, 6, 8, [4, 6])]) === null);
  const tr = kneeTrend([at('2026-11-24T07:00:00', 3), at('2026-11-24T18:00:00', 5, 'set'), at('2026-11-26T07:00:00', 1)], 84, now);
  check('the trend keeps the highest score each day, oldest first', tr.map(p => `${p.date}:${p.score}`).join() === '2026-11-24:5,2026-11-26:1', tr);
  check('a score is kept between 0 and 10', kneeEntry(14, 'set').score === 10 && kneeEntry(-2, 'set').score === 0);
}

console.log(failures ? `\n${failures} FAILED` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
