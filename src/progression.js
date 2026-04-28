import {
  ALL_EXERCISES,
  createInitialExerciseData,
  dataWithSharedLoad,
  defaultIncrementFor,
  groupMembers,
} from "./routines.js";

const byId = Object.fromEntries(ALL_EXERCISES.map((exercise) => [exercise.id, exercise]));

export function incrementFor(exercise, data = {}) {
  const customStep = Number(data.incrementStep);
  if (customStep > 0) return customStep;
  return defaultIncrementFor(exercise);
}

export function decreaseFor(exercise, data = {}) {
  const inc = incrementFor(exercise, data);
  return inc || 0;
}

export function completeSession(state, routine, entries, kneeApprovals) {
  const exerciseData = { ...createInitialExerciseData(), ...(state.exerciseData || {}) };
  const nextData = { ...exerciseData };
  const historyExercises = routine.exercises.map((exercise) => {
    const reps = entries[exercise.id] || [];
    const sharedData = dataWithSharedLoad(exercise, nextData);
    return {
      id: exercise.id,
      groupId: exercise.groupId,
      name: exercise.name,
      weight: Number(sharedData.weight || 0),
      incrementStep: Number(sharedData.incrementStep || defaultIncrementFor(exercise)),
      reps,
      totalReps: sum(reps),
    };
  });

  for (const exercise of routine.exercises) {
    const prev = dataWithSharedLoad(exercise, nextData);
    let data = {
      weight: Number(prev.weight || 0),
      incrementStep: Number(prev.incrementStep || defaultIncrementFor(exercise)),
      lastReps: Array.isArray(prev.lastReps) ? prev.lastReps : [],
      targetTotal: Number(prev.targetTotal || exercise.defaultSets * exercise.min),
      stagnationCount: Number(prev.stagnationCount || 0),
      currentSets: Number(prev.currentSets || exercise.defaultSets),
      kneeCheckPending: Boolean(prev.kneeCheckPending),
      initialized: Boolean(prev.initialized),
    };
    const reps = entries[exercise.id] || [];
    const total = sum(reps);
    const allAtTop = reps.length > 0 && reps.every((rep) => Number(rep) >= exercise.max);
    const improved = total > sum(data.lastReps);
    const wasExtraSet = data.currentSets > exercise.defaultSets;

    if (data.kneeCheckPending) {
      if (kneeApprovals[exercise.id] === true) {
        data.weight = roundWeight(data.weight + incrementFor(exercise, data));
        data.lastReps = Array(data.currentSets).fill(exercise.min);
        data.targetTotal = exercise.min * data.currentSets + 1;
        data.stagnationCount = 0;
      }
      data.kneeCheckPending = false;
    }

    if (allAtTop && data.initialized) {
      if (exercise.category === "knee_sensitive") {
        data.kneeCheckPending = true;
        data.lastReps = reps;
        data.targetTotal = total + 1;
        data.stagnationCount = 0;
      } else if (incrementFor(exercise, data) > 0) {
        data.weight = roundWeight(data.weight + incrementFor(exercise, data));
        data.currentSets = exercise.defaultSets;
        data.lastReps = Array(exercise.defaultSets).fill(exercise.min);
        data.targetTotal = exercise.min * exercise.defaultSets + 1;
        data.stagnationCount = 0;
      } else {
        data.lastReps = reps;
        data.targetTotal = total + 1;
        data.stagnationCount = 0;
      }
    } else {
      data.lastReps = reps;
      data.targetTotal = total + 1;
      data.stagnationCount = improved ? 0 : data.stagnationCount + 1;

      if (data.stagnationCount >= 3) {
        if (exercise.category === "upper_main" || exercise.category === "posterior") {
          if (!wasExtraSet) {
            data.currentSets = exercise.defaultSets + 1;
          } else {
            data.weight = Math.max(0, roundWeight(data.weight - decreaseFor(exercise, data)));
            data.currentSets = exercise.defaultSets;
          }
          data.stagnationCount = 0;
        } else if (exercise.category === "knee_sensitive") {
          data.weight = Math.max(0, roundWeight(data.weight - decreaseFor(exercise, data)));
          data.currentSets = exercise.defaultSets;
          data.stagnationCount = 0;
        } else {
          data.stagnationCount = 0;
        }
      }
    }

    nextData[exercise.id] = data;
    syncSharedLoad(nextData, exercise, data);
  }

  let nextState = {
    ...state,
    currentRoutineIndex: (Number(state.currentRoutineIndex || 0) + 1) % 4,
    sessionCount: Number(state.sessionCount || 0) + 1,
    exerciseData: nextData,
    updatedAt: Date.now(),
  };

  if (shouldAutoDeload(nextState)) {
    nextState = applyDeload(nextState);
    nextState.lastDeloadAt = Date.now();
  }

  return { nextState, historyExercises };
}

export function applyDeload(state) {
  const nextData = { ...(state.exerciseData || {}) };
  for (const id of Object.keys(nextData)) {
    const exercise = byId[id];
    if (!exercise) continue;
    nextData[id] = {
      ...nextData[id],
      currentSets: Math.max(1, Math.ceil(Number(nextData[id].currentSets || exercise.defaultSets) / 2)),
      stagnationCount: 0,
    };
  }
  return { ...state, exerciseData: nextData, updatedAt: Date.now() };
}

export function shouldAutoDeload(state) {
  if (Number(state.sessionCount || 0) < 12) return false;
  const stalled = Object.values(state.exerciseData || {}).filter(
    (data) => Number(data.stagnationCount || 0) >= 2
  );
  return stalled.length >= 3;
}

export function sum(values) {
  return values.reduce((acc, value) => acc + Number(value || 0), 0);
}

function roundWeight(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function syncSharedLoad(nextData, exercise, data) {
  for (const member of groupMembers(exercise.groupId)) {
    nextData[member.id] = {
      ...(nextData[member.id] || {}),
      weight: data.weight,
      incrementStep: data.incrementStep,
      initialized: data.initialized,
    };
  }
}
