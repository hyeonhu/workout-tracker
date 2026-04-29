import { ANCHOR_PROFILE_IDS, MUSCLE_GROUPS, profileById } from "./routines.js";

const E1RM_PROFILE_IDS = new Set(["bench_press", "seated_db_shoulder_press", "romanian_deadlift"]);

export function weeklyMuscleVolume(history, weeks = 10) {
  const weekKeys = recentWeekKeys(weeks);
  const rows = weekKeys.map((week) => ({
    week,
    label: weekLabel(week),
    muscles: Object.fromEntries(MUSCLE_GROUPS.map((muscle) => [muscle.id, 0])),
    sessions: 0,
  }));
  const byWeek = Object.fromEntries(rows.map((row) => [row.week, row]));

  for (const session of history) {
    const key = weekKey(toDate(session.date));
    const row = byWeek[key];
    if (!row) continue;
    row.sessions += 1;
    for (const exercise of session.exercises || []) {
      const profileId = normalizeProfileId(exercise);
      const profile = profileById(profileId) || {};
      const factors = exercise.muscleFactors || profile.muscleFactors || {};
      const load = Number(exercise.weight || 0) || (profile.isTime ? 1 : 0);
      const total = Number(exercise.totalReps || 0);
      for (const [muscleId, factor] of Object.entries(factors)) {
        row.muscles[muscleId] += load * total * Number(factor || 0);
      }
    }
  }

  return rows;
}

export function progressionSeries(history, profileIds = ANCHOR_PROFILE_IDS) {
  const sorted = [...history].sort((a, b) => toDate(a.date) - toDate(b.date));
  return profileIds.map((profileId) => {
    const profile = profileById(profileId);
    const points = [];
    for (const session of sorted) {
      const matches = (session.exercises || []).filter((exercise) => normalizeProfileId(exercise) === profileId);
      for (const exercise of matches) {
        const weight = Number(exercise.weight || 0);
        const topSet = Math.max(...(exercise.reps || [0]).map((rep) => Number(rep || 0)));
        const workSets = (exercise.reps || []).length;
        const profile = profileById(profileId);
        const topTarget = profileId === "leg_press" ? 15 : profileId === "lat_pulldown" ? 12 : 12;
        points.push({
          id: `${session.id}-${exercise.id}-${points.length}`,
          date: toDate(exercise.date || session.date),
          label: shortDate(toDate(session.date)),
          weight,
          displayWeight: weight,
          metric: E1RM_PROFILE_IDS.has(profileId) ? estimateE1rm(displayLoad(profileId, weight), topSet) : weight,
          metricLabel: E1RM_PROFILE_IDS.has(profileId) ? "e1RM" : "작업중량",
          totalReps: Number(exercise.totalReps || 0),
          repCompletion: workSets ? Math.round((Number(exercise.totalReps || 0) / (workSets * topTarget)) * 100) : 0,
          workSets,
          topSet,
          session: session.routine,
        });
      }
    }
    return { profileId, name: profile?.name || profileId, points };
  });
}

export function bodyweightWeeklyAverage(bodyweightLogs, weeks = 10) {
  const rows = recentWeekKeys(weeks).map((week) => ({ week, label: weekLabel(week), values: [], morningValues: [], average: 0, confidence: "none" }));
  const byWeek = Object.fromEntries(rows.map((row) => [row.week, row]));
  for (const log of bodyweightLogs || []) {
    const key = weekKey(toDate(log.date || log.createdAt || log.completedAtLocal));
    if (!byWeek[key]) continue;
    const value = Number(log.value || log.bodyweight || 0);
    if (!value) continue;
    byWeek[key].values.push(value);
    if ((log.context || "other") === "morning_fasted") byWeek[key].morningValues.push(value);
  }
  return rows.map((row) => {
    const preferred = row.morningValues.length ? row.morningValues : row.values;
    return {
      ...row,
      average: preferred.length ? round(preferred.reduce((acc, value) => acc + value, 0) / preferred.length, 1) : 0,
      confidence: row.morningValues.length ? "high" : row.values.length ? "fallback" : "none",
    };
  });
}

export function plannedWeeklySetBalance(routines) {
  const muscles = Object.fromEntries(MUSCLE_GROUPS.map((muscle) => [muscle.id, 0]));
  for (const routine of routines) {
    for (const exercise of routine.exercises) {
      const profile = profileById(exercise.profileId);
      for (const muscleId of directMusclesFor(profile.id)) muscles[muscleId] += exercise.defaultSets;
    }
  }
  return muscles;
}

export function weeklyDirectHardSets(history, weeks = 4) {
  const rows = recentWeekKeys(weeks).map((week) => ({
    week,
    label: weekLabel(week),
    muscles: Object.fromEntries(MUSCLE_GROUPS.map((muscle) => [muscle.id, 0])),
  }));
  const byWeek = Object.fromEntries(rows.map((row) => [row.week, row]));
  for (const session of history || []) {
    const row = byWeek[weekKey(toDate(session.date))];
    if (!row) continue;
    for (const exercise of session.exercises || []) {
      const profileId = normalizeProfileId(exercise);
      const setCount = Array.isArray(exercise.sets) ? exercise.sets.length : Array.isArray(exercise.reps) ? exercise.reps.length : 0;
      for (const muscleId of directMusclesFor(profileId)) row.muscles[muscleId] += setCount;
    }
  }
  return rows;
}

export function adherenceRate(history, weeks = 4) {
  const recent = (history || []).filter((session) => daysAgo(toDate(session.date)) <= weeks * 7);
  const completed = recent.filter((session) => {
    const planned = plannedSetsForSession(session.sessionId, session.routine);
    const logged = (session.exercises || []).reduce((acc, exercise) => {
      if (Array.isArray(exercise.sets)) return acc + exercise.sets.length;
      if (Array.isArray(exercise.reps)) return acc + exercise.reps.length;
      return acc;
    }, 0);
    return planned > 0 && logged >= planned * 0.8;
  }).length;
  return Math.min(1, completed / (weeks * 4));
}

export function plateauRecommendations(history, bodyweightLogs, weeks = 4, cooldowns = {}) {
  const completionRate = adherenceRate(history, weeks);
  const bw = bodyweightWeeklyAverage(bodyweightLogs, weeks);
  const firstBw = bw.find((row) => row.average > 0)?.average || 0;
  const lastBw = [...bw].reverse().find((row) => row.average > 0)?.average || 0;
  const bodyweightOk = !firstBw || !lastBw || lastBw >= firstBw * 0.995;
  const bodyweightDropping = firstBw && lastBw && lastBw < firstBw * 0.995;
  const series = progressionSeries(history);
  const plateaued = series.filter((item) => {
    const recent = item.points.filter((point) => daysAgo(point.date) <= weeks * 7);
    if (recent.length < 3) return false;
    const first = recent[0].metric || recent[0].weight;
    const last = recent[recent.length - 1].metric || recent[recent.length - 1].weight;
    if (!first) return false;
    return Math.abs((last - first) / first) < 0.02;
  });
  const recommendations = [];
  const recoveryFlags = recentRecoveryFlags(history, weeks);
  const adequateAdherence = completionRate >= 0.85;

  if (adequateAdherence && plateaued.length >= 2 && (bodyweightDropping || recoveryFlags.length > 0)) {
    const rec = {
      type: "global",
      key: "global_plateau",
      title: "전반적인 정체",
      text: "여러 주요 운동이 같이 정체되어 보여요. 세트 추가보다 디로드 또는 식단/회복 점검이 더 적절할 수 있어요.",
    };
    return isSuppressed(rec.key, cooldowns) ? [] : [rec];
  }

  if (adequateAdherence && bodyweightOk) {
    for (const item of plateaued.slice(0, 3)) {
      const profile = profileById(item.profileId);
      const sensitive = profile?.kneeSensitive || profile?.hamstringSensitive;
      const key = `local_${directMusclesFor(item.profileId)[0] || item.profileId}`;
      if (isSuppressed(key, cooldowns)) continue;
      recommendations.push({
        type: "local",
        key,
        title: `${item.name} 정체`,
        text: sensitive
          ? "민감 부위라 세트 추가보다 같은 중량으로 1주 더 관찰하거나 증량을 보류해보세요."
          : "이 부위 볼륨이 정체 상태예요. 세트 1~2개 추가를 고려할까요?",
      });
    }
  }

  return recommendations;
}

export function complianceSeries(history, weeks = 10) {
  return weeklyMuscleVolume(history, weeks).map((row) => ({
    week: row.week,
    label: row.label,
    sessions: row.sessions,
  }));
}

export function sessionVolume(session) {
  return (session.exercises || []).reduce((acc, exercise) => {
    const profile = profileById(normalizeProfileId(exercise)) || {};
    const load = Number(exercise.weight || 0) || (profile.isTime ? 1 : 0);
    return acc + load * Number(exercise.totalReps || 0);
  }, 0);
}

function normalizeProfileId(exercise) {
  const legacy = {
    shoulder_press: "seated_db_shoulder_press",
    leg_press_a2: "leg_press",
    lat_pulldown_b2: "lat_pulldown",
    leg_curl_b2: "leg_curl",
    lateral_raise_a2: "lateral_raise",
  };
  return exercise.profileId || exercise.groupId || legacy[exercise.id] || exercise.id;
}

export function directMusclesFor(profileId) {
  const map = {
    bench_press: ["chest"],
    incline_db_press: ["chest"],
    incline_bench_press: ["chest"],
    cable_fly: ["chest"],
    lat_pulldown: ["back"],
    neutral_lat_pulldown: ["back"],
    seated_cable_row: ["back"],
    chest_supported_row: ["back"],
    lateral_raise: ["lateral_delts"],
    face_pull: ["rear_delts"],
    leg_press: ["quads"],
    leg_extension: ["quads"],
    romanian_deadlift: ["hamstrings_glutes"],
    hip_thrust: ["hamstrings_glutes"],
    leg_curl: ["hamstrings_glutes"],
    ez_bar_curl: ["biceps"],
    hammer_curl: ["biceps"],
    triceps_pushdown: ["triceps"],
    overhead_triceps_extension: ["triceps"],
    cable_crunch: ["core"],
    reverse_crunch: ["core"],
    plank: ["core"],
  };
  return map[profileId] || [];
}

function plannedSetsForSession(sessionId, routineName) {
  const map = {
    a1: 17,
    b1: 19,
    a2: 16,
    b2: 16,
    A1: 17,
    B1: 19,
    A2: 16,
    B2: 16,
  };
  return map[sessionId] || map[routineName] || 0;
}

function recentRecoveryFlags(history, weeks) {
  return (history || []).filter((session) => daysAgo(toDate(session.date)) <= weeks * 7).flatMap((session) =>
    Object.values(session.recoveryConfirmations || session.kneeConfirmations || {}).filter((item) => item && item.clean === false)
  );
}

function isSuppressed(key, cooldowns) {
  const shownAt = Number(cooldowns?.[key] || 0);
  if (!shownAt) return false;
  return Date.now() - shownAt < 14 * 86400000;
}

export function toDate(value) {
  if (!value) return new Date();
  if (value.toDate) return value.toDate();
  return new Date(value);
}

export function dateKey(value) {
  const date = toDate(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function weekKey(date) {
  const monday = startOfWeek(date);
  return dateKey(monday);
}

function recentWeekKeys(weeks) {
  const current = startOfWeek(new Date());
  return Array.from({ length: weeks }, (_, index) => {
    const date = new Date(current);
    date.setDate(current.getDate() - (weeks - index - 1) * 7);
    return dateKey(date);
  });
}

function startOfWeek(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function weekLabel(key) {
  const date = new Date(`${key}T00:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()} 주`;
}

function shortDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function estimateE1rm(weight, reps) {
  if (!weight || !reps) return 0;
  return round(weight * (1 + Math.min(Number(reps), 12) / 30), 1);
}

function displayLoad(profileId, weight) {
  return profileId === "seated_db_shoulder_press" ? weight * 2 : weight;
}

function round(value, digits = 0) {
  const mod = 10 ** digits;
  return Math.round(Number(value || 0) * mod) / mod;
}

function daysAgo(date) {
  return (Date.now() - date.getTime()) / 86400000;
}
