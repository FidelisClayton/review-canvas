import { useEffect, useRef, useState, type ReactNode } from "react";
import { deriveFreshness, langOf, type EvidenceDetailPayload, type EvidenceIndex, type EvidenceSourcePayload, type ResolvedSourceRef, type Review } from "@review-canvas/shared";
import { fetchEvidenceIndex, fetchEvidenceRun, fetchEvidenceSource } from "../api";
import { DiffRow } from "../course/StopView";
import { currentSourceStop, filterRuns, selectRun } from "./model";
import { freshnessLabel, RunPlayback } from "./RunPlayback";
import { BehaviorComparison } from "./BehaviorComparison";
import { RevisionComparison } from "./RevisionComparison";
import { DeploymentView } from "./DeploymentView";
import "./evidence.css";

export type EvidenceTab = "runs" | "compare" | "revisions" | "deployment";
export interface EvidencePanelActions {
  openRun: (runId: string, observationId?: string) => void;
  inspectSource: (payload: EvidenceSourcePayload) => void;
  openSourceRef: (runId: string, refIndex: number, observationId?: string) => void;
}
export interface EvidenceSlotContext extends EvidencePanelActions {
  review: Review;
  index: EvidenceIndex;
  active: boolean;
  selectedRunId: string | null;
}
export interface EvidencePanelProps {
  review: Review;
  goalId: string | null;
  onClose: () => void;
  onSource: (resolution: ResolvedSourceRef) => void;
  slots?: Partial<Record<Exclude<EvidenceTab, "runs">, (context: EvidenceSlotContext) => ReactNode>>;
}
const tabs: [EvidenceTab, string][] = [["runs", "Runs"], ["compare", "Compare"], ["revisions", "Since reviewed"], ["deployment", "Deployment"]];

export function EvidencePanel({ review, goalId, onClose, onSource, slots }: EvidencePanelProps) {
  const [tab, setTab] = useState<EvidenceTab>("runs");
  const [visited, setVisited] = useState<EvidenceTab[]>(["runs"]);
  const [returnTab, setReturnTab] = useState<EvidenceTab | null>(null);
  const [index, setIndex] = useState<EvidenceIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [allGoals, setAllGoals] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [linkedRunId, setLinkedRunId] = useState<string | null>(null);
  const [observationId, setObservationId] = useState<string | undefined>();
  const [detail, setDetail] = useState<EvidenceDetailPayload | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runRetry, setRunRetry] = useState(0);
  const [source, setSource] = useState<EvidenceSourcePayload | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const sourceRequest = useRef(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
    return () => { sourceRequest.current++; document.querySelector<HTMLButtonElement>("[data-evidence-toggle]")?.focus(); };
  }, []);
  useEffect(() => {
    let canceled = false;
    setIndexError(null);
    fetchEvidenceIndex(review.analysis.id).then(value => { if (!canceled) setIndex(value); }, (error: Error) => { if (!canceled) setIndexError(error.message); });
    return () => { canceled = true; };
  }, [review.analysis.id, retry]);

  const runs = filterRuns(index?.runs ?? [], allGoals ? null : goalId);
  const runId = linkedRunId ?? selectRun(runs, selected);
  const summary = runs.find(run => run.runId === runId);
  useEffect(() => {
    let canceled = false;
    setDetail(null);
    setRunError(null);
    if (runId) fetchEvidenceRun(review.analysis.id, runId).then(value => { if (!canceled) setDetail(value); }, (error: Error) => { if (!canceled) setRunError(error.message); });
    return () => { canceled = true; };
  }, [review.analysis.id, runId, runRetry]);

  function showTab(next: EvidenceTab) {
    sourceRequest.current++;
    setSource(null);
    setSourceError(null);
    setSourceLoading(false);
    setTab(next);
    setVisited(tabs => tabs.includes(next) ? tabs : [...tabs, next]);
  }
  function openRun(nextRunId: string, nextObservationId?: string) {
    if (tab !== "runs") setReturnTab(tab);
    setAllGoals(true);
    setSelected(nextRunId);
    setLinkedRunId(nextRunId);
    setObservationId(nextObservationId);
    showTab("runs");
  }
  function inspectSource(payload: EvidenceSourcePayload) {
    sourceRequest.current++;
    setSource(payload);
    setSourceError(null);
    setSourceLoading(false);
  }
  async function openSourceRef(nextRunId: string, refIndex: number, nextObservationId?: string) {
    const request = ++sourceRequest.current;
    setSource(null);
    setSourceLoading(true);
    setSourceError(null);
    try {
      const payload = await fetchEvidenceSource(review.analysis.id, nextRunId, refIndex, nextObservationId);
      if (request === sourceRequest.current) setSource(payload);
    } catch (error) {
      if (request === sourceRequest.current) setSourceError(error instanceof Error ? error.message : String(error));
    } finally {
      if (request === sourceRequest.current) setSourceLoading(false);
    }
  }
  const inspectingSource = source !== null || sourceLoading || sourceError !== null;

  return (
    <section className="evidence-panel" aria-label="Review evidence" data-evidence-panel>
      <header className="evidence-head">
        <div><h2>Evidence</h2><p>Recorded results for this review. Source tests remain source.</p></div>
        <button ref={closeButton} className="btn" onClick={onClose}>Return to source <kbd>Esc</kbd></button>
      </header>
      <nav className="evidence-tabs" aria-label="Evidence sections">
        {tabs.map(([value, label]) => <button key={value} aria-current={tab === value ? "page" : undefined} onClick={() => { setReturnTab(null); showTab(value); }}>{label}</button>)}
      </nav>
      <div className="evidence-body">
        {!index && !indexError && <p role="status">Loading recorded evidence…</p>}
        {indexError && <div role="alert"><p>Could not load evidence: {indexError}</p><button className="btn" onClick={() => setRetry(n => n + 1)}>Retry evidence</button></div>}
        {index && <>
          <div hidden={!inspectingSource}>
            <button className="btn" onClick={() => { sourceRequest.current++; setSource(null); setSourceError(null); setSourceLoading(false); }}>Back to {tabs.find(([value]) => value === tab)?.[1]}</button>
            {sourceLoading && <p role="status">Loading exact source…</p>}
            {sourceError && <p role="alert">Could not load source: {sourceError}. Return to the recorded reference to retry.</p>}
            {source && <ExactSource payload={source} review={review} onSource={onSource} />}
          </div>
          <div hidden={tab !== "runs" || inspectingSource}>
            {returnTab && <button className="btn" onClick={() => { showTab(returnTab); setReturnTab(null); }}>Back to {tabs.find(([value]) => value === returnTab)?.[1]}</button>}
            <div className="evidence-filter">
              <label><input type="checkbox" checked={allGoals || goalId === null} disabled={goalId === null} onChange={event => { setAllGoals(event.target.checked); setLinkedRunId(null); setObservationId(undefined); }} /> All goals</label>
              <span>{!allGoals && goalId ? `Goal: ${review.course.goals.find(goal => goal.id === goalId)?.title ?? goalId}` : "All recorded runs"}</span>
            </div>
            {index.errors.length > 0 && <div className="evidence-issues" role="alert"><p>Some evidence could not be read. Ask the author to inspect or replace these artifacts.</p><ul>{index.errors.map(error => <li key={error.runId}><code>{error.runId}</code>: {error.message}</li>)}</ul></div>}
            {runs.length === 0 && !linkedRunId ? <p>{index.runs.length === 0 ? "No recorded runs were supplied. Ask the author to record a scenario and import its artifact with the CLI." : "No recorded runs are bound to this goal. Choose All goals to inspect other runs."}</p> : <>
              <label className="evidence-run-choice">Recorded run <select value={runId ?? ""} onChange={event => { setSelected(event.target.value); setLinkedRunId(null); setObservationId(undefined); }}>
                {linkedRunId && !runs.some(run => run.runId === linkedRunId) && <option value={linkedRunId}>Unavailable run: {linkedRunId}</option>}
                {runs.map(run => <option value={run.runId} key={run.runId}>{run.scenario.title} · {run.runId} · {freshnessLabel[run.freshness]}{run.receipt.origin === "synthetic-fixture" ? " · Synthetic" : ""} · {run.capture.status} · {run.process.termination}, exit {run.process.exitCode ?? "unknown"}</option>)}
              </select></label>
              {summary && <p className="evidence-note">Captured assertions: {summary.assertions.passed} passed · {summary.assertions.failed} failed · {summary.assertions.skipped} skipped. {summary.goalBindings.some(binding => binding.status === "unbound") && "Includes unbound goal associations."}</p>}
              {runError ? <div role="alert"><p>Could not load this run: {runError}</p><button className="btn" onClick={() => setRunRetry(n => n + 1)}>Retry run</button></div> : detail && detail.bundle.runId === runId ? <RunPlayback key={runId} detail={detail} freshness={deriveFreshness(detail.bundle, review.analysis.pr)} observationId={observationId} onSource={(refIndex, observation) => void openSourceRef(runId!, refIndex, observation)} /> : <p role="status">Loading recorded run…</p>}
            </>}
          </div>
          {tabs.filter(([value]) => value !== "runs" && visited.includes(value)).map(([value, label]) => <div key={value} hidden={tab !== value || inspectingSource}>
            {(() => {
              const context: EvidenceSlotContext = { review, index, active: tab === value && !inspectingSource, selectedRunId: runId, openRun, inspectSource, openSourceRef };
              const slot = slots?.[value as Exclude<EvidenceTab, "runs">];
              if (slot) return slot(context);
              if (value === "compare") return <BehaviorComparison {...context} />;
              if (value === "revisions") return <RevisionComparison {...context} />;
              if (value === "deployment") return <DeploymentView {...context} />;
              return <p>{label} view is not available in this build.</p>;
            })()}
          </div>)}
        </>}
      </div>
    </section>
  );
}

function ExactSource({ payload, review, onSource }: { payload: EvidenceSourcePayload; review: Review; onSource: (resolution: ResolvedSourceRef) => void }) {
  const { resolution, content } = payload;
  const { ref } = resolution;
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = body.current?.querySelector<HTMLElement>(".ln.mark");
    if (first && body.current) body.current.scrollTop += first.getBoundingClientRect().top - body.current.getBoundingClientRect().top - 60;
  }, [payload]);
  return <section className="evidence-exact-source">
    <h3>Exact source · read-only</h3>
    <p>{ref.owner}/{ref.repo} · {ref.path}:{ref.startLine}–{ref.endLine} · {ref.side}</p>
    <p>Revision <code>{ref.revision}</code></p>
    {currentSourceStop(resolution, review) && <button className="btn" onClick={() => onSource(resolution)}>Open this source stop</button>}
    {content === null ? <p>{payload.unavailableReason ?? resolution.reason ?? "Exact source is unavailable. Ask the author to supply this revision."}</p> : <div className="evidence-source-code code" ref={body}><div className="codein">{content.split("\n").map((text, i) => <DiffRow key={i} kind="ctx" no={i + 1} text={text} lang={langOf(ref.path)} mark={i + 1 >= ref.startLine && i + 1 <= ref.endLine} />)}</div></div>}
    <p className="evidence-note">Inspecting this source does not add read marks or create comment anchors.</p>
  </section>;
}
