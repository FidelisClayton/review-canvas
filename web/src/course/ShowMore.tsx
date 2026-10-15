/** Stub for U7: "Show 20 more lines above/below" for the chunk range a stop shows. */
export interface ShowMoreProps {
  fileId: string;
  hunkId: string;
  /** The range of `hunk.lines` the stop shows. */
  from: number;
  to: number;
  dir: "up" | "down";
}

export function ShowMore(_props: ShowMoreProps) {
  return null;
}
