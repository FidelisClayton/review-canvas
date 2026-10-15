import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAnalysis, buildView, draftReview, onCourse, type GhFile, type GhPull, type Link } from "@review-canvas/shared";
import { wordMatcher } from "./StopView";
import { COLLAPSE_OVER, linkGroups } from "./linkGroups";

const { pull, files } = JSON.parse(readFileSync(new URL("../../../test/fixtures/sync-retries.json", import.meta.url), "utf8")) as { pull: GhPull; files: GhFile[] };
const analysis = buildAnalysis(pull, files, {});
const review = draftReview(analysis);
const base = buildView(review);
const withLinks = (extra: Link[]) => buildView({ ...review, agentLinks: extra });
const hunkOf = (re: RegExp) => analysis.files.find((f) => re.test(f.path) && onCourse(f) && f.hunks.length)!.hunks[0]!.id;

describe("linkGroups", () => {
  it("lists the model chunk under Uses of the job chunk and the job chunk under Used by of the model", () => {
    const job = analysis.links.find((l) => l.label.startsWith("calls ") && base.links.includes(l));
    expect(job).toBeDefined();
    expect(linkGroups(base, job!.from).uses.map((e) => e.hunkId)).toContain(job!.to);
    expect(linkGroups(base, job!.to).usedBy.map((e) => e.hunkId)).toContain(job!.from);
  });

  it("puts a link from a test file under Tested by whatever its label", () => {
    const test = hunkOf(/order_sync_test\.rb/);
    const model = analysis.links.find((l) => base.links.includes(l))!.to;
    const g = linkGroups(withLinks([{ id: "x", from: test, to: model, label: "exercises it", symbol: "Thing", source: "agent" }]), model);
    expect(g.tests.map((e) => e.hunkId)).toContain(test);
    expect(g.usedBy.map((e) => e.hunkId)).not.toContain(test);
  });

  it("highlights the symbol and each method of a 'calls a, b' label", () => {
    const [a, b] = analysis.files.filter((f) => f.hunks.length && !/test/.test(f.path)).map((f) => f.hunks[0]!.id);
    const g = linkGroups(withLinks([{ id: "y", from: a!, to: b!, label: "calls retry!, record_failure!", symbol: "Sync::retry!", source: "agent" }]), a!);
    expect(g.uses.at(-1)!.symbols).toEqual(["retry!", "record_failure!"]);
  });

  it("collapses past the limit", () => {
    expect(COLLAPSE_OVER).toBe(3);
  });
});

describe("wordMatcher", () => {
  it("escapes $ and . and matches whole words only", () => {
    const m = wordMatcher(["$el.x", "retry!"])!;
    expect(m.test("a = $el.x + 1")).toBe(true);
    expect(m.test("a = $elzx")).toBe(false);
    expect(m.test("retry!(1)")).toBe(true);
    expect(m.test("xretry!")).toBe(false);
  });
});
