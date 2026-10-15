import { useEffect, useSyncExternalStore } from "react";
import { fetchHeadFile } from "../api";
import { useCourse } from "./ctx";

export interface HeadFile {
  status: "loading" | "ready" | "removed" | "error";
  /** The file's lines, when ready. */
  lines?: string[];
  /** The server's message, when removed or failed. */
  message?: string;
  /** Fetch again; set on errors only. */
  retry?: () => void;
}

const LOADING: HeadFile = { status: "loading" };
const cache = new Map<string, HeadFile>();
const started = new Set<string>();
const subs = new Set<() => void>();

function load(reviewId: string, fileId: string, key: string) {
  started.add(key);
  void fetchHeadFile(reviewId, fileId).then((r) => {
    const retry = () => {
      cache.delete(key);
      subs.forEach((s) => s());
      load(reviewId, fileId, key);
    };
    cache.set(key, r.status === "ready" ? r : r.status === "error" ? { ...r, retry } : r);
    subs.forEach((s) => s());
  });
}

/** The file at the PR head, fetched once per file per session. Pass null to skip. */
export function useHeadFile(fileId: string | null): HeadFile {
  const reviewId = useCourse().review.analysis.id;
  const key = `${reviewId}:${fileId}`;
  useEffect(() => {
    if (fileId !== null && !started.has(key)) load(reviewId, fileId, key);
  }, [reviewId, fileId, key]);
  return useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    () => (fileId === null ? LOADING : (cache.get(key) ?? LOADING)),
  );
}
