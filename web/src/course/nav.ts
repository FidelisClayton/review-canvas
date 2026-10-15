export interface Pos {
  /** -1 is the start sheet; the last index is the unclaimed stop. */
  g: number;
  s: number;
}

/**
 * J or K. Gap rows are not stops, so they are never landed on. J and K stay inside a goal, except
 * that a goal with no stops hands over to its neighbour and the start sheet hands over to goal 1.
 * `edge` says the move ran into the end of the goal.
 */
export function step(stopCounts: number[], pos: Pos, dir: 1 | -1): { pos: Pos; edge: boolean } {
  const count = stopCounts[pos.g];
  if (pos.g < 0) return dir === 1 && stopCounts.length ? { pos: { g: 0, s: 0 }, edge: false } : { pos, edge: true };
  if (!count) {
    const g = pos.g + dir;
    if (g < 0 || g >= stopCounts.length) return { pos, edge: true };
    return { pos: { g, s: dir === 1 ? 0 : Math.max(0, stopCounts[g]! - 1) }, edge: false };
  }
  const s = pos.s + dir;
  if (s < 0 || s >= count) return { pos, edge: true };
  return { pos: { g: pos.g, s }, edge: false };
}
