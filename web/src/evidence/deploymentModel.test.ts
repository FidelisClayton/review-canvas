import { describe, expect, it } from "vitest";
import { deriveFreshness, summarizeAssertions, validateDeploymentEvidence, type DeploymentAnalysis, type DeploymentPayload, type EvidenceIndex, type EvidenceRunSummary, type SourceRef, type StoredExecution } from "@review-canvas/shared";
import { deploymentRows, deploymentSourceTarget, selectDeploymentItem } from "./deploymentModel";

const sha = "a".repeat(40);
const ref = { runId: "compat-run", observationId: "compat-check" };
const source: SourceRef = { owner: "acme", repo: "shop", revision: sha, path: "db/expand.sql", side: "RIGHT", startLine: 2, endLine: 4 };
function analysis(): DeploymentAnalysis {
  return {
    version: 1, target: { owner: "acme", repo: "shop", number: 12, headSha: sha },
    schemaChanges: [{ id: "expand", title: "Add optional column", operation: "expand", description: "Existing readers retain their columns.", basis: "declared", sourceRefs: [source], evidenceRefs: [] }],
    compatibility: [{ id: "compat", label: "Old app / new schema", appRevision: sha, schemaVersion: "v2", claim: "compatible", basis: "observed", evidenceRefs: [ref] }, { id: "unrun", label: "New app / old schema", appRevision: sha, schemaVersion: "v1", claim: "not_run", basis: "declared", evidenceRefs: [] }],
    backfills: [{ id: "fill", title: "Populate new column", state: "completed", processed: 0, remaining: 0, basis: "observed", sourceRefs: [], evidenceRefs: [{ runId: ref.runId, observationId: "fill-counts" }] }],
    rollback: [{ id: "rollback", description: "Requires retaining the original column", state: "constrained", basis: "inferred", sourceRefs: [source], evidenceRefs: [] }],
  };
}
function stored(): StoredExecution {
  return {
    receipt: { importedAt: "2026-10-19T12:00:00Z", artifactDigest: "f".repeat(64), origin: "imported-file", warnings: [] },
    bundle: {
      version: 1, runId: ref.runId, target: { owner: "acme", repo: "shop", number: 12 }, scenario: { id: "deploy", version: "1", title: "Deployment checks" }, inputs: {}, environment: {}, inputDigest: "1".repeat(64), environmentDigest: "2".repeat(64), goalIds: [], sourceRefs: [source],
      provenance: { producer: { name: "recorder", version: "1" }, origin: "recorded", revision: sha, repository: { owner: "acme", repo: "shop" }, worktree: { before: { dirty: false, fingerprint: "clean" }, after: { dirty: false, fingerprint: "clean" } } },
      process: { argv: ["node", "check.mjs"], cwd: ".", startedAt: "2026-10-19T11:00:00Z", finishedAt: "2026-10-19T11:00:01Z", exitCode: 0, signal: null, termination: "exited", stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false },
      observations: [{ id: ref.observationId, kind: "assertion", sequence: 0, at: "2026-10-19T11:00:00Z", title: "Compatibility", sourceRefs: [], value: { outcome: "passed", actual: "compatible", context: { appRevision: sha, schemaVersion: "v2" } } }, { id: "fill-counts", kind: "record", sequence: 1, at: "2026-10-19T11:00:01Z", title: "Backfill counts", sourceRefs: [], value: { state: "completed", processed: 0, remaining: 0 } }],
      capture: { status: "complete", issues: [], protocolVersion: 1, receivedObservations: 2, storedObservations: 2 },
    },
  };
}
function setup(document = analysis(), run = stored(), historical = false) {
  const { bundle, receipt } = run;
  const summary: EvidenceRunSummary = { runId: bundle.runId, scenario: bundle.scenario, provenance: bundle.provenance, process: bundle.process, capture: bundle.capture, receipt, freshness: deriveFreshness(bundle, document.target), assertions: summarizeAssertions(bundle), goalBindings: [], sourceBindings: [{ ref: source, status: "exact-file" }] };
  const index: EvidenceIndex = { version: 1, runs: [summary], errors: [], previousReviews: [] };
  const payload: DeploymentPayload = { status: "available", analysis: document, validation: validateDeploymentEvidence(document, [run]), historical };
  return { payload, index, rows: deploymentRows(payload, index) };
}

describe("deployment presentation", () => {
  it("keeps observed outcomes, zero backfill counts, inferred constraints and not-run checks distinct", () => {
    const { rows } = setup();
    expect(rows.find(row => row.id === "compat")).toMatchObject({ result: "compatible", basis: "observed", support: "captured", appRevision: sha, schemaVersion: "v2" });
    expect(rows.find(row => row.id === "fill")).toMatchObject({ result: "completed", counts: { processed: 0, remaining: 0 }, support: "captured" });
    expect(rows.find(row => row.id === "rollback")).toMatchObject({ result: "constrained", basis: "inferred", support: "analysis" });
    expect(rows.find(row => row.id === "unrun")).toMatchObject({ result: "not_run", basis: "declared", support: "analysis" });
    expect(rows.find(row => row.id === "expand")).toMatchObject({ basis: "declared", result: "expand" });
  });

  it("labels even a current imported capture as reported and unauthenticated", () => {
    const row = setup().rows.find(row => row.id === "compat")!;
    expect(row.evidence[0]?.qualifications).toContain("Imported file; producer not authenticated");
    expect(row.evidence[0]?.qualifications).toContain("Reported at current review head; revision not authenticated");
  });

  it("uses actual negative-case outcomes rather than passed assertion counts", () => {
    const document = analysis(); document.compatibility[0]!.claim = "incompatible";
    document.rollback[0] = { ...document.rollback[0]!, state: "irreversible", basis: "observed", appRevision: sha, schemaVersion: "v2", evidenceRefs: [ref] };
    const run = stored(); run.bundle.observations[0]!.value = { outcome: "passed", actual: "incompatible", context: { appRevision: sha, schemaVersion: "v2" } };
    expect(setup(document, run).rows.find(row => row.id === "compat")).toMatchObject({ result: "incompatible", support: "captured" });
    run.bundle.observations[0]!.value = { outcome: "passed", actual: "irreversible", context: { appRevision: sha, schemaVersion: "v2" } };
    expect(setup(document, run).rows.find(row => row.id === "rollback")).toMatchObject({ result: "irreversible", support: "captured" });
  });

  it("does not present missing or skipped assertions as substantiated", () => {
    const run = stored(); run.bundle.observations.splice(0, 1);
    const row = setup(analysis(), run).rows.find(row => row.id === "compat")!;
    expect(row.support).toBe("unsupported");
    expect(row.issues.join(" ")).toContain("Observed claim lacks");
    const skipped = stored(); skipped.bundle.observations[0]!.value = { outcome: "skipped", actual: "compatible", context: { appRevision: sha, schemaVersion: "v2" } };
    expect(setup(analysis(), skipped).rows.find(row => row.id === "compat")!.support).toBe("unsupported");
  });

  it("does not substantiate backfill counts from declared inputs or mismatched output", () => {
    const run = stored(); Object.assign(run.bundle.observations[1]!, { kind: "input" });
    expect(setup(analysis(), run).rows.find(row => row.id === "fill")!.support).toBe("unsupported");
    Object.assign(run.bundle.observations[1]!, { kind: "output", value: { state: "completed", processed: 1, remaining: 0 } });
    expect(setup(analysis(), run).rows.find(row => row.id === "fill")!.support).toBe("unsupported");
    Object.assign(run.bundle.observations[1]!, { kind: "assertion", value: { outcome: "passed", actual: { state: "completed", processed: 0, remaining: 0 } } });
    expect(setup(analysis(), run).rows.find(row => row.id === "fill")!.support).toBe("captured");
  });

  it("retains historical, stale, partial, dirty, unknown and server qualifications beside the evidence", () => {
    const run = stored(); run.bundle.provenance.revision = "b".repeat(40); run.bundle.capture.status = "partial";
    const { payload, index } = setup(analysis(), run, true);
    if (payload.status !== "available") throw new Error("Expected analysis");
    payload.validation.qualifications[0]!.reasons.push("retained-server-reason");
    const row = deploymentRows(payload, index).find(row => row.id === "compat")!;
    expect(row.historical).toBe(true);
    expect(row.evidence[0]!.qualifications).toEqual(expect.arrayContaining(["Other revision", "Partial capture", "retained-server-reason"]));
    index.runs[0]!.freshness = "working-tree";
    expect(deploymentRows(payload, index)[1]!.evidence[0]!.qualifications).toContain("Working tree differs from the reported revision");
    index.runs[0]!.freshness = "unknown";
    expect(deploymentRows(payload, index)[1]!.evidence[0]!.qualifications).toContain("Revision provenance unknown");
  });

  it("keeps unknown counts and outcomes explicit and has no rows for absent analysis", () => {
    const document = analysis(); Object.assign(document.backfills[0]!, { basis: "declared", state: "unknown", processed: null, remaining: null, evidenceRefs: [] });
    const { rows, index } = setup(document);
    expect(rows.find(row => row.id === "fill")).toMatchObject({ result: "unknown", counts: { processed: null, remaining: null }, support: "analysis" });
    expect(deploymentRows({ status: "absent" }, index)).toEqual([]);
  });

  it("preserves exact evidence references and selected deployment item across a run visit", () => {
    const { rows } = setup();
    const selected = selectDeploymentItem(rows, "fill");
    expect(rows.find(row => row.id === selected)!.evidence[0]!.ref).toEqual({ runId: ref.runId, observationId: "fill-counts" });
    expect(selectDeploymentItem(rows, selected)).toBe("fill");
    expect(selectDeploymentItem(rows, "removed")).toBe("expand");
    expect(selectDeploymentItem([], selected)).toBeNull();
  });

  it("opens source only through an exact stored bundle source reference", () => {
    const { index } = setup();
    expect(deploymentSourceTarget(source, index)).toEqual({ runId: ref.runId, refIndex: 0 });
    for (const mismatch of [{ revision: "b".repeat(40) }, { side: "LEFT" as const }, { startLine: 1 }, { path: "other.sql" }, { owner: "other" }])
      expect(deploymentSourceTarget({ ...source, ...mismatch }, index)).toBeNull();
    index.runs[0]!.sourceBindings = [];
    expect(deploymentSourceTarget(source, index)).toBeNull();
  });
});
