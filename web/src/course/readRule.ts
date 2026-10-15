// The read rule (KTD7). A stop is read when the union of its ranges that stayed on screen
// for DWELL_MS covers at least half its height, at reading zoom. Ranges are measured from the
// stop's top edge in any one unit; the observer uses fractions of the stop's height (so the height is 1).

export type Range = [number, number];
export const DWELL_MS = 300;

/** A part of the stop that has stayed on screen without a break since `since`. */
export interface Segment {
  range: Range;
  since: number;
}

export interface Seen {
  /** Ranges that stayed visible long enough, merged and sorted. */
  ranges: Range[];
  /** What is on screen now, each part with its own clock. */
  segs: Segment[];
}

export const emptySeen = (): Seen => ({ ranges: [], segs: [] });

export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export const covered = (ranges: Range[]) => mergeRanges(ranges).reduce((n, [a, b]) => n + (b - a), 0);

/** One look at a stop: `visible` is the part of it on screen now, or null. Returns the new state. */
export function sample(prev: Seen, visible: Range | null, now: number, far: boolean): Seen {
  if (far || !visible || visible[1] <= visible[0]) return { ranges: prev.ranges, segs: [] };
  // Parts that were already visible keep their clock; parts that just came into view start one.
  const kept: Segment[] = [];
  for (const { range, since } of prev.segs) {
    const a = Math.max(range[0], visible[0]);
    const b = Math.min(range[1], visible[1]);
    if (b > a) kept.push({ range: [a, b], since });
  }
  const segs = [...kept];
  let from = visible[0];
  for (const [a, b] of mergeRanges(kept.map((k) => k.range))) {
    if (a > from) segs.push({ range: [from, a], since: now });
    from = Math.max(from, b);
  }
  if (visible[1] > from) segs.push({ range: [from, visible[1]], since: now });
  const settled = segs.filter((g) => now - g.since >= DWELL_MS).map((g) => g.range);
  return { ranges: settled.length ? mergeRanges([...prev.ranges, ...settled]) : prev.ranges, segs };
}

export const isReadEnough = (seen: Seen, height: number) => height > 0 && covered(seen.ranges) * 2 >= height;
