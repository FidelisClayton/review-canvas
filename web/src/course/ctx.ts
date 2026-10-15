import { createContext, useContext } from "react";
import type { Review, ReviewState, ReviewView } from "@review-canvas/shared";
import type { CourseIndex } from "./model";

/** The line a half-written comment sits on. It lives in ReviewScreen so J/K and view switches keep it (KTD12). */
export interface ComposerState {
  hunkId: string;
  lineIndex: number;
  text: string;
}

export interface CourseCtx {
  review: Review;
  view: ReviewView;
  idx: CourseIndex;
  state: ReviewState;
  composer: ComposerState | null;
  openComposer: (hunkId: string, lineIndex: number) => void;
  setComposerText: (text: string) => void;
  closeComposer: () => void;
  addDraft: (hunkId: string, lineIndex: number, body: string) => void;
  deleteDraft: (id: string) => void;
  /** Open a linked chunk in the side drawer; `symbols` are highlighted in it. */
  openChunk: (hunkId: string, symbols: string[]) => void;
  openFile: (fileId: string) => void;
}

export const CourseContext = createContext<CourseCtx | null>(null);

export function useCourse(): CourseCtx {
  const ctx = useContext(CourseContext);
  if (!ctx) throw new Error("useCourse outside a review");
  return ctx;
}
