import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { langOf, layerOf, noiseOf, parsePatch, repositoryPathSchema, revisionSchema, selectRevisionBaseline, type RevisionComparison, type RevisionFileChange, type RevisionFilePayload, type RevisionIndexPayload, type RevisionTreeEntry } from "@review-canvas/shared";
import { atomicSidecar, EvidenceError, MAX_SOURCE_BYTES, pathDigest, readSidecar } from "./evidenceStore.js";
import { relatedReviews, requireReview } from "./evidence.js";
import { fetchExactTree, githubReadTransport, type GitHubReadTransport } from "./github.js";
import { loadState, reviewPath } from "./store.js";

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
    const cached = readSidecar(path) as {beforeSha?: string; afterSha?: string; files?: RevisionFileChange[]} | null;
    if (cached && cached.beforeSha === baseline.headSha && cached.afterSha === pr.headSha && Array.isArray(cached.files)) comparison.files = cached.files;
    else {
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
  const cached = readSidecar(cache) as RevisionFilePayload | null;
  if (cached && cached.beforeSha === beforeSha && cached.afterSha === afterSha && cached.change.path === path) return {...cached, baselineReviewId};
  try {
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
