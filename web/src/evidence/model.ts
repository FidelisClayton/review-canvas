import type { EvidenceRunSummary, ResolvedSourceRef, Review } from "@review-canvas/shared";

export function filterRuns(runs: EvidenceRunSummary[], goalId: string | null): EvidenceRunSummary[] {
  return goalId === null ? runs : runs.filter(run => run.goalBindings.some(binding => binding.goalId === goalId && binding.status === "bound"));
}

export function selectRun(runs: EvidenceRunSummary[], selected: string | null): string | null {
  return runs.some(run => run.runId === selected) ? selected : runs[0]?.runId ?? null;
}

export function clampStep(index: number, count: number): number {
  return count === 0 ? -1 : Math.max(0, Math.min(count - 1, index));
}

/** Historical source remains read-only even if a positional hunk ID is reused. */
export function currentSourceStop(source: ResolvedSourceRef, review: Review): { goalIndex: number; stopIndex: number } | null {
  const { ref, stop } = source;
  const { pr, id } = review.analysis;
  if (source.status !== "exact-stop" || !stop || source.reviewId !== id || stop.reviewId !== id || ref.owner !== pr.owner || ref.repo !== pr.repo || ref.revision !== pr.headSha || ref.side !== "RIGHT") return null;
  const goalIndex = review.course.goals.findIndex(goal => goal.id === stop.goalId);
  const selected = review.course.goals[goalIndex]?.stops[stop.stopIndex];
  const file = review.analysis.files.find(file => file.path === ref.path);
  const hunk = file?.hunks.find(hunk => hunk.id === stop.hunkId);
  if (!selected || selected.hunkId !== stop.hunkId || !hunk || !hunk.lines.slice(selected.from, selected.to + 1).some(line => line.newNo !== null && line.newNo >= ref.startLine && line.newNo <= ref.endLine)) return null;
  return { goalIndex, stopIndex: stop.stopIndex };
}
