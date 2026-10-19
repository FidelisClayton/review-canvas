import { describe, expect, it } from "vitest";
import { deploymentAnalysisSchema, validateDeploymentEvidence } from "./deployment.js";
import type { DeploymentAnalysis } from "./deployment.js";
import { executionBundleSchema } from "./evidence.js";
import type { StoredExecution } from "./evidence.js";

const sha = "a".repeat(40);
const analysis = (): DeploymentAnalysis => ({ version: 1, target: { owner: "acme", repo: "storefront", number: 4182, headSha: sha }, schemaChanges: [], compatibility: [{ id: "new-schema", appRevision: sha, schemaVersion: "2", label: "Old app, new schema", claim: "compatible", basis: "observed", evidenceRefs: [{ runId: "run", observationId: "check" }] }], backfills: [], rollback: [] });
const stored = (): StoredExecution => ({
  receipt: { importedAt: "2026-10-19T13:00:00Z", artifactDigest: "f".repeat(64), origin: "imported-file", warnings: [] },
  bundle: executionBundleSchema.parse({ version: 1, runId: "run", target: { owner: "acme", repo: "storefront", number: 4182 }, scenario: { id: "compat", version: "1", title: "Compatibility" }, inputs: {}, environment: {}, inputDigest: "1".repeat(64), environmentDigest: "2".repeat(64), goalIds: [], sourceRefs: [],
    provenance: { producer: { name: "recorder", version: "1" }, origin: "recorded", revision: sha, repository: { owner: "acme", repo: "storefront" }, worktree: { before: { dirty: false, fingerprint: "clean" }, after: { dirty: false, fingerprint: "clean" } } },
    process: { argv: ["node"], cwd: ".", startedAt: "2026-10-19T12:00:00Z", finishedAt: "2026-10-19T12:00:01Z", exitCode: 0, signal: null, termination: "exited", stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false },
    observations: [{ id: "check", sequence: 0, at: "2026-10-19T12:00:01Z", kind: "assertion", title: "Check", value: { outcome: "passed", actual: "compatible", context: { appRevision: sha, schemaVersion: "2" } }, sourceRefs: [] }], capture: { status: "complete", issues: [], protocolVersion: 1, receivedObservations: 1, storedObservations: 1 } }),
});

describe("deployment evidence", () => {
  it("accepts explicit matching assertions while retaining imported origin qualifications", () => {
    const result = validateDeploymentEvidence(analysis(), [stored()]);
    expect(result.valid).toBe(true);
    expect(result.qualifications).toContainEqual(expect.objectContaining({ itemId: "new-schema", runId: "run", reasons: expect.arrayContaining(["imported-file"]) }));
  });
  it("rejects missing assertions, wrong app/schema pairs, values, and outcomes", () => {
    expect(validateDeploymentEvidence(analysis(), []).valid).toBe(false);
    for (const value of [
      { outcome: "passed", actual: "compatible", context: { appRevision: sha, schemaVersion: "1" } },
      { outcome: "skipped", actual: "compatible", context: { appRevision: sha, schemaVersion: "2" } },
      { outcome: "passed", actual: "incompatible", context: { appRevision: sha, schemaVersion: "2" } },
    ]) {
      const evidence = stored(); Object.assign(evidence.bundle.observations[0]!, { value });
      expect(validateDeploymentEvidence(analysis(), [evidence]).valid).toBe(false);
    }
    const evidence = stored(); Object.assign(evidence.bundle.observations[0]!, { kind: "output", value: "compatible" });
    expect(validateDeploymentEvidence(analysis(), [evidence]).valid).toBe(false);
  });
  it("accepts passed negative-case assertions and rejects skipped assertions", () => {
    const document = analysis(); document.compatibility[0]!.claim = "incompatible";
    const evidence = stored(); Object.assign(evidence.bundle.observations[0]!, { value: { outcome: "passed", actual: "incompatible", context: { appRevision: sha, schemaVersion: "2" } } });
    expect(validateDeploymentEvidence(document, [evidence]).valid).toBe(true);
    Object.assign(evidence.bundle.observations[0]!.value, { outcome: "skipped" });
    expect(validateDeploymentEvidence(document, [evidence]).valid).toBe(false);
  });
  it("does not treat declared input counts as observed backfill completion", () => {
    const document = analysis(); document.compatibility = [];
    document.backfills = [{ id: "fill", title: "Fill", state: "completed", processed: 10, remaining: 0, basis: "observed", evidenceRefs: [{ runId: "run", observationId: "check" }], sourceRefs: [] }];
    const evidence = stored(); Object.assign(evidence.bundle.observations[0]!, { kind: "input", value: { state: "completed", processed: 10, remaining: 0 } });
    expect(validateDeploymentEvidence(document, [evidence]).valid).toBe(false);
    Object.assign(evidence.bundle.observations[0]!, { kind: "assertion", value: { outcome: "passed", actual: { state: "completed", processed: 10, remaining: 0 } } });
    expect(validateDeploymentEvidence(document, [evidence]).valid).toBe(true);
  });
  it("retains declared unknown and not-run claims without deriving results from exit zero", () => {
    const document = analysis(); Object.assign(document.compatibility[0]!, { claim: "not_run", basis: "declared", evidenceRefs: [] });
    expect(deploymentAnalysisSchema.safeParse(document).success).toBe(true);
    expect(validateDeploymentEvidence(document, [stored()]).valid).toBe(true);
    document.compatibility[0]!.claim = "unknown";
    expect(validateDeploymentEvidence(document, []).valid).toBe(true);
  });
  it("requires captured backfill values and an explicit rollback pair", () => {
    const document = analysis(); document.compatibility = [];
    document.backfills = [{ id: "fill", title: "Fill", state: "completed", processed: 10, remaining: 0, basis: "observed", evidenceRefs: [{ runId: "run", observationId: "check" }], sourceRefs: [] }];
    const evidence = stored(); Object.assign(evidence.bundle.observations[0]!, { kind: "record", value: { state: "completed", processed: 10, remaining: 0 } });
    expect(validateDeploymentEvidence(document, [evidence]).valid).toBe(true);
    document.backfills[0]!.remaining = 1;
    expect(validateDeploymentEvidence(document, [evidence]).valid).toBe(false);
    document.backfills = []; document.rollback = [{ id: "rollback", description: "Old app restored", state: "reversible", basis: "observed", evidenceRefs: [{ runId: "run", observationId: "check" }], sourceRefs: [] }];
    expect(deploymentAnalysisSchema.safeParse(document).success).toBe(false);
    Object.assign(document.rollback[0]!, { appRevision: sha, schemaVersion: "2" });
    Object.assign(evidence.bundle.observations[0]!, { kind: "assertion", value: { outcome: "passed", actual: "reversible", context: { appRevision: sha, schemaVersion: "2" } } });
    expect(validateDeploymentEvidence(document, [evidence]).valid).toBe(true);
  });
  it("keeps stale, partial, unknown and synthetic qualifications visible", () => {
    const evidence = stored(); evidence.bundle.capture.status = "partial"; evidence.bundle.provenance.revision = null; evidence.receipt.origin = "synthetic-fixture";
    expect(validateDeploymentEvidence(analysis(), [evidence]).qualifications[0]!.reasons).toEqual(expect.arrayContaining(["partial-capture", "unknown", "synthetic-fixture"]));
  });
});
