import type { DiffLine, Hunk } from "@review-canvas/shared";
import { describe, expect, it } from "vitest";
import { around, headRows } from "./headRows";

const l = (kind: DiffLine["kind"], text: string, oldNo: number | null, newNo: number | null): DiffLine => ({ kind, text, oldNo, newNo });
const hunk = (id: string, range: string, lines: DiffLine[]): Hunk => ({ id, range, section: "", lines });
const head = (n: number) => Array.from({ length: n }, (_, i) => `L${i + 1}`);
const tags = (rows: ReturnType<typeof headRows>) => rows.map((r) => `${r.kind[0]}${r.no}`).join(" ");

describe("headRows", () => {
  it("puts two deleted and three added lines at their head line numbers", () => {
    const h = hunk("h1", "@@ -2,4 +2,5 @@", [l("ctx", "L1", 1, 1), l("del", "old a", 2, null), l("del", "old b", 3, null), l("add", "L2", null, 2), l("add", "L3", null, 3), l("add", "L4", null, 4), l("ctx", "L5", 4, 5)]);
    const rows = headRows({ hunks: [h] }, head(6));
    expect(tags(rows)).toBe("c1 d2 d3 a2 a3 a4 c5 c6");
    expect(rows.map((r) => r.hunkId ?? "-")).toEqual(["h1", "h1", "h1", "h1", "h1", "h1", "h1", "-"]);
    expect(rows[1]).toMatchObject({ kind: "del", text: "old a", lineIndex: 1 });
  });

  it("places deletions at the end of the file after the last line", () => {
    const h = hunk("h1", "@@ -2,2 +2,1 @@", [l("ctx", "L2", 2, 2), l("del", "gone", 3, null)]);
    expect(tags(headRows({ hunks: [h] }, head(2)))).toBe("c1 c2 d3");
  });

  it("tags every row of an added file as added", () => {
    const h = hunk("h1", "@@ -0,0 +1,3 @@", head(3).map((t, i) => l("add", t, null, i + 1)));
    expect(headRows({ hunks: [h] }, head(3)).every((r) => r.kind === "add" && r.hunkId === "h1")).toBe(true);
  });

  it("keeps add and del tags of a second hunk when expanding from the first", () => {
    const a = hunk("a", "@@ -1,1 +1,1 @@", [l("ctx", "L1", 1, 1)]);
    const b = hunk("b", "@@ -5,2 +5,2 @@", [l("del", "x", 5, null), l("add", "L5", null, 5), l("ctx", "L6", 6, 6)]);
    const rows = headRows({ hunks: [a, b] }, head(7));
    const span = around(rows, "a", 0, 0)!;
    expect(rows.slice(span.last + 1).map((r) => `${r.kind[0]}${r.no}`)).toEqual(["c2", "c3", "c4", "d5", "a5", "c6", "c7"]);
  });

  it("gives rows outside any hunk no hunk index", () => {
    const h = hunk("h1", "@@ -3,1 +3,1 @@", [l("ctx", "L3", 3, 3)]);
    const rows = headRows({ hunks: [h] }, head(4));
    expect(rows.filter((r) => r.hunkId === undefined).map((r) => r.no)).toEqual([1, 2, 4]);
  });

  it("places deletions in a hunk with no added lines before the following line", () => {
    const h = hunk("h1", "@@ -3,2 +2,0 @@", [l("del", "a", 3, null), l("del", "b", 4, null)]);
    expect(tags(headRows({ hunks: [h] }, head(3)))).toBe("c1 c2 d3 d4 c3");
  });
});
