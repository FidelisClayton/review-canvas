import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAnalysis, courseInputSchema, emptyState, knownCleanWorktree, mergeCourse, type BehaviorComparison, type EvidenceIndex, type GhFile, type GhPull, type RevisionFilePayload, type RevisionIndexPayload, type StoredExecution } from "@review-canvas/shared";
import { buildApp } from "./app.js";
import { loadDemo } from "./cli.js";
import { importEvidence } from "./evidence.js";
import { recordExecution } from "./recorder.js";
import { loadState, reviewPath, saveAnalysis, saveReview, saveState } from "./store.js";

const fixture = JSON.parse(readFileSync(resolve("test/fixtures/sync-retries.json"), "utf8")) as {pull: GhPull; files: GhFile[]};
const offline = {readFile: vi.fn(async () => { throw new Error("Synthetic demo must stay offline"); }), readTree: vi.fn(async () => { throw new Error("Synthetic demo must stay offline"); })};
let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "review-canvas-integration-"));
  vi.stubEnv("REVIEW_CANVAS_HOME", join(folder, "store"));
  vi.clearAllMocks();
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(folder, {recursive: true, force: true}); });

describe("recorded evidence across subprocess, immutable store and API", () => {
  it("retains real HTTP, record, event, job, assertion and process differences at two actual clean commits", async () => {
    const cwd = join(folder, "repo"); mkdirSync(cwd);
    const git = (...args: string[]) => execFileSync("git", args, {cwd, encoding: "utf8"}).trim();
    git("init", "-q"); git("config", "user.name", "Synthetic"); git("config", "user.email", "synthetic@example.test");
    git("remote", "add", "origin", "https://github.com/acme/storefront.git");
    const source = readFileSync(resolve("test/scenarios/sync-retries.mjs"), "utf8");
    const manifestPath = join(cwd, "scenario.json");
    writeFileSync(manifestPath, readFileSync(resolve("test/scenarios/sync-retries.manifest.json")));
    writeFileSync(join(cwd, "scenario.mjs"), source.replace('const RETRY_POLICY = "deduplicate"', 'const RETRY_POLICY = "duplicate"'));
    git("add", "."); git("commit", "-qm", "Synthetic duplicate implementation");
    const beforeSha = git("rev-parse", "HEAD");
    const target = {owner: "acme", repo: "storefront", number: 4182};
    const options = {cwd, target, manifestPath, argv: [process.execPath, "scenario.mjs"]};
    const base = await recordExecution({...options, outPath: join(folder, "base.json")});
    writeFileSync(join(cwd, "scenario.mjs"), source);
    git("add", "scenario.mjs"); git("commit", "-qm", "Synthetic deduplicated implementation");
    const afterSha = git("rev-parse", "HEAD");
    const head = await recordExecution({...options, outPath: join(folder, "head.json")});
    expect(beforeSha).toMatch(/^[a-f0-9]{40}$/); expect(afterSha).not.toBe(beforeSha);
    expect(base.provenance.revision).toBe(beforeSha); expect(head.provenance.revision).toBe(afterSha);
    expect(knownCleanWorktree(base.provenance) && knownCleanWorktree(head.provenance)).toBe(true);
    expect(head.inputDigest).toBe(base.inputDigest); expect(head.environmentDigest).toBe(base.environmentDigest);
    expect(git("diff", beforeSha, afterSha, "--", "scenario.json")).toBe("");
    const pull = {...fixture.pull, base: {...fixture.pull.base, sha: beforeSha}, head: {...fixture.pull.head, sha: afterSha}};
    const patch = git("diff", beforeSha, afterSha, "--", "scenario.mjs");
    const analysis = buildAnalysis(pull, [{filename: "scenario.mjs", status: "modified", additions: 1, deletions: 1, patch}], {});
    saveAnalysis(analysis);
    saveReview(mergeCourse(analysis, courseInputSchema.parse({sentence: "Synthetic retry integration", goals: [{title: "Retry", src: "PR", quote: "Queue exactly one retry", stops: ["f1.h1"]}], hunks: {}, links: []})));
    const earlier = {...buildAnalysis({...pull, head: {...pull.head, sha: beforeSha}}, [], {}), createdAt: "2026-10-18T09:00:00.000Z"};
    saveAnalysis(earlier);
    saveReview(mergeCourse(earlier, courseInputSchema.parse({sentence: "Synthetic prior review", goals: [{title: "Retry", src: "PR", quote: "Queue exactly one retry", stops: [], gap: "Earlier snapshot"}], hunks: {}, links: []})));
    saveState(earlier.id, {...emptyState(), reviewed: {retry: "2026-10-18T10:00:00.000Z"}});
    const gitTransport = {
      readTree: vi.fn(async (_target: unknown, revision: string) => ({truncated: false, tree: git("ls-tree", "-r", revision).split("\n").map(line => {
        const [metadata, path] = line.split("\t"); const [mode, type, sha] = metadata!.split(" ");
        return {path: path!, mode: mode!, type: type!, sha: sha!};
      })})),
      readFile: vi.fn(async (_target: unknown, revision: string, path: string) => execFileSync("git", ["show", `${revision}:${path}`], {cwd, encoding: "utf8"})),
    };
    const state = loadState(analysis.id);
    const imported = ["base", "head"].map(name => importEvidence(analysis.id, readFileSync(join(folder, `${name}.json`))));
    const storedPath = reviewPath(analysis.id, `evidence/${head.runId}.json`);
    const storedBytes = readFileSync(storedPath, "utf8");
    expect(importEvidence(analysis.id, readFileSync(join(folder, "head.json")))).toEqual(imported[1]);
    expect(() => importEvidence(analysis.id, {...head, process: {...head.process, stdout: "changed"}})).toThrow(/conflict/i);
    expect(() => importEvidence(analysis.id, {...head, runId: "bad-digest", inputDigest: "0".repeat(64)})).toThrow(/digest/);
    expect(existsSync(reviewPath(analysis.id, "evidence/bad-digest.json"))).toBe(false);
    expect(readdirSync(reviewPath(analysis.id, "evidence"))).toHaveLength(2);
    expect(readFileSync(storedPath, "utf8")).toBe(storedBytes);
    let app = await buildApp({github: gitTransport});
    const url = `/api/reviews/${analysis.id}`;
    try {
      for (const bundle of [base, head]) {
        const detail = (await app.inject(`${url}/evidence/${bundle.runId}`)).json<StoredExecution>();
        expect(detail.bundle).toEqual(bundle); expect(detail.receipt.origin).toBe("imported-file");
        expect(bundle.observations.map(observation => observation.kind)).toEqual(["input", "response", "record", "event", "job", "output", "assertion"]);
        expect(bundle.observations.find(observation => observation.kind === "record")?.value).toMatchObject({before: {attempts: 1, status: "pending"}, after: {attempts: 2, status: "queued"}});
      }
      const comparison = (await app.inject(`${url}/evidence/compare?left=${base.runId}&right=${head.runId}&mode=base-head`)).json<BehaviorComparison>();
      expect(comparison).toMatchObject({comparable: true, reasons: [], leftRevision: beforeSha, rightRevision: afterSha, process: {changed: true, left: {exitCode: 1}, right: {exitCode: 0}}});
      expect(comparison.observations.find(observation => observation.id === "http-response")).toMatchObject({status: "changed", left: {value: {status: 200, body: {queuedJobs: 2}}}, right: {value: {status: 202, body: {queuedJobs: 1}}}});
      expect(comparison.observations.find(observation => observation.id === "queued-jobs")).toMatchObject({status: "changed", left: {value: [{id: "synthetic-job-1", type: "SyncRecord", recordId: "synthetic-record-1"}, {id: "synthetic-job-2", type: "SyncRecord", recordId: "synthetic-record-1"}]}, right: {value: [{id: "synthetic-job-1", type: "SyncRecord", recordId: "synthetic-record-1"}]}});
      expect(comparison.observations.find(observation => observation.id === "retry-assertion")).toMatchObject({left: {value: {outcome: "failed"}}, right: {value: {outcome: "passed"}}});
      const revisions = (await app.inject(`${url}/revisions`)).json<RevisionIndexPayload>();
      expect(revisions).toMatchObject({baseline: {reviewId: earlier.id, reviewedAt: "2026-10-18T10:00:00.000Z"}, comparison: {beforeSha, afterSha, status: "available", files: [{path: "scenario.mjs"}]}});
      expect(revisions.comparison?.files).toHaveLength(1);
      const delta = (await app.inject(`${url}/revisions/file?baseline=${earlier.id}&path=scenario.mjs`)).json<RevisionFilePayload>();
      expect(delta).toMatchObject({beforeSha, afterSha, baselineReviewId: earlier.id, file: {path: "scenario.mjs"}});
      expect(delta.patch).toContain('-const RETRY_POLICY = "duplicate"');
      expect(delta.patch).toContain('+const RETRY_POLICY = "deduplicate"');
      expect(gitTransport.readTree.mock.calls.map(call => call[1])).toEqual([beforeSha, afterSha]);
      expect(gitTransport.readFile.mock.calls.map(call => call[1])).toEqual([beforeSha, afterSha]);
      await app.close(); app = await buildApp({github: gitTransport});
      expect((await app.inject(`${url}/evidence/${head.runId}`)).json<StoredExecution>().bundle).toEqual(head);
      expect((await app.inject(`${url}/evidence`)).json<EvidenceIndex>().runs.map(run => run.freshness).sort()).toEqual(["base", "current"]);
      expect((await app.inject(`${url}/revisions/file?path=scenario.mjs`)).json<RevisionFilePayload>()).toEqual(delta);
      expect(gitTransport.readTree).toHaveBeenCalledTimes(2); expect(gitTransport.readFile).toHaveBeenCalledTimes(2);
      expect(loadState(analysis.id)).toEqual(state);
    } finally { await app.close(); }
  });

  it("reloads the complete synthetic demo, deployment and reviewed source comparison without GitHub", async () => {
    const review = loadDemo(); const id = review.analysis.id;
    expect(id).toBe("storefront-4182-4182def");
    expect(loadState(id)).toEqual(emptyState());
    const app = await buildApp({github: offline});
    try {
      const url = `/api/reviews/${id}`;
      const index = (await app.inject(`${url}/evidence`)).json<EvidenceIndex>();
      expect(index.errors).toEqual([]);
      expect(index.runs.every(run => run.receipt.origin === "synthetic-fixture" && run.scenario.title.includes("Synthetic"))).toBe(true);
      expect(index.runs.map(run => run.freshness)).toEqual(expect.arrayContaining(["current", "base", "unknown"]));
      expect(index.runs.some(run => run.capture.status === "partial" && run.process.exitCode === 1)).toBe(true);
      expect(index.runs.find(run => run.runId === "synthetic-head")?.sourceBindings[0]?.status).toBe("exact-stop");
      const compared = (await app.inject(`${url}/evidence/compare?left=synthetic-base&right=synthetic-head&mode=base-head`)).json<BehaviorComparison>();
      expect(compared.comparable).toBe(true);
      expect(compared.observations.find(observation => observation.kind === "response")?.status).toBe("changed");
      const revisions = (await app.inject(`${url}/revisions`)).json<RevisionIndexPayload>();
      expect(revisions.baseline?.reviewedAt).toBeTruthy(); expect(revisions.comparison?.status).toBe("available");
      const path = revisions.comparison!.files[0]!.path;
      const file = (await app.inject(`${url}/revisions/file?baseline=${revisions.baseline!.reviewId}&path=${encodeURIComponent(path)}`)).json<RevisionFilePayload>();
      expect(file.baselineReviewId).toBe(revisions.baseline!.reviewId); expect(file.patch).toContain("@@"); expect(file.file?.path).toBe(path);
      const deployment = (await app.inject(`${url}/deployment`)).json();
      expect(deployment).toMatchObject({status: "available", historical: false, validation: {valid: true, issues: []}, analysis: {schemaChanges: [{basis: "declared", operation: "expand"}], backfills: [{basis: "observed", processed: 12, remaining: 0}], rollback: [{basis: "inferred", state: "constrained"}]}});
      expect(deployment.analysis.compatibility).toEqual(expect.arrayContaining([expect.objectContaining({claim: "compatible", basis: "observed"}), expect.objectContaining({claim: "not_run", basis: "declared"})]));
      expect(loadState(id)).toEqual(emptyState());
      const state = {...emptyState(), read: {"f1.h1": "2026-10-19T12:30:00.000Z"}, reviewed: {[review.course.goals[0]!.id]: "2026-10-19T12:31:00.000Z"}, drafts: [{id: "synthetic-draft", hunkId: "f2.h1", lineIndex: 6, path: "app/models/order_sync.rb", line: 6, side: "RIGHT" as const, body: "Keep this local draft", createdAt: "2026-10-19T12:32:00.000Z"}], summary: "Keep this summary"};
      saveState(id, state);
      loadDemo();
      expect((await app.inject(`${url}/evidence`)).json<EvidenceIndex>().runs).toEqual(index.runs);
      expect((await app.inject(`${url}/revisions`)).json<RevisionIndexPayload>().comparison?.status).toBe("available");
      expect(loadState(id)).toEqual(state);
    } finally { await app.close(); }
    expect(offline.readFile).not.toHaveBeenCalled(); expect(offline.readTree).not.toHaveBeenCalled();
  });

  it("preserves an existing short-SHA demo and its local state when loading the full-SHA demo", () => {
    const legacy = buildAnalysis({...fixture.pull, head: {...fixture.pull.head, sha: "4182abc"}}, fixture.files, {});
    expect(legacy.id).toBe("storefront-4182-4182abc");
    saveAnalysis(legacy);
    saveReview(mergeCourse(legacy, courseInputSchema.parse(JSON.parse(readFileSync(resolve("test/fixtures/sync-retries.course.json"), "utf8")))));
    const state = {...emptyState(), read: {"f1.h1": "2026-10-18T12:00:00.000Z"}, reviewed: {"failed-syncs-retry-automatically-with-backoff": "2026-10-18T12:01:00.000Z"}, summary: "Existing local draft"};
    saveState(legacy.id, state);
    const reviewBytes = readFileSync(reviewPath(legacy.id, "review.json"), "utf8");
    expect(loadDemo().analysis.id).toBe("storefront-4182-4182def");
    expect(readFileSync(reviewPath(legacy.id, "review.json"), "utf8")).toBe(reviewBytes);
    expect(loadState(legacy.id)).toEqual(state);
  });
});
