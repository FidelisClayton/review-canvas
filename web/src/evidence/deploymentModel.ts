import type { DeploymentPayload, EvidenceIndex, EvidenceRef, SourceRef } from "@review-canvas/shared";

export type DeploymentSection = "schema" | "compatibility" | "backfill" | "rollback";
export interface DeploymentReferenceView {
  ref: EvidenceRef;
  qualifications: string[];
}
export interface DeploymentRow {
  id: string;
  section: DeploymentSection;
  title: string;
  description: string;
  basis: "declared" | "inferred" | "observed";
  result: string;
  appRevision?: string;
  schemaVersion?: string;
  counts?: { processed: number | null; remaining: number | null };
  evidence: DeploymentReferenceView[];
  sources: SourceRef[];
  issues: string[];
  support: "analysis" | "unsupported" | "captured";
  historical: boolean;
}

const qualificationLabels: Record<string, string> = {
  "imported-file": "Imported file; producer not authenticated",
  "synthetic-fixture": "Synthetic fixture; demonstration evidence",
  current: "Reported at current review head; revision not authenticated",
  base: "Reported at PR base; revision not authenticated",
  "other-revision": "Other revision",
  "working-tree": "Working tree differs from the reported revision",
  unknown: "Revision provenance unknown",
  "partial-capture": "Partial capture",
  "producer-reported-import": "Producer reports an imported artifact",
};

export function deploymentRows(payload: DeploymentPayload, index: EvidenceIndex): DeploymentRow[] {
  if (payload.status === "absent") return [];
  const { analysis, validation, historical } = payload;
  const rows: DeploymentRow[] = [];
  const sections = [
    ["schema", analysis.schemaChanges], ["compatibility", analysis.compatibility],
    ["backfill", analysis.backfills], ["rollback", analysis.rollback],
  ] as const;
  for (const [section, items] of sections) for (const item of items) {
    const issues = validation.issues.filter(issue => issue.itemId === item.id).map(issue => issue.reason);
    const evidence = item.evidenceRefs.map(ref => {
      const run = index.runs.find(run => run.runId === ref.runId);
      const reasons = validation.qualifications.filter(value => value.itemId === item.id && value.runId === ref.runId && value.observationId === ref.observationId).flatMap(value => value.reasons);
      if (run) {
        reasons.push(run.receipt.origin, run.freshness, ...run.receipt.warnings);
        if (run.capture.status !== "complete") reasons.push("partial-capture", ...run.capture.issues);
        if (run.provenance.origin === "imported") reasons.push("producer-reported-import");
      } else reasons.push("Run unavailable in the evidence index");
      return { ref, qualifications: [...new Set(reasons.map(reason => qualificationLabels[reason] ?? reason))] };
    });
    const result = "claim" in item ? item.claim : "operation" in item ? item.operation : item.state;
    const support = item.basis !== "observed" ? "analysis" : issues.length > 0 || evidence.length === 0 || result === "unknown" || result === "not_run" ? "unsupported" : "captured";
    rows.push({
      id: item.id, section,
      title: "title" in item ? item.title : "label" in item ? item.label : item.description,
      description: "description" in item && "title" in item ? item.description : "",
      basis: item.basis, result,
      ...("appRevision" in item ? { appRevision: item.appRevision } : {}),
      ...("schemaVersion" in item ? { schemaVersion: item.schemaVersion } : {}),
      ...("processed" in item ? { counts: { processed: item.processed, remaining: item.remaining } } : {}),
      evidence, sources: "sourceRefs" in item ? item.sourceRefs : [], issues, support, historical,
    });
  }
  return rows;
}

export function selectDeploymentItem(rows: DeploymentRow[], selected: string | null): string | null {
  return rows.some(row => row.id === selected) ? selected : rows[0]?.id ?? null;
}

/** The existing source endpoint addresses stored bundle refs, never arbitrary source input. */
export function deploymentSourceTarget(ref: SourceRef, index: EvidenceIndex): { runId: string; refIndex: number } | null {
  for (const run of index.runs) {
    const refIndex = run.sourceBindings.findIndex(({ ref: stored }) => stored.owner === ref.owner && stored.repo === ref.repo && stored.revision === ref.revision && stored.path === ref.path && stored.side === ref.side && stored.startLine === ref.startLine && stored.endLine === ref.endLine);
    if (refIndex >= 0) return { runId: run.runId, refIndex };
  }
  return null;
}
