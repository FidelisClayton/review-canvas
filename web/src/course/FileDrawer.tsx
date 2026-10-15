import { useEffect, useRef } from "react";
import { useCourse } from "./ctx";
import { headRows } from "./headRows";
import { DiffRow } from "./StopView";
import { useHeadFile } from "./useHeadFile";
import "./file.css";

export interface FileDrawerProps {
  fileId: string;
  onClose: () => void;
}

/** The whole file at the PR head, with this PR's added lines green and removed lines red where they were. */
export function FileDrawer({ fileId, onClose }: FileDrawerProps) {
  const c = useCourse();
  const file = c.review.analysis.files.find((f) => f.id === fileId);
  const head = useHeadFile(fileId);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = body.current?.querySelector<HTMLElement>(".ln.add,.ln.del");
    if (first && body.current) body.current.scrollTop = first.offsetTop - 120;
  }, [head.status, fileId]);
  if (!file) return null;
  const rows = head.status === "ready" && head.lines ? headRows(file, head.lines) : [];
  return (
    <aside className="drawer filedrawer" aria-label="File at the PR head">
      <header>
        <div className="t">
          <small>Whole file at the PR head</small>
          <b>{file.path}</b>
          <p>
            {file.hunks.length} changed chunk{file.hunks.length === 1 ? "" : "s"} · <span className="plus">+{file.additions}</span> <span className="minus">−{file.deletions}</span>
          </p>
        </div>
        <button className="btn" onClick={onClose}>
          Close <kbd>Esc</kbd>
        </button>
      </header>
      <div className="dock-body file-body" ref={body}>
        {head.status === "loading" && <p className="fnote">Loading the file…</p>}
        {head.status === "removed" && <p className="fnote">{head.message}</p>}
        {head.status === "error" && (
          <div className="fnote">
            <p>{head.message}</p>
            <button className="btn" onClick={head.retry}>
              Retry
            </button>
          </div>
        )}
        {head.status === "ready" && (
          <div className="code">
            <div className="codein">
              {rows.map((r, i) => (
                <DiffRow key={i} kind={r.kind} no={r.no} text={r.text} lang={file.lang} />
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
