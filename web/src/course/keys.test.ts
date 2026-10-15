import { describe, expect, it } from "vitest";
import { keyAction } from "./keys";
import { step } from "./nav";

const none = { drawer: false, review: false, composer: false };
const textarea = { closest: (s: string) => (s.includes("textarea") ? {} : null) };

describe("keyAction", () => {
  it("maps x to toggle reviewed and ] to the next goal", () => {
    expect(keyAction({ key: "x" }, none)).toBe("toggle-reviewed");
    expect(keyAction({ key: "]" }, none)).toBe("next-goal");
    expect(keyAction({ key: "J" }, none)).toBe("next-stop");
  });

  it("maps nothing from a textarea, with modifiers, or for the zoom keys", () => {
    expect(keyAction({ key: "x", target: textarea }, none)).toBeNull();
    expect(keyAction({ key: "x", metaKey: true }, none)).toBeNull();
    expect(keyAction({ key: "+" }, none)).toBeNull();
    expect(keyAction({ key: "0" }, none)).toBeNull();
  });

  it("closes the drawer before the review drawer before the composer", () => {
    expect(keyAction({ key: "Escape" }, { drawer: true, review: true, composer: true })).toBe("close-drawer");
    expect(keyAction({ key: "Escape" }, { drawer: false, review: true, composer: true })).toBe("close-review");
    expect(keyAction({ key: "Escape" }, { drawer: false, review: false, composer: true })).toBe("close-composer");
    expect(keyAction({ key: "Escape" }, none)).toBe("clear-focus");
  });
});

describe("step", () => {
  // Goal 0 has three stops (two code, one test) and a gap; goal 1 has none; goal 2 has one.
  const counts = [3, 0, 1];

  it("goes from the last code stop to the first test, since a gap row is not a stop", () => {
    expect(step(counts, { g: 0, s: 1 }, 1)).toEqual({ pos: { g: 0, s: 2 }, edge: false });
  });

  it("stays at the ends of a goal", () => {
    expect(step(counts, { g: 0, s: 2 }, 1)).toEqual({ pos: { g: 0, s: 2 }, edge: true });
    expect(step(counts, { g: 0, s: 0 }, -1)).toEqual({ pos: { g: 0, s: 0 }, edge: true });
  });

  it("skips from a goal with no stops to its neighbour", () => {
    expect(step(counts, { g: 1, s: 0 }, 1)).toEqual({ pos: { g: 2, s: 0 }, edge: false });
    expect(step(counts, { g: 1, s: 0 }, -1)).toEqual({ pos: { g: 0, s: 2 }, edge: false });
  });

  it("starts goal 1 from the start sheet", () => {
    expect(step(counts, { g: -1, s: 0 }, 1)).toEqual({ pos: { g: 0, s: 0 }, edge: false });
  });
});
