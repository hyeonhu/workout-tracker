export const CATEGORY_META = {
  upper_main: { label: "상체 메인", color: "#3b82f6" },
  posterior: { label: "후면사슬", color: "#a855f7" },
  knee_sensitive: { label: "무릎 주의", color: "#f59e0b" },
  isolation: { label: "고립", color: "#10b981" },
};

export const ROUTINES = [
  {
    id: "a1",
    name: "A1",
    day: "월",
    title: "벤치 중심 + 쿼드 + 코어",
    exercises: [
      item("bench_press", "벤치프레스", 3, 8, 12, "upper_main", "barbell"),
      item("lat_pulldown", "랫풀다운", 3, 8, 12, "upper_main", "machine"),
      item("incline_db_press", "인클라인 덤벨프레스", 2, 8, 12, "upper_main", "dumbbell"),
      item("leg_press", "레그프레스", 3, 10, 15, "knee_sensitive", "machine"),
      item("lateral_raise", "사이드 레터럴 레이즈", 3, 15, 25, "isolation", "dumbbell"),
      item("cable_crunch", "케이블 크런치", 3, 10, 15, "isolation", "machine"),
    ],
  },
  {
    id: "b1",
    name: "B1",
    day: "화",
    title: "숄더프레스 중심 + 후면사슬 + 팔",
    exercises: [
      item("romanian_deadlift", "루마니안 데드리프트", 3, 8, 12, "posterior", "barbell"),
      item("shoulder_press", "숄더프레스", 3, 8, 12, "upper_main", "barbell"),
      item("seated_cable_row", "시티드 케이블 로우", 3, 8, 12, "upper_main", "machine"),
      item("leg_curl", "레그컬", 3, 10, 15, "isolation", "machine"),
      item("triceps_pushdown", "트라이셉스 푸쉬다운", 2, 10, 15, "isolation", "machine"),
      item("ez_bar_curl", "EZ바 컬", 2, 10, 15, "isolation", "machine"),
      item("face_pull", "페이스풀", 2, 12, 15, "isolation", "machine"),
    ],
  },
  {
    id: "a2",
    name: "A2",
    day: "목",
    title: "인클라인 중심 + 쿼드 + 코어",
    exercises: [
      item("incline_bench_press", "인클라인 벤치프레스", 3, 8, 12, "upper_main", "barbell"),
      item("neutral_lat_pulldown", "뉴트럴그립 랫풀다운", 2, 8, 12, "upper_main", "machine"),
      item("cable_fly", "케이블 플라이", 2, 10, 15, "isolation", "machine"),
      item("leg_press_a2", "레그프레스", 2, 12, 15, "knee_sensitive", "machine"),
      item("leg_extension", "레그 익스텐션", 2, 10, 15, "knee_sensitive", "machine"),
      item("lateral_raise_a2", "사이드 레터럴 레이즈", 2, 15, 25, "isolation", "dumbbell"),
      item("reverse_crunch", "리버스 크런치", 3, 10, 15, "isolation", "machine"),
    ],
  },
  {
    id: "b2",
    name: "B2",
    day: "금",
    title: "등 보강 + 둔근/햄 + 팔",
    exercises: [
      item("hip_thrust", "힙쓰러스트", 3, 8, 12, "posterior", "machine"),
      item("chest_supported_row", "체스트 서포티드 로우", 3, 8, 12, "upper_main", "machine"),
      item("lat_pulldown_b2", "랫풀다운", 2, 10, 12, "upper_main", "machine"),
      item("leg_curl_b2", "레그컬", 2, 10, 15, "isolation", "machine"),
      item("hammer_curl", "해머 컬", 2, 10, 15, "isolation", "dumbbell"),
      item("overhead_triceps_extension", "오버헤드 트라이셉스 익스텐션", 2, 10, 15, "isolation", "machine"),
      item("plank", "플랭크", 2, 30, 45, "isolation", "bodyweight", true),
    ],
  },
];

export const ALL_EXERCISES = ROUTINES.flatMap((routine) => routine.exercises);

export function createInitialExerciseData() {
  return Object.fromEntries(
    ALL_EXERCISES.map((exercise) => [
      exercise.id,
      {
        weight: 0,
        incrementStep: defaultIncrementFor(exercise),
        lastReps: [],
        targetTotal: exercise.defaultSets * exercise.min,
        stagnationCount: 0,
        currentSets: exercise.defaultSets,
        kneeCheckPending: false,
        initialized: false,
      },
    ])
  );
}

export function createInitialState() {
  return {
    currentRoutineIndex: 0,
    sessionCount: 0,
    exerciseData: createInitialExerciseData(),
    updatedAt: Date.now(),
  };
}

function item(id, name, defaultSets, min, max, category, equipment, isTime = false) {
  return { id, name, defaultSets, min, max, category, equipment, isTime };
}

export function defaultIncrementFor(exercise) {
  if (exercise.equipment === "dumbbell") return 1;
  if (exercise.equipment === "bodyweight") return 0;
  return 2.5;
}

export function weightBasisLabel(exercise) {
  if (exercise.equipment === "barbell") return "한쪽 원판 기준";
  if (exercise.equipment === "dumbbell") return "덤벨 개당 기준";
  if (exercise.equipment === "bodyweight") return "시간/체중";
  return "머신 표시 기준";
}
