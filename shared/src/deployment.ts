import { z } from "zod";
import { deriveFreshness, revisionSchema, safeIdSchema, sameRepository, sourceRefSchema, targetSchema } from "./evidence.js";
import type { AssertionObservation, Observation, StoredExecution } from "./evidence.js";

export const evidenceRefSchema = z.object({ runId: safeIdSchema, observationId: safeIdSchema });

export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

const references = { evidenceRefs: z.array(evidenceRefSchema) };

const sourced = { ...references, sourceRefs: z.array(sourceRefSchema) };

const basis = z.enum(["declared", "inferred", "observed"]);

export const schemaChangeSchema = z.object({
  id: safeIdSchema,
  title: z.string().min(1),
  operation: z.enum(["expand", "contract", "data", "other"]),
  description: z.string(),
  basis: z.enum(["declared", "inferred"]),
  ...sourced,
});

export const compatibilityCaseSchema = z.object({
  id: safeIdSchema,
  appRevision: revisionSchema,
  schemaVersion: z.string().min(1),
  label: z.string().min(1),
  claim: z.enum(["compatible", "incompatible", "unknown", "not_run"]),
  basis,
  ...references,
});

export const backfillSchema = z.object({
  id: safeIdSchema,
  title: z.string().min(1),
  state: z.enum(["not_run", "running", "completed", "failed", "unknown"]),
  processed: z.number().int().nonnegative().nullable(),
  remaining: z.number().int().nonnegative().nullable(),
  basis,
  ...sourced,
});

export const rollbackConstraintSchema = z.object({
  id: safeIdSchema,
  description: z.string().min(1),
  state: z.enum(["reversible", "constrained", "irreversible", "unknown", "not_run"]),
  appRevision: revisionSchema.optional(),
  schemaVersion: z.string().min(1).optional(),
  basis,
  ...sourced,
}).superRefine((item, ctx) => {
  if (item.basis === "observed" && (!item.appRevision || !item.schemaVersion))
    ctx.addIssue({ code: "custom", message: "Observed rollback requires an explicit appRevision and schemaVersion" });
});

export const deploymentAnalysisSchema = z.object({
  version: z.literal(1),
  target: targetSchema.extend({ headSha: revisionSchema }),
  schemaChanges: z.array(schemaChangeSchema),
  compatibility: z.array(compatibilityCaseSchema),
  backfills: z.array(backfillSchema),
  rollback: z.array(rollbackConstraintSchema),
}).superRefine((document, ctx) => {
  const ids = new Set<string>();
  for (const item of [...document.schemaChanges, ...document.compatibility, ...document.backfills, ...document.rollback]) {
    if (ids.has(item.id))
      ctx.addIssue({ code: "custom", message: `Duplicate deployment item ID: ${item.id}` });
    ids.add(item.id);
  }
});

export type DeploymentAnalysis = z.infer<typeof deploymentAnalysisSchema>;

export type SchemaChange = z.infer<typeof schemaChangeSchema>;

export type CompatibilityCase = z.infer<typeof compatibilityCaseSchema>;

export type Backfill = z.infer<typeof backfillSchema>;

export type RollbackConstraint = z.infer<typeof rollbackConstraintSchema>;

export interface DeploymentEvidenceIssue {
  itemId: string;
  reason: string;
}

export interface DeploymentEvidenceQualification {
  itemId: string;
  runId: string;
  observationId: string;
  reasons: string[];
}

export interface DeploymentEvidenceValidation {
  valid: boolean;
  issues: DeploymentEvidenceIssue[];
  qualifications: DeploymentEvidenceQualification[];
}

export type DeploymentPayload = {
  status: "absent";
} | {
  status: "available";
  analysis: DeploymentAnalysis;
  validation: DeploymentEvidenceValidation;
  historical: boolean;
};

function assertionMatches(observation: Observation, appRevision: string | undefined, schemaVersion: string | undefined, actual: string): observation is AssertionObservation {
  return observation.kind === "assertion" && appRevision !== undefined && schemaVersion !== undefined && observation.value.context?.appRevision === appRevision && observation.value.context.schemaVersion === schemaVersion && observation.value.outcome !== "skipped" && observation.value.actual === actual;
}

/** Evidence can substantiate a captured claim without authenticating its producer or freshness. */
export function validateDeploymentEvidence(document: DeploymentAnalysis, runs: StoredExecution[]): DeploymentEvidenceValidation {
  const issues: DeploymentEvidenceIssue[] = [];
  const qualifications: DeploymentEvidenceQualification[] = [];
  const byId = new Map(runs.map(run => [run.bundle.runId, run]));
  const items = [...document.schemaChanges, ...document.compatibility, ...document.backfills, ...document.rollback];
  for (const item of items) {
    const observations: Observation[] = [];
    for (const ref of item.evidenceRefs) {
      const run = byId.get(ref.runId);
      const observation = run?.bundle.observations.find(observation => observation.id === ref.observationId);
      if (!run || !observation || !sameRepository(document.target, run.bundle.target) || document.target.number !== run.bundle.target.number) {
        if (item.basis === "observed")
          issues.push({ itemId: item.id, reason: `Evidence reference unavailable: ${ref.runId}/${ref.observationId}` });
        continue;
      }
      observations.push(observation);
      const freshness = deriveFreshness(run.bundle, document.target);
      const reasons: string[] = [run.receipt.origin];
      if (freshness !== "current")
        reasons.push(freshness);
      if (run.bundle.capture.status !== "complete")
        reasons.push("partial-capture");
      if (run.bundle.provenance.origin === "imported")
        reasons.push("producer-reported-import");
      qualifications.push({
        itemId: item.id,
        ...ref,
        reasons,
      });
    }
    if (item.basis !== "observed")
      continue;
    let supported = false;
    if ("claim" in item) {
      supported = (item.claim === "compatible" || item.claim === "incompatible") && observations.some(observation => assertionMatches(observation, item.appRevision, item.schemaVersion, item.claim));
    }
    else if ("processed" in item) {
      supported = observations.some(observation => {
        if (observation.kind !== "output" && observation.kind !== "record" && observation.kind !== "assertion") return false;
        if (observation.kind === "assertion" && observation.value.outcome === "skipped") return false;
        const value = observation.kind === "assertion" ? observation.value.actual : observation.value;
        return value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value) && "state" in value && "processed" in value && "remaining" in value && value.state === item.state && value.processed === item.processed && value.remaining === item.remaining;
      });
    }
    else if ("state" in item) {
      supported = !["unknown", "not_run"].includes(item.state) && observations.some(observation => assertionMatches(observation, item.appRevision, item.schemaVersion, item.state));
    }
    if (!supported)
      issues.push({
        itemId: item.id,
        reason: "Observed claim lacks a matching captured value and assertion context/outcome",
      });
  }
  return {
    valid: issues.length === 0,
    issues,
    qualifications,
  };
}
