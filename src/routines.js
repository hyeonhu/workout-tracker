import { effectiveBaseWeight, normalizeTotalLoad, weightBasisLabel as loadWeightBasisLabel } from "./load.js";

export const CATEGORY_META = {
  upper_main: { label: "상체 메인", color: "#3b82f6" },
  posterior: { label: "후면사슬", color: "#a855f7" },
  knee_sensitive: { label: "무릎 주의", color: "#f59e0b" },
  hamstring_sensitive: { label: "햄스트링 주의", color: "#fb7185" },
  isolation: { label: "고립", color: "#10b981" },
};

export const MUSCLE_GROUPS = [
  { id: "chest", label: "가슴", color: "#ef4444" },
  { id: "back", label: "등", color: "#3b82f6" },
  { id: "lateral_delts", label: "측면 삼각근", color: "#6366f1" },
  { id: "rear_delts", label: "후면 삼각근", color: "#8b5cf6" },
  { id: "quads", label: "대퇴사두", color: "#f59e0b" },
  { id: "hamstrings_glutes", label: "햄스트링/둔근", color: "#a855f7" },
  { id: "biceps", label: "이두", color: "#10b981" },
  { id: "triceps", label: "삼두", color: "#14b8a6" },
  { id: "core", label: "코어", color: "#eab308" },
];

export const EXERCISE_PROFILES = {
  bench_press: profile("bench_press", "벤치프레스", "upper_main", {
    loadType: "barbell_total",
    entryMode: "per_side_plus_bar",
    displayMode: "per_side_plus_bar",
    defaultIncrement: 2.5,
    defaultWeight: 15,
    baseWeight: 20,
    baseWeightEditable: true,
    muscleFactors: { chest: 1, triceps: 0.45 },
  }),
  lat_pulldown: profile("lat_pulldown", "랫풀다운", "upper_main", {
    loadType: "stack_weight",
    entryMode: "stack",
    displayMode: "stack",
    defaultIncrement: 2.5,
    defaultWeight: 45,
    muscleFactors: { back: 1, biceps: 0.35 },
  }),
  incline_db_press: profile("incline_db_press", "인클라인 덤벨프레스", "upper_main", {
    loadType: "dumbbell_each_hand",
    entryMode: "per_hand",
    displayMode: "per_hand",
    defaultIncrement: 1,
    defaultWeight: 0,
    muscleFactors: { chest: 0.9, triceps: 0.35 },
  }),
  leg_press: profile("leg_press", "레그프레스", "knee_sensitive", {
    loadType: "plate_per_side",
    entryMode: "per_side",
    displayMode: "per_side",
    defaultIncrement: 2.5,
    defaultWeight: 50,
    muscleFactors: { quads: 1, hamstrings_glutes: 0.35 },
    kneeSensitive: true,
  }),
  lateral_raise: profile("lateral_raise", "사이드 레터럴 레이즈", "isolation", {
    loadType: "dumbbell_each_hand",
    entryMode: "per_hand",
    displayMode: "per_hand",
    defaultIncrement: 1,
    defaultWeight: 0,
    muscleFactors: { lateral_delts: 1 },
  }),
  cable_crunch: profile("cable_crunch", "케이블 크런치", "isolation", {
    loadType: "stack_weight",
    entryMode: "stack",
    displayMode: "stack",
    defaultIncrement: 2.5,
    defaultWeight: 0,
    muscleFactors: { core: 1 },
  }),
  romanian_deadlift: profile("romanian_deadlift", "루마니안 데드리프트", "posterior", {
    loadType: "barbell_total",
    entryMode: "per_side_plus_bar",
    displayMode: "per_side_plus_bar",
    defaultIncrement: 2.5,
    defaultWeight: 0,
    baseWeight: 20,
    baseWeightEditable: true,
    muscleFactors: { hamstrings_glutes: 1, back: 0.25 },
  }),
  seated_db_shoulder_press: profile("seated_db_shoulder_press", "시티드 덤벨 숄더프레스", "upper_main", {
    loadType: "dumbbell_each_hand",
    entryMode: "per_hand",
    displayMode: "per_hand",
    defaultIncrement: 1,
    defaultWeight: 12.5,
    muscleFactors: { lateral_delts: 0.75, triceps: 0.45 },
  }),
  seated_cable_row: profile("seated_cable_row", "시티드 케이블 로우", "upper_main", {
    loadType: "stack_weight",
    entryMode: "stack",
    displayMode: "stack",
    defaultIncrement: 2.5,
    defaultWeight: 45,
    muscleFactors: { back: 1, biceps: 0.3, rear_delts: 0.25 },
  }),
  leg_curl: profile("leg_curl", "레그컬", "hamstring_sensitive", {
    loadType: "stack_weight",
    entryMode: "stack",
    displayMode: "stack",
    defaultIncrement: 2.5,
    defaultWeight: 0,
    muscleFactors: { hamstrings_glutes: 1 },
    hamstringSensitive: true,
  }),
  triceps_pushdown: profile("triceps_pushdown", "트라이셉스 푸쉬다운", "isolation", {
    loadType: "stack_weight",
    entryMode: "stack",
    displayMode: "stack",
    defaultIncrement: 2.5,
    defaultWeight: 0,
    muscleFactors: { triceps: 1 },
  }),
  ez_bar_curl: profile("ez_bar_curl", "EZ바 컬", "isolation", {
    loadType: "barbell_total",
    entryMode: "per_side_plus_bar",
    displayMode: "per_side_plus_bar",
    defaultIncrement: 1.25,
    defaultWeight: 0,
    baseWeight: 10,
    baseWeightEditable: true,
    muscleFactors: { biceps: 1 },
  }),
  face_pull: profile("face_pull", "페이스풀", "isolation", {
    loadType: "stack_weight",
    entryMode: "stack",
    displayMode: "stack",
    defaultIncrement: 2.5,
    defaultWeight: 0,
    muscleFactors: { rear_delts: 1, back: 0.25 },
  }),
  incline_bench_press: profile("incline_bench_press", "인클라인 벤치프레스", "upper_main", {
    loadType: "barbell_total",
    entryMode: "per_side_plus_bar",
    displayMode: "per_side_plus_bar",
    defaultIncrement: 2.5,
    defaultWeight: 0,
    baseWeight: 20,
    baseWeightEditable: true,
    muscleFactors: { chest: 1, triceps: 0.4 },
  }),
  neutral_lat_pulldown: profile("neutral_lat_pulldown", "뉴트럴그립 랫풀다운", "upper_main", {
    loadType: "stack_weight",
    entryMode: "stack",
    displayMode: "stack",
    defaultIncrement: 2.5,
    defaultWeight: 0,
    muscleFactors: { back: 1, biceps: 0.35 },
  }),
  cable_fly: profile("cable_fly", "케이블 플라이", "isolation", {
    loadType: "stack_weight",
    entryMode: "stack",
    displayMode: "stack",
    defaultIncrement: 2.5,
    defaultWeight: 0,
    muscleFactors: { chest: 1 },
  }),
  leg_extension: profile("leg_extension", "레그 익스텐션", "knee_sensitive", {
    loadType: "stack_weight",
    entryMode: "stack",
    displayMode: "stack",
    defaultIncrement: 2.5,
    defaultWeight: 0,
    muscleFactors: { quads: 1 },
    kneeSensitive: true,
  }),
  reverse_crunch: profile("reverse_crunch", "리버스 크런치", "isolation", {
    loadType: "bodyweight_progression",
    entryMode: "bodyweight",
    displayMode: "bodyweight",
    defaultIncrement: 0,
    defaultWeight: 0,
    muscleFactors: { core: 1 },
  }),
  smith_hip_thrust: profile("smith_hip_thrust", "스미스 힙쓰러스트", "posterior", {
    loadType: "smith_total",
    entryMode: "per_side_plus_bar",
    displayMode: "per_side_plus_bar",
    defaultIncrement: 2.5,
    defaultWeight: 40,
    baseWeight: 20,
    baseWeightEditable: true,
    muscleFactors: { hamstrings_glutes: 1 },
  }),
  incline_bench_chest_supported_db_row: profile("incline_bench_chest_supported_db_row", "인클라인 벤치 체서 덤벨 로우", "upper_main", {
    loadType: "dumbbell_each_hand",
    entryMode: "per_hand",
    displayMode: "per_hand",
    defaultIncrement: 1,
    defaultWeight: 0,
    muscleFactors: { back: 1, rear_delts: 0.25, biceps: 0.3 },
  }),
  hammer_curl: profile("hammer_curl", "해머 컬", "isolation", {
    loadType: "dumbbell_each_hand",
    entryMode: "per_hand",
    displayMode: "per_hand",
    defaultIncrement: 1,
    defaultWeight: 0,
    muscleFactors: { biceps: 1 },
  }),
  overhead_triceps_extension: profile("overhead_triceps_extension", "오버헤드 트라이셉스 익스텐션", "isolation", {
    loadType: "stack_weight",
    entryMode: "stack",
    displayMode: "stack",
    defaultIncrement: 2.5,
    defaultWeight: 0,
    muscleFactors: { triceps: 1 },
  }),
  plank: profile("plank", "플랭크", "isolation", {
    loadType: "bodyweight_progression",
    entryMode: "bodyweight",
    displayMode: "bodyweight",
    defaultIncrement: 0,
    defaultWeight: 0,
    muscleFactors: { core: 1 },
    isTime: true,
  }),
};

export const ROUTINES = [
  session("a1", "A1", "월", "벤치 중심 + 쿼드 + 코어", [
    inst("a1_bench_press", "bench_press", 3, 8, 12, true),
    inst("a1_lat_pulldown", "lat_pulldown", 3, 8, 12, true),
    inst("a1_incline_db_press", "incline_db_press", 2, 8, 12, true),
    inst("a1_leg_press", "leg_press", 3, 10, 15, true),
    inst("a1_lateral_raise", "lateral_raise", 3, 15, 25, true),
    inst("a1_cable_crunch", "cable_crunch", 3, 10, 15, true),
  ]),
  session("b1", "B1", "화", "숄더프레스 중심 + 후면사슬 + 팔", [
    inst("b1_romanian_deadlift", "romanian_deadlift", 3, 8, 12, true),
    inst("b1_seated_db_shoulder_press", "seated_db_shoulder_press", 3, 8, 12, true),
    inst("b1_seated_cable_row", "seated_cable_row", 3, 8, 12, true),
    inst("b1_leg_curl", "leg_curl", 3, 10, 15, true),
    inst("b1_triceps_pushdown", "triceps_pushdown", 2, 10, 15, true),
    inst("b1_ez_bar_curl", "ez_bar_curl", 2, 10, 15, true),
    inst("b1_face_pull", "face_pull", 2, 12, 15, true),
  ]),
  session("a2", "A2", "목", "인클라인 중심 + 쿼드 + 코어", [
    inst("a2_incline_bench_press", "incline_bench_press", 3, 8, 12, true),
    inst("a2_neutral_lat_pulldown", "neutral_lat_pulldown", 2, 8, 12, true),
    inst("a2_cable_fly", "cable_fly", 2, 10, 15, true),
    inst("a2_leg_press", "leg_press", 2, 12, 15, false),
    inst("a2_leg_extension", "leg_extension", 2, 10, 15, true),
    inst("a2_lateral_raise", "lateral_raise", 2, 15, 25, false),
    inst("a2_reverse_crunch", "reverse_crunch", 3, 10, 15, true),
  ]),
  session("b2", "B2", "금", "등 보강 + 둔근/햄 + 팔", [
    inst("b2_hip_thrust", "smith_hip_thrust", 3, 8, 12, true),
    inst("b2_chest_supported_row", "incline_bench_chest_supported_db_row", 3, 8, 12, true),
    inst("b2_lat_pulldown", "lat_pulldown", 2, 10, 12, false),
    inst("b2_leg_curl", "leg_curl", 2, 10, 15, false),
    inst("b2_hammer_curl", "hammer_curl", 2, 10, 15, true),
    inst("b2_overhead_triceps_extension", "overhead_triceps_extension", 2, 10, 15, true),
    inst("b2_plank", "plank", 2, 30, 45, true),
  ]),
];

export const PROFILE_LIST = Object.values(EXERCISE_PROFILES);
export const SESSION_EXERCISES = ROUTINES.flatMap((routine) =>
  routine.exercises.map((exercise) => ({ ...exercise, sessionId: routine.id, sessionName: routine.name }))
);
export const ANCHOR_PROFILE_IDS = [
  "bench_press",
  "seated_db_shoulder_press",
  "lat_pulldown",
  "leg_press",
  "romanian_deadlift",
  "smith_hip_thrust",
];

const LEGACY_PROFILE_ALIASES = {
  shoulder_press: "seated_db_shoulder_press",
  hip_thrust: "smith_hip_thrust",
  chest_supported_row: "incline_bench_chest_supported_db_row",
};

export function createInitialProfileData() {
  return Object.fromEntries(
    PROFILE_LIST.map((profileItem) => [
      profileItem.id,
      {
        weight: profileItem.defaultWeight,
        baseWeight: profileItem.baseWeight,
        incrementStep: profileItem.defaultIncrement,
        initialized: profileItem.defaultWeight > 0 || profileItem.isTime,
        kneeCheckPending: false,
        hamstringCheckPending: false,
        recoveryCheckPending: false,
      },
    ])
  );
}

export function createInitialInstanceData() {
  return Object.fromEntries(
    SESSION_EXERCISES.map((exercise) => [
      exercise.id,
      {
        lastReps: [],
        successfulReps: [],
        targetReps: Array(exercise.defaultSets).fill(exercise.min),
        targetTotal: exercise.defaultSets * exercise.min,
        stagnationCount: 0,
        currentSets: exercise.defaultSets,
      },
    ])
  );
}

export function createInitialState() {
  return {
    schemaVersion: 3,
    currentRoutineIndex: 0,
    sessionCount: 0,
    profileData: createInitialProfileData(),
    instanceData: createInitialInstanceData(),
    recommendationCooldowns: {},
    updatedAt: Date.now(),
  };
}

export function migrateState(rawState) {
  const base = createInitialState();
  if (!rawState) return base;

  const migrated = {
    ...base,
    ...rawState,
    schemaVersion: 3,
    profileData: { ...base.profileData, ...(rawState.profileData || {}) },
    instanceData: { ...base.instanceData, ...(rawState.instanceData || {}) },
    recommendationCooldowns: { ...base.recommendationCooldowns, ...(rawState.recommendationCooldowns || {}) },
  };

  migrateLegacyProfileAliases(migrated.profileData);

  if (rawState.exerciseData && !rawState.profileData) {
    for (const exercise of SESSION_EXERCISES) {
      const old = rawState.exerciseData[legacyIdFor(exercise)] || rawState.exerciseData[exercise.profileId];
      if (!old) continue;
      migrated.instanceData[exercise.id] = {
        ...migrated.instanceData[exercise.id],
        lastReps: old.lastReps || [],
        successfulReps: old.successfulReps || old.lastReps || [],
        targetReps: old.targetReps || buildLegacyTargetReps(old.lastReps, exercise),
        targetTotal: Number(old.targetTotal || exercise.defaultSets * exercise.min),
        stagnationCount: Number(old.stagnationCount || 0),
        currentSets: Number(old.currentSets || exercise.defaultSets),
      };
      migrated.profileData[exercise.profileId] = {
        ...migrated.profileData[exercise.profileId],
        weight: Number(old.weight ?? migrated.profileData[exercise.profileId].weight ?? 0),
        incrementStep: Number(
          old.incrementStep ??
            migrated.profileData[exercise.profileId].incrementStep ??
            defaultIncrementFor(profileById(exercise.profileId))
        ),
        initialized: Boolean(old.initialized || migrated.profileData[exercise.profileId].initialized),
        kneeCheckPending: Boolean(old.kneeCheckPending || migrated.profileData[exercise.profileId].kneeCheckPending),
        hamstringCheckPending: Boolean(old.hamstringCheckPending || migrated.profileData[exercise.profileId].hamstringCheckPending),
        recoveryCheckPending: Boolean(
          old.recoveryCheckPending ||
            old.kneeCheckPending ||
            old.hamstringCheckPending ||
            migrated.profileData[exercise.profileId].recoveryCheckPending
        ),
      };
    }
  }

  for (const profileItem of PROFILE_LIST) {
    const current = migrated.profileData[profileItem.id] || {};
    migrated.profileData[profileItem.id] = {
      ...base.profileData[profileItem.id],
      ...current,
      baseWeight: Number(current.baseWeight ?? base.profileData[profileItem.id].baseWeight ?? profileItem.baseWeight ?? 0),
      incrementStep: Number(
        current.incrementStep ?? base.profileData[profileItem.id].incrementStep ?? profileItem.defaultIncrement ?? 0
      ),
      initialized: Boolean(current.initialized || base.profileData[profileItem.id].initialized || profileItem.isTime),
      recoveryCheckPending: Boolean(current.recoveryCheckPending || current.kneeCheckPending || current.hamstringCheckPending),
      kneeCheckPending: Boolean(current.kneeCheckPending),
      hamstringCheckPending: Boolean(current.hamstringCheckPending),
    };
  }

  for (const exercise of SESSION_EXERCISES) {
    const current = migrated.instanceData[exercise.id] || {};
    migrated.instanceData[exercise.id] = {
      ...base.instanceData[exercise.id],
      ...current,
      lastReps: Array.isArray(current.lastReps) ? current.lastReps : [],
      successfulReps: Array.isArray(current.successfulReps)
        ? current.successfulReps
        : Array.isArray(current.lastReps)
          ? current.lastReps
          : [],
      targetReps: Array.isArray(current.targetReps) && current.targetReps.length
        ? current.targetReps
        : buildLegacyTargetReps(
            Array.isArray(current.successfulReps) && current.successfulReps.length ? current.successfulReps : current.lastReps,
            exercise
          ),
      targetTotal: Number(current.targetTotal || exercise.defaultSets * exercise.min),
      stagnationCount: Number(current.stagnationCount || 0),
      currentSets: Number(current.currentSets || exercise.defaultSets),
    };
  }

  return migrated;
}

export function profileById(profileId) {
  return EXERCISE_PROFILES[LEGACY_PROFILE_ALIASES[profileId] || profileId];
}

export function instanceById(instanceId) {
  return SESSION_EXERCISES.find((exercise) => exercise.id === instanceId);
}

export function instanceView(exercise, state) {
  const migrated = migrateState(state);
  const profileItem = profileById(exercise.profileId);
  const profileState = migrated.profileData[profileItem.id];
  return {
    ...exercise,
    ...profileItem,
    instanceId: exercise.id,
    profileId: profileItem.id,
    profileName: profileItem.name,
    ...migrated.instanceData[exercise.id],
    ...profileState,
    baseWeight: effectiveBaseWeight(profileItem, profileState?.baseWeight),
    normalizedTotalLoad: normalizeTotalLoad(profileItem, profileState?.weight, profileState?.baseWeight),
  };
}

function buildLegacyTargetReps(lastReps, exercise) {
  if (!Array.isArray(lastReps) || !lastReps.length) {
    return Array(exercise.defaultSets).fill(exercise.min);
  }
  const reps = Array.from({ length: exercise.defaultSets }, (_, index) => Number(lastReps[index] || exercise.min));
  const candidates = reps.map((rep, index) => ({ rep, index })).filter((item) => item.rep < exercise.max);
  if (!candidates.length) return reps;
  const lowest = Math.min(...candidates.map((item) => item.rep));
  const picked = candidates.find((item) => item.rep === lowest);
  reps[picked.index] += 1;
  return reps;
}

export function sessionSummary(routine) {
  const totalSets = routine.exercises.reduce((acc, exercise) => acc + exercise.defaultSets, 0);
  const hasKneeSensitive = routine.exercises.some((exercise) => profileById(exercise.profileId).kneeSensitive);
  const hasHamstringSensitive = routine.exercises.some((exercise) => profileById(exercise.profileId).hamstringSensitive);
  return { totalSets, hasKneeSensitive, hasHamstringSensitive, exerciseCount: routine.exercises.length };
}

export function defaultIncrementFor(profileItem) {
  if (!profileItem) return 0;
  return profileItem.defaultIncrement || 0;
}

export function weightBasisLabel(profileItem) {
  return loadWeightBasisLabel(profileItem);
}

function migrateLegacyProfileAliases(profileData) {
  for (const [legacyId, nextId] of Object.entries(LEGACY_PROFILE_ALIASES)) {
    if (!profileData[legacyId] || profileData[nextId]) continue;
    profileData[nextId] = { ...profileData[legacyId] };
  }
}

function profile(id, name, category, options) {
  return {
    id,
    name,
    category,
    loadType: options.loadType,
    entryMode: options.entryMode,
    displayMode: options.displayMode,
    defaultIncrement: options.defaultIncrement,
    defaultWeight: options.defaultWeight,
    baseWeight: Number(options.baseWeight || 0),
    baseWeightEditable: Boolean(options.baseWeightEditable),
    muscleFactors: options.muscleFactors,
    kneeSensitive: Boolean(options.kneeSensitive),
    hamstringSensitive: Boolean(options.hamstringSensitive),
    isTime: Boolean(options.isTime),
    displayNote: options.displayNote || "",
  };
}

function session(id, name, day, title, exercises) {
  return { id, name, day, title, exercises };
}

function inst(id, profileId, defaultSets, min, max, anchorSession) {
  return { id, profileId, defaultSets, min, max, anchorSession };
}

function legacyIdFor(exercise) {
  const map = {
    a1_bench_press: "bench_press",
    a1_lat_pulldown: "lat_pulldown",
    a1_incline_db_press: "incline_db_press",
    a1_leg_press: "leg_press",
    a1_lateral_raise: "lateral_raise",
    a1_cable_crunch: "cable_crunch",
    b1_romanian_deadlift: "romanian_deadlift",
    b1_seated_db_shoulder_press: "shoulder_press",
    b1_seated_cable_row: "seated_cable_row",
    b1_leg_curl: "leg_curl",
    b1_triceps_pushdown: "triceps_pushdown",
    b1_ez_bar_curl: "ez_bar_curl",
    b1_face_pull: "face_pull",
    a2_incline_bench_press: "incline_bench_press",
    a2_neutral_lat_pulldown: "neutral_lat_pulldown",
    a2_cable_fly: "cable_fly",
    a2_leg_press: "leg_press_a2",
    a2_leg_extension: "leg_extension",
    a2_lateral_raise: "lateral_raise_a2",
    a2_reverse_crunch: "reverse_crunch",
    b2_hip_thrust: "hip_thrust",
    b2_chest_supported_row: "chest_supported_row",
    b2_lat_pulldown: "lat_pulldown_b2",
    b2_leg_curl: "leg_curl_b2",
    b2_hammer_curl: "hammer_curl",
    b2_overhead_triceps_extension: "overhead_triceps_extension",
    b2_plank: "plank",
  };
  return map[exercise.id] || exercise.id;
}
