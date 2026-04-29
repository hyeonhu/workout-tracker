import assert from "node:assert/strict";
import fs from "node:fs";
import { parse } from "@babel/parser";
import {
  adherenceRate,
  bodyweightWeeklyAverage,
  plateauRecommendations,
  weeklyDirectHardSets,
  weeklyMuscleVolume,
  progressionSeries,
} from "../src/analytics.js";
import { completeSession } from "../src/progression.js";
import { ROUTINES, createInitialState, migrateState, profileById } from "../src/routines.js";

parse(fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8"), {
  sourceType: "module",
  plugins: ["jsx"],
});

assert.equal(profileById("seated_db_shoulder_press").name, "시티드 덤벨 숄더프레스");

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
  },
});
assert.equal(legacy.profileData.seated_db_shoulder_press.weight, 12.5);

const history = [
  {
    id: "h1",
    date: new Date(),
    routine: "A1",
    exercises: [{ id: "bench_press", profileId: "bench_press", weight: 50, totalReps: 30, reps: [10, 10, 10] }],
  },
];
assert.equal(weeklyMuscleVolume(history, 2).at(-1).muscles.chest, 1500);
assert.equal(progressionSeries(history, ["bench_press"])[0].points[0].metricLabel, "e1RM");
assert.equal(
  bodyweightWeeklyAverage([
    { date: new Date(), value: 80, context: "post_workout" },
    { date: new Date(), value: 81, context: "morning_fasted" },
  ], 1)[0].average,
  81
);
assert.equal(bodyweightWeeklyAverage([{ date: new Date(), value: 80, context: "post_workout" }], 1)[0].confidence, "fallback");
assert.equal(weeklyDirectHardSets(history, 1)[0].muscles.chest, 3);
assert.ok(adherenceRate(history, 4) >= 0);
assert.ok(Array.isArray(plateauRecommendations(history, [], 4)));

console.log("checks passed");
