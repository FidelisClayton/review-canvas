import { describe, expect, it } from "vitest";
import { cropTests, testStarts } from "./crop.js";
import type { Hunk } from "./types.js";

// "+text" is an added line, "-text" a deleted one, " text" context.
const hunk = (...rows: string[]): Hunk => {
  let n = 0;
  return {
    id: "f1.h1",
    range: "",
    section: "",
    lines: rows.map((r) => {
      const kind = r[0] === "+" ? "add" : r[0] === "-" ? "del" : "ctx";
      return { kind, text: r.slice(1), oldNo: kind === "add" ? null : n, newNo: kind === "del" ? null : ++n };
    }),
  };
};

describe("testStarts", () => {
  it("finds Minitest, def test_, RSpec and Jest tests", () => {
    const h = hunk(
      '+  test "marks it failed" do',
      "+  end",
      "+  def test_retries",
      "+  end",
      '+  it "retries" do',
      "+  end",
      "+  it('is quiet', () => {",
      '+  specify "x" do',
      '+  scenario "signs in" do',
      '+  it.each([1, 2])("handles %s", (n) => {',
      '+  test.each`a|b`("adds $a", () => {',
    );
    expect(testStarts(h).map((t) => t.name)).toEqual(["marks it failed", "test_retries", "retries", "is quiet", "x", "signs in", "handles %s", "adds $a"]);
  });

  it("finds a test whose name line is context, and ignores deleted tests", () => {
    const h = hunk(' test "old name" do', '-test "gone" do', "+  assert true");
    expect(testStarts(h).map((t) => t.name)).toEqual(["old name"]);
  });
});

describe("cropTests", () => {
  const h = hunk('+test "first" do', "+  a", "+end", "+", '+test "second one" do', "+  b", "+end", "+", "+", "+def helper", "+end", "+", '+test "last" do', "+  c", "+end", "+");

  it("ends a crop before the next test and trims trailing blank lines", () => {
    expect(cropTests(h, "first").crops).toEqual([{ from: 0, to: 2, name: "first" }]);
  });

  it("ends a crop before a non-test def", () => {
    expect(cropTests(h, "second").crops).toEqual([{ from: 4, to: 6, name: "second one" }]);
  });

  it("crops the last test to the end of the hunk minus trailing blanks", () => {
    expect(cropTests(h, "last").crops).toEqual([{ from: 12, to: 14, name: "last" }]);
  });

  it("also stops at private and setup do", () => {
    const g = hunk('+test "a" do', "+end", "+private", '+test "b" do', "+setup do", "+end");
    expect(cropTests(g, "a").crops[0]!.to).toBe(1);
    expect(cropTests(g, "b").crops[0]!.to).toBe(3);
  });

  it("reports no match and several matches with every name found", () => {
    expect(cropTests(h, "nope")).toMatchObject({ crops: [], names: ["first", "second one", "last"] });
    expect(cropTests(h, "s").crops).toHaveLength(3);
  });
});
