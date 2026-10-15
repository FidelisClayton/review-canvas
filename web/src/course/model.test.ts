import { describe, expect, it } from "vitest";
import { buildView, courseInputSchema, emptyState, mergeCourse, stopKey, type ReviewState } from "@review-canvas/shared";
import { fixture } from "../../../shared/src/fixture.test-helper";
import { buildIndex, framesOf, totals } from "./model";

const { analysis } = fixture();
const build = (input: unknown) => {
  const review = mergeCourse(analysis, courseInputSchema.parse(input));
  const idx = buildIndex(review, buildView(review));
  return { review, idx };
};
const goal = (title: string, stops: string[]) => ({ title, src: "PR", quote: "q", stops });
const withRead = (...keys: string[]): ReviewState => ({ ...emptyState(), read: Object.fromEntries(keys.map((k) => [k, "t"])) });

describe("totals", () => {
  it("counts a chunk cited by two goals once", () => {
    const { idx } = build({ goals: [goal("A", ["f2.h2"]), goal("B", ["f2.h2", "f2.h1"])] });
    const t = totals(idx, withRead("f2.h2"));
    expect(t.stopsRead).toBe(1);
    expect(t.stopsTotal).toBe(idx.goals.flatMap((g) => g.stops.map(stopKey)).filter((k, i, a) => a.indexOf(k) === i).length);
  });

  it("leaves an empty unclaimed stop out of the goal count", () => {
    const { review, idx } = build({ goals: [goal("A", ["f2.h2"])], unclaimed: [] });
    const everyChunk = analysis.files.flatMap((f) => f.hunks.map((h) => h.id));
    // Cite everything so nothing is left over for the unclaimed stop.
    const all = build({ goals: [goal("A", everyChunk)] });
    expect(all.idx.goals.at(-1)!.stops).toEqual([]);
    expect(totals(all.idx, emptyState()).goalsTotal).toBe(1);
    expect(review.course.unclaimed.length).toBeGreaterThan(0);
    expect(totals(idx, emptyState()).goalsTotal).toBe(2);
  });

  it("counts a crop as read when its whole chunk is read", () => {
    const { idx } = build({ goals: [goal("A", ["f3.h1@keeps retrying"])] });
    const crop = idx.goals[0]!.stops[0]!;
    expect(crop.name).toBeDefined();
    expect(totals(idx, emptyState()).stopsRead).toBe(0);
    expect(totals(idx, withRead(crop.hunkId)).stopsRead).toBe(1);
    expect(totals(idx, withRead(stopKey(crop))).stopsRead).toBe(1);
  });
});

describe("framesOf", () => {
  it("makes one frame per file, in the order the goal first reaches it", () => {
    const { review, idx } = build({ goals: [goal("A", ["f2.h1", "f4.h1", "f2.h2"])] });
    const frames = framesOf(idx.goals[0]!, buildView(review));
    expect(frames.map((f) => f.fileId)).toEqual(["f2", "f4"]);
    expect(frames[0]!.stops.map((s) => s.si)).toEqual([0, 2]);
    expect(frames[1]!.stops.map((s) => s.si)).toEqual([1]);
  });

  it("returns no frames for a goal with no stops", () => {
    const { review, idx } = build({ goals: [goal("A", ["f2.h1"])] });
    expect(framesOf({ ...idx.goals[0]!, stops: [] }, buildView(review))).toEqual([]);
  });
});
