import { useEffect, useRef } from "react";
import { onCourse } from "@review-canvas/shared";
import { ChunkNote } from "./notes";
import { useCourse } from "./ctx";
import { goalLabel } from "./model";
import { CodeRows } from "./StopView";
import "./links.css";

export interface ChunkDrawerProps {
  hunkId: string;
  symbols: string[];
  onClose: () => void;
  /** "Go to it in goal N": goal id (or "unclaimed") and the chunk to land on. */
  onGoToGoal: (goalId: string, hunkId: string) => void;
}

/** A linked chunk on the right, with the lines that mention the link's symbol marked. Nothing in it is faded. */
export function ChunkDrawer({ hunkId, symbols, onClose, onGoToGoal }: ChunkDrawerProps) {
  const c = useCourse();
  const body = useRef<HTMLDivElement>(null);
  const file = c.view.hunkFile.get(hunkId);
  const hunk = file?.hunks.find((h) => h.id === hunkId);
  const key = symbols.join("\0");

  useEffect(() => {
    const first = body.current?.querySelector<HTMLElement>(".ln.mark");
    if (first && body.current) body.current.scrollTop = first.offsetTop - 80;
  }, [hunkId, key]);

  if (!file || !hunk) return null;
  const summary = c.review.course.notes[hunkId]?.summary;
  const goalIdx = c.idx.ofHunk.get(hunkId) ?? [];
  const first = goalIdx[0] !== undefined ? c.idx.goals[goalIdx[0]]! : null;
  return (
    <aside className="drawer open" aria-label="Linked chunk">
      <header>
        <div className="t">
          <small>Linked chunk</small>
          <b>{file.path}</b>
          {!onCourse(file) && <span className="oobtag">Out of bounds</span>}
          {symbols.length > 0 && (
            <p className="markline">
              Highlighted: <span className="markey">{symbols.join(", ")}</span>
            </p>
          )}
          {summary ? <ChunkNote text={summary} /> : <p>{hunk.range}</p>}
        </div>
        <button className="btn" onClick={onClose}>
          Close <kbd>Esc</kbd>
        </button>
      </header>
      <div className="dock-body" ref={body}>
        <CodeRows hunkId={hunkId} from={0} to={hunk.lines.length - 1} mode="drawer" highlight={symbols} />
      </div>
      {first && (
        <footer>
          <span>On the course in goal {goalIdx.map((gi) => goalLabel(c.idx.goals[gi]!, gi)).join(", ")}</span>
          <button className="btn" onClick={() => onGoToGoal(first.id, hunkId)}>
            Go to it in goal {goalLabel(first, goalIdx[0]!)}
          </button>
        </footer>
      )}
    </aside>
  );
}
