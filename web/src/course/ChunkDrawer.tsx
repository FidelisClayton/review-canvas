/** Stub for U6: a linked chunk in the right-hand drawer, with its symbol lines highlighted. */
export interface ChunkDrawerProps {
  hunkId: string;
  symbols: string[];
  onClose: () => void;
  /** "Go to it in goal N": goal id (or "unclaimed") and the chunk to land on. */
  onGoToGoal: (goalId: string, hunkId: string) => void;
}

export function ChunkDrawer(_props: ChunkDrawerProps) {
  return null;
}
