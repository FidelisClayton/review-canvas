import { describe, expect, it } from "vitest";
import { covered, emptySeen, isReadEnough, mergeRanges, sample, type Range, type Seen } from "./readRule";

/** Look at the stop with `r` visible, then again 300 ms later, as a reader who stops to read. */
function dwell(seen: Seen, r: Range, at: number, far = false) {
  return sample(sample(seen, r, at, far), r, at + 300, far);
}

describe("read rule", () => {
  it("reads a 200 px stop with 100 px seen", () => {
    expect(isReadEnough(dwell(emptySeen(), [0, 100], 0), 200)).toBe(true);
  });

  it("does not read a 3000 px stop with 400 px seen", () => {
    expect(isReadEnough(dwell(emptySeen(), [0, 400], 0), 3000)).toBe(false);
  });

  it("reads a 3000 px stop scrolled through 0-800 then 800-1600 in steps", () => {
    let seen = dwell(emptySeen(), [0, 800], 0);
    expect(isReadEnough(seen, 3000)).toBe(false);
    seen = dwell(seen, [800, 1600], 1000);
    expect(covered(seen.ranges)).toBe(1600);
    expect(isReadEnough(seen, 3000)).toBe(true);
  });

  it("does not read a 3000 px stop seen as 0-800 twice", () => {
    const seen = dwell(dwell(emptySeen(), [0, 800], 0), [0, 800], 1000);
    expect(isReadEnough(seen, 3000)).toBe(false);
  });

  it("does not count overlapping ranges twice", () => {
    expect(mergeRanges([[0, 100], [50, 150], [200, 250]])).toEqual([[0, 150], [200, 250]]);
    expect(covered([[0, 100], [50, 150]])).toBe(150);
  });

  it("does not count a range visible for less than 300 ms", () => {
    const seen = sample(sample(emptySeen(), [0, 200], 0, false), [0, 200], 299, false);
    expect(seen.ranges).toEqual([]);
    expect(isReadEnough(seen, 200)).toBe(false);
  });

  it("counts the part that stayed put when the view grows", () => {
    // 20 px peeks in, then the stop scrolls fully into view: the first 20 px count after 300 ms, the rest after their own 300 ms.
    let seen = sample(emptySeen(), [0, 20], 0, false);
    seen = sample(seen, [0, 200], 100, false);
    seen = sample(seen, [0, 200], 350, false);
    expect(seen.ranges).toEqual([[0, 20]]);
    seen = sample(seen, [0, 200], 450, false);
    expect(seen.ranges).toEqual([[0, 200]]);
  });

  it("does not count a scroll-through that keeps moving", () => {
    let seen = emptySeen();
    for (let i = 0; i < 20; i++) seen = sample(seen, [i * 200, i * 200 + 200], i * 100, false);
    expect(seen.ranges).toEqual([]);
  });

  it("counts nothing while zoomed out", () => {
    expect(dwell(emptySeen(), [0, 200], 0, true).ranges).toEqual([]);
  });
});
