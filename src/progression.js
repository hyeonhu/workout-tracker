import {
  ROUTINES,
  SESSION_EXERCISES,
  createInitialInstanceData,
  createInitialProfileData,
  migrateState,
  profileById,
} from "./routines.js";
import { effectiveBaseWeight, normalizeTotalLoad } from "./load.js";

export function completeSession(rawState, routine, entries, kneeApprovals, notes = "") {
  const state = migrateState(rawState);
  const profileData = { ...createInitialProfileData(), ...(state.profileData || {}) };
  const instanceData = { ...createInitialInstanceData(), ...(state.instanceData || {}) };
  const recoveryConfirmations = {};
  const historyExercises = [];

  for (const exercise of routine.exercises) {
    const profile = profileById(exercise.profileId);
    const profileState = {
      ...profileData[profile.id],
      weight: Number(profileData[profile.id]?.weight || 0),
      baseWeight: Number(profileData[profile.id]?.baseWeight ?? profile.baseWeight ?? 0),
      incrementStep: Number(profileData[profile.id]?.incrementStep || profile.defaultIncrement || 0),
      initialized: Boolean(profileData[profile.id]?.initialized || profile.isTime),
      kneeCheckPending: Boolean(profileData[profile.id]?.kneeCheckPending),
      hamstringCheckPending: Boolean(profileData[profile.id]?.hamstringCheckPending),
      recoveryCheckPending: Boolean(
        profileData[profile.id]?.recoveryCheckPending ||
          profileData[profile.id]?.kneeCheckPending ||
          profileData[profile.id]?.hamstringCheckPending
      ),
    };

    let instanceState = normalizeInstanceState(instanceData[exercise.id], exercise);

    if (exercise.anchorSession && profileState.recoveryCheckPending && kneeApprovals[exercise.id] !== undefined) {
      recoveryConfirmations[exercise.id] = {
        clean: Boolean(kneeApprovals[exercise.id]),
        type: profile.kneeSensitive ? "knee" : profile.hamstringSensitive ? "hamstring" : "general",
      };
      if (kneeApprovals[exercise.id] === true) {
        profileState.weight = roundWeight(profileState.weight + incrementFor(profileState));
        instanceState = resetInstanceProgress(instanceState, exercise);
        resetSiblingInstancesForProfile(profile.id, exercise.id, instanceData);
      }
      profileState.kneeCheckPending = false;
      profileState.hamstringCheckPending = false;
      profileState.recoveryCheckPending = false;
    }

    const reps = (entries[exercise.id] || []).map((value) => Number(value || 0));
    const totalReps = sum(reps);
    const lowerBound = lowerBoundArray(exercise, instanceState.currentSets);
    const lastSuccessful = instanceState.successfulReps.length ? instanceState.successfulReps : [];
    const currentTarget = instanceState.targetReps.length ? instanceState.targetReps : defaultTargetReps(exercise, instanceState);
    const successfulBaselineTotal = lastSuccessful.length ? sum(lastSuccessful) : null;
    const meetsLowerBound = reps.length > 0 && reps.every((rep) => rep >= exercise.min);
    const isSuccess = meetsLowerBound && (successfulBaselineTotal === null ? true : totalReps >= successfulBaselineTotal + 1);
    const allAtTop = reps.length > 0 && reps.every((rep) => Number(rep) >= exercise.max);
    const wasExtraSet = instanceState.currentSets > exercise.defaultSets;
    const canChangeLoad = exercise.anchorSession && profileState.initialized && incrementFor(profileState) > 0;
    const normalizedTotalLoad = normalizeTotalLoad(profile, profileState.weight, profileState.baseWeight);

    historyExercises.push({
      id: exercise.id,
      instanceId: exercise.id,
      profileId: profile.id,
      name: profile.name,
      weight: Number(profileState.weight || 0),
      baseWeight: effectiveBaseWeight(profile, profileState.baseWeight),
      loadType: profile.loadType,
      entryMode: profile.entryMode,
      displayMode: profile.displayMode,
      normalizedTotalLoad,
      reps,
      totalReps,
      sets: reps.map((rep, index) => ({
        set: index + 1,
        reps: Number(rep || 0),
        weight: Number(profileState.weight || 0),
        baseWeight: effectiveBaseWeight(profile, profileState.baseWeight),
        normalizedTotalLoad,
      })),
      muscleFactors: profile.muscleFactors,
      kneeSensitive: profile.kneeSensitive,
      hamstringSensitive: profile.hamstringSensitive,
      anchorSession: exercise.anchorSession,
    });

    instanceState.lastReps = reps;

    if (isSuccess) {
      if (allAtTop && profileState.initialized) {
        if ((profile.kneeSensitive || profile.hamstringSensitive) && exercise.anchorSession) {
          profileState.kneeCheckPending = Boolean(profile.kneeSensitive);
          profileState.hamstringCheckPending = Boolean(profile.hamstringSensitive);
          profileState.recoveryCheckPending = true;
          instanceState.successfulReps = reps;
          instanceState.targetReps = buildNextTargetFromSuccessful(reps, exercise.max);
          instanceState.targetTotal = sum(instanceState.targetReps);
          instanceState.stagnationCount = 0;
        } else if (canChangeLoad) {
          profileState.weight = roundWeight(profileState.weight + incrementFor(profileState));
          instanceState = resetInstanceProgress(instanceState, exercise);
          resetSiblingInstancesForProfile(profile.id, exercise.id, instanceData);
        } else {
          instanceState.successfulReps = reps;
          instanceState.targetReps = buildNextTargetFromSuccessful(reps, exercise.max);
          instanceState.targetTotal = sum(instanceState.targetReps);
          instanceState.stagnationCount = 0;
        }
      } else {
        instanceState.successfulReps = reps;
        instanceState.targetReps = buildNextTargetFromSuccessful(reps, exercise.max);
        instanceState.targetTotal = sum(instanceState.targetReps);
        instanceState.stagnationCount = 0;
      }
    } else {
      instanceState.targetReps = currentTarget;
      instanceState.targetTotal = sum(currentTarget);
      instanceState.stagnationCount = Number(instanceState.stagnationCount || 0) + 1;

      if (instanceState.stagnationCount >= 3) {
        if (profile.kneeSensitive || profile.hamstringSensitive) {
          if (exercise.anchorSession && canChangeLoad) {
            profileState.weight = Math.max(0, roundWeight(profileState.weight - incrementFor(profileState)));
            resetSiblingInstancesForProfile(profile.id, exercise.id, instanceData);
          }
          instanceState.currentSets = exercise.defaultSets;
          instanceState.successfulReps = [];
          instanceState.targetReps = lowerBoundArray(exercise, exercise.defaultSets);
          instanceState.targetTotal = sum(instanceState.targetReps);
          instanceState.stagnationCount = 0;
        } else if (profile.category === "upper_main") {
          if (!wasExtraSet) {
            instanceState.currentSets = exercise.defaultSets + 1;
            instanceState.successfulReps = [];
            instanceState.targetReps = lowerBoundArray(exercise, instanceState.currentSets);
            instanceState.targetTotal = sum(instanceState.targetReps);
          } else {
            if (exercise.anchorSession && canChangeLoad) {
              profileState.weight = Math.max(0, roundWeight(profileState.weight - incrementFor(profileState)));
              resetSiblingInstancesForProfile(profile.id, exercise.id, instanceData);
            }
            instanceState.currentSets = exercise.defaultSets;
            instanceState.successfulReps = [];
            instanceState.targetReps = lowerBoundArray(exercise, exercise.defaultSets);
            instanceState.targetTotal = sum(instanceState.targetReps);
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
    schemaVersion: 3,
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

  return { nextState, historyExercises, kneeConfirmations: recoveryConfirmations, recoveryConfirmations, notes };
}

export function applyDeload(rawState) {
  const state = migrateState(rawState);
  const instanceData = { ...state.instanceData };
  for (const routine of ROUTINES) {
    for (const exercise of routine.exercises) {
      const current = normalizeInstanceState(instanceData[exercise.id], exercise);
      const currentSets = Math.max(1, Math.ceil(Number(current.currentSets || exercise.defaultSets) / 2));
      instanceData[exercise.id] = {
        ...current,
        currentSets,
        targetReps: lowerBoundArray(exercise, currentSets),
        targetTotal: sum(lowerBoundArray(exercise, currentSets)),
        stagnationCount: 0,
      };
    }
  }
  return { ...state, instanceData, updatedAt: Date.now() };
}

export function shouldAutoDeload(rawState) {
  const state = migrateState(rawState);
  if (Number(state.sessionCount || 0) < 12) return false;
  const stalled = Object.values(state.instanceData || {}).filter((data) => Number(data.stagnationCount || 0) >= 2);
  return stalled.length >= 3;
}

export function sum(values) {
  return values.reduce((acc, value) => acc + Number(value || 0), 0);
}

export function comparableTarget(exercise, state) {
  const migrated = migrateState(state);
  const current = normalizeInstanceState(migrated.instanceData?.[exercise.id], exercise);
  return Number(current?.targetTotal || sum(defaultTargetReps(exercise, current)));
}

function normalizeInstanceState(rawInstance, exercise) {
  const currentSets = Number(rawInstance?.currentSets || exercise.defaultSets);
  const successfulReps = sanitizeReps(rawInstance?.successfulReps, currentSets);
  const targetReps = sanitizeReps(rawInstance?.targetReps, currentSets);
  const defaultTarget = defaultTargetReps(exercise, { currentSets, successfulReps, targetReps });
  return {
    ...(rawInstance || {}),
    lastReps: sanitizeReps(rawInstance?.lastReps, currentSets),
    successfulReps,
    targetReps: targetReps.length ? targetReps : defaultTarget,
    targetTotal: Number(rawInstance?.targetTotal || sum(targetReps.length ? targetReps : defaultTarget)),
    stagnationCount: Number(rawInstance?.stagnationCount || 0),
    currentSets,
  };
}

function sanitizeReps(values, expectedLength) {
  if (!Array.isArray(values)) return [];
  const cleaned = values.map((value) => Number(value || 0)).filter((value) => Number.isFinite(value));
  if (!cleaned.length) return [];
  return Array.from({ length: expectedLength }, (_, index) => Number(cleaned[index] || 0));
}

function defaultTargetReps(exercise, instanceState) {
  if (instanceState?.targetReps?.length) return instanceState.targetReps;
  if (instanceState?.successfulReps?.length) return buildNextTargetFromSuccessful(instanceState.successfulReps, exercise.max);
  return lowerBoundArray(exercise, instanceState?.currentSets || exercise.defaultSets);
}

function lowerBoundArray(exercise, sets) {
  return Array.from({ length: Number(sets || exercise.defaultSets || 0) }, () => Number(exercise.min || 0));
}

function buildNextTargetFromSuccessful(successfulReps, maxRep) {
  if (!Array.isArray(successfulReps) || !successfulReps.length) return [];
  const next = successfulReps.map((value) => Number(value || 0));
  const candidates = next
    .map((rep, index) => ({ rep, index }))
    .filter((item) => item.rep < Number(maxRep || 0));

  if (!candidates.length) return [...next];

  const lowest = Math.min(...candidates.map((item) => item.rep));
  const target = candidates.find((item) => item.rep === lowest);
  next[target.index] += 1;
  return next;
}

function resetInstanceProgress(instanceState, exercise) {
  const targetReps = lowerBoundArray(exercise, exercise.defaultSets);
  return {
    ...instanceState,
    currentSets: exercise.defaultSets,
    lastReps: [],
    successfulReps: [],
    targetReps,
    targetTotal: sum(targetReps),
    stagnationCount: 0,
  };
}

function incrementFor(profileState) {
  return Number(profileState.incrementStep || 0);
}

function roundWeight(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function resetSiblingInstancesForProfile(profileId, currentExerciseId, instanceData) {
  for (const sessionExercise of SESSION_EXERCISES) {
    if (sessionExercise.profileId !== profileId || sessionExercise.id === currentExerciseId) continue;
    const targetReps = lowerBoundArray(sessionExercise, sessionExercise.defaultSets);
    instanceData[sessionExercise.id] = {
      ...(instanceData[sessionExercise.id] || {}),
      lastReps: [],
      successfulReps: [],
      targetReps,
      targetTotal: sum(targetReps),
      stagnationCount: 0,
      currentSets: sessionExercise.defaultSets,
    };
  }
}
