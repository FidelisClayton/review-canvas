import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { draftReview, mergeCourse, onCourse } from "./course.js";
import { fileByPath, fixture } from "./fixture.test-helper.js";
import { courseInputSchema, stateInputSchema } from "./schemas.js";

const { analysis } = fixture();
const hunkOf = (suffix: string, n = 0) => fileByPath(analysis, suffix).hunks[n]!.id;
const merge = (goals: unknown[], extra: object = {}) => mergeCourse(analysis, courseInputSchema.parse({ goals, ...extra }));
const goal = (title: string, stops: string[], extra: object = {}) => ({ title, src: "PR", quote: "q", stops, ...extra });

const fixtureCourse = JSON.parse(readFileSync(fileURLToPath(new URL("../../test/fixtures/sync-retries.course.json", import.meta.url)), "utf8"));

describe("the synthetic fixture course", () => {
  const review = mergeCourse(analysis, courseInputSchema.parse(fixtureCourse));

  it("merges with no warnings", () => {
    expect(review.warnings).toEqual([]);
    expect(review.version).toBe(2);
  });

  it("cites every on-course chunk in a goal or the unclaimed stop", () => {
    const cited = new Set([...review.course.goals.flatMap((g) => g.stops), ...review.course.unclaimed].map((s) => s.hunkId));
    const all = analysis.files.filter(onCourse).flatMap((f) => f.hunks.map((h) => h.id));
    expect(all.filter((id) => !cited.has(id))).toEqual([]);
    expect(review.course.unclaimed.map((s) => s.hunkId)).toEqual(["f19.h1"]);
  });

  it("crops the two-test hunk to the test that keeps retrying", () => {
    const stop = review.course.goals[0]!.stops.find((s) => s.name)!;
    const lines = fileByPath(analysis, "order_sync_test.rb").hunks[0]!.lines.slice(stop.from, stop.to + 1);
    expect(stop).toMatchObject({ hunkId: "f3.h1", name: "keeps retrying before the limit", test: true });
    expect(lines[0]!.text).toContain("keeps retrying before the limit");
    expect(lines.at(-1)!.text.trim()).toBe("end");
    expect(lines.some((l) => l.text.includes("marks the sync failed"))).toBe(false);
  });

  it("keeps a gap goal, a summary on every on-course chunk and the line note", () => {
    expect(review.course.goals.filter((g) => g.gap).map((g) => g.id)).toEqual(["shop-owners-get-a-daily-digest-of-failed-syncs", "admins-can-retry-a-failed-sync-from-the-ui"]);
    for (const f of analysis.files.filter(onCourse)) for (const h of f.hunks) expect(review.course.notes[h.id]?.summary.length).toBeGreaterThan(0);
    expect(review.course.notes["f2.h1"]!.lines).toHaveLength(1);
  });
});

describe("mergeCourse stops", () => {
  it("appends an uncited chunk to unclaimed and names its file", () => {
    const review = merge([goal("A", [hunkOf("order_sync.rb")])]);
    expect(review.course.unclaimed.map((s) => s.hunkId)).toContain(hunkOf("sync_mailer.rb"));
    expect(review.warnings.join("\n")).toMatch(/app\/mailers\/sync_mailer\.rb/);
  });

  it("appends an uncited test chunk too", () => {
    const review = merge([goal("A", [hunkOf("order_sync.rb")])]);
    const test = review.course.unclaimed.find((s) => s.hunkId === hunkOf("order_sync_test.rb"));
    expect(test?.test).toBe(true);
    expect(review.warnings.join("\n")).toMatch(/order_sync_test\.rb/);
  });

  it("does not warn about a chunk the agent listed as unclaimed", () => {
    const all = analysis.files.filter(onCourse).flatMap((f) => f.hunks.map((h) => h.id));
    const summaries = Object.fromEntries(all.map((id) => [id, { summary: "s" }]));
    expect(merge([], { unclaimed: all, hunks: summaries }).warnings).toEqual([]);
  });

  it("warns once per on-course chunk with a missing or blank summary", () => {
    const all = analysis.files.filter(onCourse).flatMap((f) => f.hunks.map((h) => h.id));
    const hunks = Object.fromEntries(all.filter((id) => id !== "f2.h2").map((id) => [id, { summary: id === "f2.h1" ? "   " : "s" }]));
    const w = merge([], { unclaimed: all, hunks }).warnings;
    expect(w.filter((x) => x.startsWith("summary:"))).toEqual([expect.stringMatching(/^summary: f2\.h1 /), expect.stringMatching(/^summary: f2\.h2 /)]);
  });

  it("warns when a goal has an empty quote or src", () => {
    const review = merge([goal("Bare", ["f2.h1"], { quote: "", src: "" })]);
    expect(review.warnings.join("\n")).toMatch(/goals "Bare": empty quote and src/);
  });

  it("leaves a chunk a goal cites off unclaimed, with a warning", () => {
    const id = hunkOf("order_sync.rb");
    const review = merge([goal("A", [id])], { unclaimed: [id] });
    expect(review.course.unclaimed.map((s) => s.hunkId)).not.toContain(id);
    expect(review.warnings.join("\n")).toMatch(new RegExp(`unclaimed: ${id} is cited`));
  });

  it("drops stops in generated and API-client files, and keeps locale files", () => {
    const review = merge([goal("A", [hunkOf("db/schema.rb"), hunkOf("adminApi.ts"), hunkOf("config/locales/en.yml"), "f999.h1"])]);
    expect(review.course.goals[0]!.stops.map((s) => s.hunkId)).toEqual([hunkOf("config/locales/en.yml")]);
    const w = review.warnings.join("\n");
    expect(w).toMatch(/db\/schema\.rb is out of bounds/);
    expect(w).toMatch(/adminApi\.ts is out of bounds/);
    expect(w).toMatch(/unknown hunk id "f999\.h1"/);
  });

  it("falls back to the whole chunk when a crop matches no test, and lists the test names", () => {
    const review = merge([goal("A", ["f3.h1@nope"])]);
    const stop = review.course.goals[0]!.stops[0]!;
    expect(stop).toMatchObject({ hunkId: "f3.h1", from: 0, to: 13 });
    expect(stop.name).toBeUndefined();
    expect(review.warnings.join("\n")).toMatch(/"marks the sync failed on the fifth attempt", "keeps retrying before the limit"/);
  });

  it("falls back to the whole chunk when a crop matches two tests", () => {
    const review = merge([goal("A", ["f3.h1@the"])]);
    expect(review.course.goals[0]!.stops[0]).toMatchObject({ from: 0, to: 13 });
    expect(review.warnings.join("\n")).toMatch(/matches 2 tests/);
  });

  it("moves test stops after code stops, keeping each side's order", () => {
    const review = merge([goal("A", [hunkOf("order_sync_test.rb"), hunkOf("order_sync_job.rb"), hunkOf("order_sync.rb"), hunkOf("order_sync_job_test.rb")])]);
    expect(review.course.goals[0]!.stops.map((s) => s.hunkId)).toEqual([hunkOf("order_sync_job.rb"), hunkOf("order_sync.rb"), hunkOf("order_sync_test.rb"), hunkOf("order_sync_job_test.rb")]);
  });

  it("keeps only the whole citation when a chunk is cited whole and cropped, and drops repeats", () => {
    const review = merge([goal("A", ["f3.h1@keeps retrying", "f3.h1", "f3.h1", "f3.h1@keeps retrying"])]);
    const stops = review.course.goals[0]!.stops;
    expect(stops).toHaveLength(1);
    expect(stops[0]!.name).toBeUndefined();
  });

  it("counts a crop as citing its whole chunk", () => {
    const review = merge([goal("A", ["f3.h1@keeps retrying"])]);
    expect(review.course.unclaimed.map((s) => s.hunkId)).not.toContain("f3.h1");
  });
});

describe("mergeCourse goals", () => {
  it("gives goals with the same title ids x and x-2", () => {
    const review = merge([goal("Retry it!", ["f2.h1"]), goal("Retry it!", ["f2.h2"])]);
    expect(review.course.goals.map((g) => g.id)).toEqual(["retry-it", "retry-it-2"]);
  });

  it("never lets a goal take the unclaimed id", () => {
    expect(merge([goal("Unclaimed", ["f2.h1"])]).course.goals[0]!.id).toBe("unclaimed-2");
  });

  it("keeps a goal with only a gap and drops one with neither stops nor gap", () => {
    const review = merge([goal("Gap only", [], { gap: "Nothing tests it." }), goal("Empty", [])]);
    expect(review.course.goals.map((g) => g.title)).toEqual(["Gap only"]);
    expect(review.course.goals[0]!.gap).toBe("Nothing tests it.");
    expect(review.warnings.join("\n")).toMatch(/goals "Empty": no stops and no gap/);
  });
});

describe("mergeCourse notes", () => {
  const note = (lines: unknown[]) => ({ hunks: { "f2.h1": { summary: "s", lines } } });

  it("drops a RIGHT note that is not a line of its chunk and keeps one that is", () => {
    const review = merge([], note([{ side: "RIGHT", line: 6, text: "ok" }, { side: "RIGHT", line: 99, text: "no" }]));
    expect(review.course.notes["f2.h1"]!.lines.map((l) => l.line)).toEqual([6]);
    expect(review.warnings.join("\n")).toMatch(/RIGHT line 99/);
  });

  it("keeps a LEFT note on a deleted line and drops one on an added line", () => {
    // f2.h1 deletes old line 6; old line 7 is context.
    const review = merge([], note([{ side: "LEFT", line: 6, text: "was errored" }, { side: "LEFT", line: 7, text: "context" }]));
    expect(review.course.notes["f2.h1"]!.lines.map((l) => l.line)).toEqual([6]);
  });

  it("ignores notes for unknown and out-of-bounds hunks", () => {
    const review = merge([], { hunks: { nope: { summary: "x" }, [hunkOf("db/schema.rb")]: { summary: "x" } } });
    expect(review.course.notes).toEqual({});
    expect(review.warnings.filter((w) => w.startsWith("hunks:"))).toHaveLength(2);
  });
});

describe("mergeCourse links", () => {
  it("accepts an agent link only when the symbol appears in both hunks", () => {
    const review = merge([], {
      links: [
        { from: hunkOf("sync_mailer.rb"), to: hunkOf("config/locales/en.yml"), label: "reads", symbol: "subject" },
        { from: hunkOf("sync_mailer.rb"), to: hunkOf("config/locales/en.yml"), label: "invented", symbol: "imaginaryThing" },
      ],
    });
    expect(review.agentLinks.map((l) => l.symbol)).toEqual(["subject"]);
    expect(review.warnings.join("\n")).toMatch(/"imaginaryThing" does not appear in both/);
  });
});

describe("schemas", () => {
  it("rejects four line notes on a chunk and a 91-character summary", () => {
    const line = { side: "RIGHT", line: 1, text: "x" };
    expect(courseInputSchema.safeParse({ hunks: { a: { summary: "s", lines: [line, line, line, line] } } }).success).toBe(false);
    expect(courseInputSchema.safeParse({ hunks: { a: { summary: "x".repeat(91) } } }).success).toBe(false);
    expect(courseInputSchema.safeParse({ hunks: { a: { summary: "x".repeat(90) } } }).success).toBe(true);
  });

  it("rejects malformed state and strips a legacy punched key", () => {
    expect(stateInputSchema.safeParse({ read: 1, drafts: [], verdict: "COMMENT", summary: "" }).success).toBe(false);
    const parsed = stateInputSchema.parse({ punched: { f1: { at: "x", splitMs: null } }, read: {}, reviewed: {}, drafts: [], verdict: "COMMENT", summary: "" });
    expect("punched" in parsed).toBe(false);
  });
});

describe("draftReview", () => {
  it("has no goals and nothing unclaimed", () => {
    const review = draftReview(analysis);
    expect(review.version).toBe(2);
    expect(review.course).toMatchObject({ goals: [], unclaimed: [] });
    expect(review.defaultCourse).toBe(true);
  });
});
