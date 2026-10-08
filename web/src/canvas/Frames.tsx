import { memo, useEffect, useRef, useState, type CSSProperties } from "react";

export interface Placement {
  x: number;
  y: number;
  w: number;
  hidden: boolean;
}

/** Shallow prop equality, comparing placements by value, so frames only re-render when they move or change. */
function sameProps<T extends object>(a: T, b: T) {
  for (const key of Object.keys(a) as (keyof T)[]) {
    const x = a[key], y = b[key];
    if (key === "at") {
      const p = x as Placement, q = y as Placement;
      if (p.x !== q.x || p.y !== q.y || p.w !== q.w || p.hidden !== q.hidden) return false;
    } else if (x !== y) return false;
  }
  return true;
}

const place = (p: Placement): CSSProperties => ({ left: p.x, top: p.y, width: p.w, visibility: p.hidden ? "hidden" : undefined });
import type { Draft, FileNotes, Hunk, OobItem, PrFile, PrMeta, Punch } from "@review-canvas/shared";
import { highlight } from "../highlight";
import { Icon } from "../icons";
import { Pins } from "../pins";

const base = (p: string) => p.split("/").pop() ?? p;
const dir = (p: string) => p.slice(0, p.length - base(p).length);
/** Break long file names at `_` and `.` when the frame collapses to a tag at far zoom. */
const breakable = (name: string) => name.split(/(?<=[_.])/);

export interface Chip {
  hunkId: string;
  label: string;
  out: boolean;
  otherPath: string;
}

export function fmtSplit(ms: number | null) {
  if (ms === null) return "";
  const s = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface FileFrameProps {
  file: PrFile;
  ctl: string;
  sub?: "test" | "gen";
  notes?: FileNotes;
  hunkNotes: Record<string, string>;
  chips: Record<string, Chip[]>;
  drafts: Draft[];
  punch?: Punch;
  current: boolean;
  at: Placement;
  prUrl: string;
  frameRef: (el: HTMLElement | null) => void;
  onPunch: (id: string) => void;
  onGoHunk: (hunkId: string) => void;
  onAddDraft: (hunkId: string, lineIndex: number, body: string) => void;
  onDeleteDraft: (id: string) => void;
}

export const FileFrame = memo(function FileFrame(p: FileFrameProps) {
  const { file } = p;
  const what = p.notes?.what?.trim();
  const why = p.notes?.why?.trim();
  return (
    <article className={`node${p.current ? " cur" : ""}`} data-node={file.id} style={place(p.at)} ref={p.frameRef}>
      <header className="tb" data-drag={file.id}>
        <span className="ctl">
          {p.ctl}
          {p.sub && <small>{p.sub}</small>}
        </span>
        <div className="fname" title={file.path}>
          <span className="dir">{dir(file.path)}</span>
          <b>
            {breakable(base(file.path)).map((part, i) => (
              <span key={i}>
                {part}
                <wbr />
              </span>
            ))}
          </b>
        </div>
        <span className="delta">
          {file.status === "removed" ? <span className="d">deleted</span> : null}
          <span className="a">+{file.additions}</span>
          {file.deletions ? <span className="d">−{file.deletions}</span> : null}
        </span>
        <button className="punch" aria-pressed={!!p.punch} onClick={() => p.onPunch(file.id)}>
          <span className="pins">{p.punch && <Pins ctl={p.ctl} size={16} />}</span>
          <span className="pl">{p.punch ? `Punched ${fmtSplit(p.punch.splitMs)}`.trim() : "Punch"}</span>
        </button>
      </header>
      {(what || why || file.previousPath) && (
        <dl className="desc">
          {what && (
            <div>
              <dt>What</dt>
              <dd>{what}</dd>
            </div>
          )}
          {why && (
            <div>
              <dt>Why here</dt>
              <dd>{why}</dd>
            </div>
          )}
          {file.previousPath && (
            <div>
              <dt>Renamed</dt>
              <dd>from {file.previousPath}</dd>
            </div>
          )}
        </dl>
      )}
      <div className="body">
        {file.patchMissing ? (
          <p className="nopatch">
            GitHub sent no diff for this file (binary or too large).{" "}
            <a href={`${p.prUrl}/files`} target="_blank" rel="noreferrer">
              Open it on GitHub
            </a>
          </p>
        ) : (
          file.hunks.map((h) => (
            <HunkView
              key={h.id}
              hunk={h}
              lang={file.lang}
              note={p.hunkNotes[h.id]}
              chips={p.chips[h.id] ?? []}
              drafts={p.drafts.filter((d) => d.hunkId === h.id)}
              onGoHunk={p.onGoHunk}
              onAddDraft={p.onAddDraft}
              onDeleteDraft={p.onDeleteDraft}
            />
          ))
        )}
      </div>
    </article>
  );
}, sameProps);

interface HunkViewProps {
  hunk: Hunk;
  lang: string;
  note?: string;
  chips: Chip[];
  drafts: Draft[];
  onGoHunk: (hunkId: string) => void;
  onAddDraft: (hunkId: string, lineIndex: number, body: string) => void;
  onDeleteDraft: (id: string) => void;
}

function HunkView({ hunk, lang, note, chips, drafts, onGoHunk, onAddDraft, onDeleteDraft }: HunkViewProps) {
  const [composing, setComposing] = useState<number | null>(null);
  return (
    <section className="hunk" id={`hunk-${hunk.id}`} data-hunk={hunk.id}>
      <div className="hh">
        <code>{hunk.range}</code>
        <span className="sum">{note?.trim() || hunk.section}</span>
        {chips.length > 0 && (
          <div className="links">
            {chips.map((c, i) => (
              <button key={i} className="chip" onClick={() => onGoHunk(c.hunkId)}>
                {c.out ? (
                  <>
                    {c.label} <Icon name="arrow" className="icon chip-arrow" /> <b>{base(c.otherPath)}</b>
                  </>
                ) : (
                  <>
                    <b>{base(c.otherPath)}</b> {c.label} this
                  </>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="code">
        {hunk.lines.map((line, i) => {
          const no = line.kind === "del" ? line.oldNo : line.newNo;
          return (
            <div key={i}>
              <div className={`ln ${line.kind}`}>
                <span className="no">{no}</span>
                <span className="sg">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}</span>
                <span className="tx" dangerouslySetInnerHTML={{ __html: highlight(line.text, lang) || " " }} />
                <button className="cmt" aria-label={`Comment on line ${no}`} onClick={() => setComposing(i)}>
                  <Icon name="cmt" />
                </button>
              </div>
              {drafts
                .filter((d) => d.lineIndex === i)
                .map((d) => (
                  <div className="draft" key={d.id}>
                    <header>
                      You <span>· draft, not posted</span>
                      <button className="x" aria-label="Delete draft" onClick={() => onDeleteDraft(d.id)}>
                        <Icon name="trash" />
                      </button>
                    </header>
                    <p>{d.body}</p>
                  </div>
                ))}
              {composing === i && (
                <Composer
                  onCancel={() => setComposing(null)}
                  onSave={(body) => {
                    onAddDraft(hunk.id, i, body);
                    setComposing(null);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Composer({ onCancel, onSave }: { onCancel: () => void; onSave: (body: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  const save = () => (body.trim() ? onSave(body.trim()) : ref.current?.focus());
  return (
    <div className="composer">
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Comment on this line. Stays a draft until you post the review."
        aria-label="Draft comment"
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
      />
      <div className="acts">
        <button className="btn quiet" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" onClick={save}>
          Save draft
        </button>
      </div>
    </div>
  );
}

export const StartCard = memo(function StartCard({ pr, route, at, frameRef }: { pr: PrMeta; route: string; at: Placement; frameRef: (el: HTMLElement | null) => void }) {
  const body = pr.body.trim();
  const excerpt = body.length > 700 ? `${body.slice(0, 700).trimEnd()}…` : body;
  return (
    <article className="node startnode" data-node="__start" style={place(at)} ref={frameRef}>
      <header className="tb" data-drag="__start">
        <span className="ctl">
          <svg viewBox="0 0 26 26">
            <path d="M3 22 13 4 23 22Z" fill="none" stroke="#7b2cbf" strokeWidth={2.4} strokeLinejoin="round" />
          </svg>
        </span>
        <div className="fname">
          <b>Start</b> <span className="dir">· PR description</span>
        </div>
      </header>
      <div className="pr-body">
        {excerpt ? excerpt.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>) : <p className="muted">No description.</p>}
        <p>
          <a href={pr.url} target="_blank" rel="noreferrer">
            Open #{pr.number} on GitHub <Icon name="external" className="icon inline" />
          </a>
        </p>
      </div>
      {route.trim() && (
        <div className="route">
          <b>How this course runs</b>
          {route}
        </div>
      )}
    </article>
  );
}, sameProps);

export const OobTag = memo(function OobTag({ item, at, frameRef }: { item: OobItem; at: Placement; frameRef: (el: HTMLElement | null) => void }) {
  return (
    <article className="node oobnode" data-node={item.id} style={place(at)} ref={frameRef}>
      <header className="tb" data-drag={item.id}>
        <div className="fname" title={item.path}>
          <span className="dir">{dir(item.path)}</span>
          <b>{base(item.path)}</b>
        </div>
        <span className="delta">
          {item.additions ? <span className="a">+{item.additions}</span> : null}
          {item.deletions ? <span className="d">−{item.deletions}</span> : null}
        </span>
      </header>
      <div className="why">{item.reason}</div>
    </article>
  );
}, sameProps);
