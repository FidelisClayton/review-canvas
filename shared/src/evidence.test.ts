import { describe, expect, it } from "vitest";
import { bindEvidenceGoals, canonicalJson, deriveFreshness, executionBundleSchema, resolveSourceRef, safeIdSchema, summarizeAssertions } from "./evidence.js";
import { fixture } from "./fixture.test-helper.js";
import { mergeCourse } from "./course.js";
import { courseInputSchema } from "./schemas.js";

const sha = "a".repeat(40);
const run = () => ({
  version: 1 as const, runId: "retry-head", target: { owner: "acme", repo: "storefront", number: 4182 },
  scenario: { id: "retry", version: "1", title: "Retry" }, inputs: { id: 1 }, environment: { schema: "2" },
  inputDigest: "1".repeat(64), environmentDigest: "2".repeat(64), goalIds: ["retry"], sourceRefs: [],
  provenance: { producer: { name: "recorder", version: "1" }, origin: "recorded" as const, revision: sha,
    repository: { owner: "acme", repo: "storefront" }, worktree: { before: { dirty: false, fingerprint: "clean" }, after: { dirty: false, fingerprint: "clean" } } },
  process: { argv: ["node", "retry.js"], cwd: ".", startedAt: "2026-10-19T12:00:00Z", finishedAt: "2026-10-19T12:00:01Z", exitCode: 0, signal: null,
    termination: "exited" as const, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false },
  observations: [{ id: "response", sequence: 0, at: "2026-10-19T12:00:00Z", kind: "response" as const, title: "Response", value: { status: 200 }, sourceRefs: [] }],
  capture: { status: "complete" as const, issues: [], protocolVersion: 1 as const, receivedObservations: 1, storedObservations: 1 },
});

describe("recorded evidence", () => {
  it.each([".github", "_repository", "-repository", ".github-42-abcdef0", "a".repeat(200)])("accepts supported ID %s", id => {
    expect(safeIdSchema.parse(id)).toBe(id);
  });
  it.each(["", ".", "..", "../private", "a/b", "a\\b", "a\0b", "a:b", "a".repeat(201)])("rejects unsafe ID %j", id => {
    expect(safeIdSchema.safeParse(id).success).toBe(false);
  });
  it("sorts object keys recursively while retaining arrays", () => {
    expect(canonicalJson({ z: [2, 1], a: { z: null, a: true } })).toBe('{"a":{"a":true,"z":null},"z":[2,1]}');
  });
  it("validates identity, counts, timestamp ordering and stable IDs", () => {
    expect(executionBundleSchema.safeParse(run()).success).toBe(true);
    const duplicate = run(); duplicate.observations.push(duplicate.observations[0]!);
    expect(executionBundleSchema.safeParse(duplicate).success).toBe(false);
    expect(executionBundleSchema.safeParse({ ...run(), version: 2 }).success).toBe(false);
    expect(executionBundleSchema.safeParse({ ...run(), sourceRefs: [{ owner: "acme", repo: "storefront", revision: sha, path: "../secret", side: "RIGHT", startLine: 1, endLine: 2 }] }).success).toBe(false);
    expect(executionBundleSchema.safeParse({ ...run(), process: { ...run().process, finishedAt: "2026-10-18T00:00:00Z" } }).success).toBe(false);
    expect(executionBundleSchema.safeParse({ ...run(), capture: { ...run().capture, storedObservations: 0 } }).success).toBe(false);
  });
  it("does not call exit zero or partial assertions a passing scenario", () => {
    expect(summarizeAssertions(run())).toEqual({ passed: 0, failed: 0, skipped: 0 });
    const partial = { ...run(), capture: { ...run().capture, status: "partial" as const, issues: ["invalid trace"] } };
    expect(executionBundleSchema.parse(partial).capture.status).toBe("partial");
    expect(deriveFreshness(partial, { ...partial.target, headSha: sha })).toBe("current");
  });
  it("keeps freshness separate from completeness and reports unknown/changed trees", () => {
    const bundle = run(); const pr = { ...bundle.target, headSha: sha, baseSha: "b".repeat(40) };
    expect(deriveFreshness(bundle, pr)).toBe("current");
    expect(deriveFreshness(bundle, { ...pr, headSha: "b".repeat(40), baseSha: sha })).toBe("base");
    expect(deriveFreshness(bundle, { ...pr, headSha: "b".repeat(40), baseSha: undefined })).toBe("other-revision");
    bundle.provenance.worktree.after.fingerprint = "changed";
    expect(deriveFreshness(bundle, pr)).toBe("working-tree");
    expect(deriveFreshness({ ...bundle, provenance: { ...bundle.provenance, revision: null } }, pr)).toBe("unknown");
    expect(deriveFreshness({ ...run(), provenance: { ...run().provenance, repository: null } }, pr)).toBe("unknown");
  });
  it("leaves missing manifest goal associations explicitly unbound", () => {
    const { analysis } = fixture();
    const review = mergeCourse(analysis, courseInputSchema.parse({ goals: [{ title: "Retry", src: "PR", quote: "Retry", stops: ["f3.h1@keeps retrying"] }] }));
    const bundle = run(); bundle.goalIds = ["retry", "missing-goal"];
    expect(bindEvidenceGoals(bundle, review)).toEqual([{ goalId: "retry", status: "bound" }, { goalId: "missing-goal", status: "unbound" }]);
  });
  it("maps only exact-revision lines inside the selected test crop without changing links", () => {
    const { analysis } = fixture();
    const review = mergeCourse(analysis, courseInputSchema.parse({ goals: [{ title: "Retry", src: "PR", quote: "Retry", stops: ["f3.h1@keeps retrying"] }] }));
    const stop = review.course.goals[0]!.stops[0]!;
    const file = analysis.files.find(f => f.id === "f3")!;
    const hunk = file.hunks[0]!;
    const line = hunk.lines[stop.from]!.newNo!;
    const ref = { owner: analysis.pr.owner, repo: analysis.pr.repo, revision: analysis.pr.headSha, path: file.path, side: "RIGHT" as const, startLine: line, endLine: line };
    const links = JSON.stringify([analysis.links, review.agentLinks]);
    expect(resolveSourceRef(ref, [review])).toMatchObject({ status: "exact-stop", stop: { reviewId: analysis.id, goalId: review.course.goals[0]!.id, stopIndex: 0, hunkId: stop.hunkId } });
    expect(resolveSourceRef({ ...ref, startLine: hunk.lines[0]!.newNo!, endLine: hunk.lines[0]!.newNo! }, [review]).status).toBe("exact-file");
    expect(resolveSourceRef({ ...ref, revision: sha }, [review]).status).toBe("unavailable");
    expect(resolveSourceRef({ ...ref, side: "LEFT", revision: sha }, [review]).status).toBe("exact-file");
    expect(JSON.stringify([analysis.links, review.agentLinks])).toBe(links);
  });
});
