import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RevisionFile } from "./RevisionComparison";
import { compareBehavior, type EvidenceRunSummary, type ExecutionBundle, type PrFile, type RevisionComparison, type RevisionFilePayload, type RevisionIndexPayload } from "@review-canvas/shared";
import { defaultRunPair, observationValue, revisionAvailability, revisionFileAvailability } from "./comparisonModel";

const base = "a".repeat(40);
const head = "b".repeat(40);
const startedAt = "2026-10-19T12:00:00Z";
const observedAt = "2026-10-19T12:00:01Z";
const finishedAt = "2026-10-19T12:00:02Z";
const target = { owner: "sample", repo: "shop", number: 1 };

function summary(runId: string, revision: string | null, scenario = "checkout"): EvidenceRunSummary {
  const bundle = run(runId, revision, 200, 2);
  return {
    runId, scenario: { ...bundle.scenario, id: scenario }, provenance: bundle.provenance,
    process: bundle.process, capture: bundle.capture,
    receipt: { importedAt: finishedAt, artifactDigest: "d".repeat(64), origin: "synthetic-fixture", warnings: [] },
    freshness: "unknown", goalBindings: [], sourceBindings: [], assertions: { passed: 0, failed: 0, skipped: 0 },
  };
}

function revisionIndex(overrides: Partial<RevisionComparison> = {}): RevisionIndexPayload {
  const baseline = { ...target, reviewId: "old-review", headSha: base, createdAt: startedAt, reviewedAt: observedAt };
  return {
    baseline, alternatives: [baseline],
    comparison: { ...target, baselineReviewId: baseline.reviewId, beforeSha: base, afterSha: head, reviewedAt: observedAt, status: "available", files: [], ...overrides },
  };
}

function sourceFile(path: string, overrides: Partial<PrFile> = {}): PrFile {
  return { id: "f1", path, status: "modified", additions: 0, deletions: 0, lang: "ts", layer: "frontend", noise: null, patchMissing: false, hunks: [], ...overrides };
}

function revisionFile(path = "script", overrides: Partial<RevisionFilePayload> = {}): RevisionFilePayload {
  return {
    baselineReviewId: "old-review", target, beforeSha: base, afterSha: head,
    change: { path, status: "modified", before: { path, sha: base, mode: "100644", type: "blob" }, after: { path, sha: base, mode: "100755", type: "blob" } },
    patch: "", file: sourceFile(path), ...overrides,
  };
}

function removedFile(text = "old"): RevisionFilePayload {
  const path = "removed.ts";
  return revisionFile(path, {
    change: { path, status: "removed", before: { path, sha: base, mode: "100644", type: "blob" }, after: null },
    patch: "diff",
    file: sourceFile(path, { status: "removed", deletions: 1, hunks: [{ id: "h1", range: "@@ -1 +0,0 @@", section: "", lines: [{ kind: "del", text, oldNo: 1, newNo: null }] }] }),
  });
}

describe("comparison selection", () => {
  it("defaults only to the exact stored endpoints and prefers matching scenario identities", () => {
    const runs = [summary("wrong", base, "other"), summary("head", head), summary("base", base), summary("historical", "c".repeat(40))];
    expect(defaultRunPair(runs, { baseSha: base, headSha: head })).toEqual({ left: "base", right: "head" });
    expect(defaultRunPair(runs, { headSha: head })).toEqual({ left: "", right: "head" });
    expect(defaultRunPair([summary("old", "c".repeat(40))], { baseSha: base, headSha: head })).toEqual({ left: "", right: "" });
  });
  it("distinguishes a missing observation from captured null or an empty collection", () => {
    expect(observationValue(undefined)).toBe("Not captured in this run.");
    expect(observationValue({ value: null })).toBe("null");
    expect(observationValue({ value: [] })).toBe("[]");
  });
});

function run(runId: string, revision: string | null, response: number, jobs: number): ExecutionBundle {
  return {
    version: 1, runId, target, scenario: { id: "checkout", version: "1", title: "Checkout" },
    inputs: {}, environment: {}, inputDigest: "d".repeat(64), environmentDigest: "e".repeat(64), goalIds: [], sourceRefs: [],
    provenance: { repository: { owner: target.owner, repo: target.repo }, revision, origin: "recorded", producer: { name: "recorder", version: "1" }, worktree: { before: { dirty: false, fingerprint: "clean" }, after: { dirty: false, fingerprint: "clean" } } },
    capture: { status: "complete", issues: [], protocolVersion: 1, receivedObservations: 2, storedObservations: 2 },
    process: { argv: ["node", "scenario.js"], cwd: ".", startedAt, finishedAt, exitCode: 0, termination: "exited", signal: null, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false },
    observations: [
      { id: "response", kind: "response", title: "Response", value: { status: response }, sequence: 0, at: observedAt, sourceRefs: [] },
      { id: "jobs", kind: "job", title: "Jobs", value: { count: jobs }, sequence: 1, at: observedAt, sourceRefs: [] },
    ],
  };
}
describe("captured behavior presentation", () => {
  it("retains changed response and job values aligned by authored id rather than display title", () => {
    const left = run("base", base, 500, 0);
    const right = run("head", head, 200, 2);
    right.observations.reverse();
    right.observations[0]!.title = "Renamed";
    const comparison = compareBehavior(left, right, { mode: "base-head", baseSha: base, headSha: head });
    expect(comparison.comparable).toBe(true);
    expect(comparison.observations.map(item => [item.id, item.status, observationValue(item.left), observationValue(item.right)])).toEqual([
      ["response", "changed", '{\n  "status": 500\n}', '{\n  "status": 200\n}'], ["jobs", "changed", '{\n  "count": 0\n}', '{\n  "count": 2\n}'],
    ]);
    expect(comparison.leftRevision).toBe(base);
    expect(comparison.rightRevision).toBe(head);
  });
  it("keeps values and reasons inspectable for incompatible inputs without turning exit zero into a pass", () => {
    const left = run("base", base, 500, 0);
    const right = run("head", head, 200, 2);
    right.inputs = { different: true };
    const comparison = compareBehavior(left, right);
    expect(comparison.comparable).toBe(false);
    expect(comparison.reasons).toContain("Declared inputs differ");
    expect(observationValue(comparison.observations[0]?.right)).toContain("200");
    expect(comparison.process).toEqual({ changed: false, left: { exitCode: 0, termination: "exited", signal: null }, right: { exitCode: 0, termination: "exited", signal: null } });
  });
});

describe("exact revision availability", () => {
  it("never treats no baseline or failed inventory as an empty successful comparison", () => {
    expect(revisionAvailability({ baseline: null, alternatives: [], comparison: null })).toBe("No earlier reviewed revision is available.");
    expect(revisionAvailability(revisionIndex({ status: "unavailable", unavailableReason: "Tree fetch failed" }))).toBe("Tree fetch failed");
    expect(revisionAvailability(revisionIndex())).toBeNull();
  });
  it("retains removed and mode-only paths while unavailable source has an explicit reason", () => {
    const removed = removedFile();
    expect(revisionFileAvailability(removed)).toBeNull();
    expect(removed.change.path).toBe("removed.ts");
    expect(revisionFileAvailability(revisionFile())).toBeNull();
    expect(revisionFileAvailability(revisionFile("binary", { file: null, patch: null, unavailableReason: "Binary file" }))).toBe("Binary file");
    expect(revisionFileAvailability(revisionFile("script", { file: null, patch: null }))).toBe("Source diff is unavailable for this file.");
  });
});


describe("historical source rendering", () => {
  it("uses shared code rows without current-head comment or read anchors", () => {
    const payload = removedFile("const old = true;");
    const html = renderToStaticMarkup(createElement(RevisionFile, { payload }));
    expect(html).toContain('class="ln del"');
    expect(html).toContain('class="evidence-source-code code"');
    expect(html).toContain('class="codein"');
    expect(html).toContain(base);
    expect(html).toContain(head);
    expect(html).toContain("removed");
    expect(html).not.toContain("data-h=");
    expect(html).not.toContain("data-i=");
    expect(html).not.toContain("data-read");
    expect(html).not.toContain("composer");
    expect(html).not.toContain("<button");
  });
  it("renders source failure as unavailable and mode-only changes as metadata", () => {
    const payload = revisionFile();
    const html = renderToStaticMarkup(createElement(RevisionFile, { payload }));
    expect(html).toContain("100644");
    expect(html).toContain("100755");
    expect(html).toContain("No text lines differ");
    const failed = renderToStaticMarkup(createElement(RevisionFile, { payload: { ...payload, patch: null, file: null, unavailableReason: "Exact content fetch failed" } }));
    expect(failed).toContain("Source diff unavailable: Exact content fetch failed");
    expect(failed).not.toContain("No text lines differ");
  });
});
