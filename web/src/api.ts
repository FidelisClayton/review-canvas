import type { ReviewPayload, ReviewState, Verdict } from "@review-canvas/shared";

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
