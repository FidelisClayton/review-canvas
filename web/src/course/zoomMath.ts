export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 1.6;
/** Below this, frames collapse to their titles and the read observer pauses. */
export const FAR_BELOW = 0.6;
export const OVERVIEW_ZOOM = 0.42;

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
export const isFar = (z: number) => z < FAR_BELOW;

/** Scroll offsets that keep the world point under viewport point (mx, my) fixed when zooming from `from` to `to`. */
export function zoomScroll(scroll: { left: number; top: number }, from: number, to: number, mx: number, my: number) {
  return { left: ((scroll.left + mx) / from) * to - mx, top: ((scroll.top + my) / from) * to - my };
}
