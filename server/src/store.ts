import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { draftReview, emptyState, type Analysis, type Review, type ReviewState } from "@review-canvas/shared";
import { reviewsDir } from "./config.js";

// One directory per review: analysis.json (deterministic), review.json (published course),
// state.json (the reviewer's punches and drafts). Plain files, written atomically.

const SAFE_ID = /^[A-Za-z0-9._-]+$/;

function dir(id: string) {
  if (!SAFE_ID.test(id)) throw new Error(`Invalid review id "${id}".`);
  return join(reviewsDir(), id);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, path);
}

export function saveAnalysis(analysis: Analysis) {
  const existing = loadAnalysis(analysis.id) ?? readJson<Review>(join(dir(analysis.id), "review.json"))?.analysis;
  if (existing && (existing.pr.owner !== analysis.pr.owner || existing.pr.repo !== analysis.pr.repo || existing.pr.number !== analysis.pr.number || existing.pr.headSha !== analysis.pr.headSha)) {
    throw new Error(`Review identity collision: ${analysis.id}.`);
  }
  mkdirSync(dir(analysis.id), { recursive: true });
  writeJson(join(dir(analysis.id), "analysis.json"), analysis);
}

export const loadAnalysis = (id: string) => readJson<Analysis>(join(dir(id), "analysis.json"));

export function saveReview(review: Review) {
  mkdirSync(dir(review.analysis.id), { recursive: true });
  writeJson(join(dir(review.analysis.id), "review.json"), review);
}

/** The published review, or the server's default course when no agent has published yet. */
export function loadReview(id: string): Review | null {
  const published = readJson<Review>(join(dir(id), "review.json"));
  if (published?.version === 2) return published;
  const analysis = loadAnalysis(id) ?? published?.analysis;
  if (!analysis) return null;
  // A review published in the old file-based format has no goals; the web app asks for a republish.
  return { ...draftReview(analysis), ...(published ? { outdated: true } : {}) };
}

/** Only the v2 keys are read, so a state.json from before (with `punched`) loads as unread. */
export function loadState(id: string): ReviewState {
  const s = readJson<Partial<ReviewState>>(join(dir(id), "state.json")) ?? {};
  const d = emptyState();
  return {
    read: s.read ?? d.read,
    reviewed: s.reviewed ?? d.reviewed,
    drafts: s.drafts ?? d.drafts,
    verdict: s.verdict ?? d.verdict,
    summary: s.summary ?? d.summary,
    submitted: s.submitted ?? d.submitted,
  };
}

/** A file's text at the PR head, cached by file id after the first fetch. */
export function loadHeadFile(id: string, fileId: string): string | null {
  try {
    return readFileSync(join(dir(id), "heads", `${fileId}.txt`), "utf8");
  } catch {
    return null;
  }
}

export function saveHeadFile(id: string, fileId: string, text: string) {
  if (!SAFE_ID.test(fileId)) throw new Error(`Invalid file id "${fileId}".`);
  mkdirSync(join(dir(id), "heads"), { recursive: true });
  const path = join(dir(id), "heads", `${fileId}.txt`);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export function saveState(id: string, state: ReviewState) {
  mkdirSync(dir(id), { recursive: true });
  writeJson(join(dir(id), "state.json"), state);
}

export const reviewPath = (id: string, file: string) => join(dir(id), file);

export interface ReviewSummary {
  id: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  publishedAt: string | null;
}

export function listReviews(): ReviewSummary[] {
  if (!existsSync(reviewsDir())) return [];
  return readdirSync(reviewsDir())
    .filter((id) => SAFE_ID.test(id))
    .map((id) => loadReview(id))
    .filter((r): r is Review => r !== null)
    .map((r) => ({
      id: r.analysis.id,
      repo: `${r.analysis.pr.owner}/${r.analysis.pr.repo}`,
      number: r.analysis.pr.number,
      title: r.analysis.pr.title,
      author: r.analysis.pr.author,
      publishedAt: r.publishedAt,
    }))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}
