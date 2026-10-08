import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAnalysis, courseInputSchema, mergeCourse, type GhFile, type GhPull, type ReviewPayload } from "@review-canvas/shared";
import { courseTemplate, renderBrief } from "./brief.js";

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
    expect(body.review.course.order.length).toBeGreaterThan(10);
    expect(body.state.punched).toEqual({});
  });

  it("serves the published course after publish", async () => {
    const input = courseInputSchema.parse({ ...courseTemplate(analysis), route: "Storage first." });
    store.saveReview(mergeCourse(analysis, input));
    const body = (await app.inject({ method: "GET", url: `/api/reviews/${analysis.id}` })).json<ReviewPayload>();
    expect(body.review.defaultCourse).toBe(false);
    expect(body.review.course.route).toBe("Storage first.");
  });

  it("saves state and never accepts `submitted` from the browser", async () => {
    const state = { punched: { f1: { at: "2026-10-08T12:00:00Z", splitMs: 4000 } }, drafts: [], verdict: "COMMENT", summary: "", submitted: { at: "x", url: "https://evil", event: "APPROVE" } };
    const put = await app.inject({ method: "PUT", url: `/api/reviews/${analysis.id}/state`, payload: state });
    expect(put.statusCode).toBe(200);
    const body = (await app.inject({ method: "GET", url: `/api/reviews/${analysis.id}` })).json<ReviewPayload>();
    expect(body.state.punched.f1?.splitMs).toBe(4000);
    expect(body.state.submitted).toBeNull();
  });

  it("rejects malformed state and unknown or unsafe ids", async () => {
    expect((await app.inject({ method: "PUT", url: `/api/reviews/${analysis.id}/state`, payload: { punched: 1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/reviews/nope" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/reviews/..%2F..%2Fetc" })).statusCode).toBe(400);
  });
});

describe("brief", () => {
  const brief = renderBrief(analysis, "/tmp/course.json");

  it("carries every on-course file id and hunk id the agent may use", () => {
    for (const id of courseTemplate(analysis).order) expect(brief).toContain(`### ${id} `);
    expect(brief).toContain("#### f2.h1");
  });

  it("does not spend the agent's attention on generated diffs", () => {
    expect(brief).toContain("Generated; no notes needed.");
    expect(brief).not.toContain("syncsRetry200.parse(data)");
  });
});
