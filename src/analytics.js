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
  const rows = recentWeekKeys(weeks).map((week) => ({ week, label: weekLabel(week), values: [], average: 0 }));
  const byWeek = Object.fromEntries(rows.map((row) => [row.week, row]));
  for (const log of bodyweightLogs || []) {
    const key = weekKey(toDate(log.date || log.createdAt || log.completedAtLocal));
    if (!byWeek[key]) continue;
    byWeek[key].values.push(Number(log.value || log.bodyweight || 0));
  }
  return rows.map((row) => ({
    ...row,
    average: row.values.length ? round(row.values.reduce((acc, value) => acc + value, 0) / row.values.length, 1) : 0,
  }));
}

export function plannedWeeklySetBalance(routines) {
  const muscles = Object.fromEntries(MUSCLE_GROUPS.map((muscle) => [muscle.id, 0]));
  for (const routine of routines) {
    for (const exercise of routine.exercises) {
      const profile = profileById(exercise.profileId);
      for (const [muscleId, factor] of Object.entries(profile.muscleFactors || {})) {
        if (Number(factor) >= 0.5) muscles[muscleId] += exercise.defaultSets;
      }
    }
  }
  return muscles;
}

export function plateauRecommendations(history, bodyweightLogs, weeks = 4) {
  const completedRecent = history.filter((session) => daysAgo(toDate(session.date)) <= weeks * 7);
  const completionRate = Math.min(1, completedRecent.length / (weeks * 4));
  const bw = bodyweightWeeklyAverage(bodyweightLogs, weeks);
  const firstBw = bw.find((row) => row.average > 0)?.average || 0;
  const lastBw = [...bw].reverse().find((row) => row.average > 0)?.average || 0;
  const bodyweightOk = !firstBw || !lastBw || lastBw >= firstBw * 0.995;
  const series = progressionSeries(history);
  const plateaued = series.filter((item) => {
    const recent = item.points.filter((point) => daysAgo(point.date) <= weeks * 7);
    if (recent.length < 2) return false;
    const first = recent[0].metric || recent[0].weight;
    const last = recent[recent.length - 1].metric || recent[recent.length - 1].weight;
    if (!first) return false;
    return Math.abs((last - first) / first) < 0.02;
  });
  const recommendations = [];

  if (plateaued.length >= 3 || (plateaued.length >= 2 && !bodyweightOk)) {
    recommendations.push({
      type: "global",
      title: "전반적인 정체",
      text: "여러 주요 운동이 같이 정체되어 보여요. 세트 추가보다 디로드 또는 식단/회복 점검이 더 적절할 수 있어요.",
    });
    return recommendations;
  }

  if (completionRate >= 0.85 && bodyweightOk) {
    for (const item of plateaued.slice(0, 3)) {
      const profile = profileById(item.profileId);
      const sensitive = profile?.kneeSensitive || profile?.hamstringSensitive;
      recommendations.push({
        type: "local",
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
