import { z } from "zod";
import type { PrMeta, Review } from "./types.js";
import type { RevisionReviewSummary } from "./comparison.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | {
  [key: string]: JsonValue;
};

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]));

export const safeIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const repositorySchema = z.object({ owner: safeIdSchema, repo: safeIdSchema });

export const revisionSchema = z.string().regex(/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/);

export const repositoryPathSchema = z.string().min(1).max(1000).refine(path => !/[\\:\x00-\x1f\x7f]/.test(path) && path.split("/").every(part => part !== "" && part !== "." && part !== ".."), "Expected a repository-relative path");

export const timestampSchema = z.iso.datetime({ offset: true });

export const targetSchema = repositorySchema.extend({ number: z.number().int().positive() });

export const sourceRefSchema = repositorySchema.extend({
  revision: revisionSchema,
  path: repositoryPathSchema,
  side: z.enum(["LEFT", "RIGHT"]),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
}).refine(ref => ref.endLine >= ref.startLine, "Source range ends before it starts");

export type SourceRef = z.infer<typeof sourceRefSchema>;

export const scenarioSchema = z.object({
  id: safeIdSchema,
  version: z.string().min(1),
  title: z.string().min(1),
});

export const scenarioManifestSchema = z.object({
  version: z.literal(1),
  scenario: scenarioSchema,
  inputs: jsonValueSchema,
  environment: jsonValueSchema,
  goalIds: z.array(safeIdSchema),
  sourceRefs: z.array(sourceRefSchema),
});

export type ScenarioManifest = z.infer<typeof scenarioManifestSchema>;

export const assertionValueSchema = z.object({
  outcome: z.enum(["passed", "failed", "skipped"]),
  expected: jsonValueSchema.optional(),
  actual: jsonValueSchema.optional(),
  message: z.string().optional(),
  context: z.object({ appRevision: revisionSchema, schemaVersion: z.string().min(1) }).optional(),
});

const observationFields = {
  id: safeIdSchema,
  title: z.string().min(1),
  observedAt: timestampSchema.optional(),
  sourceRefs: z.array(sourceRefSchema),
};

export const observationInputSchema = z.discriminatedUnion("kind", [
  z.object({
    ...observationFields,
    kind: z.enum(["input", "output", "response", "record", "event", "job"]),
    value: jsonValueSchema,
  }),
  z.object({
    ...observationFields,
    kind: z.literal("assertion"),
    value: assertionValueSchema,
  }),
]);

const receiptFields = { sequence: z.number().int().nonnegative(), at: timestampSchema };

export const observationSchema = z.discriminatedUnion("kind", [
  observationInputSchema.options[0].extend(receiptFields), observationInputSchema.options[1].extend(receiptFields),
]);

export type ObservationInput = z.infer<typeof observationInputSchema>;

export type Observation = z.infer<typeof observationSchema>;

export type AssertionObservation = Extract<Observation, {
  kind: "assertion";
}>;

const treeStateSchema = z.object({ dirty: z.boolean().nullable(), fingerprint: z.string().min(1).nullable() });

export const provenanceSchema = z.object({
  producer: z.object({ name: z.string().min(1), version: z.string().min(1) }),
  origin: z.enum(["recorded", "imported"]),
  revision: revisionSchema.nullable(),
  repository: repositorySchema.nullable(),
  worktree: z.object({ before: treeStateSchema, after: treeStateSchema }),
});

export type ExecutionProvenance = z.infer<typeof provenanceSchema>;

export const processSchema = z.object({
  argv: z.array(z.string()).min(1),
  cwd: z.union([z.literal("."), repositoryPathSchema]),
  startedAt: timestampSchema,
  finishedAt: timestampSchema,
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  termination: z.enum(["exited", "signaled", "timed_out", "spawn_error", "interrupted"]),
  stdout: z.string(),
  stderr: z.string(),
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean(),
});

export const captureSchema = z.object({
  status: z.enum(["complete", "partial"]),
  issues: z.array(z.string()),
  protocolVersion: z.literal(1),
  receivedObservations: z.number().int().nonnegative(),
  storedObservations: z.number().int().nonnegative(),
});

export const executionBundleSchema = z.object({
  version: z.literal(1),
  runId: safeIdSchema,
  target: targetSchema,
  scenario: scenarioSchema,
  inputs: jsonValueSchema,
  environment: jsonValueSchema,
  inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
  environmentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  goalIds: z.array(safeIdSchema),
  sourceRefs: z.array(sourceRefSchema),
  provenance: provenanceSchema,
  process: processSchema,
  observations: z.array(observationSchema).max(2000),
  capture: captureSchema,
}).superRefine((bundle, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const start = Date.parse(bundle.process.startedAt);
  const finish = Date.parse(bundle.process.finishedAt);
  if (finish < start)
    issue("Process finished before it started");
  const ids = new Set<string>();
  let sequence = -1;
  let at = start;
  for (const observation of bundle.observations) {
    if (ids.has(observation.id))
      issue(`Duplicate observation ID: ${observation.id}`);
    ids.add(observation.id);
    if (observation.sequence <= sequence)
      issue("Observation sequence must increase");
    sequence = observation.sequence;
    const received = Date.parse(observation.at);
    if (received < at || received > finish)
      issue("Observation receipt timestamps must be ordered within process capture");
    at = received;
  }
  if (bundle.capture.storedObservations !== bundle.observations.length || bundle.capture.receivedObservations < bundle.capture.storedObservations)
    issue("Observation counts do not match capture");
  if (bundle.capture.status === "complete" && (bundle.process.stdoutTruncated || bundle.process.stderrTruncated || bundle.process.termination !== "exited" || bundle.capture.issues.length > 0 || bundle.capture.receivedObservations !== bundle.capture.storedObservations))
    issue("Incomplete capture must be marked partial");
  const refs = [...bundle.sourceRefs, ...bundle.observations.flatMap(observation => observation.sourceRefs)];
  for (const ref of refs)
    if (!sameRepository(ref, bundle.target) || !sameRepository(ref, bundle.provenance.repository) || ref.revision !== bundle.provenance.revision)
      issue("Source reference must use the run repository and revision");
  if (bundle.provenance.repository && !sameRepository(bundle.target, bundle.provenance.repository))
    issue("Provenance repository differs from target");
});

export type ExecutionBundle = z.infer<typeof executionBundleSchema>;

export const importReceiptSchema = z.object({
  importedAt: timestampSchema,
  artifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
  origin: z.enum(["imported-file", "synthetic-fixture"]),
  warnings: z.array(z.string()),
});

export type ImportReceipt = z.infer<typeof importReceiptSchema>;

export const storedExecutionSchema = z.object({ bundle: executionBundleSchema, receipt: importReceiptSchema });

export type StoredExecution = z.infer<typeof storedExecutionSchema>;

export type EvidenceDetailPayload = StoredExecution;

/** Canonical declarations retain array order and all captured values. Hashing belongs to server. */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
}

export function sameRepository(left: {
  owner: string;
  repo: string;
}, right: {
  owner: string;
  repo: string;
} | null): boolean {
  return right !== null && left.owner === right.owner && left.repo === right.repo;
}

export function knownCleanWorktree(provenance: ExecutionProvenance): boolean {
  const { before, after } = provenance.worktree;
  return before.dirty === false && after.dirty === false && before.fingerprint !== null && before.fingerprint === after.fingerprint;
}

export type EvidenceFreshness = "current" | "base" | "other-revision" | "working-tree" | "unknown";

export function deriveFreshness(bundle: ExecutionBundle, pr: Pick<PrMeta, "owner" | "repo" | "headSha" | "baseSha">): EvidenceFreshness {
  const provenance = bundle.provenance;
  const { before, after } = provenance.worktree;
  if (!sameRepository(pr, provenance.repository) || !sameRepository(pr, bundle.target) || !provenance.revision)
    return "unknown";
  if (before.dirty === true || after.dirty === true || (before.fingerprint !== null && after.fingerprint !== null && before.fingerprint !== after.fingerprint))
    return "working-tree";
  if (!knownCleanWorktree(provenance))
    return "unknown";
  if (provenance.revision === pr.headSha)
    return "current";
  if (provenance.revision === pr.baseSha)
    return "base";
  return "other-revision";
}

export function summarizeAssertions(bundle: ExecutionBundle): {
  passed: number;
  failed: number;
  skipped: number;
} {
  const counts = {
    passed: 0,
    failed: 0,
    skipped: 0,
  };
  for (const observation of bundle.observations)
    if (observation.kind === "assertion")
      counts[observation.value.outcome]++;
  return counts;
}

export interface EvidenceGoalBinding {
  goalId: string;
  status: "bound" | "unbound";
}

export function bindEvidenceGoals(bundle: ExecutionBundle, review: Review): EvidenceGoalBinding[] {
  const ids = new Set(review.course.goals.map(goal => goal.id));
  return bundle.goalIds.map(goalId => ({ goalId, status: ids.has(goalId) ? "bound" : "unbound" }));
}

export interface ResolvedSourceRef {
  status: "exact-stop" | "exact-file" | "unavailable";
  ref: SourceRef;
  reviewId?: string;
  stop?: {
    reviewId: string;
    goalId: string;
    stopIndex: number;
    hunkId: string;
  };
  reason?: string;
}

export function resolveSourceRef(ref: SourceRef, reviews: Review[], options: {
  leftRevisions?: Record<string, string>;
} = {}): ResolvedSourceRef {
  if (!sourceRefSchema.safeParse(ref).success)
    return {
      status: "unavailable",
      ref,
      reason: "Invalid source reference",
    };
  let fileMatch: Review | undefined;
  for (const review of reviews) {
    const { analysis } = review;
    if (!sameRepository(ref, analysis.pr))
      continue;
    const file = analysis.files.find(file => ref.side === "LEFT" ? (file.previousPath ?? file.path) === ref.path : file.path === ref.path);
    if (!file)
      continue;
    const revision = ref.side === "RIGHT" ? analysis.pr.headSha : options.leftRevisions?.[analysis.id];
    // PR patch LEFT is not established by baseSha: GitHub may diff against the merge base.
    if (ref.side === "LEFT" || revision === ref.revision)
      fileMatch ??= review;
    if (revision !== ref.revision)
      continue;
    for (const goal of review.course.goals)
      for (const [stopIndex, stop] of goal.stops.entries()) {
        const hunk = file.hunks.find(hunk => hunk.id === stop.hunkId);
        if (!hunk)
          continue;
        const overlaps = hunk.lines.slice(stop.from, stop.to + 1).some(line => {
          const number = ref.side === "RIGHT" ? line.newNo : line.oldNo;
          return number !== null && number >= ref.startLine && number <= ref.endLine;
        });
        if (overlaps)
          return {
            status: "exact-stop",
            ref,
            reviewId: analysis.id,
            stop: {
              reviewId: analysis.id,
              goalId: goal.id,
              stopIndex,
              hunkId: stop.hunkId,
            },
          };
      }
  }
  return fileMatch ? {
    status: "exact-file",
    ref,
    reviewId: fileMatch.analysis.id,
  } : {
    status: "unavailable",
    ref,
    reason: "No stored analysis contains this source at the declared revision",
  };
}

export interface EvidenceRunSummary {
  runId: string;
  scenario: ExecutionBundle["scenario"];
  provenance: ExecutionProvenance;
  process: Omit<ExecutionBundle["process"], "stdout" | "stderr">;
  capture: ExecutionBundle["capture"];
  receipt: ImportReceipt;
  freshness: EvidenceFreshness;
  goalBindings: EvidenceGoalBinding[];
  sourceBindings: ResolvedSourceRef[];
  assertions: ReturnType<typeof summarizeAssertions>;
}

export interface EvidenceItemError {
  runId: string;
  message: string;
}

export interface EvidenceIndex {
  version: 1;
  runs: EvidenceRunSummary[];
  errors: EvidenceItemError[];
  previousReviews: RevisionReviewSummary[];
}

export interface EvidenceSourcePayload {
  resolution: ResolvedSourceRef;
  content: string | null;
  unavailableReason?: string;
}
