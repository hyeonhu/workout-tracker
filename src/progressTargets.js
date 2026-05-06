export function lowerBoundReps(exercise, view) {
  const sets = Number(view?.currentSets || exercise?.defaultSets || 0);
  return Array.from({ length: sets }, () => Number(exercise?.min || 0));
}

export function lastResultReps(exercise, view) {
  const fallback = lowerBoundReps(exercise, view);
  const last = Array.isArray(view?.lastReps) ? view.lastReps.map((value) => Number(value || 0)) : [];
  if (!last.length) return fallback;
  return Array.from({ length: fallback.length }, (_, index) => Number(last[index] || fallback[index] || 0));
}

export function nextSuccessReps(exercise, view) {
  const last = lastResultReps(exercise, view);
  if (!last.length) return [];
  const next = [...last];
  next[0] = Number(next[0] || 0) + 1;
  return next;
}

export function nextSuccessTotal(exercise, view) {
  return sumReps(lastResultReps(exercise, view)) + 1;
}

export function formatRepSequence(values, unit = "회") {
  if (!Array.isArray(values) || !values.length) return "-";
  return `${values.join(",")}${unit ? unit : ""}`;
}

export function sumReps(values) {
  return (values || []).reduce((acc, value) => acc + Number(value || 0), 0);
}
