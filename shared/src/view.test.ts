import { describe, expect, it } from "vitest";
import { draftReview, mergeCourse } from "./course.js";
import { fixture } from "./fixture.test-helper.js";
import { courseInputSchema } from "./schemas.js";
import { emptyState } from "./types.js";
import { buildView, isRead, stopKey } from "./view.js";

const { analysis } = fixture();
const input = courseInputSchema.parse({
  goals: [
    { title: "One", src: "PR", quote: "q", stops: ["f2.h2", "f3.h1@keeps retrying"] },
    { title: "Two", src: "PR", quote: "q", stops: ["f2.h2", "f2.h1"] },
  ],
});
const review = mergeCourse(analysis, input);
const view = buildView(review);

describe("buildView", () => {
  it("lists every goal that cites a chunk or a file", () => {
    expect(view.goalsOfHunk.get("f2.h2")).toEqual([0, 1]);
    expect(view.goalsOfHunk.get("f2.h1")).toEqual([1]);
    expect(view.goalsOfHunk.get("f1.h1")).toBeUndefined();
    expect(view.goalsOfFile.get("f2")).toEqual([0, 1]);
    expect(view.goalsOfFile.get("f3")).toEqual([0]);
  });

  it("lists generated files and API clients as out of bounds, and keeps locale files on the course", () => {
    const oob = new Map(view.oob.map((o) => [o.path, o.kind]));
    expect(oob.get("yarn.lock")).toBe("generated");
    expect(oob.get("app/frontend/clients/admin-api/adminApi.ts")).toBe("api");
    expect([...oob.keys()].some((p) => p.endsWith("config/locales/en.yml"))).toBe(false);
  });

  it("drops links that touch an out-of-bounds chunk", () => {
    const ids = new Set(view.oob.map((o) => o.fileId));
    for (const l of view.links) {
      expect(ids.has(view.hunkFile.get(l.from)!.id)).toBe(false);
      expect(ids.has(view.hunkFile.get(l.to)!.id)).toBe(false);
    }
    expect(view.links.length).toBeGreaterThan(0);
  });

  it("indexes a review with no goals", () => {
    expect(buildView(draftReview(analysis)).goalsOfHunk.size).toBe(0);
  });
});

describe("isRead", () => {
  const crop = review.course.goals[0]!.stops.find((s) => s.name)!;
  const whole = review.course.goals[0]!.stops.find((s) => !s.name)!;

  it("keys a crop by hunk and start, a whole chunk by hunk", () => {
    expect(stopKey(crop)).toBe(`f3.h1@${crop.from}`);
    expect(stopKey(whole)).toBe("f2.h2");
  });

  it("treats a crop as read when its whole hunk is read, but not the other way round", () => {
    const state = { ...emptyState(), read: { "f3.h1": "t" } };
    expect(isRead(state, crop)).toBe(true);
    const cropOnly = { ...emptyState(), read: { [stopKey(crop)]: "t" } };
    expect(isRead(cropOnly, crop)).toBe(true);
    expect(isRead(cropOnly, { ...crop, from: 0, to: 13, name: undefined })).toBe(false);
  });
});
