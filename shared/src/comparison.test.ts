import { describe, expect, it } from "vitest";
import { compareBehavior, selectRevisionBaseline } from "./comparison.js";
import type { ExecutionBundle } from "./evidence.js";
import { fixture } from "./fixture.test-helper.js";
import { draftReview } from "./course.js";
import { emptyState } from "./types.js";

function run(revision = "a".repeat(40)): ExecutionBundle {
  return {
    version: 1, runId: revision[0]!, target: { owner: "acme", repo: "storefront", number: 4182 }, scenario: { id: "retry", version: "1", title: "Retry" },
    inputs: { id: 1 }, environment: { schema: "2" }, inputDigest: "1".repeat(64), environmentDigest: "2".repeat(64), goalIds: [], sourceRefs: [],
    provenance: { producer: { name: "recorder", version: "1" }, origin: "recorded", revision, repository: { owner: "acme", repo: "storefront" }, worktree: { before: { dirty: false, fingerprint: "clean" }, after: { dirty: false, fingerprint: "clean" } } },
    process: { argv: ["node"], cwd: ".", startedAt: "2026-10-19T12:00:00Z", finishedAt: "2026-10-19T12:00:01Z", exitCode: 0, signal: null, termination: "exited", stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false },
    observations: [{ id: "response", sequence: 0, at: "2026-10-19T12:00:00Z", kind: "response", title: "Response", value: { status: 200 }, sourceRefs: [] }, { id: "queued", sequence: 1, at: "2026-10-19T12:00:01Z", kind: "job", title: "Jobs", value: { count: 1 }, sourceRefs: [] }],
    capture: { status: "complete", issues: [], protocolVersion: 1, receivedObservations: 2, storedObservations: 2 },
  };
}

describe("behavior comparison", () => {
  it("aligns authored IDs, records changed values and process outcome without a pass verdict", () => {
    const left = run(); const right = run("b".repeat(40));
    right.observations[0]!.value = { status: 202 }; right.observations[1]!.value = { count: 2 }; right.process.exitCode = 1;
    const comparison = compareBehavior(left, right);
    expect(comparison.comparable).toBe(true);
    expect(comparison.observations.map(item => [item.id, item.status])).toEqual([["response", "changed"], ["queued", "changed"]]);
    expect(comparison.process.changed).toBe(true);
    expect(comparison).not.toHaveProperty("passed");
  });
  it("ignores receipt time, display title, coordinates, and process timing but preserves arrays and IDs", () => {
    const left = run(); const right = run();
    right.observations[0]!.at = "2026-10-19T12:00:01Z"; right.observations[0]!.title = "Renamed";
    right.observations[0]!.sourceRefs = [{ owner: "acme", repo: "storefront", revision: right.provenance.revision!, path: "a.ts", side: "RIGHT", startLine: 30, endLine: 31 }];
    right.process.finishedAt = "2026-10-19T12:01:00Z";
    expect(compareBehavior(left, right).observations.every(item => item.status === "unchanged")).toBe(true);
    left.observations[0]!.value = [1, 2]; right.observations[0]!.value = [2, 1];
    expect(compareBehavior(left, right).observations[0]!.status).toBe("changed");
    right.observations[0]!.id = "other";
    expect(compareBehavior(left, right).observations.map(item => item.status)).toEqual(["removed", "unchanged", "added"]);
  });
  it.each([
    ["inputs", (r: ExecutionBundle) => { r.inputDigest = "3".repeat(64); }],
    ["environment", (r: ExecutionBundle) => { r.environmentDigest = "3".repeat(64); }],
    ["revision", (r: ExecutionBundle) => { r.provenance.revision = null; }],
    ["worktree", (r: ExecutionBundle) => { r.provenance.worktree.before.dirty = true; }],
    ["duplicate", (r: ExecutionBundle) => { r.observations.push(r.observations[0]!); }],
    ["protocol", (r: ExecutionBundle) => { Object.assign(r.capture, { protocolVersion: 2 }); }],
    ["producer", (r: ExecutionBundle) => { r.provenance.producer.version = "2"; }],
    ["capture", (r: ExecutionBundle) => { r.capture.status = "partial"; }],
    ["repository", (r: ExecutionBundle) => { r.target.owner = "other"; }],
  ])("explains incomparable %s", (reason, change) => {
    const right = run(); change(right);
    const comparison = compareBehavior(run(), right);
    expect(comparison.comparable).toBe(false);
    expect(comparison.reasons.join(" ").toLowerCase()).toContain(reason);
  });
  it("requires explicit stored base/head endpoints in base-head mode", () => {
    const left = run(); const right = run("b".repeat(40));
    expect(compareBehavior(left, right, { mode: "base-head", headSha: right.provenance.revision! }).comparable).toBe(false);
    expect(compareBehavior(left, right, { mode: "base-head", baseSha: left.provenance.revision!, headSha: right.provenance.revision! }).comparable).toBe(true);
    expect(compareBehavior(right, left, { mode: "base-head", baseSha: left.provenance.revision!, headSha: right.provenance.revision! }).comparable).toBe(false);
  });
});

describe("since reviewed baseline", () => {
  it("uses full repository/PR and valid marked goal timestamps without moving marks", () => {
    const { analysis } = fixture(); const current = draftReview(analysis); current.course.goals = [{ id: "retry", title: "Retry", src: "PR", quote: "Retry", stops: [] }]; current.analysis.createdAt = "2026-10-19T12:00:00Z";
    const prior = structuredClone(current); prior.analysis.id = "older"; prior.analysis.pr.headSha = "b".repeat(40);
    const state = emptyState(); state.reviewed[prior.course.goals[0]!.id] = "2026-10-19T10:00:00Z";
    state.reviewed.unrelated = "2026-10-19T11:00:00Z";
    const foreign = structuredClone(prior); foreign.analysis.pr.owner = "foreign";
    const sameHead = structuredClone(current);
    const before = JSON.stringify(state);
    const result = selectRevisionBaseline(current, [{ review: prior, state }, { review: foreign, state }, { review: sameHead, state }]);
    expect(result.selected).toMatchObject({ reviewId: "older", reviewedAt: "2026-10-19T10:00:00Z" });
    expect(result.alternatives).toHaveLength(1);
    expect(JSON.stringify(state)).toBe(before);
    state.reviewed[prior.course.goals[0]!.id] = "2026-10-20T10:00:00Z";
    expect(selectRevisionBaseline(current, [{ review: prior, state }]).selected).toBeNull();
    expect(selectRevisionBaseline(current, [{ review: prior, state }], "missing").selected).toBeNull();
  });
});
