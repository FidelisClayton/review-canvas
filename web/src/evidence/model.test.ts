import { describe, expect, it } from "vitest";
import type { EvidenceRunSummary, Observation, ResolvedSourceRef, Review } from "@review-canvas/shared";
import { clampStep, currentSourceStop, filterRuns, selectRun } from "./model";

const summaries = [
  { runId: "old", goalBindings: [{ goalId: "retry", status: "bound" }] },
  { runId: "other", goalBindings: [{ goalId: "digest", status: "bound" }] },
  { runId: "unbound", goalBindings: [{ goalId: "retry", status: "unbound" }] },
] as EvidenceRunSummary[];

describe("evidence selection", () => {
  it("filters only explicit bound goals without removing runs from the all-runs view", () => {
    expect(filterRuns(summaries, "retry").map(run => run.runId)).toEqual(["old"]);
    expect(filterRuns(summaries, null)).toEqual(summaries);
    expect(filterRuns(summaries, "missing")).toEqual([]);
  });

  it("retains a visible selection and chooses a visible run after a filter change", () => {
    expect(selectRun(summaries, "other")).toBe("other");
    expect(selectRun(filterRuns(summaries, "retry"), "other")).toBe("old");
    expect(selectRun([], "old")).toBeNull();
  });

  it("clamps playback to actual recorded order, including an empty capture", () => {
    const observations = [{ id: "second-title-first" }, { id: "first-title-second" }] as Observation[];
    expect(observations[clampStep(0, observations.length)]?.id).toBe("second-title-first");
    expect(observations[clampStep(1, observations.length)]?.id).toBe("first-title-second");
    expect(clampStep(-1, 2)).toBe(0);
    expect(clampStep(7, 2)).toBe(1);
    expect(clampStep(0, 0)).toBe(-1);
  });
});

const revision = "a".repeat(40);
const review = {
  analysis: { id: "current", pr: { owner: "acme", repo: "shop", headSha: revision }, files: [{ path: "retry.ts", hunks: [{ id: "h1", lines: [{ oldNo: 4, newNo: 5 }, { oldNo: 5, newNo: 6 }] }] }] },
  course: { goals: [{ id: "retry", stops: [{ hunkId: "h1", from: 1, to: 1 }] }] },
} as Review;
const source: ResolvedSourceRef = {
  status: "exact-stop", ref: { owner: "acme", repo: "shop", revision, path: "retry.ts", side: "RIGHT", startLine: 6, endLine: 6 },
  reviewId: "current", stop: { reviewId: "current", goalId: "retry", hunkId: "h1", stopIndex: 0 },
};

describe("exact source return", () => {
  it("returns the exact stop index of a validated current source association", () => {
    expect(currentSourceStop(source, review)).toEqual({ goalIndex: 0, stopIndex: 0 });
  });

  it("does not jump to reused positional ids in another review or revision", () => {
    expect(currentSourceStop({ ...source, stop: { ...source.stop!, reviewId: "old" } }, review)).toBeNull();
    expect(currentSourceStop({ ...source, ref: { ...source.ref, revision: "b".repeat(40) } }, review)).toBeNull();
    expect(currentSourceStop({ ...source, ref: { ...source.ref, side: "LEFT" } }, review)).toBeNull();
    expect(currentSourceStop({ ...source, status: "exact-file" }, review)).toBeNull();
  });

  it("rejects an unrelated path, goal, or a range outside the selected crop", () => {
    expect(currentSourceStop({ ...source, ref: { ...source.ref, path: "elsewhere.ts" } }, review)).toBeNull();
    expect(currentSourceStop({ ...source, stop: { ...source.stop!, goalId: "other" } }, review)).toBeNull();
    expect(currentSourceStop({ ...source, ref: { ...source.ref, startLine: 5, endLine: 5 } }, review)).toBeNull();
  });
});
