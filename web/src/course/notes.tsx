import { Fragment, type ReactNode } from "react";

export function Spark() {
  return (
    <svg className="spark" aria-hidden="true">
      <use href="#i-spark" />
    </svg>
  );
}

/** Backticked words become code. Nothing else is interpreted, and nothing is injected as HTML. */
export function NoteText({ text }: { text: string }): ReactNode {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.length > 2 && part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>,
  );
}

/** The chunk summary: its own row under the chunk header. */
export function ChunkNote({ text }: { text: string }) {
  return (
    <div className="cnote">
      <Spark />
      <span className="ai">
        <NoteText text={text} />
      </span>
    </div>
  );
}

/** A line note: a row under the line it explains. */
export function LineNoteRow({ text }: { text: string }) {
  return (
    <div className="lnote">
      <span>
        <Spark />
        <span className="ai">
          <NoteText text={text} />
        </span>
      </span>
    </div>
  );
}
