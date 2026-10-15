import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAnalysis, courseInputSchema, mergeCourse, type GhFile, type GhPull, type ReviewPayload } from "@review-canvas/shared";
import { courseTemplate } from "./brief.js";

const { pull, files } = JSON.parse(readFileSync(new URL("../../test/fixtures/sync-retries.json", import.meta.url), "utf8")) as { pull: GhPull; files: GhFile[] };
const analysis = buildAnalysis(pull, files, {});

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
  });

  it("returns 404 with a message for a removed file", async () => {
    const removed = { ...analysis, id: "with-removed", files: analysis.files.map((f, i) => (i === 0 ? { ...f, status: "removed" as const } : f)) };
    store.saveAnalysis(removed);
    const res = await app.inject({ method: "GET", url: `/api/reviews/${removed.id}/files/${removed.files[0]!.id}` });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe("File removed in this PR.");
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
