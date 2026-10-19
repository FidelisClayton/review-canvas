import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAnalysis, canonicalJson, draftReview, type ExecutionBundle, type GhFile, type GhPull } from "@review-canvas/shared";
import { loadReview, loadState, reviewPath, saveAnalysis, saveReview } from "./store.js";
import { compareEvidence, getDeployment, getEvidenceIndex, getEvidenceRun, getEvidenceSource, importDeployment, importEvidence } from "./evidence.js";
import { buildApp } from "./app.js";
const fixture = JSON.parse(readFileSync(new URL("../../test/fixtures/sync-retries.json", import.meta.url), "utf8")) as {pull: GhPull; files: GhFile[]};
const analysis = buildAnalysis(fixture.pull, fixture.files, {});
const digest = (value: ExecutionBundle["inputs"]) => createHash("sha256").update(canonicalJson(value)).digest("hex");
function bundle(): ExecutionBundle {
  const target = { owner: analysis.pr.owner, repo: analysis.pr.repo, number: analysis.pr.number };
  return { version: 1, runId: "run-1", target, scenario: { id: "retry", version: "1", title: "Retry" }, inputs: {}, environment: {}, inputDigest: digest({}), environmentDigest: digest({}), goalIds: ["retry"], sourceRefs: [],
    provenance: { producer: {name: "test", version: "1"}, origin: "recorded", repository: target, revision: analysis.pr.headSha, worktree: { before: {dirty: false, fingerprint: "clean"}, after: {dirty: false, fingerprint: "clean"} } },
    process: {argv: ["node", "scenario.mjs"], cwd: ".", startedAt: "2026-10-19T12:00:00Z", finishedAt: "2026-10-19T12:00:01Z", exitCode: 0, signal: null, termination: "exited", stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false},
    observations: [], capture: {status: "complete", issues: [], protocolVersion: 1, receivedObservations: 0, storedObservations: 0} };
}
let home: string;
let previousHome: string | undefined;
beforeEach(() => { previousHome = process.env.REVIEW_CANVAS_HOME; home = mkdtempSync(join(tmpdir(), "evidence-test-")); process.env.REVIEW_CANVAS_HOME = home; saveAnalysis(analysis); });
afterEach(() => { if (previousHome === undefined) delete process.env.REVIEW_CANVAS_HOME; else process.env.REVIEW_CANVAS_HOME = previousHome; rmSync(home, {recursive: true, force: true}); });

describe("immutable evidence", () => {
  it("imports once with a server receipt, keeps the bundle, and rejects conflicts", () => {
    const run = bundle();
    const stored = importEvidence(analysis.id, JSON.stringify(run));
    expect(stored.bundle).toEqual(run);
    expect(stored.receipt.origin).toBe("imported-file");
    expect(importEvidence(analysis.id, run)).toEqual(stored);
    expect(() => importEvidence(analysis.id, {...run, process: {...run.process, stdout: "changed"}})).toThrow(/conflict/i);
    expect(getEvidenceRun(analysis.id, run.runId)).toEqual(stored);
    expect(getEvidenceIndex(analysis.id).runs[0]).toMatchObject({freshness: "current", assertions: {passed: 0, failed: 0, skipped: 0}, goalBindings: [{goalId: "retry", status: "unbound"}]});
  });
  it("rejects foreign identity, bad declarations, provenance/ref mismatches and oversized JSON before writing", () => {
    const run = bundle();
    for (const invalid of [ {...run, target: {...run.target, owner: "foreign"}}, {...run, target: {...run.target, number: 999}}, {...run, inputDigest: "a".repeat(64)}, {...run, provenance: {...run.provenance, repository: {owner: "foreign", repo: run.target.repo}}}, {...run, sourceRefs: [{...run.target, revision: "b".repeat(40), path: analysis.files[0]!.path, side: "RIGHT", startLine: 1, endLine: 1}]} ]) expect(() => importEvidence(analysis.id, invalid)).toThrow();
    expect(() => importEvidence(analysis.id, " ".repeat(2 * 1024 * 1024 + 1))).toThrow(/limit|large/i);
    expect(getEvidenceIndex(analysis.id).runs).toEqual([]);
  });
  it("retains historical and unknown runs, rebinds goals, and surfaces corruption without hiding the course", () => {
    const run = bundle(); run.provenance.revision = "b".repeat(40); importEvidence(analysis.id, run);
    const unknown = bundle(); unknown.runId = "unknown"; unknown.provenance.revision = null; importEvidence(analysis.id, unknown);
    const review = draftReview(analysis); review.course.goals = [{id: "retry", title: "Retry", src: "PR", quote: "Retry", stops: []}]; saveReview(review);
    expect(getEvidenceIndex(analysis.id).runs.find(r => r.runId === run.runId)).toMatchObject({freshness: "other-revision", goalBindings: [{goalId: "retry", status: "bound"}]});
    expect(getEvidenceIndex(analysis.id).runs.find(r => r.runId === "unknown")?.freshness).toBe("unknown");
    writeFileSync(reviewPath(analysis.id, "evidence/broken.json"), "{");
    expect(getEvidenceIndex(analysis.id).errors).toEqual([{runId: "broken", message: expect.any(String)}]);
    expect(loadReview(analysis.id)?.course.goals).toHaveLength(1);
  });
  it("will not overwrite a colliding legacy id with a different full identity", () => {
    for (const pr of [{...analysis.pr, owner: "other"}, {...analysis.pr, headSha: `${analysis.pr.headSha.slice(0,7)}${"f".repeat(33)}`}, {...analysis.pr, number: analysis.pr.number + 1}]) expect(() => saveAnalysis({...analysis, pr})).toThrow(/identity|collision/i);
    expect(loadReview(analysis.id)?.analysis.pr).toEqual(analysis.pr);
  });
  it("compares only selected stored runs without touching review progress", () => {
    const left = bundle(); left.provenance.revision = "b".repeat(40); importEvidence(analysis.id, left);
    const right = bundle(); right.runId = "right"; right.inputs = {other: true}; right.inputDigest = digest(right.inputs); importEvidence(analysis.id, right);
    const state = loadState(analysis.id);
    expect(compareEvidence(analysis.id, left.runId, right.runId).reasons).toContain("Declared inputs differ");
    expect(compareEvidence(analysis.id, left.runId, right.runId, "base-head").reasons).toContain("Exact stored base/head revisions are unavailable");
    expect(loadState(analysis.id)).toEqual(state);
  });
});

describe("deployment and source boundaries", () => {
  it("keeps absent deployment explicit and validates observed claims before replacing it", () => {
    expect(getDeployment(analysis.id)).toEqual({status: "absent"});
    const document = { version: 1, target: {...bundle().target, headSha: analysis.pr.headSha}, schemaChanges: [], compatibility: [{id: "check", appRevision: analysis.pr.headSha, schemaVersion: "2", label: "Old app", claim: "compatible", basis: "observed", evidenceRefs: [{runId: "run-1", observationId: "assert"}]}], backfills: [], rollback: [] };
    expect(() => importDeployment(analysis.id, document)).toThrow(/evidence|observed/i);
    const run = bundle(); run.observations = [{id: "assert", title: "Check", kind: "assertion", sequence: 0, at: run.process.startedAt, sourceRefs: [], value: {outcome: "passed", actual: "compatible", context: {appRevision: analysis.pr.headSha, schemaVersion: "2"}}}]; run.capture.receivedObservations = run.capture.storedObservations = 1; importEvidence(analysis.id, run);
    expect(importDeployment(analysis.id, document)).toMatchObject({status: "available", validation: {valid: true}, historical: false});
    const historical = {...document, target: {...document.target, headSha: "c".repeat(40)}};
    expect(importDeployment(analysis.id, historical)).toMatchObject({historical: true});
    writeFileSync(reviewPath(analysis.id, "deployment.json"), "{");
    expect(() => getDeployment(analysis.id)).toThrow(/deployment/i);
    expect(loadReview(analysis.id)).not.toBeNull();
  });
  it("fetches only a selected stored source at its exact revision and bounds content", async () => {
    const run = bundle(); run.sourceRefs = [{owner: run.target.owner, repo: run.target.repo, revision: analysis.pr.headSha, path: analysis.files[0]!.path, side: "RIGHT", startLine: 1, endLine: 1}]; importEvidence(analysis.id, run);
    const readFile = vi.fn(async () => "source\n"); const transport = {readFile};
    expect(await getEvidenceSource(analysis.id, run.runId, undefined, 0, transport)).toMatchObject({content: "source\n"});
    expect(readFile).toHaveBeenCalledWith(expect.objectContaining(run.target), analysis.pr.headSha, run.sourceRefs[0]!.path);
    await expect(getEvidenceSource(analysis.id, run.runId, undefined, 1, transport)).rejects.toThrow(/reference/i);
    expect((await getEvidenceSource(analysis.id, run.runId, undefined, 0, {readFile: async () => "x".repeat(1024 * 1024 + 1)})).unavailableReason).toMatch(/large|limit/i);
    const unlisted = bundle(); unlisted.runId = "unlisted"; unlisted.sourceRefs = [{...run.sourceRefs[0]!, path: "secret.txt"}]; importEvidence(analysis.id, unlisted);
    expect((await getEvidenceSource(analysis.id, unlisted.runId, undefined, 0, transport)).content).toBeNull();
    expect(readFile).toHaveBeenCalledTimes(1);
  });
  it("serves literal compare before run lookup and rejects arbitrary source selectors", async () => {
    importEvidence(analysis.id, bundle()); const app = await buildApp();
    try {
      const url = `/api/reviews/${analysis.id}`;
      expect((await app.inject(`${url}/evidence`)).json()).toMatchObject({version: 1, runs: [{runId: "run-1"}]});
      expect((await app.inject(`${url}/evidence/compare?left=run-1&right=run-1`)).json()).toMatchObject({leftRunId: "run-1"});
      expect((await app.inject(`${url}/evidence/run-1/source?ref=-1&sha=main`)).statusCode).toBe(400);
      expect((await app.inject(`${url}/deployment`)).json()).toEqual({status: "absent"});
      expect((await app.inject(`${url}/revisions`)).json()).toMatchObject({baseline: null, comparison: null});
      expect((await app.inject(`${url}/evidence/..%2Fprivate`)).statusCode).toBe(400);
      expect((await app.inject({method: "POST", url: `${url}/evidence`, payload: bundle()})).statusCode).toBe(404);
    } finally { await app.close(); }
  });
});
