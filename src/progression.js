import {
  ROUTINES,
  SESSION_EXERCISES,
  createInitialState,
  createInitialInstanceData,
  createInitialProfileData,
  legacyIdFor,
  migrateState,
  profileById,
} from "./routines.js";
import { convertNormalizedToEntry, effectiveBaseWeight, normalizeTotalLoad } from "./load.js";

export function completeSession(rawState, routine, entries, kneeApprovals, notes = "") {
  const state = migrateState(rawState);
  const profileData = { ...createInitialProfileData(), ...(state.profileData || {}) };
  const instanceData = { ...createInitialInstanceData(), ...(state.instanceData || {}) };
  const recoveryConfirmations = {};
  const historyExercises = [];
  const sessionDeload = getSessionDeload(state, routine);
  const isDeloadSession = Boolean(sessionDeload);

  for (const exercise of routine.exercises) {
    const profile = profileById(exercise.profileId);
    const deloadProfileState = isDeloadSession ? profileStateForDeload(state, profile.id, sessionDeload) : null;
    const profileState = {
      ...profileData[profile.id],
      weight: Number(profileData[profile.id]?.weight || 0),
      baseWeight: Number(profileData[profile.id]?.baseWeight ?? profile.baseWeight ?? 0),
      incrementStep: Number(profileData[profile.id]?.incrementStep || profile.defaultIncrement || 0),
      initialized: Boolean(profileData[profile.id]?.initialized || profile.isTime),
      kneeCheckPending: Boolean(profileData[profile.id]?.kneeCheckPending),
      hamstringCheckPending: Boolean(profileData[profile.id]?.hamstringCheckPending),
      pendingLoadIncrease: Boolean(profileData[profile.id]?.pendingLoadIncrease),
      recoveryCheckPending: Boolean(
        profileData[profile.id]?.recoveryCheckPending ||
          profileData[profile.id]?.kneeCheckPending ||
          profileData[profile.id]?.hamstringCheckPending
      ),
    };

    let instanceState = normalizeInstanceState(instanceData[exercise.id], exercise);
    const normalLoggedWeight = Number(profileState.weight || 0);
    const normalBaseWeight = effectiveBaseWeight(profile, profileState.baseWeight);
    const loggedWeight = isDeloadSession ? deloadEntryWeight(profile, deloadProfileState || profileState, sessionDeload) : normalLoggedWeight;
    const loggedBaseWeight = isDeloadSession
      ? effectiveBaseWeight(profile, deloadProfileState?.baseWeight ?? profileState.baseWeight)
      : normalBaseWeight;
    let consumedRecoveryCheck = false;
    let appliedRecoveryIncrease = false;

    if (!isDeloadSession && (profile.kneeSensitive || profile.hamstringSensitive) && profileState.recoveryCheckPending && kneeApprovals[exercise.id] !== undefined) {
      consumedRecoveryCheck = true;
      recoveryConfirmations[exercise.id] = {
        clean: Boolean(kneeApprovals[exercise.id]),
        type: profile.kneeSensitive ? "knee" : profile.hamstringSensitive ? "hamstring" : "general",
      };
      if (kneeApprovals[exercise.id] === true && profileState.pendingLoadIncrease) {
        appliedRecoveryIncrease = true;
        profileState.weight = roundWeight(profileState.weight + incrementFor(profileState));
        instanceState = resetInstanceProgress(instanceState, exercise);
        resetSiblingInstancesForProfile(profile.id, exercise.id, instanceData);
      }
      profileState.kneeCheckPending = false;
      profileState.hamstringCheckPending = false;
      profileState.recoveryCheckPending = false;
      profileState.pendingLoadIncrease = false;
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
    const canChangeLoad = profileState.initialized && incrementFor(profileState) > 0;
    const normalizedTotalLoad = normalizeTotalLoad(profile, loggedWeight, loggedBaseWeight);

    historyExercises.push({
      id: exercise.id,
      instanceId: exercise.id,
      profileId: profile.id,
      name: profile.name,
      weight: loggedWeight,
      baseWeight: loggedBaseWeight,
      loadType: profile.loadType,
      entryMode: profile.entryMode,
      displayMode: profile.displayMode,
      normalizedTotalLoad,
      normalWeight: normalLoggedWeight,
      normalBaseWeight,
      normalNormalizedTotalLoad: normalizeTotalLoad(profile, normalLoggedWeight, normalBaseWeight),
      isDeload: isDeloadSession,
      deloadType: sessionDeload?.type || null,
      deloadFactor: sessionDeload?.factor || null,
      reps,
      totalReps,
      sets: reps.map((rep, index) => ({
        set: index + 1,
        reps: Number(rep || 0),
        weight: loggedWeight,
        baseWeight: loggedBaseWeight,
        normalizedTotalLoad,
      })),
      muscleFactors: profile.muscleFactors,
      kneeSensitive: profile.kneeSensitive,
      hamstringSensitive: profile.hamstringSensitive,
      anchorSession: exercise.anchorSession,
    });

    if (isDeloadSession) {
      profileData[profile.id] = profileState;
      instanceData[exercise.id] = instanceState;
      continue;
    }

    instanceState.lastReps = reps;

    if (appliedRecoveryIncrease) {
      if ((profile.kneeSensitive || profile.hamstringSensitive) && reps.length > 0) {
        profileState.kneeCheckPending = Boolean(profile.kneeSensitive);
        profileState.hamstringCheckPending = Boolean(profile.hamstringSensitive);
        profileState.recoveryCheckPending = true;
        profileState.pendingLoadIncrease = false;
      }
      instanceState = resetInstanceProgress(instanceState, exercise);
      profileData[profile.id] = profileState;
      instanceData[exercise.id] = instanceState;
      continue;
    }

    if (isSuccess) {
      if (allAtTop && profileState.initialized) {
        if (profile.kneeSensitive || profile.hamstringSensitive) {
          profileState.kneeCheckPending = Boolean(profile.kneeSensitive);
          profileState.hamstringCheckPending = Boolean(profile.hamstringSensitive);
          profileState.recoveryCheckPending = true;
          profileState.pendingLoadIncrease = Boolean(canChangeLoad);
          instanceState.successfulReps = reps;
          instanceState.displaySuccessfulReps = reps;
          instanceState.targetReps = currentTarget;
          instanceState.targetTotal = sum(currentTarget);
          instanceState.stagnationCount = 0;
        } else if (canChangeLoad) {
          instanceState.displaySuccessfulReps = reps;
          profileState.weight = roundWeight(profileState.weight + incrementFor(profileState));
          instanceState = resetInstanceProgress(instanceState, exercise);
          resetSiblingInstancesForProfile(profile.id, exercise.id, instanceData);
        } else {
          instanceState.successfulReps = reps;
          instanceState.displaySuccessfulReps = reps;
          instanceState.targetReps = buildNextTargetFromSuccessful(reps, exercise.max);
          instanceState.targetTotal = sum(instanceState.targetReps);
          instanceState.stagnationCount = 0;
        }
      } else {
        instanceState.successfulReps = reps;
        instanceState.displaySuccessfulReps = reps;
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
          if (canChangeLoad) {
            profileState.weight = Math.max(0, roundWeight(profileState.weight - incrementFor(profileState)));
            resetSiblingInstancesForProfile(profile.id, exercise.id, instanceData);
          }
          instanceState.currentSets = exercise.defaultSets;
          instanceState.successfulReps = [];
          instanceState.targetReps = lowerBoundArray(exercise, exercise.defaultSets);
          instanceState.targetTotal = sum(instanceState.targetReps);
          instanceState.stagnationCount = 0;
        } else if (profile.category === "upper_main" || profile.category === "posterior") {
          if (!wasExtraSet) {
            instanceState.currentSets = exercise.defaultSets + 1;
            instanceState.successfulReps = [];
            instanceState.targetReps = lowerBoundArray(exercise, instanceState.currentSets);
            instanceState.targetTotal = sum(instanceState.targetReps);
          } else {
            if (canChangeLoad) {
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

    if ((profile.kneeSensitive || profile.hamstringSensitive) && reps.length > 0) {
      profileState.kneeCheckPending = Boolean(profile.kneeSensitive);
      profileState.hamstringCheckPending = Boolean(profile.hamstringSensitive);
      profileState.recoveryCheckPending = true;
      profileState.pendingLoadIncrease = Boolean(allAtTop && canChangeLoad);
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

  if (isDeloadSession) {
    nextState = finishDeloadSession(nextState, sessionDeload);
  } else if (shouldAutoDeload(nextState)) {
    nextState = schedulePlateauDeload(nextState);
  }

  return {
    nextState,
    historyExercises,
    kneeConfirmations: recoveryConfirmations,
    recoveryConfirmations,
    notes,
    deload: sessionDeload
      ? {
          type: sessionDeload.type,
          factor: sessionDeload.factor,
          remainingSessions: sessionDeload.remainingSessions,
        }
      : null,
  };
}

export function applyDeload(rawState) {
  return startConditionDeload(rawState);
}

export function startConditionDeload(rawState, sessionId = "") {
  const state = migrateState(rawState);
  return {
    ...state,
    deload: {
      mode: "condition",
      type: "condition",
      factor: 0.7,
      sessionId,
      startedAt: Date.now(),
    },
    updatedAt: Date.now(),
  };
}

export function cancelConditionDeload(rawState) {
  const state = migrateState(rawState);
  if (state.deload?.mode !== "condition") return state;
  return { ...state, deload: { mode: "none" }, updatedAt: Date.now() };
}

export function cancelScheduledPlateauDeload(rawState) {
  const state = migrateState(rawState);
  if (state.deload?.mode !== "plateau_scheduled") return state;
  return { ...state, deload: { mode: "none" }, updatedAt: Date.now() };
}

export function endPlateauDeload(rawState) {
  const state = migrateState(rawState);
  if (state.deload?.mode !== "plateau_active" && state.deload?.mode !== "plateau_scheduled") return state;
  return {
    ...state,
    deload: { mode: "none" },
    updatedAt: Date.now(),
  };
}

export function schedulePlateauDeload(rawState) {
  const state = migrateState(rawState);
  if (state.deload?.mode && state.deload.mode !== "none") return state;
  return {
    ...state,
    deload: {
      mode: "plateau_scheduled",
      type: "plateau",
      startsAtSession: "a1",
      factor: 0.65,
      scheduledAt: Date.now(),
    },
    updatedAt: Date.now(),
  };
}

export function getSessionDeload(rawState, routine) {
  const state = migrateState(rawState);
  const deload = state.deload || { mode: "none" };
  if (deload.mode === "condition") {
    if (deload.sessionId && deload.sessionId !== routine?.id) return null;
    return {
      ...deload,
      type: "condition",
      factor: 0.7,
      remainingSessions: 1,
      normalProfileData: currentProfileSnapshot(state),
    };
  }
  if (deload.mode === "plateau_active") {
    return {
      ...deload,
      type: "plateau",
      factor: 0.65,
      remainingSessions: Number(deload.remainingSessions || 4),
      normalProfileData: deload.normalProfileData || currentProfileSnapshot(state),
    };
  }
  if (deload.mode === "plateau_scheduled" && routine?.id === (deload.startsAtSession || "a1")) {
    return {
      ...deload,
      mode: "plateau_active",
      type: "plateau",
      factor: 0.65,
      remainingSessions: 4,
      normalProfileData: currentProfileSnapshot(state),
      startedAt: Date.now(),
    };
  }
  return null;
}

export function deloadTargetReps(exercise) {
  return lowerBoundArray(exercise, exercise.defaultSets);
}

export function deloadEntryWeight(profile, profileState, sessionDeload) {
  if (!sessionDeload || profile?.isTime || profile?.loadType === "bodyweight_progression") return Number(profileState?.weight || 0);
  const baseWeight = effectiveBaseWeight(profile, profileState?.baseWeight);
  const normalTotal = normalizeTotalLoad(profile, profileState?.weight, baseWeight);
  if (!normalTotal) return Number(profileState?.weight || 0);
  const targetTotal = normalTotal * Number(sessionDeload.factor || 1);
  return convertNormalizedToEntry({ ...profile, baseWeight }, targetTotal);
}

export function shouldAutoDeload(rawState) {
  const state = migrateState(rawState);
  if (state.deload?.mode && state.deload.mode !== "none") return false;
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

export function rebuildStateFromHistory(rawState, history = []) {
  const source = migrateState(rawState);
  if (!Array.isArray(history) || !history.length) return source;

  const routinesById = new Map(ROUTINES.map((routine) => [routine.id, routine]));
  const routinesByName = new Map(ROUTINES.map((routine) => [routine.name, routine]));
  const seenProfiles = new Set();
  const seenInstances = new Set();

  let replayState = createReplaySeed(source);
  const orderedHistory = [...history].sort((a, b) => toTimestamp(a) - toTimestamp(b));
  let replayPlateauDeloadCount = 0;

  for (const session of orderedHistory) {
    const routine = routinesById.get(session.sessionId) || routinesByName.get(session.routine);
    if (!routine) continue;

    if (isDeloadHistorySession(session)) {
      replayState = advanceReplaySession(replayState);
      if ((session.deloadType || session.deload?.type) === "plateau") {
        replayPlateauDeloadCount += 1;
        if (replayPlateauDeloadCount >= 4) {
          replayState = resetAllStallCounters(replayState);
          replayPlateauDeloadCount = 0;
        }
      }
      continue;
    }

    replayPlateauDeloadCount = 0;

    const loggedExercises = session.exercises || [];
    const entries = {};

    for (const exercise of routine.exercises) {
      const logged = findLoggedExercise(loggedExercises, exercise);
      if (!logged) {
        entries[exercise.id] = Array(exercise.defaultSets).fill(exercise.min);
        continue;
      }

      const profile = profileById(logged.profileId || exercise.profileId);
      seenProfiles.add(profile.id);
      seenInstances.add(exercise.id);

      replayState.profileData[profile.id] = {
        ...replayState.profileData[profile.id],
        weight: Number(logged.weight ?? replayState.profileData[profile.id].weight ?? 0),
        baseWeight: Number(logged.baseWeight ?? replayState.profileData[profile.id].baseWeight ?? profile.baseWeight ?? 0),
        initialized: Boolean(
          replayState.profileData[profile.id].initialized ||
            Number(logged.weight ?? 0) > 0 ||
            profile.isTime
        ),
      };

      entries[exercise.id] = (logged.reps || []).map((value) => Number(value || 0));
    }

    const approvals = Object.fromEntries(
      Object.entries(session.recoveryConfirmations || session.kneeConfirmations || {}).map(([exerciseId, value]) => [
        exerciseId,
        Boolean(value?.clean),
      ])
    );

    replayState = completeSession(replayState, routine, entries, approvals, session.notes || "").nextState;
  }

  if (replayPlateauDeloadCount > 0 && replayPlateauDeloadCount < 4) {
    replayState = {
      ...replayState,
      deload: {
        mode: "plateau_active",
        type: "plateau",
        factor: 0.65,
        startsAtSession: "a1",
        remainingSessions: 4 - replayPlateauDeloadCount,
        normalProfileData: currentProfileSnapshot(replayState),
      },
    };
  }

  return mergeRebuiltState(source, replayState, seenProfiles, seenInstances);
}

function isDeloadHistorySession(session) {
  return Boolean(session?.isDeload || session?.deloadType || session?.deload);
}

function advanceReplaySession(state) {
  return {
    ...state,
    currentRoutineIndex: (Number(state.currentRoutineIndex || 0) + 1) % ROUTINES.length,
    sessionCount: Number(state.sessionCount || 0) + 1,
  };
}

function currentProfileSnapshot(state) {
  return Object.fromEntries(
    Object.entries(state.profileData || {}).map(([profileId, profileState]) => [
      profileId,
      {
        weight: Number(profileState?.weight || 0),
        baseWeight: Number(profileState?.baseWeight ?? profileById(profileId)?.baseWeight ?? 0),
      },
    ])
  );
}

function profileStateForDeload(state, profileId, sessionDeload) {
  const profile = profileById(profileId);
  const snapshot = sessionDeload?.normalProfileData?.[profileId];
  const current = state.profileData?.[profileId] || {};
  return {
    ...current,
    weight: Number(snapshot?.weight ?? current.weight ?? 0),
    baseWeight: Number(snapshot?.baseWeight ?? current.baseWeight ?? profile?.baseWeight ?? 0),
  };
}

function finishDeloadSession(state, sessionDeload) {
  if (!sessionDeload) return state;
  if (sessionDeload.type === "condition") {
    return { ...state, deload: { mode: "none" }, updatedAt: Date.now() };
  }

  const remainingSessions = Math.max(0, Number(sessionDeload.remainingSessions || 4) - 1);
  if (remainingSessions <= 0) {
    return {
      ...resetAllStallCounters(state),
      deload: { mode: "none" },
      lastDeloadAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  return {
    ...state,
    deload: {
      mode: "plateau_active",
      type: "plateau",
      factor: 0.65,
      startsAtSession: "a1",
      remainingSessions,
      normalProfileData: sessionDeload.normalProfileData || currentProfileSnapshot(state),
      startedAt: sessionDeload.startedAt || Date.now(),
    },
    updatedAt: Date.now(),
  };
}

function resetAllStallCounters(state) {
  const instanceData = {};
  for (const exercise of SESSION_EXERCISES) {
    instanceData[exercise.id] = {
      ...state.instanceData?.[exercise.id],
      stagnationCount: 0,
    };
  }
  return { ...state, instanceData };
}

function normalizeInstanceState(rawInstance, exercise) {
  const currentSets = Math.max(exercise.defaultSets, Number(rawInstance?.currentSets || exercise.defaultSets));
  const successfulReps = sanitizeReps(rawInstance?.successfulReps, currentSets);
  const displaySuccessfulReps = sanitizeReps(rawInstance?.displaySuccessfulReps, currentSets);
  const targetReps = sanitizeReps(rawInstance?.targetReps, currentSets);
  const defaultTarget = defaultTargetReps(exercise, { currentSets, successfulReps, targetReps });
  return {
    ...(rawInstance || {}),
    lastReps: sanitizeReps(rawInstance?.lastReps, currentSets),
    successfulReps,
    displaySuccessfulReps: displaySuccessfulReps.length ? displaySuccessfulReps : successfulReps,
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

function createReplaySeed(source) {
  const base = createInitialProfileData();
  const seed = migrateState({
    ...createInitialState(),
    currentRoutineIndex: 0,
    sessionCount: 0,
    updatedAt: source.updatedAt,
    profileData: Object.fromEntries(
      Object.entries(base).map(([profileId, profileState]) => [
        profileId,
        {
          ...profileState,
          incrementStep: Number(
            source.profileData?.[profileId]?.incrementStep ?? profileState.incrementStep ?? 0
          ),
          baseWeight: Number(source.profileData?.[profileId]?.baseWeight ?? profileState.baseWeight ?? 0),
        },
      ])
    ),
  });

  return seed;
}

function mergeRebuiltState(source, rebuilt, seenProfiles, seenInstances) {
  const nextProfileData = { ...rebuilt.profileData };
  const nextInstanceData = { ...rebuilt.instanceData };

  for (const [profileId, profileState] of Object.entries(source.profileData || {})) {
    if (!seenProfiles.has(profileId)) {
      nextProfileData[profileId] = { ...profileState };
      continue;
    }

    nextProfileData[profileId] = {
      ...nextProfileData[profileId],
      incrementStep: Number(profileState.incrementStep ?? nextProfileData[profileId].incrementStep ?? 0),
      baseWeight: Number(profileState.baseWeight ?? nextProfileData[profileId].baseWeight ?? 0),
    };
  }

  for (const [instanceId, instanceState] of Object.entries(source.instanceData || {})) {
    if (!seenInstances.has(instanceId)) {
      nextInstanceData[instanceId] = { ...instanceState };
    }
  }

  return migrateState({
    ...source,
    ...rebuilt,
    profileData: nextProfileData,
    instanceData: nextInstanceData,
    recommendationCooldowns: { ...(source.recommendationCooldowns || {}) },
    updatedAt: source.updatedAt,
  });
}

function toTimestamp(session) {
  const value = session?.completedAtLocal || session?.date || session?.createdAt || 0;
  if (value?.toDate) return value.toDate().getTime();
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function findLoggedExercise(loggedExercises, exercise) {
  const candidateIds = new Set([exercise.id, legacyIdFor(exercise), exercise.profileId]);
  return (loggedExercises || []).find((logged) => {
    const loggedIds = [logged?.instanceId, logged?.id, logged?.profileId].filter(Boolean);
    return loggedIds.some((value) => candidateIds.has(value));
  });
}
