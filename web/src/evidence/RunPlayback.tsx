import { useEffect, useState } from "react";
import type { EvidenceDetailPayload, EvidenceFreshness, SourceRef } from "@review-canvas/shared";
import { clampStep } from "./model";

export const freshnessLabel: Record<EvidenceFreshness, string> = {
  current: "Matches current head (reported)",
  base: "Matches stored base (reported)",
  "other-revision": "Historical revision",
  "working-tree": "Dirty or changed working tree",
  unknown: "Unknown provenance",
};

export interface RunPlaybackProps {
  detail: EvidenceDetailPayload;
  freshness: EvidenceFreshness;
  observationId?: string;
  onSource: (refIndex: number, observationId?: string) => void;
}

export function SourceRefs({ refs, onSource }: { refs: SourceRef[]; onSource: (index: number) => void }) {
  return refs.length > 0 ? (
    <ul className="evidence-source-links">
      {refs.map((ref, index) => (
        <li key={index}>
          <button className="btn" onClick={() => onSource(index)}>Inspect source: {ref.path}:{ref.startLine}–{ref.endLine} ({ref.side})</button>
        </li>
      ))}
    </ul>
  ) : null;
}

export function RunPlayback({ detail, freshness, observationId, onSource }: RunPlaybackProps) {
  const { bundle, receipt } = detail;
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    const index = observationId === undefined ? 0 : bundle.observations.findIndex(observation => observation.id === observationId);
    setSelected(Math.max(0, index));
  }, [bundle.runId, observationId]);
  const index = clampStep(selected, bundle.observations.length);
  const observation = bundle.observations[index];
  const requestedMissing = observationId !== undefined && !bundle.observations.some(item => item.id === observationId);
  const { process, provenance, capture } = bundle;
  const treeState = (dirty: boolean | null, fingerprint: string | null) => `${dirty === null ? "unknown" : dirty ? "dirty" : "clean"}; fingerprint ${fingerprint ?? "unknown"}`;

  return (
    <article className="run-playback" aria-label="Recorded run playback">
      <header className="evidence-section-head">
        <h3>{bundle.scenario.title}</h3>
        {receipt.origin === "synthetic-fixture" && <span className="synthetic">Synthetic</span>}
        <p>{freshnessLabel[freshness]} · {capture.status === "partial" ? "Partial capture" : "Complete capture"}</p>
      </header>
      <p className="evidence-note">Revision <code>{provenance.revision ?? "Unknown"}</code> · {process.termination}, exit code {process.exitCode ?? "unavailable"}</p>
      <p className="evidence-note">Captured values below come from the imported artifact. A process exit code does not establish that a scenario passed.</p>
      <section className="evidence-observations" aria-label="Captured observations">
        <h3>Captured observations</h3>
        {requestedMissing && <p role="alert">The linked observation “{observationId}” is unavailable. Select another recorded step below.</p>}
        {observation ? (
          <>
            <div className="evidence-step-controls">
              <button className="btn" disabled={index === 0} onClick={() => setSelected(index - 1)}>Previous step</button>
              <label>Step <select value={index} onChange={event => setSelected(Number(event.target.value))}>
                {bundle.observations.map((item, position) => <option key={item.id} value={position}>{position + 1}. {item.kind}: {item.title}</option>)}
              </select></label>
              <button className="btn" disabled={index === bundle.observations.length - 1} onClick={() => setSelected(index + 1)}>Next step</button>
            </div>
            <div className="evidence-observation" aria-live="polite">
              <h4>{index + 1} / {bundle.observations.length} · {observation.kind}: {observation.title}</h4>
              <p><code>{observation.id}</code> · sequence {observation.sequence} · received <time>{observation.at}</time>{observation.observedAt && <> · observed <time>{observation.observedAt}</time></>}</p>
              <pre>{JSON.stringify(observation.value, null, 2)}</pre>
              <SourceRefs refs={observation.sourceRefs} onSource={index => onSource(index, observation.id)} />
            </div>
          </>
        ) : <p>No structured observations were captured. Inspect the process result, capture issues and logs; no scenario result can be inferred.</p>}
      </section>
      <dl className="evidence-facts">
        <dt>Run</dt><dd><code>{bundle.runId}</code></dd>
        <dt>Scenario</dt><dd>{bundle.scenario.id} · version {bundle.scenario.version}</dd>
        <dt>Repository</dt><dd>{provenance.repository ? `${provenance.repository.owner}/${provenance.repository.repo}` : "Unknown"}</dd>
        <dt>Revision</dt><dd><code>{provenance.revision ?? "Unknown"}</code></dd>
        <dt>Command argv</dt><dd><pre>{JSON.stringify(process.argv, null, 2)}</pre></dd>
        <dt>Working directory</dt><dd><code>{process.cwd}</code></dd>
        <dt>Started</dt><dd><time>{process.startedAt}</time></dd>
        <dt>Finished</dt><dd><time>{process.finishedAt}</time></dd>
        <dt>Process result</dt><dd>{process.termination} · exit code {process.exitCode ?? "unavailable"} · signal {process.signal ?? "none"}</dd>
        <dt>Capture</dt><dd>{capture.status} · {capture.storedObservations} stored / {capture.receivedObservations} received observations · protocol {capture.protocolVersion}</dd>
        <dt>Producer</dt><dd>{provenance.producer.name} {provenance.producer.version} · origin: {provenance.origin} (producer-reported)</dd>
        <dt>Receipt</dt><dd>{receipt.origin} · imported <time>{receipt.importedAt}</time></dd>
        <dt>Artifact digest</dt><dd><code>{receipt.artifactDigest}</code></dd>
        <dt>Tree before</dt><dd>{treeState(provenance.worktree.before.dirty, provenance.worktree.before.fingerprint)}</dd>
        <dt>Tree after</dt><dd>{treeState(provenance.worktree.after.dirty, provenance.worktree.after.fingerprint)}</dd>
      </dl>
      <p className="evidence-note">Imported provenance is reported, not authenticated. Linked tests are test source.</p>
      {capture.issues.length > 0 && <ul className="evidence-issues">{capture.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
      {receipt.warnings.length > 0 && <ul className="evidence-issues">{receipt.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
      <SourceRefs refs={bundle.sourceRefs} onSource={index => onSource(index)} />
      <details className="evidence-details">
        <summary>Declared inputs and environment</summary>
        <h4>Inputs</h4><pre>{JSON.stringify(bundle.inputs, null, 2)}</pre><p>Digest: <code>{bundle.inputDigest}</code></p>
        <h4>Environment</h4><pre>{JSON.stringify(bundle.environment, null, 2)}</pre><p>Digest: <code>{bundle.environmentDigest}</code></p>
      </details>
      <details className="evidence-details">
        <summary>Process logs{process.stdoutTruncated || process.stderrTruncated ? " · truncated" : ""}</summary>
        <h4>stdout{process.stdoutTruncated ? " (truncated)" : ""}</h4><pre>{process.stdout || "No stdout captured."}</pre>
        <h4>stderr{process.stderrTruncated ? " (truncated)" : ""}</h4><pre>{process.stderr || "No stderr captured."}</pre>
      </details>
    </article>
  );
}
