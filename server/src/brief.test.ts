import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAnalysis, courseInputSchema, onCourse, type GhFile, type GhPull } from "@review-canvas/shared";
import { courseTemplate, renderBrief } from "./brief.js";

const { pull, files } = JSON.parse(readFileSync(new URL("../../test/fixtures/sync-retries.json", import.meta.url), "utf8")) as { pull: GhPull; files: GhFile[] };
const analysis = buildAnalysis(pull, files, {});

describe("brief", () => {
  const brief = renderBrief(analysis, "/tmp/course.json");

  it("carries every on-course file id and hunk id the agent may use", () => {
    for (const f of analysis.files.filter(onCourse)) expect(brief).toContain(`### ${f.id} `);
    expect(brief).toContain("#### f2.h1");
  });

  it("does not spend the agent's attention on generated diffs", () => {
    expect(brief).toContain("Out of bounds");
    expect(brief).toContain("adminApi.ts");
    expect(brief).not.toContain("syncsRetry200.parse(data)");
  });

  it("hands out a v2 course template", () => {
    expect(courseInputSchema.parse(courseTemplate(analysis)).goals).toEqual([]);
  });
});
