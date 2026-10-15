import type { RefObject } from "react";

/** Stub for U9: zoom, pinch and Space+drag pan. */
export interface Zoom {
  zoom: number;
  /** Zoomed out far enough that frames collapse to titles. */
  far: boolean;
  setZoom: (zoom: number, originX?: number, originY?: number) => void;
  toggleOverview: () => void;
  /** Zoom to reading size centred on a frame. */
  zoomToElement: (el: HTMLElement) => void;
}

const noop = () => {};
const STUB: Zoom = { zoom: 1, far: false, setZoom: noop, toggleOverview: noop, zoomToElement: noop };

export function useZoom(_scrollerRef: RefObject<HTMLElement | null>, _worldRef: RefObject<HTMLElement | null>): Zoom {
  return STUB;
}
