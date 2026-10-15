import { useState } from "react";
import { useCourse } from "./ctx";
import { around, headRowsOf } from "./headRows";
import { DiffRow } from "./StopView";
import { useHeadFile } from "./useHeadFile";
import "./file.css";

export interface ShowMoreProps {
  fileId: string;
  hunkId: string;
  /** The range of `hunk.lines` the stop shows. */
  from: number;
  to: number;
  dir: "up" | "down";
}

const STEP = 20;

/** "Show 20 more lines above/below" a stop, from the file at the PR head. Nothing until the file has loaded. */
export function ShowMore({ fileId, hunkId, from, to, dir }: ShowMoreProps) {
  const c = useCourse();
  const head = useHeadFile(fileId);
  const [count, setCount] = useState(0);
  const file = c.view.hunkFile.get(hunkId);
  if (head.status !== "ready" || !head.lines || !file) return null;
  const rows = headRowsOf(file, head.lines);
  const at = around(rows, hunkId, from, to);
  if (!at) return null;
  // Added and deleted rows keep their kind when the reader expands into another chunk; none of these rows take a comment.
  const shown = dir === "up" ? rows.slice(Math.max(0, at.first - count), at.first) : rows.slice(at.last + 1, at.last + 1 + count);
  const more = dir === "up" ? at.first - count > 0 : at.last + count < rows.length - 1;
  const lines = shown.map((r, i) => (
    <DiffRow key={i} kind={r.kind} no={r.no} text={r.text} lang={file.lang} />
  ));
  const button = more && (
    <button className="more" onClick={() => setCount((n) => n + STEP)}>
      Show {STEP} more lines {dir === "up" ? "above" : "below"}
    </button>
  );
  return dir === "up" ? (
    <>
      {button}
      {lines}
    </>
  ) : (
    <>
      {lines}
      {button}
    </>
  );
}
