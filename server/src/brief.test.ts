import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAnalysis, courseInputSchema, onCourse, type GhFile, type GhPull } from "@review-canvas/shared";
import { courseTemplate, renderBrief, TICKET_ID } from "./brief.js";

const { pull, files } = JSON.parse(readFileSync(new URL("../../test/fixtures/sync-retries.json", import.meta.url), "utf8")) as { pull: GhPull; files: GhFile[] };
const analysis = buildAnalysis(pull, files, {});

describe("brief", () => {
  const brief = renderBrief(analysis, "/tmp/course.json");

  it("carries every on-course file id and hunk id the agent may use", () => {
    for (const f of analysis.files.filter(onCourse)) {
      expect(brief).toContain(`### ${f.id} `);
      for (const h of f.hunks) expect(brief).toContain(`#### ${h.id} `);
    }
  });

  it("lists the test names of a test chunk so the agent can crop it", () => {
    expect(brief).toContain('"marks the sync failed on the fifth attempt", "keeps retrying before the limit"');
  });

  it("marks generated output and API clients as not stops, leaves their diffs out, and keeps locale diffs", () => {
    expect(brief).toContain("## Out of bounds, not stops");
    expect(brief).toContain("adminApi.ts");
    expect(brief).not.toContain("syncsRetry200.parse(data)");
    expect(brief).toContain("#### f10.h1");
    expect(brief).toContain("Retry queued");
  });

  it("tells the agent to read the ticket with Linear get_issue, falling back to the PR description", () => {
    expect(brief).toContain("get_issue");
    expect(brief).toContain("use `PR` as `src`");
  });

  it("matches ticket ids case-insensitively", () => {
    expect("user/e-51-title".match(TICKET_ID)?.[0].toUpperCase()).toBe("E-51");
    expect("user/E-51-title".match(TICKET_ID)?.[0].toUpperCase()).toBe("E-51");
    expect(brief).toContain(TICKET_ID.source);
    expect(brief).toContain("`user/e-51-title` holds ticket `E-51`");
  });

  it("carries the cite-only-when-needed rule with a good and a bad example", () => {
    expect(brief).toContain("Cite a chunk on a goal only when the goal's quote needs that change. When unsure, leave it uncited");
    expect(brief).toContain("Changes no goal asked for");
    expect(brief).toContain("- Good:");
    expect(brief).toContain("- Bad:");
  });

  it("orders stops code, boilerplate, tests, and allows single-test crops and gap sentences", () => {
    expect(brief).toContain("the code, then\nboilerplate");
    expect(brief).toContain("then tests");
    expect(brief).toContain("`f3.h1@keeps retrying`");
    expect(brief).toContain("`gap` sentence");
  });

  it("carries the note rules word for word", () => {
    for (const rule of [
      "Every chunk gets a `summary`, tests and trivial chunks included.",
      "imperative, commit-subject style, ≤ 90 chars,\n  backticks around identifiers, no reasoning or \"so that/because\".",
      "The test for every line note: cover the note and read the line. If the line already says it, delete\n  the note.",
      "Never on lines that only open or close structure: `class`, `def`, `do`, `end`, braces,\n  imports, blank lines.",
      "A chunk may carry several line notes when that helps; most chunks carry none.",
      "Imperative, commit-subject style, aim for ≤ 60 chars (the schema allows 200), backticks around\n  identifiers, no reasoning.",
      "At most 3 line notes per chunk; the summary is separate.",
    ]) expect(brief).toContain(rule);
  });

  it("lists the repairs publish makes and says to republish", () => {
    expect(brief).toContain("fix `/tmp/course.json`\nand publish again");
    expect(brief).toContain("no goal asked for");
  });
});

describe("courseTemplate", () => {
  const template = courseTemplate(analysis);

  it("has a summary slot for every on-course chunk, tests included, and none for out-of-bounds chunks", () => {
    for (const f of analysis.files)
      for (const h of f.hunks) expect(Object.hasOwn(template.hunks, h.id)).toBe(onCourse(f));
    expect(template.hunks["f3.h1"]).toBeDefined();
  });

  it("parses with courseInputSchema and starts with no goals", () => {
    expect(courseInputSchema.parse(template).goals).toEqual([]);
  });
});
