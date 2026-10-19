import { canonicalJson, knownCleanWorktree, sameRepository } from "./evidence.js";
import type { ExecutionBundle, ExecutionProvenance, Observation } from "./evidence.js";
import type { PrMeta, Review, ReviewState, PrFile } from "./types.js";

export interface ObservationDifference {
  id: string;
  kind: Observation["kind"];
  status: "added" | "removed" | "changed" | "unchanged";
  left?: Observation;
  right?: Observation;
}

export type ProcessOutcome = Pick<ExecutionBundle["process"], "exitCode" | "signal" | "termination">;

export interface BehaviorComparison {
  leftRunId: string;
  rightRunId: string;
  leftRevision: string | null;
  rightRevision: string | null;
  leftProvenance: ExecutionProvenance;
  rightProvenance: ExecutionProvenance;
  comparable: boolean;
  reasons: string[];
  observations: ObservationDifference[];
  process: {
    left: ProcessOutcome;
    right: ProcessOutcome;
    changed: boolean;
  };
}

export interface BehaviorComparisonOptions {
  mode?: "runs" | "base-head";
  baseSha?: string;
  headSha?: string;
}

export function compareBehavior(left: ExecutionBundle, right: ExecutionBundle, options: BehaviorComparisonOptions = {}): BehaviorComparison {
  const reasons: string[] = [];
  if (!sameRepository(left.target, right.target) || left.target.number !== right.target.number)
    reasons.push("Target repository or PR differs");
  if (left.scenario.id !== right.scenario.id || left.scenario.version !== right.scenario.version)
    reasons.push("Scenario identity or version differs");
  if (left.inputDigest !== right.inputDigest || canonicalJson(left.inputs) !== canonicalJson(right.inputs))
    reasons.push("Declared inputs differ");
  if (left.environmentDigest !== right.environmentDigest || canonicalJson(left.environment) !== canonicalJson(right.environment))
    reasons.push("Declared environment differs");
  if (left.capture.protocolVersion !== right.capture.protocolVersion)
    reasons.push("Capture protocol differs");
  if (left.provenance.producer.name !== right.provenance.producer.name || left.provenance.producer.version !== right.provenance.producer.version)
    reasons.push("Producer identity or version differs");
  for (const [side, run] of [["Left", left], ["Right", right]] as const) {
    if (!run.provenance.revision)
      reasons.push(`${side} revision is unknown`);
    if (!sameRepository(run.target, run.provenance.repository))
      reasons.push(`${side} provenance repository is unknown or differs`);
    if (!knownCleanWorktree(run.provenance))
      reasons.push(`${side} worktree is dirty, changed, or unknown`);
    if (run.capture.status !== "complete")
      reasons.push(`${side} capture is partial`);
    if (new Set(run.observations.map(observation => observation.id)).size !== run.observations.length)
      reasons.push(`${side} duplicate observation IDs`);
  }
  if (options.mode === "base-head") {
    if (!options.baseSha || !options.headSha)
      reasons.push("Exact stored base/head revisions are unavailable");
    else if (left.provenance.revision !== options.baseSha || right.provenance.revision !== options.headSha)
      reasons.push("Selected runs do not match stored base/head revisions");
  }
  const key = (observation: Observation) => `${observation.kind}:${observation.id}`;
  const rightByKey = new Map(right.observations.map(observation => [key(observation), observation]));
  const leftKeys = new Set(left.observations.map(key));
  const observations: ObservationDifference[] = left.observations.map(observation => {
    const other = rightByKey.get(key(observation));
    return {
      id: observation.id,
      kind: observation.kind,
      status: !other ? "removed" : canonicalJson(observation.value) === canonicalJson(other.value) ? "unchanged" : "changed",
      left: observation,
      ...(other ? { right: other } : {}),
    };
  });
  for (const observation of right.observations)
    if (!leftKeys.has(key(observation)))
      observations.push({
        id: observation.id,
        kind: observation.kind,
        status: "added",
        right: observation,
      });
  const outcome = (run: ExecutionBundle): ProcessOutcome => ({
    exitCode: run.process.exitCode,
    signal: run.process.signal,
    termination: run.process.termination,
  });
  const leftProcess = outcome(left);
  const rightProcess = outcome(right);
  return {
    leftRunId: left.runId,
    rightRunId: right.runId,
    leftRevision: left.provenance.revision,
    rightRevision: right.provenance.revision,
    leftProvenance: left.provenance,
    rightProvenance: right.provenance,
    comparable: reasons.length === 0,
    reasons,
    observations,
    process: {
      left: leftProcess,
      right: rightProcess,
      changed: canonicalJson(leftProcess) !== canonicalJson(rightProcess),
    },
  };
}

export interface RevisionReviewSummary {
  reviewId: string;
  owner: string;
  repo: string;
  number: number;
  headSha: string;
  createdAt: string;
  reviewedAt: string | null;
}

export interface RevisionBaselineSelection {
  selected: RevisionReviewSummary | null;
  alternatives: RevisionReviewSummary[];
  unavailableReason?: string;
}

export function summarizeRevisionReview(review: Review, state: ReviewState, before = Infinity): RevisionReviewSummary {
  const goalIds = new Set(review.course.goals.map(goal => goal.id));
  const timestamps = Object.entries(state.reviewed).filter(([id, at]) => goalIds.has(id) && Number.isFinite(Date.parse(at)) && Date.parse(at) <= before).map(([, at]) => at);
  timestamps.sort((a, b) => Date.parse(b) - Date.parse(a));
  const { owner, repo, number, headSha } = review.analysis.pr;
  return {
    reviewId: review.analysis.id,
    owner,
    repo,
    number,
    headSha,
    createdAt: review.analysis.createdAt,
    reviewedAt: timestamps[0] ?? null,
  };
}

export function selectRevisionBaseline(current: Review, candidates: {
  review: Review;
  state: ReviewState;
}[], baselineId?: string): RevisionBaselineSelection {
  const pr = current.analysis.pr;
  const cutoff = Date.parse(current.analysis.createdAt);
  const alternatives = candidates.filter(({ review }) => sameRepository(pr, review.analysis.pr) && pr.number === review.analysis.pr.number && pr.headSha !== review.analysis.pr.headSha)
    .map(({ review, state }) => summarizeRevisionReview(review, state, cutoff))
    .filter(candidate => candidate.reviewedAt !== null)
    .sort((a, b) => Date.parse(b.reviewedAt!) - Date.parse(a.reviewedAt!) || (a.reviewId < b.reviewId ? -1 : a.reviewId > b.reviewId ? 1 : 0));
  const selected = baselineId === undefined ? alternatives[0] ?? null : alternatives.find(candidate => candidate.reviewId === baselineId) ?? null;
  return {
    selected,
    alternatives,
    ...(!selected ? {
      unavailableReason: baselineId ? "Selected baseline is unavailable or ineligible" : "No earlier reviewed revision is available",
    } : {}),
  };
}

export interface RevisionTreeEntry {
  path: string;
  sha: string;
  mode: string;
  type: string;
}

export interface RevisionFileChange {
  path: string;
  status: "added" | "removed" | "modified";
  before: RevisionTreeEntry | null;
  after: RevisionTreeEntry | null;
  unavailableReason?: string;
}

export interface RevisionComparison {
  baselineReviewId: string;
  owner: string;
  repo: string;
  number: number;
  beforeSha: string;
  afterSha: string;
  reviewedAt: string;
  status: "available" | "unavailable";
  files: RevisionFileChange[];
  unavailableReason?: string;
}

export interface RevisionIndexPayload {
  baseline: RevisionReviewSummary | null;
  alternatives: RevisionReviewSummary[];
  comparison: RevisionComparison | null;
  unavailableReason?: string;
}

export interface RevisionFilePayload {
  baselineReviewId: string;
  target: Pick<PrMeta, "owner" | "repo" | "number">;
  beforeSha: string;
  afterSha: string;
  change: RevisionFileChange;
  patch: string | null;
  file: PrFile | null;
  unavailableReason?: string;
}
