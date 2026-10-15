import type { Hunk } from "./types.js";

// A test stop may be one test cropped out of a test chunk. These patterns find where tests start
// in the added and context lines of a hunk; they read a line at a time, so they only catch the
// common shapes (Minitest, RSpec, Jest, Vitest).

const QUOTED = `(["'\`])(.+?)\\1`;
const STARTS: RegExp[] = [
  new RegExp(`^\\s*test\\s*\\(?\\s*${QUOTED}`), // Minitest test "…", Jest test("…")
  /^\s*def\s+()(test_\w+[?!]?)/, // Minitest def test_…
  new RegExp(`^\\s*(?:it|specify|scenario)(?:\\.(?:only|skip|concurrent))?\\s*\\(?\\s*${QUOTED}`), // RSpec, Jest
  new RegExp(`^\\s*(?:it|test)\\.each\\b.*?[)\`]\\s*\\(\\s*${QUOTED}`), // it.each(table)("…")
];
// Lines that end a test without starting another: a helper, a visibility switch, a setup block.
const ENDS = /^\s*(?:def\s|private\b|protected\b|setup\s+do\b)/;

export interface TestStart {
  /** Index into `hunk.lines`. */
  index: number;
  name: string;
}

export interface Crop {
  from: number;
  to: number;
  name: string;
}

const startOf = (text: string): string | null => {
  for (const re of STARTS) {
    const m = re.exec(text);
    if (m) return m[2]!;
  }
  return null;
};

/** Where tests start in the hunk. Deleted lines are not tests of the new code. */
export function testStarts(hunk: Hunk): TestStart[] {
  const out: TestStart[] = [];
  hunk.lines.forEach((l, index) => {
    if (l.kind === "del") return;
    const name = startOf(l.text);
    if (name !== null) out.push({ index, name });
  });
  return out;
}

/**
 * Crops of the tests whose name contains `substring`. A crop runs from the test's first line to
 * the line before the next test, helper or setup block, minus trailing blank lines. The caller
 * decides what zero or several crops mean; `names` lists every test found, for its warning.
 */
export function cropTests(hunk: Hunk, substring: string): { crops: Crop[]; names: string[] } {
  const starts = testStarts(hunk);
  const crops: Crop[] = [];
  for (const start of starts) {
    if (!start.name.includes(substring)) continue;
    let end = start.index + 1;
    while (end < hunk.lines.length) {
      const l = hunk.lines[end]!;
      if (l.kind !== "del" && (startOf(l.text) !== null || ENDS.test(l.text))) break;
      end += 1;
    }
    while (end - 1 > start.index && !hunk.lines[end - 1]!.text.trim()) end -= 1;
    crops.push({ from: start.index, to: end - 1, name: start.name });
  }
  return { crops, names: starts.map((s) => s.name) };
}
