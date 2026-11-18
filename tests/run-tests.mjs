// Node tests for the Session Builder and Progression Engine. Run: node tests/run-tests.mjs
import { readFileSync } from 'node:fs';
import { buildTimeline, trimToFit, remainingSeconds, lastResults, setTiming } from '../js/builder.js';
import { applyProgression, epley, checkPR, estimateStart } from '../js/progression.js';
import { effortPlain, effortLevel, spokenDuration } from '../js/data.js';
import { parseRepo, toBase64, fromBase64, setupLink, readSetupLink, explainStatus } from '../js/sync.js';
import { strengthSeries, adherence, weeklySets, accessoryRows, prList, yTicks, muscleSets } from '../js/progress.js';
import { changesFor, replyFor, pendingAdjustments, withRest, thread } from '../js/coach.js';
import { applyRestAdjust } from '../js/builder.js';

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
  const minutes = tl.plannedSeconds / 60;
  check(`${sid}: planned ${minutes.toFixed(1)} min is within 68 (week 1 has baseline work-ups)`, minutes <= 68 && minutes >= 45, { minutes });
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
const lastBlk = l2.steps.filter(s => s.blockId === 'last' && s.kind === 'set');
check('lift2: face pull only rounds 1-2', lastBlk.filter(s => s.exerciseId === 'face_pull').length === 2 && lastBlk.length === 8);

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
check('week 3 lift3: planned within 60 min incl. if-time', w3l3.plannedSeconds / 60 <= 61, { min: w3l3.plannedSeconds / 60 });

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
    { id: 'b', sessionId: 'lift1', week: 2, date: '2026-11-24', startedAt: '2026-11-24T06:00:00', status: 'complete', sets: [set('back_squat', 135, 5, { ramp: true }), set('back_squat', 190, 5), set('back_squat', 190, 4), set('leg_curl', 80, 12), set('back_squat', 250, 1, { skipped: true })], prs: [{ exerciseId: 'back_squat', name: 'Box squat', kind: 'e1rm', value: 222, prev: 216 }] },
    { id: 'a', sessionId: 'lift1', week: 1, date: '2026-11-17', startedAt: '2026-11-17T06:00:00', status: 'complete', sets: [set('back_squat', 185, 5), set('back_squat', 185, 5), set('leg_curl', 70, 12), set('leg_curl', 70, 10)], prs: [] },
    { id: 'c', sessionId: 'lift2', week: 1, date: '2026-11-18', startedAt: '2026-11-18T06:00:00', status: 'ended_early', sets: [set('weighted_pullup', 25, 5), set('curl', 50, 10)], prs: [] }
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

// ---- v1.8: muscle sets, coach check-ins, rest adjustments ----
console.log('v1.8 muscle groups and coach check-ins');
{
  const muscles = JSON.parse(readFileSync(new URL('../data/muscles.json', import.meta.url)));
  const planIds = new Set(); for (const s of plan.sessions) for (const b of s.blocks) for (const it of b.items || []) if (it.exercise) planIds.add(it.exercise);
  check('v1.8 muscles: every exercise in the plan has muscle groups', [...planIds].every(id => muscles.exercises[id]), [...planIds].filter(id => !muscles.exercises[id]));
  const groupIds = new Set(muscles.groups.map(g => g.id));
  check('v1.8 muscles: every group named is a known group', Object.values(muscles.exercises).every(m => [...(m.main || []), ...(m.helper || [])].every(g => groupIds.has(g))));
  const sess = [{ week: 2, sets: [{ exerciseId: 'curl', done: true }, { exerciseId: 'curl', done: true }, { exerciseId: 'cs_row', done: true }, { exerciseId: 'curl', done: true, ramp: true }, { exerciseId: 'curl', done: false }] }, { week: 1, sets: [{ exerciseId: 'curl', done: true }] }];
  const rows = muscleSets(sess, plan, muscles, 2);
  const bi = rows.find(r => r.id === 'biceps');
  check('v1.8 muscles: main counts 1, helper half, ramp-ups and undone sets do not count', bi.done === 2.5 && bi.lastWeek === 1 && rows.find(r => r.id === 'back').done === 1, bi);
  check('v1.8 muscles: biceps get planned sets from the curls and rows in the plan', bi.planned >= 9, bi.planned);

  const targets = { incline_db_press: { weight: 90, reps: 8 }, back_squat: { weight: 185, reps: 4 } };
  const heavy = changesFor({ exerciseId: 'incline_db_press', tags: ['too_heavy'] }, { plan, rules, targets, restAdjust: {} });
  check('v1.8 check-in: Too heavy drops a pair lift one step (total of both dumbbells)', heavy.length === 1 && heavy[0].kind === 'weight' && heavy[0].to < 90 && heavy[0].to >= 80, heavy);
  const light = changesFor({ exerciseId: 'back_squat', tags: ['too_light'] }, { plan, rules, targets, restAdjust: {} });
  check('v1.8 check-in: Too light adds one step to the squat', light.length === 1 && light[0].to > 185 && light[0].to <= 195, light);
  check('v1.8 check-in: no target, no weight change, and the reply says why', changesFor({ exerciseId: 'rdl', tags: ['too_heavy'] }, { plan, rules, targets, restAdjust: {} }).length === 0 && replyFor({ exerciseId: 'rdl', tags: ['too_heavy'] }, [], plan).includes('No target'));
  const rest = changesFor({ exerciseId: 'cs_row', tags: ['rest_long'] }, { plan, rules, targets, restAdjust: { cs_row: -30 } });
  check('v1.8 check-in: Rest too long takes 15 s more off, up to 45 s', rest.length === 1 && rest[0].to === -45, rest);
  check('v1.8 check-in: rest stops at the 45 s limit', changesFor({ exerciseId: 'cs_row', tags: ['rest_long'] }, { plan, rules, targets, restAdjust: { cs_row: -45 } }).length === 0);
  check('v1.8 check-in: rest never goes under 15 s (RDL rests 30 s)', changesFor({ exerciseId: 'rdl', tags: ['rest_long'] }, { plan, rules, targets, restAdjust: { rdl: -15 } }).length === 0);
  const sessRest = changesFor({ sessionId: 'lift2', tags: ['rest_short'] }, { plan, rules, targets, restAdjust: {} });
  check('v1.8 check-in: a rest tag on a whole session moves that session', sessRest.length === 1 && sessRest[0].key === 'session:lift2' && sessRest[0].to === 15, sessRest);
  check('v1.8 check-in: Pain and Slept badly change nothing and answer in words', changesFor({ exerciseId: 'back_squat', tags: ['pain', 'tired'] }, { plan, rules, targets }).length === 0 && replyFor({ tags: ['pain', 'tired'] }, [], plan).includes('short version'));

  const lift2 = plan.sessions.find(s => s.id === 'lift2');
  const adj = applyRestAdjust(lift2, { cs_row: -15, 'session:lift2': 10, oh_tri_ext: 20 });
  const row = adj.blocks.flatMap(b => b.items || []).find(i => i.exercise === 'cs_row');
  const orig = lift2.blocks.flatMap(b => b.items || []).find(i => i.exercise === 'cs_row');
  check('v1.8 rest: exercise and session offsets add up, plan left as it was', row.restSeconds === orig.restSeconds - 5 && orig.restSeconds === 75, [row.restSeconds, orig.restSeconds]);
  const fin = adj.blocks.find(b => b.id === 'finisher'), finOrig = lift2.blocks.find(b => b.id === 'finisher');
  check('v1.8 rest: a finisher exercise moves its round rest', fin.roundRestSeconds === finOrig.roundRestSeconds + 30, [fin.roundRestSeconds, finOrig.roundRestSeconds]);
  const tl0 = buildTimeline({ plan, rules, settings, sessionId: 'lift2', week: 3, targets: {} });
  const tl1 = buildTimeline({ plan, rules, settings: { ...settings, restAdjust: { 'session:lift2': -15 } }, sessionId: 'lift2', week: 3, targets: {} });
  check('v1.8 rest: shorter rests make a shorter session', tl1.plannedSeconds < tl0.plannedSeconds, [tl0.plannedSeconds, tl1.plannedSeconds]);

  const file = { messages: [{ id: 'm1', at: '2026-11-18T03:00:00Z', text: 'Nice work.' }], adjustments: [{ id: 'a1', exerciseId: 'curl', weight: 50 }, { id: 'a2', exerciseId: 'nope', weight: 5 }, { id: 'a3', sessionId: 'lift1', restDelta: -15 }, { id: 'a4', exerciseId: 'curl', weight: 55 }] };
  const pend = pendingAdjustments(file, ['a4'], plan);
  check('v1.8 coach file: unknown lifts and applied ones are skipped', pend.map(a => a.id).join() === 'a1,a3', pend);
  check('v1.8 coach file: rest offsets stay inside 45 s', withRest({}, 'x', -90).x === -45 && !('x' in withRest({ x: 15 }, 'x', 0)));
  const th = thread([{ id: 'c1', at: '2026-11-18T02:00:00Z', text: 'Heavy', reply: 'Dropped.' }], file);
  check('v1.8 thread: check-in, app answer and coach reply in time order', th.map(m => m.from).join() === 'you,app,coach', th);
}

console.log(failures ? `\n${failures} FAILED` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
