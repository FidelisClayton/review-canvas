import type { DiffLine, Hunk } from "./types.js";

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/**
 * Splits a GitHub file patch (the `patch` field of the PR files API, which has no `---`/`+++`
 * file headers) into hunks with line numbers on both sides.
 */
export function parsePatch(fileId: string, patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  // A trailing newline would otherwise read as one extra, empty context line.
  const rows = (patch.endsWith("\n") ? patch.slice(0, -1) : patch).split("\n");
  for (const raw of rows) {
    const header = HEADER.exec(raw);
    if (header) {
      oldNo = Number(header[1]);
      newNo = Number(header[3]);
      current = {
        id: `${fileId}.h${hunks.length + 1}`,
        range: raw.slice(0, raw.indexOf("@@", 2) + 2),
        section: (header[5] ?? "").trim(),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    // "\ No newline at end of file" describes the previous line; it is not code.
    if (raw.startsWith("\\")) continue;

    const sign = raw[0];
    const text = raw.slice(1);
    let line: DiffLine;
    if (sign === "+") line = { kind: "add", text, oldNo: null, newNo: newNo++ };
    else if (sign === "-") line = { kind: "del", text, oldNo: oldNo++, newNo: null };
    else line = { kind: "ctx", text, oldNo: oldNo++, newNo: newNo++ };
    current.lines.push(line);
  }
  return hunks;
}

const LANGS: [RegExp, string][] = [
  [/\.(rb|rake|ru|gemspec)$|(^|\/)(Gemfile|Rakefile|Guardfile)$/, "rb"],
  [/\.html?\.erb$|\.erb$/, "erb"],
  [/\.tsx$/, "tsx"],
  [/\.(ts|mts|cts)$/, "ts"],
  [/\.(jsx)$/, "tsx"],
  [/\.(js|mjs|cjs)$/, "ts"],
  [/\.tsp$/, "tsp"],
  [/\.ya?ml$/, "yml"],
  [/\.json$/, "json"],
  [/\.(md|mdx)$/, "md"],
  [/\.(css|scss)$/, "css"],
  [/\.sql$/, "sql"],
  [/\.(sh|bash)$/, "sh"],
];

export function langOf(path: string): string {
  for (const [re, lang] of LANGS) if (re.test(path)) return lang;
  return "text";
}
