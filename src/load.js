const LOAD_TYPE_TOTAL_FACTORS = {
  barbell_total: 2,
  dumbbell_each_hand: 2,
  stack_weight: 1,
  plate_per_side: 2,
  smith_total: 2,
  bodyweight_progression: 0,
};

const MINI_WARMUP_HINTS = {
  a1_lat_pulldown: "가벼운 무게 1세트 ×8 추천",
  a1_leg_press: "무릎 적응세트 1개 추천",
  b1_seated_db_shoulder_press: "가벼운 덤벨 1세트 ×8 추천",
  b1_seated_cable_row: "가벼운 무게 1세트 ×8 추천",
  b1_leg_curl: "햄스트링 적응세트 1개 추천",
  a2_neutral_lat_pulldown: "가벼운 무게 1세트 ×8 추천",
  a2_leg_press: "무릎 적응세트 1개 추천",
  a2_reverse_crunch: "웜업: 동적 준비만 진행",
  b2_chest_supported_row: "가벼운 덤벨 1세트 ×8 추천",
  b2_leg_curl: "햄스트링 적응세트 1개 추천",
  b2_plank: "웜업: 동적 준비만 진행",
};

export function normalizeTotalLoad(profile, enteredWeight, baseWeightOverride) {
  const entry = Number(enteredWeight || 0);
  const baseWeight = effectiveBaseWeight(profile, baseWeightOverride);

  switch (profile?.loadType) {
    case "barbell_total":
    case "smith_total":
      return roundLoad(baseWeight + entry * 2);
    case "dumbbell_each_hand":
      return roundLoad(entry * 2);
    case "stack_weight":
      return roundLoad(entry);
    case "plate_per_side":
      return roundLoad(entry * 2);
    case "bodyweight_progression":
    default:
      return null;
  }
}

export function normalizeLoggedLoad(exercise, profile) {
  if (exercise?.normalizedTotalLoad !== undefined && exercise?.normalizedTotalLoad !== null) {
    return Number(exercise.normalizedTotalLoad || 0);
  }
  if (profile?.isTime || profile?.loadType === "bodyweight_progression") return null;
  return normalizeTotalLoad(profile, exercise?.weight, exercise?.baseWeight);
}

export function effectiveBaseWeight(profile, baseWeightOverride) {
  return Number(baseWeightOverride ?? profile?.baseWeight ?? 0);
}

export function usesNormalizedLoad(profile) {
  return Boolean(profile) && profile.loadType !== "bodyweight_progression" && !profile.isTime;
}

export function hasAdjustableBaseWeight(profile) {
  return Boolean(profile?.baseWeightEditable);
}

export function weightBasisLabel(profile) {
  switch (profile?.displayMode) {
    case "per_side_plus_bar":
      return "한쪽 + 바 기준";
    case "per_hand":
      return "한 손 기준";
    case "stack":
      return "스택 기준";
    case "per_side":
      return "한쪽 기준";
    case "bodyweight":
      return profile?.isTime ? "초 단위 기준" : "맨몸 기준";
    case "total":
    default:
      return "총중량 기준";
  }
}

export function formatWeightDisplay(weight, profile, options = {}) {
  const entry = roundDisplay(weight);
  const baseWeight = effectiveBaseWeight(profile, options.baseWeight);
  const total = normalizeTotalLoad(profile, weight, baseWeight);
  const includeTotal = Boolean(options.includeTotal && total !== null);

  if (profile?.isTime) return `${entry}초`;

  switch (profile?.displayMode) {
    case "per_side_plus_bar":
      if (includeTotal) return `한쪽 ${entry}kg + 바 ${roundDisplay(baseWeight)}kg (총 ${roundDisplay(total)}kg)`;
      return `한쪽 ${entry}kg + 바 ${roundDisplay(baseWeight)}kg`;
    case "per_hand":
      if (includeTotal) return `한 손 ${entry}kg (총 ${roundDisplay(total)}kg)`;
      return `한 손 ${entry}kg`;
    case "stack":
      return `${entry}kg`;
    case "per_side":
      if (includeTotal) return `한쪽 ${entry}kg (총 ${roundDisplay(total)}kg)`;
      return `한쪽 ${entry}kg`;
    case "bodyweight":
      return "맨몸";
    case "total":
    default:
      return `${entry}kg`;
  }
}

export function metricDisplayLabel(_profileId, useE1rm) {
  return useE1rm ? "e1RM" : "총중량";
}

export function displayMetricWeight(profile, exercise) {
  if (profile?.isTime || profile?.loadType === "bodyweight_progression") return 0;
  return normalizeLoggedLoad(exercise, profile) || 0;
}

export function warmupHelperText(_exercise, view) {
  if (!view) return null;

  if (view.loadType === "bodyweight_progression") {
    return ["웜업", "동적 준비만 진행"].join("\n");
  }

  if (!usesNormalizedLoad(view) || Number(view.weight || 0) <= 0) return null;

  const total = normalizeTotalLoad(view, view.weight, view.baseWeight);
  if (!total) return null;

  switch (view.loadType) {
    case "barbell_total":
    case "smith_total":
    case "plate_per_side":
      return [
        "웜업",
        `1세트 : ${firstSetText(view)} 10~12회`,
        `2세트 : ${warmupStepText(view, total * 0.5)} 6~8회`,
        `3세트 : ${warmupStepText(view, total * 0.7)} 3~5회`,
      ].join("\n");
    case "stack_weight":
      return [
        "웜업",
        `1세트 : ${warmupStepText(view, total * 0.45)} 8~10회`,
        `2세트 : ${warmupStepText(view, total * 0.7)} 4~6회`,
      ].join("\n");
    case "dumbbell_each_hand":
      return [
        "웜업",
        `1세트 : ${warmupStepText(view, total * 0.5)} 8회`,
        `2세트 : ${warmupStepText(view, total * 0.7)} 4~5회`,
      ].join("\n");
    default:
      return null;
  }
}

export function miniWarmupHelperText(exercise) {
  return MINI_WARMUP_HINTS[exercise?.id] || null;
}

export function warmupHintText(profile) {
  if (!profile || profile.loadType === "bodyweight_progression" || profile.isTime) return null;
  return "가벼운 무게 1세트 ×8 추천";
}

export function roundWarmupEntry(profile, entryWeight) {
  const positive = Math.max(0, Number(entryWeight || 0));
  const step = warmupStep(profile);
  if (!step) return roundDisplay(positive);
  return roundDisplay(Math.round(positive / step) * step);
}

export function convertNormalizedToEntry(profile, normalizedLoad) {
  const total = Math.max(0, Number(normalizedLoad || 0));
  const baseWeight = effectiveBaseWeight(profile, profile?.baseWeight);

  switch (profile?.loadType) {
    case "barbell_total":
    case "smith_total":
      return roundWarmupEntry(profile, Math.max(0, (total - baseWeight) / 2));
    case "dumbbell_each_hand":
      return roundWarmupEntry(profile, total / 2);
    case "stack_weight":
      return roundWarmupEntry(profile, total);
    case "plate_per_side":
      return roundWarmupEntry(profile, total / 2);
    default:
      return 0;
  }
}

function warmupStep(profile) {
  if (!profile) return 0;
  if (profile.displayMode === "per_hand") return 1;
  if (profile.displayMode === "stack") return 2.5;
  return 2.5;
}

function firstSetText(profile) {
  if (profile.loadType === "smith_total") return "빈 스미스바";
  if (profile.loadType === "plate_per_side") return "아주 가볍게";
  return "빈바";
}

function warmupStepText(profile, normalizedLoad) {
  const entryWeight = convertNormalizedToEntry(profile, normalizedLoad);
  switch (profile.displayMode) {
    case "per_side_plus_bar": {
      const baseWeight = effectiveBaseWeight(profile, profile.baseWeight);
      const total = normalizeTotalLoad(profile, entryWeight, baseWeight);
      return `한쪽 ${roundDisplay(entryWeight)}kg (총 ${roundDisplay(total)}kg)`;
    }
    case "per_hand":
      return `한 손 ${roundDisplay(entryWeight)}kg`;
    case "stack":
      return `${roundDisplay(entryWeight)}kg`;
    case "per_side": {
      const total = normalizeTotalLoad(profile, entryWeight, profile.baseWeight);
      return `한쪽 ${roundDisplay(entryWeight)}kg (총 ${roundDisplay(total)}kg)`;
    }
    default:
      return `${roundDisplay(entryWeight)}kg`;
  }
}

function roundLoad(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function roundDisplay(value) {
  const rounded = roundLoad(value);
  return Number.isInteger(rounded) ? rounded : rounded.toFixed(1).replace(/\.0$/, "");
}

export function totalFactorFor(profile) {
  return LOAD_TYPE_TOTAL_FACTORS[profile?.loadType] || 0;
}
