import assert from "node:assert/strict";
import fs from "node:fs";
import { parse } from "@babel/parser";
import {
  adherenceRate,
  bodyweightWeeklyAverage,
  plateauRecommendations,
  progressionSeries,
  weeklyDirectHardSets,
  weeklyMuscleVolume,
} from "../src/analytics.js";
import { miniWarmupHelperText, warmupHelperText } from "../src/load.js";
import { completeSession, rebuildStateFromHistory } from "../src/progression.js";
import { lastResultReps, lowerBoundReps, nextSuccessReps, nextSuccessTotal } from "../src/progressTargets.js";
import { ROUTINES, createInitialState, instanceView, migrateState, profileById } from "../src/routines.js";

parse(fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8"), {
  sourceType: "module",
  plugins: ["jsx"],
});

assert.equal(profileById("leg_extension").loadType, "stack_weight");
assert.equal(profileById("smith_hip_thrust").loadType, "smith_total");
assert.equal(profileById("incline_bench_chest_supported_db_row").entryMode, "per_hand");
assert.equal(profileById("ez_bar_curl").loadType, "barbell_total");

const initial = createInitialState();

const b2Entries = Object.fromEntries(ROUTINES[3].exercises.map((exercise) => [exercise.id, Array(exercise.defaultSets).fill(exercise.max)]));
const b2Result = completeSession(initial, ROUTINES[3], b2Entries, {});
assert.equal(b2Result.nextState.profileData.lat_pulldown.weight, 47.5, "B2 lat pulldown should also progress the shared load");
assert.equal(b2Result.nextState.profileData.leg_curl.weight, initial.profileData.leg_curl.weight, "Sensitive shared loads should still wait for a clean follow-up check");
assert.equal(b2Result.nextState.profileData.leg_curl.hamstringCheckPending, true, "B2 leg curl should schedule a hamstring check");
assert.equal(b2Result.nextState.instanceData.b2_lat_pulldown.stagnationCount, 0);

const a1Entries = Object.fromEntries(ROUTINES[0].exercises.map((exercise) => [exercise.id, Array(exercise.defaultSets).fill(exercise.max)]));
const a1Result = completeSession(initial, ROUTINES[0], a1Entries, {});
assert.equal(a1Result.nextState.profileData.lat_pulldown.weight, 47.5, "A1 lat pulldown anchor should progress shared load");
assert.equal(a1Result.nextState.profileData.leg_press.kneeCheckPending, true, "Leg press should wait for knee confirmation");
assert.equal(a1Result.historyExercises[0].normalizedTotalLoad, 50, "Bench 15kg/side + 20kg bar should normalize to 50kg");

const legPressAnchorState = createInitialState();
legPressAnchorState.profileData.leg_press.initialized = true;
legPressAnchorState.profileData.leg_press.weight = 40;
legPressAnchorState.profileData.leg_press.kneeCheckPending = true;
legPressAnchorState.profileData.leg_press.recoveryCheckPending = true;
legPressAnchorState.profileData.leg_press.pendingLoadIncrease = true;
legPressAnchorState.instanceData.a2_leg_press.lastReps = [15, 15];
legPressAnchorState.instanceData.a2_leg_press.targetTotal = 31;
legPressAnchorState.instanceData.a2_leg_press.stagnationCount = 2;
const a1LegEntries = {
  a1_bench_press: [8, 8, 8],
  a1_lat_pulldown: [8, 8, 8],
  a1_incline_db_press: [8, 8],
  a1_leg_press: [15, 15, 15],
  a1_lateral_raise: [15, 15, 15],
  a1_cable_crunch: [10, 10, 10],
};
const a1LegResult = completeSession(legPressAnchorState, ROUTINES[0], a1LegEntries, { a1_leg_press: true });
assert.equal(a1LegResult.nextState.profileData.leg_press.weight, 42.5, "A1 leg press anchor should raise shared weight after clean knee check");
assert.deepEqual(a1LegResult.nextState.instanceData.a2_leg_press.targetReps, [12, 12], "A2 leg press target should reset to its own lower bound after anchor load change");
assert.equal(a1LegResult.nextState.instanceData.a2_leg_press.targetTotal, 24, "A2 leg press target should reset to its own lower bound after shared weight change");
assert.equal(a1LegResult.nextState.instanceData.a2_leg_press.stagnationCount, 0, "A2 leg press stall count should reset on shared load change");

const hamstringInitial = createInitialState();
hamstringInitial.profileData.leg_curl.weight = 30;
hamstringInitial.profileData.leg_curl.initialized = true;
const b1Entries = Object.fromEntries(ROUTINES[1].exercises.map((exercise) => [exercise.id, Array(exercise.defaultSets).fill(exercise.max)]));
const b1Result = completeSession(hamstringInitial, ROUTINES[1], b1Entries, {});
assert.equal(b1Result.nextState.profileData.leg_curl.hamstringCheckPending, true, "Leg curl should wait for hamstring confirmation");
assert.equal(b1Result.nextState.profileData.leg_curl.recoveryCheckPending, true);

const legacy = migrateState({
  exerciseData: {
    shoulder_press: { weight: 12.5, initialized: true, currentSets: 3, targetTotal: 25 },
    hip_thrust: { weight: 40, initialized: true, currentSets: 3, targetTotal: 25 },
  },
});
assert.equal(legacy.profileData.seated_db_shoulder_press.weight, 12.5);
assert.equal(legacy.profileData.smith_hip_thrust.weight, 40);

const benchView = instanceView(ROUTINES[0].exercises[0], initial);
assert.match(warmupHelperText(ROUTINES[0].exercises[0], benchView), /웜업/);
assert.match(warmupHelperText(ROUTINES[0].exercises[0], benchView), /한쪽 2.5kg/);
assert.equal(miniWarmupHelperText(ROUTINES[2].exercises[4]), null, "A2 leg extension should not show mini warm-up");
assert.equal(miniWarmupHelperText(ROUTINES[1].exercises[3]), "햄스트링 적응세트 1개 추천");
assert.equal(miniWarmupHelperText(ROUTINES[3].exercises[6]), "웜업: 동적 준비만 진행");

const rdlView = {
  currentSets: 3,
  lastReps: [10, 10, 10],
  targetReps: [11, 10, 10],
  isTime: false,
};
assert.deepEqual(lowerBoundReps(ROUTINES[1].exercises[0], rdlView), [8, 8, 8]);
assert.deepEqual(lastResultReps(ROUTINES[1].exercises[0], rdlView), [10, 10, 10]);
assert.deepEqual(nextSuccessReps(ROUTINES[1].exercises[0], rdlView), [11, 10, 10]);
assert.equal(nextSuccessTotal(ROUTINES[1].exercises[0], rdlView), 31);

const targetState = createInitialState();
targetState.profileData.romanian_deadlift.initialized = true;
targetState.instanceData.b1_romanian_deadlift.successfulReps = [10, 10, 10];
targetState.instanceData.b1_romanian_deadlift.targetReps = [11, 10, 10];
targetState.instanceData.b1_romanian_deadlift.targetTotal = 31;
const failEntries = Object.fromEntries(ROUTINES[1].exercises.map((exercise) => [exercise.id, Array(exercise.defaultSets).fill(exercise.min)]));
failEntries.b1_romanian_deadlift = [11, 9, 8];
const failResult = completeSession(targetState, ROUTINES[1], failEntries, {});
assert.deepEqual(failResult.nextState.instanceData.b1_romanian_deadlift.successfulReps, [10, 10, 10], "Failed result must not replace last successful result");
assert.deepEqual(failResult.nextState.instanceData.b1_romanian_deadlift.targetReps, [11, 10, 10], "Failed result must not create a new target");

const successState = createInitialState();
successState.profileData.romanian_deadlift.initialized = true;
successState.instanceData.b1_romanian_deadlift.successfulReps = [10, 10, 10];
successState.instanceData.b1_romanian_deadlift.targetReps = [11, 10, 10];
successState.instanceData.b1_romanian_deadlift.targetTotal = 31;
const successEntries = Object.fromEntries(ROUTINES[1].exercises.map((exercise) => [exercise.id, Array(exercise.defaultSets).fill(exercise.min)]));
successEntries.b1_romanian_deadlift = [11, 10, 10];
const successResult = completeSession(successState, ROUTINES[1], successEntries, {});
assert.deepEqual(successResult.nextState.instanceData.b1_romanian_deadlift.successfulReps, [11, 10, 10], "Successful result should become the new successful baseline");
assert.deepEqual(successResult.nextState.instanceData.b1_romanian_deadlift.targetReps, [11, 11, 10], "Next target should add 1 to the lowest set, left to right");

const posteriorStallState = createInitialState();
posteriorStallState.profileData.smith_hip_thrust.initialized = true;
posteriorStallState.instanceData.b2_hip_thrust.stagnationCount = 2;
posteriorStallState.instanceData.b2_hip_thrust.successfulReps = [8, 8, 8];
posteriorStallState.instanceData.b2_hip_thrust.targetReps = [9, 8, 8];
posteriorStallState.instanceData.b2_hip_thrust.targetTotal = 25;
const posteriorFailEntries = Object.fromEntries(ROUTINES[3].exercises.map((exercise) => [exercise.id, Array(exercise.defaultSets).fill(exercise.min)]));
posteriorFailEntries.b2_hip_thrust = [8, 8, 8];
const posteriorStallResult = completeSession(posteriorStallState, ROUTINES[3], posteriorFailEntries, {});
assert.equal(posteriorStallResult.nextState.instanceData.b2_hip_thrust.currentSets, 4, "Posterior lifts should add one set after three stalls");

const topOutState = createInitialState();
topOutState.profileData.romanian_deadlift.initialized = true;
topOutState.profileData.romanian_deadlift.weight = 15;
topOutState.instanceData.b1_romanian_deadlift.successfulReps = [11, 12, 12];
topOutState.instanceData.b1_romanian_deadlift.targetReps = [12, 12, 12];
topOutState.instanceData.b1_romanian_deadlift.targetTotal = 36;
const topOutEntries = Object.fromEntries(ROUTINES[1].exercises.map((exercise) => [exercise.id, Array(exercise.defaultSets).fill(exercise.min)]));
topOutEntries.b1_romanian_deadlift = [12, 12, 12];
const topOutResult = completeSession(topOutState, ROUTINES[1], topOutEntries, {});
assert.equal(topOutResult.nextState.profileData.romanian_deadlift.weight, 17.5, "Top-end success should increase load");
assert.deepEqual(topOutResult.nextState.instanceData.b1_romanian_deadlift.targetReps, [8, 8, 8], "After load increase, the next target should reset to the lower bound");

const a2LegPressState = createInitialState();
a2LegPressState.profileData.leg_press.initialized = true;
a2LegPressState.profileData.leg_press.weight = 40;
a2LegPressState.instanceData.a2_leg_press.successfulReps = [14, 15];
a2LegPressState.instanceData.a2_leg_press.targetReps = [15, 15];
a2LegPressState.instanceData.a2_leg_press.targetTotal = 30;
const a2LegPressEntries = Object.fromEntries(ROUTINES[2].exercises.map((exercise) => [exercise.id, Array(exercise.defaultSets).fill(exercise.min)]));
a2LegPressEntries.a2_leg_press = [15, 15];
const a2LegPressResult = completeSession(a2LegPressState, ROUTINES[2], a2LegPressEntries, {});
assert.equal(a2LegPressResult.nextState.profileData.leg_press.kneeCheckPending, true, "Leg press should request a knee check after A2 as well");
assert.equal(a2LegPressResult.nextState.profileData.leg_press.pendingLoadIncrease, true, "A2 leg press should also be able to arm the shared load increase");
assert.deepEqual(a2LegPressResult.nextState.instanceData.a1_leg_press.targetReps, [10, 10, 10], "A2 leg press should not overwrite the A1 leg press target");

const pendingIncreaseState = createInitialState();
pendingIncreaseState.profileData.leg_press.initialized = true;
pendingIncreaseState.profileData.leg_press.weight = 40;
pendingIncreaseState.profileData.leg_press.kneeCheckPending = true;
pendingIncreaseState.profileData.leg_press.recoveryCheckPending = true;
pendingIncreaseState.profileData.leg_press.pendingLoadIncrease = true;
pendingIncreaseState.instanceData.a1_leg_press.successfulReps = [15, 15, 15];
pendingIncreaseState.instanceData.a1_leg_press.targetReps = [15, 15, 15];
pendingIncreaseState.instanceData.a1_leg_press.targetTotal = 45;
const pendingIncreaseEntries = Object.fromEntries(ROUTINES[2].exercises.map((exercise) => [exercise.id, Array(exercise.defaultSets).fill(exercise.min)]));
pendingIncreaseEntries.a2_leg_press = [15, 15];
const pendingIncreaseResult = completeSession(pendingIncreaseState, ROUTINES[2], pendingIncreaseEntries, { a2_leg_press: true });
assert.equal(pendingIncreaseResult.nextState.profileData.leg_press.weight, 42.5, "Clean follow-up knee check should move the shared weight up");
assert.deepEqual(pendingIncreaseResult.nextState.instanceData.a2_leg_press.targetReps, [12, 12], "The session that consumes a pending increase should restart from its own lower bound");
assert.deepEqual(pendingIncreaseResult.nextState.instanceData.a1_leg_press.targetReps, [10, 10, 10], "Sibling shared sessions should keep their own lower bounds after the shared increase");

const rebuildSeed = createInitialState();
rebuildSeed.profileData.romanian_deadlift.initialized = true;
rebuildSeed.profileData.romanian_deadlift.weight = 15;
const rebuildEntries = Object.fromEntries(ROUTINES[1].exercises.map((exercise) => [exercise.id, Array(exercise.defaultSets).fill(exercise.min)]));
rebuildEntries.b1_romanian_deadlift = [10, 10, 10];
const rebuildSession = completeSession(rebuildSeed, ROUTINES[1], rebuildEntries, {});
const brokenState = createInitialState();
brokenState.currentRoutineIndex = rebuildSession.nextState.currentRoutineIndex;
brokenState.sessionCount = rebuildSession.nextState.sessionCount;
brokenState.profileData.romanian_deadlift.weight = 0;
brokenState.profileData.romanian_deadlift.initialized = false;
brokenState.instanceData.b1_romanian_deadlift.successfulReps = [];
brokenState.instanceData.b1_romanian_deadlift.targetReps = [10, 10, 10];
brokenState.instanceData.b1_romanian_deadlift.targetTotal = 30;
const repairedState = rebuildStateFromHistory(brokenState, [
  {
    id: "repair-1",
    sessionId: ROUTINES[1].id,
    routine: ROUTINES[1].name,
    date: new Date("2026-05-07T10:00:00+09:00"),
    exercises: rebuildSession.historyExercises,
    recoveryConfirmations: {},
    notes: "",
  },
]);
assert.equal(repairedState.profileData.romanian_deadlift.weight, 15, "History repair should restore the last logged working weight");
assert.deepEqual(repairedState.instanceData.b1_romanian_deadlift.successfulReps, [10, 10, 10], "History repair should restore the last successful result");
assert.deepEqual(repairedState.instanceData.b1_romanian_deadlift.targetReps, [11, 10, 10], "History repair should rebuild the next target from the last successful result");

const history = [
  {
    id: "h1",
    date: new Date(),
    routine: "A1",
    exercises: [{ id: "bench_press", profileId: "bench_press", weight: 50, totalReps: 30, reps: [10, 10, 10] }],
  },
];
assert.equal(weeklyMuscleVolume(history, 2).at(-1).muscles.chest, 3600);
assert.equal(progressionSeries(history, ["bench_press"])[0].points[0].metricLabel, "e1RM");
assert.equal(progressionSeries(history, ["bench_press"])[0].points[0].normalizedTotalLoad, 120);
assert.equal(
  bodyweightWeeklyAverage(
    [
      { date: new Date(), value: 80, context: "post_workout" },
      { date: new Date(), value: 81, context: "morning_fasted" },
    ],
    1
  )[0].average,
  81
);
assert.equal(bodyweightWeeklyAverage([{ date: new Date(), value: 80, context: "post_workout" }], 1)[0].confidence, "fallback");
assert.equal(weeklyDirectHardSets(history, 1)[0].muscles.chest, 3);
assert.ok(adherenceRate(history, 4) >= 0);
assert.ok(Array.isArray(plateauRecommendations(history, [], 4)));

console.log("checks passed");
