/** Stub for U7: the file at the PR head, fetched once per file per session. */
export interface HeadFile {
  status: "loading" | "ready" | "removed" | "error";
  /** The file's lines, when ready. */
  lines?: string[];
  /** The server's message, when removed or failed. */
  message?: string;
}

export function useHeadFile(_fileId: string | null): HeadFile {
  return { status: "loading" };
}
