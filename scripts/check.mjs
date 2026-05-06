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
import { completeSession } from "../src/progression.js";
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
assert.equal(b2Result.nextState.profileData.lat_pulldown.weight, initial.profileData.lat_pulldown.weight, "B2 lat pulldown must not progress shared load");
assert.equal(b2Result.nextState.profileData.leg_curl.weight, initial.profileData.leg_curl.weight, "B2 leg curl must not progress shared load");
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
assert.deepEqual(a1LegResult.nextState.instanceData.a2_leg_press.lastReps, [12, 12], "A2 leg press should reset to its own lower bound after anchor load change");
assert.equal(a1LegResult.nextState.instanceData.a2_leg_press.targetTotal, 25, "A2 leg press target should be session-specific after shared weight change");
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
  isTime: false,
};
assert.deepEqual(lowerBoundReps(ROUTINES[1].exercises[0], rdlView), [8, 8, 8]);
assert.deepEqual(lastResultReps(ROUTINES[1].exercises[0], rdlView), [10, 10, 10]);
assert.deepEqual(nextSuccessReps(ROUTINES[1].exercises[0], rdlView), [11, 10, 10]);
assert.equal(nextSuccessTotal(ROUTINES[1].exercises[0], rdlView), 31);

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
