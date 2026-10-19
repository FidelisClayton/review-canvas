import type { EvidenceRunSummary, JsonValue, PrMeta, RevisionFilePayload, RevisionIndexPayload } from "@review-canvas/shared";

export function defaultRunPair(runs: EvidenceRunSummary[], pr: Pick<PrMeta, "baseSha" | "headSha">): { left: string; right: string } {
  const left = pr.baseSha ? runs.filter(run => run.provenance.revision === pr.baseSha) : [];
  const right = runs.filter(run => run.provenance.revision === pr.headSha);
  const pairedLeft = left.find(a => right.some(b => a.scenario.id === b.scenario.id && a.scenario.version === b.scenario.version));
  const pairedRight = pairedLeft && right.find(b => pairedLeft.scenario.id === b.scenario.id && pairedLeft.scenario.version === b.scenario.version);
  return { left: (pairedLeft ?? left[0])?.runId ?? "", right: (pairedRight ?? right[0])?.runId ?? "" };
}

export function observationValue(observation: { value: JsonValue } | undefined): string {
  return observation === undefined ? "Not captured in this run." : JSON.stringify(observation.value, null, 2);
}

export function revisionAvailability(payload: RevisionIndexPayload): string | null {
  if (!payload.comparison) return payload.unavailableReason ?? "No earlier reviewed revision is available.";
  return payload.comparison.status === "unavailable" ? payload.comparison.unavailableReason ?? "Exact revision comparison is unavailable." : null;
}

export function revisionFileAvailability(payload: RevisionFilePayload): string | null {
  return payload.unavailableReason ?? payload.change?.unavailableReason ?? (!payload.file || payload.patch === null ? "Source diff is unavailable for this file." : null);
}
