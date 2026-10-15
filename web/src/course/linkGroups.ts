import { isTestPath, type ReviewView } from "@review-canvas/shared";

export interface LinkEntry {
  /** The other chunk: where the link opens. */
  hunkId: string;
  path: string;
  /** The symbol the two chunks share, shown on the button. */
  symbol: string;
  /** What the drawer highlights: the symbol plus the methods a "calls a, b" label names. */
  symbols: string[];
}

export interface LinkGroupsOf {
  uses: LinkEntry[];
  usedBy: LinkEntry[];
  tests: LinkEntry[];
}

/** More entries than this collapse into a count button. */
export const COLLAPSE_OVER = 3;

/** Uses: this chunk refers to the other. Tested by: a test file refers to this chunk. Used by: any other chunk refers to it. */
export function linkGroups(view: ReviewView, hunkId: string): LinkGroupsOf {
  const g: LinkGroupsOf = { uses: [], usedBy: [], tests: [] };
  for (const l of view.links) {
    if (l.from !== hunkId && l.to !== hunkId) continue;
    const otherId = l.from === hunkId ? l.to : l.from;
    const other = view.hunkFile.get(otherId);
    if (!other) continue;
    const symbol = l.symbol.split("::").pop() ?? "";
    const listed = l.label.startsWith("calls ") ? l.label.slice(6).split(/,\s*/) : [];
    const entry: LinkEntry = { hunkId: otherId, path: other.path, symbol, symbols: [...new Set([symbol, ...listed].filter(Boolean))] };
    if (l.from === hunkId) g.uses.push(entry);
    else if (isTestPath(other.path)) g.tests.push(entry);
    else g.usedBy.push(entry);
  }
  return g;
}
