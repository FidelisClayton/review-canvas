/** Stub for U6: Uses / Used by / Tested by buttons for one chunk. */
export interface LinkGroupsProps {
  hunkId: string;
  /** Opens the linked chunk in the side drawer, highlighting `symbols`. */
  onOpenChunk: (hunkId: string, symbols: string[]) => void;
}

export function LinkGroups(_props: LinkGroupsProps) {
  return null;
}
