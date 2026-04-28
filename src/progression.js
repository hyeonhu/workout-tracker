import {
  ROUTINES,
  createInitialInstanceData,
  createInitialProfileData,
  instanceView,
  migrateState,
  profileById,
} from "./routines.js";

export function completeSession(rawState, routine, entries, kneeApprovals, notes = "") {
  const state = migrateState(rawState);
  const profileData = { ...createInitialProfileData(), ...(state.profileData || {}) };
  const instanceData = { ...createInitialInstanceData(), ...(state.instanceData || {}) };
  const kneeConfirmations = {};
  const historyExercises = [];

  for (const exercise of routine.exercises) {
    const profile = profileById(exercise.profileId);
    const profileState = {
      ...profileData[profile.id],
      weight: Number(profileData[profile.id]?.weight || 0),
      incrementStep: Number(profileData[profile.id]?.incrementStep || profile.defaultIncrement || 0),
      initialized: Boolean(profileData[profile.id]?.initialized || profile.isTime),
      kneeCheckPending: Boolean(profileData[profile.id]?.kneeCheckPending),
    };
    let instanceState = {
      ...instanceData[exercise.id],
      lastReps: Array.isArray(instanceData[exercise.id]?.lastReps) ? instanceData[exercise.id].lastReps : [],
      targetTotal: Number(instanceData[exercise.id]?.targetTotal || exercise.defaultSets * exercise.min),
      stagnationCount: Number(instanceData[exercise.id]?.stagnationCount || 0),
      currentSets: Number(instanceData[exercise.id]?.currentSets || exercise.defaultSets),
    };

    if (exercise.anchorSession && profileState.kneeCheckPending && kneeApprovals[exercise.id] !== undefined) {
      kneeConfirmations[exercise.id] = Boolean(kneeApprovals[exercise.id]);
      if (kneeApprovals[exercise.id] === true) {
        profileState.weight = roundWeight(profileState.weight + incrementFor(profileState));
        instanceState.lastReps = Array(instanceState.currentSets).fill(exercise.min);
        instanceState.targetTotal = exercise.min * instanceState.currentSets + 1;
        instanceState.stagnationCount = 0;
      }
      profileState.kneeCheckPending = false;
    }

    const reps = entries[exercise.id] || [];
    const totalReps = sum(reps);
    const allAtTop = reps.length > 0 && reps.every((rep) => Number(rep) >= exercise.max);
    const comparableTotal = sum(instanceState.lastReps);
    const improved = totalReps > comparableTotal;
    const wasExtraSet = instanceState.currentSets > exercise.defaultSets;
    const canChangeLoad = exercise.anchorSession && profileState.initialized && incrementFor(profileState) > 0;

    historyExercises.push({
      id: exercise.id,
      instanceId: exercise.id,
      profileId: profile.id,
      name: profile.name,
      weight: Number(profileState.weight || 0),
      reps,
      totalReps,
      sets: reps.map((rep, index) => ({ set: index + 1, reps: Number(rep || 0), weight: Number(profileState.weight || 0) })),
      muscleFactors: profile.muscleFactors,
      kneeSensitive: profile.kneeSensitive,
      anchorSession: exercise.anchorSession,
    });

    if (allAtTop && profileState.initialized) {
      if (profile.kneeSensitive && exercise.anchorSession) {
        profileState.kneeCheckPending = true;
        instanceState.lastReps = reps;
        instanceState.targetTotal = totalReps + 1;
        instanceState.stagnationCount = 0;
      } else if (canChangeLoad) {
        profileState.weight = roundWeight(profileState.weight + incrementFor(profileState));
        instanceState.currentSets = exercise.defaultSets;
        instanceState.lastReps = Array(exercise.defaultSets).fill(exercise.min);
        instanceState.targetTotal = exercise.min * exercise.defaultSets + 1;
        instanceState.stagnationCount = 0;
      } else {
        instanceState.lastReps = reps;
        instanceState.targetTotal = totalReps + 1;
        instanceState.stagnationCount = 0;
      }
    } else {
      instanceState.lastReps = reps;
      instanceState.targetTotal = totalReps + 1;
      instanceState.stagnationCount = improved ? 0 : instanceState.stagnationCount + 1;

      if (instanceState.stagnationCount >= 3) {
        if (profile.kneeSensitive) {
          if (exercise.anchorSession && canChangeLoad) {
            profileState.weight = Math.max(0, roundWeight(profileState.weight - incrementFor(profileState)));
          }
          instanceState.currentSets = exercise.defaultSets;
          instanceState.stagnationCount = 0;
        } else if (profile.category === "upper_main" || profile.category === "posterior") {
          if (!wasExtraSet) {
            instanceState.currentSets = exercise.defaultSets + 1;
          } else {
            if (exercise.anchorSession && canChangeLoad) {
              profileState.weight = Math.max(0, roundWeight(profileState.weight - incrementFor(profileState)));
            }
            instanceState.currentSets = exercise.defaultSets;
          }
          instanceState.stagnationCount = 0;
        } else {
          instanceState.stagnationCount = 0;
        }
      }
    }

    profileData[profile.id] = profileState;
    instanceData[exercise.id] = instanceState;
  }

  let nextState = {
    ...state,
    schemaVersion: 2,
    currentRoutineIndex: (Number(state.currentRoutineIndex || 0) + 1) % ROUTINES.length,
    sessionCount: Number(state.sessionCount || 0) + 1,
    profileData,
    instanceData,
    updatedAt: Date.now(),
  };

  if (shouldAutoDeload(nextState)) {
    nextState = applyDeload(nextState);
    nextState.lastDeloadAt = Date.now();
  }

  return { nextState, historyExercises, kneeConfirmations, notes };
}

export function applyDeload(rawState) {
  const state = migrateState(rawState);
  const instanceData = { ...state.instanceData };
  for (const routine of ROUTINES) {
    for (const exercise of routine.exercises) {
      const current = instanceData[exercise.id] || {};
      instanceData[exercise.id] = {
        ...current,
        currentSets: Math.max(1, Math.ceil(Number(current.currentSets || exercise.defaultSets) / 2)),
        stagnationCount: 0,
      };
    }
  }
  return { ...state, instanceData, updatedAt: Date.now() };
}

export function shouldAutoDeload(rawState) {
  const state = migrateState(rawState);
  if (Number(state.sessionCount || 0) < 12) return false;
  const stalled = Object.values(state.instanceData || {}).filter(
    (data) => Number(data.stagnationCount || 0) >= 2
  );
  return stalled.length >= 3;
}

export function sum(values) {
  return values.reduce((acc, value) => acc + Number(value || 0), 0);
}

export function comparableTarget(exercise, state) {
  const view = instanceView(exercise, state);
  return Number(view.targetTotal || exercise.defaultSets * exercise.min);
}

function incrementFor(profileState) {
  return Number(profileState.incrementStep || 0);
}

function roundWeight(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}
