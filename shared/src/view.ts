import { onCourse } from "./course.js";
import type { Link, PrFile, Review, ReviewState, Stop } from "./types.js";

export interface OobItem {
  id: string;
  fileId: string;
  path: string;
  additions: number;
  deletions: number;
  reason: string;
  kind: "generated" | "api";
}

/** An index over a review for the web app: lookups, not layout. */
export interface ReviewView {
  files: Map<string, PrFile>;
  hunkFile: Map<string, PrFile>;
  /** Indices into `course.goals` of the goals that cite the chunk, ascending. */
  goalsOfHunk: Map<string, number[]>;
  goalsOfFile: Map<string, number[]>;
  /** Out-of-bounds files: viewable, never stops, never counted as read. */
  oob: OobItem[];
  /** Static and agent links between on-course chunks. */
  links: Link[];
}

/** Whole chunks are read by hunk id, a cropped test by `hunkId@from`. */
export const stopKey = (s: Stop) => (s.name === undefined ? s.hunkId : `${s.hunkId}@${s.from}`);

/** Reading a whole chunk also reads every crop of it. */
export const isRead = (state: ReviewState, s: Stop) => !!state.read[s.hunkId] || !!state.read[stopKey(s)];

export function buildView(review: Review): ReviewView {
  const files = new Map(review.analysis.files.map((f) => [f.id, f]));
  const hunkFile = new Map(review.analysis.files.flatMap((f) => f.hunks.map((h) => [h.id, f] as const)));

  const goalsOfHunk = new Map<string, number[]>();
  const goalsOfFile = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, key: string, goal: number) => {
    const list = map.get(key) ?? [];
    if (!list.includes(goal)) map.set(key, [...list, goal]);
  };
  review.course.goals.forEach((g, i) => {
    for (const s of g.stops) {
      add(goalsOfHunk, s.hunkId, i);
      const f = hunkFile.get(s.hunkId);
      if (f) add(goalsOfFile, f.id, i);
    }
  });

  const oob: OobItem[] = review.analysis.files
    .filter((f) => !onCourse(f))
    .map((f) => ({
      id: `oob-${f.id}`,
      fileId: f.id,
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      kind: f.noise === "api" ? "api" : "generated",
      reason: f.noiseReason ?? "Generated.",
    }));

  const links = [...review.analysis.links, ...review.agentLinks].filter((l) => {
    const a = hunkFile.get(l.from);
    const b = hunkFile.get(l.to);
    return a && b && onCourse(a) && onCourse(b);
  });

  return { files, hunkFile, goalsOfHunk, goalsOfFile, oob, links };
}
