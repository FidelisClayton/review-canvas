/** Stub for U8: every changed file on its layer band with every chunk open, and the Out of bounds band. */
export interface MapViewProps {
  /** True once, when the course sheet's "Out of bounds" row asks for the band to be scrolled to. */
  focusOob: boolean;
  /** A goal badge was clicked: open that goal in the Guided view at that chunk. */
  onGoalBadge: (goalId: string, hunkId: string) => void;
}

export function MapView(_props: MapViewProps) {
  return null;
}
