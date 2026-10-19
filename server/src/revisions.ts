import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { canonicalJson, jsonValueSchema, LAYERS, safeIdSchema, targetSchema, langOf, layerOf, noiseOf, parsePatch, repositoryPathSchema, revisionSchema, selectRevisionBaseline, type RevisionComparison, type RevisionFileChange, type RevisionFilePayload, type RevisionIndexPayload, type RevisionTreeEntry } from "@review-canvas/shared";
import { atomicSidecar, EvidenceError, MAX_SOURCE_BYTES, pathDigest, readSidecar } from "./evidenceStore.js";
import { relatedReviews, requireReview } from "./evidence.js";
import { fetchExactTree, githubReadTransport, type GitHubReadTransport } from "./github.js";
import { loadState, reviewPath } from "./store.js";

const treeEntrySchema = z.object({
  path: repositoryPathSchema, sha: revisionSchema,
  mode: z.enum(["100644", "100755", "120000", "160000"]), type: z.enum(["blob", "commit"]),
}).refine(entry => (entry.mode === "160000") === (entry.type === "commit"));
const changeSchema = z.object({
  path: repositoryPathSchema, status: z.enum(["added", "removed", "modified"]),
  before: treeEntrySchema.nullable(), after: treeEntrySchema.nullable(), unavailableReason: z.string().optional(),
}).refine(change => {
  if ((change.before && change.before.path !== change.path) || (change.after && change.after.path !== change.path)) return false;
  if (change.status === "added") return change.before === null && change.after !== null;
  if (change.status === "removed") return change.before !== null && change.after === null;
  return change.before !== null && change.after !== null && !sameEntry(change.before, change.after);
});
const inventoryCacheSchema = z.object({beforeSha: revisionSchema, afterSha: revisionSchema, files: z.array(changeSchema)})
  .refine(cache => new Set(cache.files.map(file => file.path)).size === cache.files.length);
const lineSchema = z.object({kind: z.enum(["add", "del", "ctx"]), text: z.string(), oldNo: z.number().int().nonnegative().nullable(), newNo: z.number().int().nonnegative().nullable()});
const renderFileSchema = z.object({
  id: safeIdSchema, path: repositoryPathSchema, previousPath: repositoryPathSchema.optional(), status: z.enum(["added", "removed", "modified"]),
  additions: z.number().int().nonnegative(), deletions: z.number().int().nonnegative(), lang: z.string(), layer: z.enum(LAYERS),
  noise: z.enum(["tests", "i18n", "api", "generated"]).nullable(), noiseReason: z.string().optional(), subjectOf: z.string().optional(), generatedFrom: z.string().optional(),
  patchMissing: z.literal(false), hunks: z.array(z.object({id: safeIdSchema, range: z.string(), section: z.string(), lines: z.array(lineSchema)})),
});
const fileCacheSchema = z.object({
  baselineReviewId: safeIdSchema, target: targetSchema, beforeSha: revisionSchema, afterSha: revisionSchema, change: changeSchema,
  patch: z.string().nullable(), file: renderFileSchema.nullable(), unavailableReason: z.string().optional(),
}).refine(cache => {
  if (cache.patch === null || cache.file === null) return cache.patch === null && cache.file === null && !!cache.unavailableReason;
  if (cache.file.path !== cache.change.path || cache.file.status !== cache.change.status) return false;
  const hunks = parsePatch(cache.file.id, cache.patch);
  if (canonicalJson(jsonValueSchema.parse(hunks)) !== canonicalJson(jsonValueSchema.parse(cache.file.hunks))) return false;
  const lines = hunks.flatMap(hunk => hunk.lines);
  return cache.file.additions === lines.filter(line => line.kind === "add").length && cache.file.deletions === lines.filter(line => line.kind === "del").length;
});
function sameEntry(left: RevisionTreeEntry | null, right: RevisionTreeEntry | null): boolean {
  return left === null || right === null ? left === right : left.path === right.path && left.sha === right.sha && left.mode === right.mode && left.type === right.type;
}
function sameChange(left: RevisionFileChange, right: RevisionFileChange): boolean {
  return left.path === right.path && left.status === right.status && sameEntry(left.before, right.before) && sameEntry(left.after, right.after);
}

function cachePath(id: string, before: string, after: string, file: string) {
  if (!revisionSchema.safeParse(before).success || !revisionSchema.safeParse(after).success) throw new EvidenceError("Exact full endpoint revisions are unavailable.");
  return reviewPath(id, `revisions/${before}-${after}/${file}`);
}
function inventory(left: RevisionTreeEntry[], right: RevisionTreeEntry[]): RevisionFileChange[] {
  const before = new Map(left.map(entry => [entry.path, entry])); const after = new Map(right.map(entry => [entry.path, entry]));
  const changes: RevisionFileChange[] = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    if (!repositoryPathSchema.safeParse(path).success) throw new EvidenceError("GitHub tree contains an invalid repository path.", 502);
    const a = before.get(path) ?? null; const b = after.get(path) ?? null;
    if (a && b && a.sha === b.sha && a.mode === b.mode && a.type === b.type) continue;
    changes.push({path, status: !a ? "added" : !b ? "removed" : "modified", before: a, after: b});
  }
  return changes;
}
export async function getRevisions(id: string, baselineId?: string, transport: GitHubReadTransport = githubReadTransport): Promise<RevisionIndexPayload> {
  const current = requireReview(id); const candidates = relatedReviews(current).map(review => ({review, state: loadState(review.analysis.id)}));
  const selection = selectRevisionBaseline(current, candidates, baselineId);
  const {selected: baseline, alternatives, unavailableReason} = selection;
  if (!baseline) return {baseline, alternatives, comparison: null, unavailableReason};
  const pr = current.analysis.pr;
  const comparison: RevisionComparison = {baselineReviewId: baseline.reviewId, owner: pr.owner, repo: pr.repo, number: pr.number, beforeSha: baseline.headSha, afterSha: pr.headSha, reviewedAt: baseline.reviewedAt!, status: "available", files: []};
  try {
    const path = cachePath(id, baseline.headSha, pr.headSha, "inventory.json");
    const cached = readSidecar(path);
    if (cached !== null) {
      const parsed = inventoryCacheSchema.safeParse(cached);
      if (!parsed.success || parsed.data.beforeSha !== baseline.headSha || parsed.data.afterSha !== pr.headSha) throw new EvidenceError("Invalid revision inventory cache.", 422);
      comparison.files = parsed.data.files;
    } else {
      const [left, right] = await Promise.all([fetchExactTree(pr, baseline.headSha, transport), fetchExactTree(pr, pr.headSha, transport)]);
      comparison.files = inventory(left, right);
      atomicSidecar(path, {beforeSha: baseline.headSha, afterSha: pr.headSha, files: comparison.files});
    }
  } catch (error) {
    comparison.status = "unavailable"; comparison.unavailableReason = error instanceof Error ? error.message : "Exact endpoint trees could not be fetched.";
  }
  return {baseline, alternatives, comparison};
}

function diffText(left: string, right: string): Promise<string> {
  const folder = mkdtempSync(join(tmpdir(), "review-canvas-diff-"));
  writeFileSync(join(folder, "before"), left); writeFileSync(join(folder, "after"), right);
  return new Promise((resolve, reject) => {
    execFile("git", ["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--no-color", "--", "before", "after"], {cwd: folder, encoding: "utf8", maxBuffer: 10 * 1024 * 1024}, (error, stdout, stderr) => {
      rmSync(folder, {recursive: true, force: true});
      if (error && error.code !== 1) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout);
    });
  });
}
export async function getRevisionFile(id: string, baselineId: string | undefined, path: string, transport: GitHubReadTransport = githubReadTransport): Promise<RevisionFilePayload> {
  if (!repositoryPathSchema.safeParse(path).success) throw new EvidenceError("Invalid repository path.");
  const index = await getRevisions(id, baselineId, transport); const comparison = index.comparison;
  if (!comparison || comparison.status !== "available") throw new EvidenceError(comparison?.unavailableReason ?? index.unavailableReason ?? "Revision comparison unavailable.", 422);
  const change = comparison.files.find(file => file.path === path);
  if (!change) throw new EvidenceError("Path is outside the selected comparison inventory.", 404);
  const {owner, repo, number, beforeSha, afterSha, baselineReviewId} = comparison;
  const payload: RevisionFilePayload = {baselineReviewId, target: {owner, repo, number}, beforeSha, afterSha, change, patch: null, file: null};
  const cache = cachePath(id, beforeSha, afterSha, `files/${pathDigest(path)}.json`);
  const unavailable = (reason: string): RevisionFilePayload => ({...payload, change: {...change, unavailableReason: reason}, unavailableReason: reason});
  if ([change.before, change.after].some(entry => entry && (entry.type === "commit" || entry.mode === "160000"))) return unavailable("Submodule contents are unavailable as a text diff.");
  if ([change.before, change.after].some(entry => entry?.mode === "120000")) return unavailable("Symbolic link contents are unavailable as a regular text diff.");
  if ([change.before, change.after].some(entry => entry && entry.type !== "blob")) return unavailable("This object type cannot be rendered as a text diff.");
  try {
    const cached = readSidecar(cache);
    if (cached !== null) {
      const parsed = fileCacheSchema.safeParse(cached);
      if (!parsed.success || parsed.data.beforeSha !== beforeSha || parsed.data.afterSha !== afterSha ||
          parsed.data.target.owner !== owner || parsed.data.target.repo !== repo || parsed.data.target.number !== number || !sameChange(parsed.data.change, change)) return unavailable("Invalid revision file cache.");
      return {...parsed.data, baselineReviewId};
    }
    const text = async (entry: RevisionTreeEntry | null, sha: string) => {
      if (!entry) return "";
      const content = await transport.readFile(payload.target, sha, path);
      if (Buffer.byteLength(content) > MAX_SOURCE_BYTES) throw new Error("Text exceeds the 1 MiB per-side size limit.");
      if (content.includes("\0")) throw new Error("Binary content cannot be rendered as a text diff.");
      return content;
    };
    const [left, right] = await Promise.all([text(change.before, beforeSha), text(change.after, afterSha)]);
    const rawPatch = await diffText(left, right);
    const patch = rawPatch.replace(/^diff --git a\/before b\/after$/m, `diff --git a/${path} b/${path}`).replace(/^--- a\/before$/m, `--- ${change.before ? `a/${path}` : "/dev/null"}`).replace(/^\+\+\+ b\/after$/m, `+++ ${change.after ? `b/${path}` : "/dev/null"}`);
    const fileId = `revision-${pathDigest(path).slice(0, 16)}`; const hunks = parsePatch(fileId, patch); const noise = noiseOf(path, right || left);
    const lines = hunks.flatMap(hunk => hunk.lines);
    const result: RevisionFilePayload = {...payload, patch, file: {id: fileId, path, status: change.status, additions: lines.filter(line => line.kind === "add").length, deletions: lines.filter(line => line.kind === "del").length, lang: langOf(path), layer: layerOf(path), noise: noise?.kind ?? null, ...(noise ? {noiseReason: noise.reason} : {}), patchMissing: false, hunks}};
    atomicSidecar(cache, result);
    return result;
  } catch (error) { return unavailable(error instanceof Error ? error.message : "Exact endpoint content unavailable."); }
}
