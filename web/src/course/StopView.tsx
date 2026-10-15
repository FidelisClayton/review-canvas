import { useEffect, useRef } from "react";
import { isRead, stopKey, type Stop } from "@review-canvas/shared";
import { highlight } from "../highlight";
import { Icon } from "../icons";
import { goalLabel } from "./model";
import { useCourse } from "./ctx";
import { ChunkNote, LineNoteRow } from "./notes";
import { LinkGroups } from "./LinkGroups";
import { ShowMore } from "./ShowMore";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A whole-word matcher for symbols such as `retry!`, which a plain `\b` would cut short. */
export function wordMatcher(symbols: string[] | undefined): RegExp | null {
  const list = (symbols ?? []).filter(Boolean);
  return list.length ? new RegExp(`(?<![\\w])(?:${list.map(escapeRe).join("|")})(?![\\w])`) : null;
}

export interface DiffRowProps {
  kind: "add" | "del" | "ctx";
  no: number | null;
  text: string;
  lang: string;
  mark?: boolean;
  /** Set only on rows that take a comment (diff lines of a stop); expanded and whole-file rows leave these out. */
  hunkId?: string;
  index?: number;
  onClick?: () => void;
}

/** One code row: line number, +/- sign, highlighted text. The only place this markup lives. */
export function DiffRow({ kind, no, text, lang, mark, hunkId, index, onClick }: DiffRowProps) {
  return (
    <div className={`ln ${kind}${mark ? " mark" : ""}`} data-h={hunkId} data-i={index} onClick={onClick}>
      <span className="no">{no}</span>
      <span className="sg">{kind === "add" ? "+" : kind === "del" ? "−" : " "}</span>
      <span className="tx" dangerouslySetInnerHTML={{ __html: highlight(text, lang) || " " }} />
    </div>
  );
}

export type CodeMode = "stop" | "map" | "drawer";

export interface CodeRowsProps {
  hunkId: string;
  /** Inclusive indices into `hunk.lines`. */
  from: number;
  to: number;
  mode: CodeMode;
  /** Lines mentioning one of these symbols as a whole word are marked. */
  highlight?: string[];
}

/** Rows of a chunk with their line notes, drafts and the composer. Every row is a diff line, so every row takes a comment. */
export function CodeRows({ hunkId, from, to, mode, highlight: symbols }: CodeRowsProps) {
  const c = useCourse();
  const file = c.view.hunkFile.get(hunkId);
  const hunk = file?.hunks.find((h) => h.id === hunkId);
  if (!file || !hunk) return null;
  const marker = wordMatcher(symbols);
  const notes = c.review.course.notes[hunkId]?.lines ?? [];
  const rows = [];
  for (let i = from; i <= Math.min(to, hunk.lines.length - 1); i++) {
    const line = hunk.lines[i]!;
    const no = line.kind === "del" ? line.oldNo : line.newNo;
    const open = () => {
      if (!window.getSelection()?.toString()) c.openComposer(hunkId, i);
    };
    rows.push(
      <div key={i}>
        <DiffRow kind={line.kind} no={no} text={line.text} lang={file.lang} mark={!!marker?.test(line.text)} hunkId={hunkId} index={i} onClick={open} />
        {notes
          .filter((n) => (n.side === "LEFT" ? line.kind === "del" && line.oldNo === n.line : line.kind !== "del" && line.newNo === n.line))
          .map((n, k) => (
            <LineNoteRow key={k} text={n.text} />
          ))}
        {c.state.drafts
          .filter((d) => d.hunkId === hunkId && d.lineIndex === i)
          .map((d) => (
            <div className="draft" key={d.id}>
              <header>
                You <span>· draft, not posted</span>
                <button className="x" aria-label="Delete draft" onClick={() => c.deleteDraft(d.id)}>
                  <Icon name="trash" />
                </button>
              </header>
              <p>{d.body}</p>
            </div>
          ))}
        {c.composer?.hunkId === hunkId && c.composer.lineIndex === i && <Composer />}
      </div>,
    );
  }
  return (
    <div className="code">
      <div className="codein">
        {mode !== "drawer" && <ShowMore fileId={file.id} hunkId={hunkId} from={from} to={to} dir="up" />}
        {rows}
        {mode !== "drawer" && <ShowMore fileId={file.id} hunkId={hunkId} from={from} to={to} dir="down" />}
      </div>
    </div>
  );
}

function Composer() {
  const c = useCourse();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  const cp = c.composer!;
  const save = () => {
    if (!cp.text.trim()) return ref.current?.focus();
    c.addDraft(cp.hunkId, cp.lineIndex, cp.text.trim());
    c.closeComposer();
  };
  return (
    <div className="composer">
      <textarea
        ref={ref}
        value={cp.text}
        onChange={(e) => c.setComposerText(e.target.value)}
        placeholder="Comment on this line. Stays a draft until you post the review."
        aria-label="Draft comment"
        onKeyDown={(e) => {
          if (e.key === "Escape") c.closeComposer();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
      />
      <div className="acts">
        <button className="btn quiet" onClick={c.closeComposer}>
          Cancel
        </button>
        <button className="btn primary" onClick={save}>
          Save draft
        </button>
      </div>
    </div>
  );
}

export interface StopViewProps {
  stop: Stop;
  /** "stop" is one stop of the current goal; "map" is a whole chunk in the Map view. */
  mode: "stop" | "map";
  /** 1-based position in the goal, in "stop" mode. */
  number?: number;
  current?: boolean;
  /** A goal badge was clicked: go to that goal at this chunk. */
  onGoalBadge: (goalId: string, hunkId: string) => void;
  /** The reader clicked inside the stop. */
  onSelect?: () => void;
}

export function StopView({ stop, mode, number, current, onGoalBadge, onSelect }: StopViewProps) {
  const c = useCourse();
  const file = c.view.hunkFile.get(stop.hunkId);
  const hunk = file?.hunks.find((h) => h.id === stop.hunkId);
  if (!file || !hunk) return null;
  const read = isRead(c.state, stop);
  const summary = stop.name ? `Test: ${stop.name}` : c.review.course.notes[stop.hunkId]?.summary;
  const goals = c.idx.ofHunk.get(stop.hunkId) ?? [];
  return (
    <div
      className={`stop${read ? " isread" : ""}${current ? " cur" : ""}`}
      data-key={stopKey(stop)}
      data-hunk={stop.hunkId}
      {...(mode === "stop" && number !== undefined ? { "data-si": number - 1 } : {})}
      onClick={onSelect}
    >
      <div className="hh">
        {mode === "stop" ? (
          <span className="sn">{number}</span>
        ) : (
          <span className="gs">
            {goals.map((gi) => {
              const g = c.idx.goals[gi]!;
              return (
                <button key={gi} className={`gn${g.unclaimed ? " u" : ""}`} title={`Review goal ${goalLabel(g, gi)}`} onClick={() => onGoalBadge(g.id, stop.hunkId)}>
                  {goalLabel(g, gi)}
                </button>
              );
            })}
          </span>
        )}
        <code className="rg">{hunk.range}</code>
        <span className="read">{read ? "Read" : ""}</span>
        {!stop.test && <LinkGroups hunkId={stop.hunkId} onOpenChunk={c.openChunk} />}
      </div>
      {summary && <ChunkNote text={summary} />}
      <CodeRows hunkId={stop.hunkId} from={stop.from} to={stop.to} mode={mode} />
    </div>
  );
}
