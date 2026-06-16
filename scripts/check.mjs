import assert from "node:assert/strict";
import fs from "node:fs";
import { parse } from "@babel/parser";
import {
  bodyweightWeeklyAverage,
  plannedWeeklySetBalance,
  progressionSeries,
  weeklyDirectHardSets,
} from "../src/analytics.js";
import { miniWarmupHelperText, warmupHelperText } from "../src/load.js";
import {
  completeSession,
  deloadEntryWeight,
  deloadTargetReps,
  getSessionDeload,
  startConditionDeload,
} from "../src/progression.js";
import { nextSuccessReps } from "../src/progressTargets.js";
import {
  ACTIVE_ROUTINE_VERSION,
  ROUTINES,
  createInitialState,
  instanceView,
  migrateState,
  profileById,
  sessionSummary,
} from "../src/routines.js";

parse(fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8"), {
  sourceType: "module",
  plugins: ["jsx"],
});

assert.equal(ACTIVE_ROUTINE_VERSION, "aesthetic_3split_v1");
assert.deepEqual(ROUTINES.map((routine) => routine.id), ["day1", "day2", "day4", "day5"]);
assert.deepEqual(ROUTINES.map((routine) => routine.name), ["Day 1", "Day 2", "Day 4", "Day 5"]);
assert.ok(!ROUTINES.some((routine) => ["a1", "b1", "a2", "b2"].includes(routine.id)));

assert.deepEqual(
  ROUTINES.map((routine) => sessionSummary(routine).totalSets),
  [19, 21, 23, 21]
);
assert.equal(sessionSummary(ROUTINES[3]).optionalSets, 2);

const balance = plannedWeeklySetBalance(ROUTINES);
assert.equal(balance.chest, 12);
assert.equal(balance.upper_chest, 6);
assert.equal(balance.lateral_delts, 14);
assert.equal(balance.rear_delts, 6);
assert.equal(balance.biceps, 9);
assert.equal(balance.triceps, 9);
assert.equal(balance.back, 12);
assert.equal(balance.quads, 7);
assert.equal(balance.hamstrings_glutes, 9);
assert.equal(balance.core, 3);

assert.deepEqual(ROUTINES[2].exercises.slice(0, 2).map((exercise) => exercise.profileId), [
  "seated_db_shoulder_press",
  "lateral_raise_day4",
]);
assert.equal(ROUTINES[3].exercises.find((exercise) => exercise.profileId === "rear_delt_fly").optional, false);
assert.equal(ROUTINES[3].exercises.find((exercise) => exercise.profileId === "lying_leg_raise").optional, true);
assert.equal(profileById("lying_leg_raise").entryMode, "reps_only");

const lateralRaises = ROUTINES.flatMap((routine) => routine.exercises).filter((exercise) =>
  exercise.profileId.includes("lateral_raise")
);
assert.equal(lateralRaises.length, 4);
assert.deepEqual(lateralRaises.map((exercise) => exercise.profileId), [
  "lateral_raise",
  "lateral_raise_day2",
  "lateral_raise_day4",
  "lateral_raise_day5",
]);
assert.equal(lateralRaises.filter((exercise) => exercise.anchorSession).length, 1);

const day1OhTri = ROUTINES[0].exercises.find((exercise) => exercise.profileId === "overhead_triceps_extension");
const day5OhTri = ROUTINES[3].exercises.find((exercise) => exercise.profileId === "overhead_triceps_extension");
assert.equal(day1OhTri.sharedProfileId, "overhead_cable_triceps_extension");
assert.equal(day1OhTri.anchorForSharedProgression, true);
assert.equal(day5OhTri.sharedProfileId, "overhead_cable_triceps_extension");
assert.equal(day5OhTri.anchorForSharedProgression, false);

const initial = createInitialState();
assert.equal(migrateState(initial).instanceData.day5_lying_leg_raise.currentSets, 0);
assert.deepEqual(nextSuccessReps(ROUTINES[3].exercises.at(-1), instanceView(ROUTINES[3].exercises.at(-1), initial)), []);

const day5State = createInitialState();
day5State.profileData.overhead_triceps_extension.weight = 20;
day5State.profileData.overhead_triceps_extension.initialized = true;
const day5Entries = Object.fromEntries(
  ROUTINES[3].exercises.map((exercise) => [
    exercise.id,
    exercise.optional ? [] : Array(exercise.defaultSets).fill(exercise.max),
  ])
);
const day5Result = completeSession(day5State, ROUTINES[3], day5Entries, {});
assert.equal(day5Result.nextState.profileData.overhead_triceps_extension.weight, 20);
assert.ok(!day5Result.historyExercises.some((exercise) => exercise.profileId === "lying_leg_raise"));

const day1State = createInitialState();
day1State.profileData.overhead_triceps_extension.weight = 20;
day1State.profileData.overhead_triceps_extension.initialized = true;
const day1Entries = Object.fromEntries(
  ROUTINES[0].exercises.map((exercise) => [exercise.id, Array(exercise.defaultSets).fill(exercise.max)])
);
const day1Result = completeSession(day1State, ROUTINES[0], day1Entries, {});
assert.equal(day1Result.nextState.profileData.overhead_triceps_extension.weight, 22.5);
assert.equal(day1Result.historyExercises[0].routineVersion, ACTIVE_ROUTINE_VERSION);
assert.equal(day1Result.historyExercises[0].normalNormalizedTotalLoad, 50);

const deloadState = createInitialState();
deloadState.profileData.romanian_deadlift.weight = 20;
deloadState.profileData.romanian_deadlift.initialized = true;
const conditionDeloadState = startConditionDeload(deloadState, ROUTINES[2].id);
const conditionDeload = getSessionDeload(conditionDeloadState, ROUTINES[2]);
const rdl = ROUTINES[2].exercises.find((exercise) => exercise.profileId === "romanian_deadlift");
assert.equal(conditionDeload.type, "condition");
assert.equal(deloadTargetReps(rdl).length, 3);
assert.equal(deloadEntryWeight(profileById("romanian_deadlift"), deloadState.profileData.romanian_deadlift, conditionDeload), 10);
const deloadEntries = Object.fromEntries(
  ROUTINES[2].exercises.map((exercise) => [exercise.id, Array(exercise.defaultSets).fill(exercise.min)])
);
const deloadResult = completeSession(conditionDeloadState, ROUTINES[2], deloadEntries, {});
assert.equal(deloadResult.nextState.deload.mode, "none");
assert.equal(deloadResult.nextState.instanceData.day4_romanian_deadlift.currentSets, 3);
assert.deepEqual(deloadResult.nextState.instanceData.day4_romanian_deadlift.successfulReps, []);

assert.match(warmupHelperText(ROUTINES[0].exercises[0], instanceView(ROUTINES[0].exercises[0], initial)), /웜업/);
assert.match(miniWarmupHelperText(ROUTINES[0].exercises[1]), /프레스/);
assert.match(miniWarmupHelperText(ROUTINES[2].exercises[2]), /무릎/);
assert.match(miniWarmupHelperText(ROUTINES[2].exercises[3]), /햄스트링/);
assert.match(miniWarmupHelperText(ROUTINES[3].exercises[1]), /프레스/);
assert.match(miniWarmupHelperText(ROUTINES[3].exercises[2]), /둔근/);

const today = new Date();
assert.equal(
  bodyweightWeeklyAverage(
    [
      { date: today, value: 80, context: "post_workout" },
      { date: today, value: 81, context: "morning_fasted" },
      { date: today, value: 82, context: "other" },
    ],
    1
  )[0].average,
  81
);

const hardSetRows = weeklyDirectHardSets(
  [
    {
      id: "h1",
      date: today,
      sessionId: "day1",
      routine: "Day 1",
      exercises: day1Result.historyExercises,
    },
  ],
  1
);
assert.equal(hardSetRows[0].muscles.chest, 9);
assert.equal(hardSetRows[0].muscles.upper_chest, 3);
assert.equal(hardSetRows[0].muscles.triceps, 6);
assert.equal(hardSetRows[0].muscles.lateral_delts, 4);
assert.equal(progressionSeries([{ id: "h1", date: today, exercises: day1Result.historyExercises }], ["bench_press"])[0].points[0].metricLabel, "e1RM");
assert.equal(progressionSeries([{ id: "h1", date: today, exercises: day1Result.historyExercises }], ["lateral_raise"])[0].points[0].metricLabel, "총중량");

const firebaseSource = fs.readFileSync(new URL("../src/firebase.js", import.meta.url), "utf8");
const rulesSource = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
assert.match(firebaseSource, /signInAnonymously/);
assert.match(rulesSource, /recoveryCodes/);
assert.match(rulesSource, /userAccess/);
assert.match(rulesSource, /users\/\{userId\}\/\{document=\*\*\}/);

console.log("checks passed");
