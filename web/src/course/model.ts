import { isRead, onCourse, stopKey, type Goal, type PrFile, type Review, type ReviewState, type ReviewView, type Stop } from "@review-canvas/shared";

export const UNCLAIMED_ID = "unclaimed";
export const UNCLAIMED_TITLE = "Changes no goal asked for";

/** The reviewer sees the unclaimed stop as one more goal, always last. */
export interface CourseGoal extends Goal {
  unclaimed: boolean;
}

export interface CourseIndex {
  /** Real goals in course order, then the unclaimed stop. */
  goals: CourseGoal[];
  realCount: number;
  /** Indices into `goals` (the unclaimed stop included) that cite a chunk or file. */
  ofHunk: Map<string, number[]>;
  ofFile: Map<string, number[]>;
}

export const base = (p: string) => p.split("/").pop() ?? p;
export const dir = (p: string) => p.slice(0, p.length - base(p).length);

export function buildIndex(review: Review, view: ReviewView): CourseIndex {
  const goals: CourseGoal[] = [
    ...review.course.goals.map((g) => ({ ...g, unclaimed: false })),
    { id: UNCLAIMED_ID, title: UNCLAIMED_TITLE, src: "", quote: "", stops: review.course.unclaimed, unclaimed: true },
  ];
  const ofHunk = new Map<string, number[]>();
  const ofFile = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, key: string, gi: number) => {
    const list = map.get(key) ?? [];
    if (!list.includes(gi)) map.set(key, [...list, gi]);
  };
  goals.forEach((g, gi) => {
    for (const s of g.stops) {
      add(ofHunk, s.hunkId, gi);
      const f = view.hunkFile.get(s.hunkId);
      if (f) add(ofFile, f.id, gi);
    }
  });
  return { goals, realCount: review.course.goals.length, ofHunk, ofFile };
}

export const goalLabel = (g: CourseGoal, gi: number) => (g.unclaimed ? "U" : String(gi + 1));

/** The unclaimed stop with nothing in it needs no mark and counts as nothing. */
export const needsMark = (g: CourseGoal) => !(g.unclaimed && g.stops.length === 0);

export interface Totals {
  goalsDone: number;
  goalsTotal: number;
  stopsRead: number;
  stopsTotal: number;
}

/** A chunk that serves several goals counts once (R5). */
export function totals(idx: CourseIndex, state: ReviewState): Totals {
  const markable = idx.goals.filter(needsMark);
  const keys = new Map<string, Stop>();
  for (const g of idx.goals) for (const s of g.stops) keys.set(stopKey(s), s);
  return {
    goalsDone: markable.filter((g) => state.reviewed[g.id]).length,
    goalsTotal: markable.length,
    stopsRead: [...keys.values()].filter((s) => isRead(state, s)).length,
    stopsTotal: keys.size,
  };
}

export interface Frame {
  fileId: string;
  stops: { stop: Stop; si: number }[];
}

/** One frame per file, in the order the goal first reaches it. */
export function framesOf(goal: CourseGoal, view: ReviewView): Frame[] {
  const frames: Frame[] = [];
  goal.stops.forEach((stop, si) => {
    const fileId = view.hunkFile.get(stop.hunkId)?.id;
    if (!fileId) return;
    let frame = frames.find((f) => f.fileId === fileId);
    if (!frame) frames.push((frame = { fileId, stops: [] }));
    frame.stops.push({ stop, si });
  });
  return frames;
}

/** On-course files with nothing to show as a chunk (renames, patches GitHub left out). */
export const chunklessFiles = (review: Review): PrFile[] => review.analysis.files.filter((f) => onCourse(f) && f.hunks.length === 0);

export function stopLabel(stop: Stop, view: ReviewView): { title: string; sub: string } {
  const file = view.hunkFile.get(stop.hunkId);
  const path = file ? base(file.path) : stop.hunkId;
  if (stop.name) return { title: stop.name, sub: path };
  const hunk = file?.hunks.find((h) => h.id === stop.hunkId);
  return { title: path, sub: hunk?.range ?? "" };
}

/** Where a draft's line shows in the Guided view: the first stop, in course order, that covers it. */
export function findStopFor(idx: CourseIndex, hunkId: string, lineIndex: number): { g: number; s: number } | null {
  for (let g = 0; g < idx.goals.length; g++) {
    const s = idx.goals[g]!.stops.findIndex((st) => st.hunkId === hunkId && lineIndex >= st.from && lineIndex <= st.to);
    if (s >= 0) return { g, s };
  }
  return null;
}
