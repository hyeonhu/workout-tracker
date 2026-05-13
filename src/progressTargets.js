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

export function lastSuccessfulReps(exercise, view) {
  const fallback = lowerBoundReps(exercise, view);
  const last = Array.isArray(view?.successfulReps) ? view.successfulReps.map((value) => Number(value || 0)) : [];
  if (!last.length) return fallback;
  return Array.from({ length: fallback.length }, (_, index) => Number(last[index] || fallback[index] || 0));
}

export function nextSuccessReps(exercise, view) {
  const fallback = lowerBoundReps(exercise, view);
  const stored = Array.isArray(view?.targetReps) ? view.targetReps.map((value) => Number(value || 0)) : [];
  const baseline = baselineReps(exercise, view);
  const derived = deriveNextTargetFromBaseline(baseline, fallback, Number(exercise?.max || 0));

  if (!stored.length) return derived;

  const normalizedStored = Array.from({ length: fallback.length }, (_, index) => Number(stored[index] || fallback[index] || 0));
  if (sameReps(normalizedStored, derived)) return normalizedStored;
  if (sameReps(normalizedStored, fallback) && shouldKeepLowerBoundReset(view, baseline, Number(exercise?.max || 0))) {
    return normalizedStored;
  }
  return derived;
}

export function nextSuccessTotal(exercise, view) {
  return sumReps(nextSuccessReps(exercise, view));
}

export function formatRepSequence(values, unit = "?") {
  if (!Array.isArray(values) || !values.length) return "-";
  return `${values.join(",")}${unit ? unit : ""}`;
}

export function sumReps(values) {
  return (values || []).reduce((acc, value) => acc + Number(value || 0), 0);
}

function baselineReps(exercise, view) {
  const successful = Array.isArray(view?.successfulReps) ? view.successfulReps : [];
  if (successful.length) return lastSuccessfulReps(exercise, view);
  return lastResultReps(exercise, view);
}

function deriveNextTargetFromBaseline(baseline, lowerBound, maxRep) {
  if (!Array.isArray(baseline) || !baseline.length) return lowerBound;
  const next = baseline.map((value, index) => Number(value || lowerBound[index] || 0));
  const candidates = next
    .map((rep, index) => ({ rep, index }))
    .filter((item) => item.rep < maxRep);

  if (!candidates.length) return lowerBound;

  const lowest = Math.min(...candidates.map((item) => item.rep));
  const picked = candidates.find((item) => item.rep === lowest);
  next[picked.index] += 1;
  return next;
}

function sameReps(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((value, index) => Number(value || 0) === Number(right[index] || 0));
}

function shouldKeepLowerBoundReset(view, baseline, maxRep) {
  const hasSuccessful = Array.isArray(view?.successfulReps) && view.successfulReps.length > 0;
  const hasLast = Array.isArray(view?.lastReps) && view.lastReps.length > 0;
  if (!hasSuccessful && !hasLast) return true;
  return Array.isArray(baseline) && baseline.length > 0 && baseline.every((rep) => Number(rep || 0) >= maxRep);
}
