import { useEffect, useState } from "react";
import type { DeploymentPayload } from "@review-canvas/shared";
import { fetchDeployment } from "../api";
import type { EvidenceSlotContext } from "./EvidencePanel";
import { deploymentRows, deploymentSourceTarget, selectDeploymentItem, type DeploymentRow, type DeploymentSection } from "./deploymentModel";
import "./deployment.css";

export type DeploymentViewProps = Pick<EvidenceSlotContext, "review" | "index" | "active" | "openRun" | "openSourceRef">;
const sections: [DeploymentSection, string, string][] = [
  ["schema", "Schema changes", "No schema changes supplied."],
  ["compatibility", "Application / schema compatibility", "No compatibility cases supplied. Compatibility is unknown."],
  ["backfill", "Backfills", "No backfill analysis supplied."],
  ["rollback", "Rollback constraints", "No rollback analysis supplied. Reversibility is unknown."],
];
const supportLabel: Record<DeploymentRow["support"], string> = {
  analysis: "Analysis only",
  unsupported: "Observed claim unsupported",
  captured: "Captured value matches analysis",
};
const text = (value: string) => value.replaceAll("_", " ");

export function DeploymentView({ review, index, active, openRun, openSourceRef }: DeploymentViewProps) {
  const [response, setResponse] = useState<{ reviewId: string; payload: DeploymentPayload } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  useEffect(() => {
    if (!visited) return;
    let canceled = false;
    setResponse(null);
    setError(null);
    fetchDeployment(review.analysis.id).then(
      payload => { if (!canceled) setResponse({ reviewId: review.analysis.id, payload }); },
      error => { if (!canceled) setError(error instanceof Error ? error.message : String(error)); },
    );
    return () => { canceled = true; };
  }, [review.analysis.id, visited, retry]);

  const payload = response?.reviewId === review.analysis.id ? response.payload : null;
  if (error) return <div className="deployment-view" role="alert"><p>Could not load deployment analysis: {error}</p><button className="btn" onClick={() => setRetry(value => value + 1)}>Retry deployment analysis</button></div>;
  if (!payload) return <p role="status">Loading deployment analysis…</p>;
  if (payload.status === "absent") return <section className="deployment-view" aria-label="Deployment analysis"><h3>Deployment</h3><p>No deployment analysis supplied.</p></section>;

  const rows = deploymentRows(payload, index);
  const selectedId = selectDeploymentItem(rows, selected);
  return <section className="deployment-view" aria-label="Deployment analysis">
    <header className="deployment-intro">
      <h3>Deployment</h3>
      <p>Analysis for <code>{payload.analysis.target.owner}/{payload.analysis.target.repo}#{payload.analysis.target.number}</code> at <code>{payload.analysis.target.headSha}</code>.</p>
      <p>Captured results are producer-reported evidence. An imported file does not authenticate execution or its reported revision.</p>
      {payload.historical && <p className="deployment-warning">Historical analysis: this document targets a different review head. Its claims do not establish current-head compatibility.</p>}
      {!payload.validation.valid && <p className="deployment-warning">Some observed claims lack matching evidence. Inspect the validation issues beside each claim.</p>}
    </header>
    {sections.map(([section, title, empty]) => <section className="deployment-section" key={section} aria-label={title}>
      <h4>{title}</h4>
      {rows.filter(row => row.section === section).length === 0 ? <p>{empty}</p> : <ul className="deployment-rows">
        {rows.filter(row => row.section === section).map(row => {
          const expanded = row.id === selectedId;
          const detailId = `deployment-${row.id}`;
          return <li key={row.id} className="deployment-row">
            <button className="deployment-item" aria-expanded={expanded} aria-controls={detailId} onClick={() => setSelected(row.id)}>
              <span className="deployment-item-title">{row.title}</span>
              <span className="deployment-result">{text(row.result)}</span>
              <span className="deployment-basis">{row.basis}</span>
            </button>
            {(row.appRevision || row.schemaVersion || row.counts) && <dl className="deployment-context">
              {row.appRevision && <><dt>App revision</dt><dd><code>{row.appRevision}</code></dd></>}
              {row.schemaVersion && <><dt>Schema version</dt><dd><code>{row.schemaVersion}</code></dd></>}
              {row.counts && <><dt>Processed</dt><dd>{row.counts.processed ?? "unknown"}</dd><dt>Remaining</dt><dd>{row.counts.remaining ?? "unknown"}</dd></>}
            </dl>}
            <p className="deployment-support">{supportLabel[row.support]}{row.historical ? " · historical analysis" : ""}</p>
            {row.issues.length > 0 && <ul className="deployment-warning" aria-label="Validation issues">{row.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
            <div id={detailId} hidden={!expanded} className="deployment-detail">
              {row.description && <p>{row.description}</p>}
              <h5>Execution evidence</h5>
              {row.evidence.length === 0 ? <p>No execution evidence referenced.</p> : <ul className="deployment-references">{row.evidence.map(({ ref, qualifications }, i) => <li key={`${ref.runId}/${ref.observationId}/${i}`}>
                <button className="btn" onClick={() => { setSelected(row.id); openRun(ref.runId, ref.observationId); }}>Open run <code>{ref.runId}</code> · observation <code>{ref.observationId}</code></button>
                {qualifications.length > 0 && <ul aria-label="Evidence qualifications">{qualifications.map(reason => <li key={reason}>{reason}</li>)}</ul>}
              </li>)}</ul>}
              {row.sources.length > 0 && <><h5>Source references</h5><ul className="deployment-references">{row.sources.map((ref, i) => {
                const target = deploymentSourceTarget(ref, index);
                return <li key={i}>
                  <p><code>{ref.owner}/{ref.repo} · {ref.path}:{ref.startLine}–{ref.endLine} · {ref.side}</code><br />Revision <code>{ref.revision}</code></p>
                  {target ? <button className="btn" onClick={() => { setSelected(row.id); openSourceRef(target.runId, target.refIndex); }}>Inspect exact source</button> : <p>Source preview unavailable: no matching source reference in a stored run.</p>}
                </li>;
              })}</ul></>}
            </div>
          </li>;
        })}
      </ul>}
    </section>)}
  </section>;
}
