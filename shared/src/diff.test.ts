import { describe, expect, it } from "vitest";
import { langOf, parsePatch } from "./diff.js";

describe("parsePatch", () => {
  it("numbers both sides of every hunk", () => {
    const hunks = parsePatch("f1", "@@ -3,3 +3,4 @@ class OrderSync\n   belongs_to :shop\n-  enum :status\n+  enum :status, { failed: 3 }\n+  MAX = 5\n   validates :order_id");
    expect(hunks).toHaveLength(1);
    const [h] = hunks;
    expect(h!.id).toBe("f1.h1");
    expect(h!.range).toBe("@@ -3,3 +3,4 @@");
    expect(h!.section).toBe("class OrderSync");
    expect(h!.lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ["ctx", 3, 3],
      ["del", 4, null],
      ["add", null, 4],
      ["add", null, 5],
      ["ctx", 5, 6],
    ]);
  });

  it("splits several hunks and skips the no-newline marker", () => {
    const hunks = parsePatch("f2", "@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n@@ -10,2 +10,2 @@\n x\n-y\n+z\n");
    expect(hunks.map((h) => h.id)).toEqual(["f2.h1", "f2.h2"]);
    expect(hunks[0]!.lines).toHaveLength(2);
    expect(hunks[1]!.lines.at(-1)).toEqual({ kind: "add", text: "z", oldNo: null, newNo: 11 });
  });
});

describe("langOf", () => {
  it.each([
    ["app/models/case.rb", "rb"],
    ["lib/tasks/workos.rake", "rb"],
    ["app/views/a/b.html.erb", "erb"],
    ["app/frontend/App.tsx", "tsx"],
    ["typespec/cases.tsp", "tsp"],
    ["config/locales/en.yml", "yml"],
    ["README", "text"],
  ])("%s is %s", (path, lang) => expect(langOf(path)).toBe(lang));
});
