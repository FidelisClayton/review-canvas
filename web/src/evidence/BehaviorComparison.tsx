import { useEffect, useState } from "react";
import type { BehaviorComparison as Comparison, EvidenceRunSummary, Observation } from "@review-canvas/shared";
import { compareEvidenceRuns } from "../api";
import type { EvidenceSlotContext } from "./EvidencePanel";
import { defaultRunPair, observationValue } from "./comparisonModel";
import { SourceRefs } from "./RunPlayback";
import "./comparison.css";

export function BehaviorComparison({ review, index, active, openRun, openSourceRef }: EvidenceSlotContext) {
  const [selection, setSelection] = useState(() => defaultRunPair(index.runs, review.analysis.pr));
  const [mode, setMode] = useState<"base-head" | "runs">("base-head");
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: Comparison; error?: string } | null>(null);
  const { left, right } = selection;
  const requestKey = JSON.stringify([review.analysis.id, left, right, mode, retry]);
  const current = result?.key === requestKey ? result : null;
  useEffect(() => {
    if (!active || !left || !right || current?.data || current?.error) return;
    let canceled = false;
    compareEvidenceRuns(review.analysis.id, left, right, mode).then(data => {
      if (!canceled) setResult({ key: requestKey, data });
    }, (error: Error) => { if (!canceled) setResult({ key: requestKey, error: error.message }); });
    return () => { canceled = true; };
  }, [active, review.analysis.id, left, right, mode, requestKey, current?.data, current?.error]);
  const comparison = current?.data;
  const leftRun = index.runs.find(run => run.runId === left);
  const rightRun = index.runs.find(run => run.runId === right);

  return <section className="evidence-comparison" aria-label="Behavior comparison">
    <h3>Compare captured behavior</h3>
    <p>Values are aligned by authored observation ID and kind. Differences describe what was captured; they do not establish correctness.</p>
    <label className="comparison-mode">Comparison mode <select value={mode} onChange={event => setMode(event.target.value as "base-head" | "runs")}>
      <option value="base-head">Stored base → head</option><option value="runs">Explicit run pair</option>
    </select></label>
    <p className="evidence-note">Stored base <code>{review.analysis.pr.baseSha ?? "Unavailable in this review"}</code><br />Stored head <code>{review.analysis.pr.headSha}</code></p>
    <div className="comparison-pair">
      {(["left", "right"] as const).map(side => <label className="evidence-run-choice" key={side}>{side === "left" ? "Left run" : "Right run"}<select value={selection[side]} onChange={event => setSelection(value => ({ ...value, [side]: event.target.value }))}>
        <option value="">Select a recorded run</option>
        {index.runs.map(run => <option key={run.runId} value={run.runId}>{run.scenario.title} · {run.runId} · {run.provenance.revision ?? "unknown revision"}</option>)}
      </select></label>)}
    </div>
    {index.runs.length === 0 && <p>No recorded runs are available. Ask the author to record and import the scenarios to compare.</p>}
    {(!left || !right) && index.runs.length > 0 && <p role="status">Choose both runs to compare. A missing stored endpoint is never replaced with another revision.</p>}
    <div className="comparison-pair">
      {leftRun && <RunIdentity side="Left" run={leftRun} onOpen={() => openRun(leftRun.runId)} />}
      {rightRun && <RunIdentity side="Right" run={rightRun} onOpen={() => openRun(rightRun.runId)} />}
    </div>
    {current?.error && <div role="alert"><p>Behavior comparison unavailable: {current.error}</p><button className="btn" onClick={() => setRetry(value => value + 1)}>Retry comparison</button></div>}
    {left && right && !current && <p role="status">Loading captured differences…</p>}
    {comparison && <>
      <section className="comparison-summary" aria-label="Comparability">
        <h4>{comparison.comparable ? "Runs meet comparison requirements" : "Runs are not comparable"}</h4>
        <p>Left revision <code>{comparison.leftRevision ?? "Unknown"}</code><br />Right revision <code>{comparison.rightRevision ?? "Unknown"}</code></p>
        {comparison.reasons.length > 0 && <ul>{comparison.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        {!comparison.comparable && <p>Captured values remain inspectable below. No regression or correctness verdict is inferred.</p>}
      </section>
      <h4>Process outcome · {comparison.process.changed ? "changed" : "unchanged"}</h4>
      <p className="evidence-note">A process exit code of zero does not establish that the scenario passed.</p>
      <div className="comparison-pair"><pre aria-label="Left process outcome">{JSON.stringify(comparison.process.left, null, 2)}</pre><pre aria-label="Right process outcome">{JSON.stringify(comparison.process.right, null, 2)}</pre></div>
      <h3>Captured observation differences</h3>
      {comparison.observations.length === 0 && <p>No structured observations were captured in either run.</p>}
      {comparison.observations.map(item => <article className="comparison-observation" key={`${item.kind}:${item.id}`}>
        <h4><code>{item.id}</code> · {item.kind} · {item.status}</h4>
        <div className="comparison-pair">
          <ObservationValue side="Left" observation={item.left} onOpen={() => openRun(comparison.leftRunId, item.left?.id)} onSource={ref => openSourceRef(comparison.leftRunId, ref, item.left?.id)} />
          <ObservationValue side="Right" observation={item.right} onOpen={() => openRun(comparison.rightRunId, item.right?.id)} onSource={ref => openSourceRef(comparison.rightRunId, ref, item.right?.id)} />
        </div>
      </article>)}
    </>}
  </section>;
}

function RunIdentity({ side, run, onOpen }: { side: string; run: EvidenceRunSummary; onOpen: () => void }) {
  return <section className="comparison-identity" aria-label={`${side} run provenance`}>
    <h4>{side} · {run.runId}</h4>
    <p><code>{run.provenance.revision ?? "Unknown revision"}</code></p>
    <p>{run.scenario.id} · version {run.scenario.version} · {run.capture.status} capture{run.receipt.origin === "synthetic-fixture" ? " · Synthetic" : ""}</p>
    <button className="btn" onClick={onOpen}>Inspect {side.toLowerCase()} run</button>
    <details className="evidence-details"><summary>{side} provenance and capture</summary><pre>{JSON.stringify({ provenance: run.provenance, process: run.process, capture: run.capture, receipt: run.receipt }, null, 2)}</pre></details>
  </section>;
}

function ObservationValue({ side, observation, onOpen, onSource }: { side: string; observation?: Observation; onOpen: () => void; onSource: (index: number) => void }) {
  return <section aria-label={`${side} captured value`}>
    <h4>{side}{observation ? ` · ${observation.title}` : ""}</h4>
    <pre>{observationValue(observation)}</pre>
    {observation && <><button className="btn" onClick={onOpen}>Open {side.toLowerCase()} recorded step</button><SourceRefs refs={observation.sourceRefs} onSource={onSource} />{observation.sourceRefs.length === 0 && <p className="evidence-note">No source references supplied for this observation.</p>}</>}
  </section>;
}
