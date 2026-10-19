import { useEffect, useState } from "react";
import type { RevisionFilePayload, RevisionIndexPayload } from "@review-canvas/shared";
import { fetchRevisionComparison, fetchRevisionFile } from "../api";
import { DiffRow } from "../course/StopView";
import type { EvidenceSlotContext } from "./EvidencePanel";
import { revisionAvailability, revisionFileAvailability } from "./comparisonModel";
import "./comparison.css";

type Loaded<T> = { key: string; data?: T; error?: string };

export function RevisionComparison({ review, index, active }: EvidenceSlotContext) {
  const [baseline, setBaseline] = useState<string | undefined>();
  const [path, setPath] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [fileRetry, setFileRetry] = useState(0);
  const [inventory, setInventory] = useState<Loaded<RevisionIndexPayload> | null>(null);
  const [fileResult, setFileResult] = useState<Loaded<RevisionFilePayload> | null>(null);
  const indexKey = JSON.stringify([review.analysis.id, baseline, retry]);
  const current = inventory?.key === indexKey ? inventory : null;
  useEffect(() => {
    if (!active || current?.data || current?.error) return;
    let canceled = false;
    fetchRevisionComparison(review.analysis.id, baseline).then(data => {
      if (!canceled) setInventory({ key: indexKey, data });
    }, (error: Error) => { if (!canceled) setInventory({ key: indexKey, error: error.message }); });
    return () => { canceled = true; };
  }, [active, review.analysis.id, baseline, indexKey, current?.data, current?.error]);

  const payload = current?.data;
  const comparison = payload?.comparison;
  const unavailable = payload ? revisionAvailability(payload) : null;
  const selectedBaseline = comparison?.baselineReviewId;
  const fileKey = JSON.stringify([review.analysis.id, selectedBaseline, path, fileRetry]);
  const currentFile = fileResult?.key === fileKey ? fileResult : null;
  useEffect(() => {
    if (!active || !selectedBaseline || !path || comparison?.status !== "available" || currentFile?.data || currentFile?.error) return;
    let canceled = false;
    fetchRevisionFile(review.analysis.id, selectedBaseline, path).then(data => {
      if (!canceled) setFileResult({ key: fileKey, data });
    }, (error: Error) => { if (!canceled) setFileResult({ key: fileKey, error: error.message }); });
    return () => { canceled = true; };
  }, [active, review.analysis.id, selectedBaseline, path, comparison?.status, fileKey, currentFile?.data, currentFile?.error]);

  const alternatives = payload?.alternatives ?? inventory?.data?.alternatives ?? index.previousReviews;
  return <section className="evidence-comparison" aria-label="Changes since reviewed">
    <h3>Changes since reviewed</h3>
    <p>Compare an explicitly reviewed snapshot with this review’s stored head. These source rows are read-only and do not mark current course chunks read.</p>
    <label className="evidence-run-choice">Previous reviewed snapshot <select value={baseline ?? ""} onChange={event => { setBaseline(event.target.value || undefined); setPath(null); }}>
      <option value="">Latest eligible reviewed snapshot</option>
      {alternatives.map(item => <option key={item.reviewId} value={item.reviewId}>{item.reviewId} · reviewed {item.reviewedAt} · {item.headSha}</option>)}
    </select></label>
    {baseline && !alternatives.some(item => item.reviewId === baseline) && <p role="alert">The selected baseline is unavailable or no longer eligible.</p>}
    <p className="evidence-note">Current stored head <code>{review.analysis.pr.headSha}</code></p>
    {!current && <p role="status">Loading exact revision inventory…</p>}
    {current?.error && <div role="alert"><p>Exact revision comparison unavailable: {current.error}</p><button className="btn" onClick={() => setRetry(value => value + 1)}>Retry revision comparison</button></div>}
    {payload && <>
      {(comparison || payload.baseline) && <dl className="evidence-facts">
        <dt>Repository / PR</dt><dd>{comparison ? `${comparison.owner}/${comparison.repo} #${comparison.number}` : `${payload.baseline!.owner}/${payload.baseline!.repo} #${payload.baseline!.number}`}</dd>
        <dt>Baseline review</dt><dd><code>{comparison?.baselineReviewId ?? payload.baseline?.reviewId}</code></dd>
        <dt>Reviewed at</dt><dd><time>{comparison?.reviewedAt ?? payload.baseline?.reviewedAt}</time></dd>
        <dt>Before</dt><dd><code>{comparison?.beforeSha ?? payload.baseline?.headSha}</code></dd>
        <dt>After</dt><dd><code>{comparison?.afterSha ?? review.analysis.pr.headSha}</code></dd>
      </dl>}
      {unavailable && <div className="evidence-issues" role="status"><p>Comparison unavailable: {unavailable}</p><button className="btn" onClick={() => setRetry(value => value + 1)}>Refresh reviewed snapshots</button></div>}
      {comparison?.status === "available" && <>
        <h3>Changed paths · {comparison.files.length}</h3>
        {comparison.files.length === 0 ? <p>No paths differ between these exact endpoints.</p> : <ul className="comparison-paths" aria-label="Changed-path inventory">
          {comparison.files.map(change => <li key={change.path}>
            <button className="btn" aria-pressed={path === change.path} onClick={() => setPath(change.path)}><code>{change.path}</code> · {change.status}</button>
            <span className="evidence-note">{change.before?.mode ?? "absent"} / {change.before?.type ?? "absent"} → {change.after?.mode ?? "absent"} / {change.after?.type ?? "absent"}</span>
            {change.unavailableReason && <span className="evidence-note">Diff unavailable: {change.unavailableReason}</span>}
          </li>)}
        </ul>}
        {!path && comparison.files.length > 0 && <p>Select a path to fetch its diff at these exact revisions.</p>}
        {path && <section className="comparison-file" aria-label="Selected revision file">
          <h3><code>{path}</code> · read-only</h3>
          {!currentFile && <p role="status">Loading exact file diff…</p>}
          {currentFile?.error && <div role="alert"><p>Source diff unavailable: {currentFile.error}</p><button className="btn" onClick={() => setFileRetry(value => value + 1)}>Retry file diff</button></div>}
          {currentFile?.data && <RevisionFile payload={currentFile.data} />}
        </section>}
      </>}
    </>}
  </section>;
}

export function RevisionFile({ payload }: { payload: RevisionFilePayload }) {
  const unavailable = revisionFileAvailability(payload);
  const { file, change } = payload;
  return <>
    <p className="evidence-note">Before <code>{payload.beforeSha}</code><br />After <code>{payload.afterSha}</code></p>
    <dl className="evidence-facts">
      <dt>Path status</dt><dd>{change.status}</dd>
      <dt>Before object</dt><dd><code>{change.before?.sha ?? "Absent"}</code> · {change.before?.mode ?? "no mode"} · {change.before?.type ?? "no type"}</dd>
      <dt>After object</dt><dd><code>{change.after?.sha ?? "Absent"}</code> · {change.after?.mode ?? "no mode"} · {change.after?.type ?? "no type"}</dd>
    </dl>
    {unavailable ? <p role="status">Source diff unavailable: {unavailable}</p> : file && <>
      {file.hunks.length === 0 && <p>No text lines differ. Inspect the path status and object modes above.</p>}
      {file.hunks.map((hunk, hunkIndex) => <section className="comparison-hunk" key={hunkIndex}>
        <h4><code>{hunk.range}</code>{hunk.section && ` · ${hunk.section}`}</h4>
        <div className="evidence-source-code code" aria-label={`Read-only diff for ${change.path}, ${hunk.range}`}>
          <div className="codein">{hunk.lines.map((line, index) => <DiffRow key={index} kind={line.kind} no={line.kind === "del" ? line.oldNo : line.newNo} text={line.text} lang={file.lang} />)}</div>
        </div>
      </section>)}
    </>}
  </>;
}
