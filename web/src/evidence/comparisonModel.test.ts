import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RevisionFile } from "./RevisionComparison";
import { compareBehavior, type EvidenceRunSummary, type ExecutionBundle, type RevisionFilePayload, type RevisionIndexPayload } from "@review-canvas/shared";
import { defaultRunPair, observationValue, revisionAvailability, revisionFileAvailability } from "./comparisonModel";

const base = "a".repeat(40);
const head = "b".repeat(40);
const summary = (runId: string, revision: string | null, scenario = "checkout"): EvidenceRunSummary => ({ runId, provenance: { revision }, scenario: { id: scenario, version: "1" } } as EvidenceRunSummary);

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

function run(runId: string, revision: string, response: number, jobs: number): ExecutionBundle {
  return { runId, target: { owner: "sample", repo: "shop", number: 1 }, scenario: { id: "checkout", version: "1", title: "Checkout" }, inputs: {}, environment: {}, inputDigest: "same", environmentDigest: "same", provenance: { repository: { owner: "sample", repo: "shop" }, revision, origin: "recorded", producer: { name: "recorder", version: "1" }, worktree: { before: { dirty: false, fingerprint: "clean" }, after: { dirty: false, fingerprint: "clean" } } }, capture: { status: "complete", protocolVersion: 1 }, process: { exitCode: 0, termination: "exited", signal: null }, observations: [ { id: "response", kind: "response", title: "Response", value: { status: response } }, { id: "jobs", kind: "job", title: "Jobs", value: { count: jobs } } ] } as ExecutionBundle;
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
    expect(revisionAvailability({ comparison: { status: "unavailable", files: [], unavailableReason: "Tree fetch failed" } } as RevisionIndexPayload)).toBe("Tree fetch failed");
    expect(revisionAvailability({ comparison: { status: "available", files: [] } } as RevisionIndexPayload)).toBeNull();
  });
  it("retains removed and mode-only paths while unavailable source has an explicit reason", () => {
    const removed = { change: { path: "removed.ts", status: "removed" }, file: { hunks: [{ lines: [{ kind: "del", text: "old", oldNo: 1, newNo: null }] }] }, patch: "diff" } as RevisionFilePayload;
    expect(revisionFileAvailability(removed)).toBeNull();
    expect(removed.change.path).toBe("removed.ts");
    expect(revisionFileAvailability({ change: { path: "script", status: "modified" }, file: { hunks: [] }, patch: "" } as RevisionFilePayload)).toBeNull();
    expect(revisionFileAvailability({ change: { path: "binary" }, file: null, patch: null, unavailableReason: "Binary file" } as RevisionFilePayload)).toBe("Binary file");
    expect(revisionFileAvailability({ file: null, patch: null } as RevisionFilePayload)).toBe("Source diff is unavailable for this file.");
  });
});


describe("historical source rendering", () => {
  it("uses shared code rows without current-head comment or read anchors", () => {
    const payload = {
      baselineReviewId: "old-review", target: { owner: "sample", repo: "shop", number: 1 }, beforeSha: base, afterSha: head,
      change: { path: "removed.ts", status: "removed", before: { path: "removed.ts", sha: base, mode: "100644", type: "blob" }, after: null },
      patch: "diff", file: { id: "f1", path: "removed.ts", status: "removed", lang: "ts", hunks: [{ id: "h1", range: "@@ -1 +0,0 @@", section: "", lines: [{ kind: "del", text: "const old = true;", oldNo: 1, newNo: null }] }] },
    } as RevisionFilePayload;
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
    const payload = { beforeSha: base, afterSha: head, change: { path: "script", status: "modified", before: { sha: base, mode: "100644", type: "blob" }, after: { sha: base, mode: "100755", type: "blob" } }, patch: "", file: { hunks: [] } } as RevisionFilePayload;
    const html = renderToStaticMarkup(createElement(RevisionFile, { payload }));
    expect(html).toContain("100644");
    expect(html).toContain("100755");
    expect(html).toContain("No text lines differ");
    const failed = renderToStaticMarkup(createElement(RevisionFile, { payload: { ...payload, patch: null, file: null, unavailableReason: "Exact content fetch failed" } }));
    expect(failed).toContain("Source diff unavailable: Exact content fetch failed");
    expect(failed).not.toContain("No text lines differ");
  });
});
