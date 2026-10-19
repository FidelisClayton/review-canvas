import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildAnalysis, courseInputSchema, mergeCourse, type GhFile, type GhPull, type ReviewPayload } from "@review-canvas/shared";
import { courseTemplate } from "./brief.js";

const { pull, files } = JSON.parse(readFileSync(new URL("../../test/fixtures/sync-retries.json", import.meta.url), "utf8")) as { pull: GhPull; files: GhFile[] };
const analysis = buildAnalysis(pull, files, {});

const fetchFileAt = vi.fn(async () => "from gh\n");
vi.mock("./github.js", async (orig) => ({ ...(await orig<typeof import("./github.js")>()), fetchFileAt: (...a: unknown[]) => (fetchFileAt as (...x: unknown[]) => unknown)(...a) }));

let dir: string;
let app: Awaited<ReturnType<typeof import("./app.js").buildApp>>;
let store: typeof import("./store.js");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "review-canvas-"));
  process.env.REVIEW_CANVAS_HOME = dir;
  store = await import("./store.js");
  store.saveAnalysis(analysis);
  app = await (await import("./app.js")).buildApp();
});
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("review API", () => {
  it("serves the default course before an agent publishes", async () => {
    const res = await app.inject({ method: "GET", url: `/api/reviews/${analysis.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json<ReviewPayload>();
    expect(body.review.defaultCourse).toBe(true);
    expect(body.review.version).toBe(2);
    expect(body.review.course.goals).toEqual([]);
    expect(body.state.read).toEqual({});
    expect(body.state.reviewed).toEqual({});
  });

  it("serves the published course after publish", async () => {
    const input = courseInputSchema.parse({ ...courseTemplate(analysis), sentence: "Storage first." });
    store.saveReview(mergeCourse(analysis, input));
    const body = (await app.inject({ method: "GET", url: `/api/reviews/${analysis.id}` })).json<ReviewPayload>();
    expect(body.review.defaultCourse).toBe(false);
    expect(body.review.course.sentence).toBe("Storage first.");
  });

  it("saves state and never accepts `submitted` from the browser", async () => {
    const state = { read: { "f1.h1": "2026-10-08T12:00:00Z" }, reviewed: { "retry-with-backoff": "2026-10-08T12:01:00Z" }, drafts: [], verdict: "COMMENT", summary: "", submitted: { at: "x", url: "https://evil", event: "APPROVE" } };
    const put = await app.inject({ method: "PUT", url: `/api/reviews/${analysis.id}/state`, payload: state });
    expect(put.statusCode).toBe(200);
    const body = (await app.inject({ method: "GET", url: `/api/reviews/${analysis.id}` })).json<ReviewPayload>();
    expect(body.state.read["f1.h1"]).toBe("2026-10-08T12:00:00Z");
    expect(body.state.reviewed["retry-with-backoff"]).toBe("2026-10-08T12:01:00Z");
    expect(body.state.submitted).toBeNull();
  });

  it("rejects malformed state and unknown or unsafe ids", async () => {
    expect((await app.inject({ method: "PUT", url: `/api/reviews/${analysis.id}/state`, payload: { read: 1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/reviews/nope" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/reviews/..%2F..%2Fetc" })).statusCode).toBe(400);
  });

  it("opens a review published in the old file-based format as outdated", async () => {
    const old = { ...analysis, id: "old-format" };
    store.saveAnalysis(old);
    writeFileSync(store.reviewPath(old.id, "review.json"), JSON.stringify({ analysis: old, course: { order: [] }, publishedAt: "2026-10-01T00:00:00Z" }));
    const body = (await app.inject({ method: "GET", url: `/api/reviews/${old.id}` })).json<ReviewPayload>();
    expect(body.review.outdated).toBe(true);
    expect(body.review.course.goals).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/api/reviews" })).statusCode).toBe(200);
  });

  it("loads a legacy state.json with `punched` as unread", async () => {
    const legacy = { ...analysis, id: "legacy-state" };
    store.saveAnalysis(legacy);
    writeFileSync(store.reviewPath(legacy.id, "state.json"), JSON.stringify({ punched: { f1: "2026-10-01T00:00:00Z" }, drafts: [], verdict: "COMMENT", summary: "", submitted: null }));
    const { state } = (await app.inject({ method: "GET", url: `/api/reviews/${legacy.id}` })).json<ReviewPayload>();
    expect(state).toEqual({ read: {}, reviewed: {}, drafts: [], verdict: "COMMENT", summary: "", submitted: null });
  });
});

describe("head files", () => {
  const url = (fileId: string) => `/api/reviews/${analysis.id}/files/${fileId}`;

  it("returns 404 for a file that is not in the PR", async () => {
    const res = await app.inject({ method: "GET", url: url("nope") });
    expect(res.statusCode).toBe(404);
    expect(fetchFileAt).not.toHaveBeenCalled();
  });

  it("returns 404 with a message for a removed file", async () => {
    const removed = { ...analysis, id: "with-removed", files: analysis.files.map((f, i) => (i === 0 ? { ...f, status: "removed" as const } : f)) };
    store.saveAnalysis(removed);
    const res = await app.inject({ method: "GET", url: `/api/reviews/${removed.id}/files/${removed.files[0]!.id}` });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe("File removed in this PR.");
    expect(fetchFileAt).not.toHaveBeenCalled();
  });

  it("serves a cached file without calling gh", async () => {
    const file = analysis.files[0]!;
    mkdirSync(join(store.reviewPath(analysis.id, "heads")), { recursive: true });
    writeFileSync(store.reviewPath(analysis.id, `heads/${file.id}.txt`), "line one\nline two\n");
    const res = await app.inject({ method: "GET", url: url(file.id) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ path: file.path, lines: ["line one", "line two"] });
  });
});

describe("revision API boundaries", () => {
  it("uses selected exact endpoints through the injected transport and does not change state", async () => {
    const {draftReview, emptyState} = await import("@review-canvas/shared");
    const {buildApp} = await import("./app.js");
    const beforeSha = "b".repeat(40); const afterSha = "c".repeat(40);
    const current = {...analysis, id: "api-current", createdAt: "2026-10-19T12:00:00Z", pr: {...analysis.pr, headSha: afterSha}};
    const old = {...analysis, id: "api-baseline", createdAt: "2026-10-19T09:00:00Z", pr: {...analysis.pr, headSha: beforeSha}};
    store.saveAnalysis(current); store.saveAnalysis(old);
    const review = draftReview(old); review.course.goals = [{id: "done", title: "Done", src: "PR", quote: "Done", stops: []}]; store.saveReview(review);
    store.saveState(old.id, {...emptyState(), reviewed: {done: "2026-10-19T10:00:00Z"}});
    const readFile = vi.fn(async (_ref: unknown, sha: string) => sha === beforeSha ? "before\n" : "after\n");
    const readTree = vi.fn(async (_ref: unknown, sha: string) => ({truncated: false, tree: [{path: "app/code.ts", sha, mode: "100644", type: "blob"}]}));
    const local = await buildApp({github: {readFile, readTree}});
    const state = store.loadState(current.id); const url = `/api/reviews/${current.id}/revisions`;
    try {
      expect((await local.inject(url)).json()).toMatchObject({baseline: {reviewId: old.id}, comparison: {beforeSha, afterSha, status: "available", files: [{path: "app/code.ts"}]}});
      expect((await local.inject(`${url}/file?baseline=${old.id}&path=app%2Fcode.ts`)).json()).toMatchObject({beforeSha, afterSha, file: {path: "app/code.ts"}});
      expect(readFile.mock.calls.map(call => call[1])).toEqual([beforeSha, afterSha]);
      expect((await local.inject(`${url}/file?baseline=${old.id}&path=..%2Fprivate`)).statusCode).toBe(400);
      expect((await local.inject(`${url}/file?baseline=${old.id}&path=private`)).statusCode).toBe(404);
      expect((await local.inject(`${url}/file?baseline=foreign&path=app%2Fcode.ts`)).statusCode).toBe(422);
      expect((await local.inject(`${url}?baseline=..%2Fprivate`)).statusCode).toBe(400);
      expect(readFile).toHaveBeenCalledTimes(2); expect(store.loadState(current.id)).toEqual(state);
    } finally {await local.close();}
  });
});
