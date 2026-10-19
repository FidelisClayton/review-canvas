import { bindEvidenceGoals, compareBehavior, deploymentAnalysisSchema, deriveFreshness, executionBundleSchema, resolveSourceRef, sameRepository, safeIdSchema, selectRevisionBaseline, summarizeAssertions, validateDeploymentEvidence, type DeploymentPayload, type EvidenceIndex, type EvidenceSourcePayload, type ImportReceipt, type Review, type StoredExecution } from "@review-canvas/shared";
import { artifactDigest, atomicSidecar, EvidenceError, listStoredExecutions, loadStoredExecution, MAX_SOURCE_BYTES, parseArtifact, readSidecar, saveStoredExecution } from "./evidenceStore.js";
import { githubReadTransport, type GitHubReadTransport } from "./github.js";
import { listReviews, loadReview, loadState, reviewPath } from "./store.js";

export function requireReview(id: string): Review {
  if (!safeIdSchema.safeParse(id).success) throw new EvidenceError("Invalid review id.");
  const review = loadReview(id); if (!review) throw new EvidenceError("No such review.", 404); return review;
}
export function relatedReviews(review: Review): Review[] {
  return listReviews().map(summary => loadReview(summary.id)).filter((candidate): candidate is Review => candidate !== null && sameRepository(review.analysis.pr, candidate.analysis.pr) && review.analysis.pr.number === candidate.analysis.pr.number);
}
export function importEvidence(id: string, input: unknown, options: {origin?: ImportReceipt["origin"]; now?: Date} = {}): StoredExecution {
  const review = requireReview(id); const raw = parseArtifact(input); const parsed = executionBundleSchema.safeParse(raw);
  if (!parsed.success) throw new EvidenceError(`Invalid execution bundle: ${parsed.error.message}`);
  // Preserve the original validated artifact, including producer extensions, in its immutable envelope.
  const bundle = raw as StoredExecution["bundle"];
  if (!sameRepository(bundle.target, review.analysis.pr) || bundle.target.number !== review.analysis.pr.number) throw new EvidenceError("Evidence target differs from the review repository or PR.");
  if (bundle.inputDigest !== artifactDigest(bundle.inputs) || bundle.environmentDigest !== artifactDigest(bundle.environment)) throw new EvidenceError("Declared input or environment digest mismatch.");
  if (bundle.provenance.repository !== null && !sameRepository(bundle.target, bundle.provenance.repository)) throw new EvidenceError("Provenance repository differs from target.");
  const refs = [...bundle.sourceRefs, ...bundle.observations.flatMap(observation => observation.sourceRefs)];
  if (refs.some(ref => !sameRepository(bundle.target, ref) || ref.revision !== bundle.provenance.revision)) throw new EvidenceError("Source reference must use the run repository and revision.");
  const warnings = bindEvidenceGoals(bundle, review).filter(binding => binding.status === "unbound").map(binding => `Unbound goal: ${binding.goalId}`);
  for (const ref of refs) if (resolveSourceRef(ref, relatedReviews(review)).status === "unavailable") warnings.push(`Unavailable source: ${ref.path}@${ref.revision}`);
  return saveStoredExecution(id, {bundle, receipt: {importedAt: (options.now ?? new Date()).toISOString(), artifactDigest: artifactDigest(bundle), origin: options.origin ?? "imported-file", warnings}});
}
export function getEvidenceRun(id: string, runId: string): StoredExecution {
  const review = requireReview(id); const run = loadStoredExecution(id, runId);
  if (!run) throw new EvidenceError("No such evidence run.", 404);
  if (!sameRepository(run.bundle.target, review.analysis.pr) || run.bundle.target.number !== review.analysis.pr.number) throw new EvidenceError("Stored evidence target differs from review.", 422);
  return run;
}
export function getEvidenceIndex(id: string): EvidenceIndex {
  const review = requireReview(id); const reviews = relatedReviews(review); const {runs, errors} = listStoredExecutions(id);
  return {version: 1, errors, previousReviews: selectRevisionBaseline(review, reviews.map(review => ({review, state: loadState(review.analysis.id)}))).alternatives,
    runs: runs.flatMap(({bundle, receipt}) => {
      if (!sameRepository(bundle.target, review.analysis.pr) || bundle.target.number !== review.analysis.pr.number) { errors.push({runId: bundle.runId, message: "Stored evidence target differs from review."}); return []; }
      const {stdout: _stdout, stderr: _stderr, ...process} = bundle.process;
      return [{runId: bundle.runId, scenario: bundle.scenario, provenance: bundle.provenance, process, capture: bundle.capture, receipt, freshness: deriveFreshness(bundle, review.analysis.pr), goalBindings: bindEvidenceGoals(bundle, review), sourceBindings: bundle.sourceRefs.map(ref => resolveSourceRef(ref, reviews)), assertions: summarizeAssertions(bundle)}];
    })};
}
export function compareEvidence(id: string, left: string, right: string, mode: "runs" | "base-head" = "runs") {
  const review = requireReview(id);
  return compareBehavior(getEvidenceRun(id, left).bundle, getEvidenceRun(id, right).bundle, {mode, baseSha: review.analysis.pr.baseSha, headSha: review.analysis.pr.headSha});
}
export async function getEvidenceSource(id: string, runId: string, observationId: string | undefined, refIndex: number, transport: Pick<GitHubReadTransport, "readFile"> = githubReadTransport): Promise<EvidenceSourcePayload> {
  const review = requireReview(id); const run = getEvidenceRun(id, runId);
  const refs = observationId === undefined ? run.bundle.sourceRefs : run.bundle.observations.find(observation => observation.id === observationId)?.sourceRefs;
  const ref = Number.isInteger(refIndex) && refIndex >= 0 ? refs?.[refIndex] : undefined;
  if (!ref) throw new EvidenceError("No such stored source reference.");
  const resolution = resolveSourceRef(ref, relatedReviews(review));
  if (!sameRepository(run.bundle.target, ref) || ref.revision !== run.bundle.provenance.revision || resolution.status === "unavailable") return {resolution: {...resolution, status: "unavailable", reason: "Source is outside the stored review source references."}, content: null, unavailableReason: "Source is outside the stored review source references."};
  try {
    const content = await transport.readFile(run.bundle.target, ref.revision, ref.path);
    if (Buffer.byteLength(content) > MAX_SOURCE_BYTES) throw new Error("Source exceeds the 1 MiB size limit.");
    if (content.includes("\0")) throw new Error("Binary source is unavailable.");
    return {resolution, content};
  } catch (error) { return {resolution, content: null, unavailableReason: error instanceof Error ? error.message : "Source fetch failed."}; }
}
export function importDeployment(id: string, input: unknown): DeploymentPayload {
  const review = requireReview(id); const parsed = deploymentAnalysisSchema.safeParse(parseArtifact(input));
  if (!parsed.success) throw new EvidenceError(`Invalid deployment analysis: ${parsed.error.message}`);
  const analysis = parsed.data;
  if (!sameRepository(analysis.target, review.analysis.pr) || analysis.target.number !== review.analysis.pr.number) throw new EvidenceError("Deployment target differs from review.");
  const refs = [...analysis.schemaChanges, ...analysis.backfills, ...analysis.rollback].flatMap(item => item.sourceRefs);
  if (refs.some(ref => !sameRepository(ref, analysis.target))) throw new EvidenceError("Deployment source repository differs from target.");
  const validation = validateDeploymentEvidence(analysis, listStoredExecutions(id).runs);
  if (!validation.valid) throw new EvidenceError(`Invalid observed deployment evidence: ${validation.issues.map(issue => `${issue.itemId}: ${issue.reason}`).join("; ")}`);
  atomicSidecar(reviewPath(id, "deployment.json"), analysis);
  return {status: "available", analysis, validation, historical: analysis.target.headSha !== review.analysis.pr.headSha};
}
export function getDeployment(id: string): DeploymentPayload {
  const review = requireReview(id); let raw: unknown;
  try { raw = readSidecar(reviewPath(id, "deployment.json")); } catch { throw new EvidenceError("Invalid deployment sidecar.", 422); }
  if (raw === null) return {status: "absent"};
  const parsed = deploymentAnalysisSchema.safeParse(raw);
  if (!parsed.success || !sameRepository(parsed.data.target, review.analysis.pr) || parsed.data.target.number !== review.analysis.pr.number) throw new EvidenceError("Invalid deployment sidecar.", 422);
  return {status: "available", analysis: parsed.data, validation: validateDeploymentEvidence(parsed.data, listStoredExecutions(id).runs), historical: parsed.data.target.headSha !== review.analysis.pr.headSha};
}
