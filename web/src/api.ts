import type { BehaviorComparison, DeploymentPayload, EvidenceDetailPayload, EvidenceIndex, EvidenceSourcePayload, RevisionFilePayload, RevisionIndexPayload, ReviewPayload, ReviewState, Verdict } from "@review-canvas/shared";

export interface ReviewSummary {
  id: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  publishedAt: string | null;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
  return body;
}

export const fetchReview = (id: string) => fetch(`/api/reviews/${encodeURIComponent(id)}`).then((r) => json<ReviewPayload>(r));
export const fetchReviews = () => fetch("/api/reviews").then((r) => json<{ reviews: ReviewSummary[] }>(r));

export function saveState(id: string, state: ReviewState) {
  const { submitted: _ignored, ...body } = state;
  return fetch(`/api/reviews/${encodeURIComponent(id)}/state`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<{ ok: true }>(r));
}

export function submitReview(id: string, event: Verdict, body: string) {
  return fetch(`/api/reviews/${encodeURIComponent(id)}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, body }),
  }).then((r) => json<{ url: string; submitted: NonNullable<ReviewState["submitted"]> }>(r));
}

export type HeadFileResult = { status: "ready"; lines: string[] } | { status: "removed" | "error"; message: string };

/** The file at the PR head. A 404 means the file is gone or not in the review; anything else that fails is an error to retry. */
export async function fetchHeadFile(reviewId: string, fileId: string): Promise<HeadFileResult> {
  try {
    const res = await fetch(`/api/reviews/${encodeURIComponent(reviewId)}/files/${encodeURIComponent(fileId)}`);
    const body = (await res.json().catch(() => ({}))) as { lines?: string[]; error?: string };
    if (res.ok && body.lines) return { status: "ready", lines: body.lines };
    return { status: res.status === 404 ? "removed" : "error", message: body.error ?? `Request failed (${res.status}).` };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Could not reach the server." };
  }
}


const reviewPath = (id: string) => `/api/reviews/${encodeURIComponent(id)}`;
export const fetchEvidenceIndex = (id: string): Promise<EvidenceIndex> => fetch(`${reviewPath(id)}/evidence`).then(r => json<EvidenceIndex>(r));
export const fetchEvidenceRun = (id: string, runId: string): Promise<EvidenceDetailPayload> => fetch(`${reviewPath(id)}/evidence/${encodeURIComponent(runId)}`).then(r => json<EvidenceDetailPayload>(r));
export function fetchEvidenceSource(id: string, runId: string, ref: number, observation?: string): Promise<EvidenceSourcePayload> {
  const query = new URLSearchParams({ ref: String(ref), ...(observation === undefined ? {} : { observation }) });
  return fetch(`${reviewPath(id)}/evidence/${encodeURIComponent(runId)}/source?${query}`).then(r => json<EvidenceSourcePayload>(r));
}
export function compareEvidenceRuns(id: string, left: string, right: string, mode: "runs" | "base-head" = "base-head"): Promise<BehaviorComparison> {
  const query = new URLSearchParams({ left, right, mode });
  return fetch(`${reviewPath(id)}/evidence/compare?${query}`).then(r => json<BehaviorComparison>(r));
}
export function fetchRevisionComparison(id: string, baseline?: string): Promise<RevisionIndexPayload> {
  const query = baseline === undefined ? "" : `?${new URLSearchParams({ baseline })}`;
  return fetch(`${reviewPath(id)}/revisions${query}`).then(r => json<RevisionIndexPayload>(r));
}
export function fetchRevisionFile(id: string, baseline: string, path: string): Promise<RevisionFilePayload> {
  const query = new URLSearchParams({ baseline, path });
  return fetch(`${reviewPath(id)}/revisions/file?${query}`).then(r => json<RevisionFilePayload>(r));
}
export const fetchDeployment = (id: string): Promise<DeploymentPayload> => fetch(`${reviewPath(id)}/deployment`).then(r => json<DeploymentPayload>(r));
