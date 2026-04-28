import assert from "node:assert/strict";
import fs from "node:fs";
import { parse } from "@babel/parser";
import { weeklyMuscleVolume, progressionSeries } from "../src/analytics.js";
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
assert.equal(b2Result.nextState.instanceData.b2_lat_pulldown.stagnationCount, 0);

const a1Entries = Object.fromEntries(ROUTINES[0].exercises.map((exercise) => [exercise.id, Array(exercise.defaultSets).fill(exercise.max)]));
const a1Result = completeSession(initial, ROUTINES[0], a1Entries, {});
assert.equal(a1Result.nextState.profileData.lat_pulldown.weight, 47.5, "A1 lat pulldown anchor should progress shared load");
assert.equal(a1Result.nextState.profileData.leg_press.kneeCheckPending, true, "Leg press should wait for knee confirmation");

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
assert.equal(progressionSeries(history, ["bench_press"])[0].points.length, 1);

console.log("checks passed");
