import { ANCHOR_PROFILE_IDS, MUSCLE_GROUPS, profileById } from "./routines.js";

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
        points.push({
          id: `${session.id}-${exercise.id}-${points.length}`,
          date: toDate(exercise.date || session.date),
          label: shortDate(toDate(session.date)),
          weight: Number(exercise.weight || 0),
          totalReps: Number(exercise.totalReps || 0),
          topSet: Math.max(...(exercise.reps || [0]).map((rep) => Number(rep || 0))),
          session: session.routine,
        });
      }
    }
    return { profileId, name: profile?.name || profileId, points };
  });
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
