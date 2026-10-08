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
