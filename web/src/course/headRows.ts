import type { PrFile } from "@review-canvas/shared";

export interface HeadRow {
  kind: "add" | "del" | "ctx";
  text: string;
  /** Head line number; the base line number for deleted rows. */
  no: number;
  /** Set on diff lines only: the row is `hunk.lines[lineIndex]`. Rows without it take no comment. */
  hunkId?: string;
  lineIndex?: number;
}

/**
 * Every line of the file at head, in order. Added lines keep their `add` kind, deleted lines sit
 * where they were (before the head line that follows them), and the rest is context.
 */
export function headRows(file: Pick<PrFile, "hunks">, head: string[]): HeadRow[] {
  const diff = new Map<number, HeadRow>();
  const dels = new Map<number, HeadRow[]>();
  for (const h of file.hunks) {
    const m = /\+(\d+)(?:,(\d+))?/.exec(h.range);
    // `anchor` is the last head line passed; a deletion goes before the line after it.
    let anchor = m ? (m[2] === "0" ? Number(m[1]) : Number(m[1]) - 1) : 0;
    h.lines.forEach((l, lineIndex) => {
      if (l.kind === "del") {
        const at = Math.min(anchor + 1, head.length + 1);
        dels.set(at, [...(dels.get(at) ?? []), { kind: "del", text: l.text, no: l.oldNo ?? 0, hunkId: h.id, lineIndex }]);
      } else if (l.newNo !== null) {
        anchor = l.newNo;
        diff.set(l.newNo, { kind: l.kind, text: head[l.newNo - 1] ?? l.text, no: l.newNo, hunkId: h.id, lineIndex });
      }
    });
  }
  const rows: HeadRow[] = [];
  for (let n = 1; n <= head.length + 1; n++) {
    rows.push(...(dels.get(n) ?? []));
    if (n <= head.length) rows.push(diff.get(n) ?? { kind: "ctx", text: head[n - 1]!, no: n });
  }
  return rows;
}

const memo = new WeakMap<string[], HeadRow[]>();
/** `headRows`, computed once per fetched file. */
export function headRowsOf(file: Pick<PrFile, "hunks">, head: string[]): HeadRow[] {
  let rows = memo.get(head);
  if (!rows) memo.set(head, (rows = headRows(file, head)));
  return rows;
}

/** Where the diff lines `from..to` of a hunk sit in `rows`, or null when they are not in the file. */
export function around(rows: HeadRow[], hunkId: string, from: number, to: number) {
  const first = rows.findIndex((r) => r.hunkId === hunkId && r.lineIndex === from);
  const last = rows.findIndex((r) => r.hunkId === hunkId && r.lineIndex === to);
  return first < 0 || last < 0 ? null : { first, last };
}
