import { createHash, randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalJson, safeIdSchema, storedExecutionSchema, type JsonValue, type StoredExecution } from "@review-canvas/shared";
import { reviewPath } from "./store.js";

export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_BYTES = 1024 * 1024;
export class EvidenceError extends Error {
  constructor(message: string, public readonly statusCode = 400) { super(message); }
}
export const artifactDigest = (value: unknown) => createHash("sha256").update(canonicalJson(value as JsonValue)).digest("hex");
export function parseArtifact(input: unknown): unknown {
  const text = Buffer.isBuffer(input) ? input.toString("utf8") : typeof input === "string" ? input : JSON.stringify(input);
  if (text === undefined || Buffer.byteLength(text) > MAX_ARTIFACT_BYTES) throw new EvidenceError("Artifact exceeds the 2 MiB size limit or is not JSON.");
  try { return JSON.parse(text) as unknown; } catch { throw new EvidenceError("Artifact is not valid JSON."); }
}
function runPath(id: string, runId: string) {
  if (!safeIdSchema.safeParse(runId).success) throw new EvidenceError("Invalid run id.");
  return reviewPath(id, `evidence/${runId}.json`);
}
export function loadStoredExecution(id: string, runId: string): StoredExecution | null {
  const path = runPath(id, runId);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as StoredExecution;
    storedExecutionSchema.parse(raw);
    if (raw.bundle.runId !== runId || artifactDigest(raw.bundle) !== raw.receipt.artifactDigest) throw new Error("Stored artifact integrity mismatch");
    return raw;
  } catch { throw new EvidenceError(`Invalid evidence sidecar: ${runId}.`, 422); }
}
export function listStoredExecutions(id: string) {
  const folder = reviewPath(id, "evidence");
  const runs: StoredExecution[] = []; const errors: {runId: string; message: string}[] = [];
  if (!existsSync(folder)) return {runs, errors};
  for (const file of readdirSync(folder).filter(file => file.endsWith(".json")).sort()) {
    const runId = file.slice(0, -5);
    try { const run = loadStoredExecution(id, runId); if (run) runs.push(run); }
    catch (error) { errors.push({runId, message: error instanceof Error ? error.message : "Invalid evidence sidecar"}); }
  }
  return {runs, errors};
}
/** An exclusive final link makes duplicate imports safe across separate CLI processes. */
export function saveStoredExecution(id: string, stored: StoredExecution): StoredExecution {
  const path = runPath(id, stored.bundle.runId); mkdirSync(dirname(path), {recursive: true});
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(stored, null, 2) + "\n", {flag: "wx"});
  try {
    try { linkSync(temp, path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = loadStoredExecution(id, stored.bundle.runId);
      if (!current || current.receipt.artifactDigest !== stored.receipt.artifactDigest) throw new EvidenceError(`Run id conflict: ${stored.bundle.runId}.`, 409);
      return current;
    }
    return stored;
  } finally { unlinkSync(temp); }
}
export function atomicSidecar(path: string, value: unknown) {
  mkdirSync(dirname(path), {recursive: true}); const temp = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", {flag: "wx"}); renameSync(temp, path); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
}
export function readSidecar(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as unknown; } catch { throw new EvidenceError("Invalid sidecar JSON.", 422); }
}
export const pathDigest = (path: string) => createHash("sha256").update(path).digest("hex");
