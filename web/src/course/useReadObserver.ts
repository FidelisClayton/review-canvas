import { useEffect, useRef, type RefObject } from "react";
import { emptySeen, isReadEnough, sample, type Seen } from "./readRule";

interface Options {
  scrollerRef: RefObject<HTMLElement | null>;
  worldRef: RefObject<HTMLElement | null>;
  /** Zoomed out: nothing is being read. */
  far: boolean;
  /** Changes when the stops on the page change (view, goal), so the observer re-attaches. */
  scope: string;
  isRead: (key: string) => boolean;
  onRead: (keys: string[]) => void;
}

/**
 * Applies the read rule (KTD7) to every `.stop[data-key]` in the world. An IntersectionObserver
 * only tracks which stops are on screen. The visible pixel range is measured on rAF-throttled
 * scroll and resize, because a 50% threshold never fires for a chunk taller than two screens.
 * A short interval lets a range that has stopped moving reach its 300 ms.
 */
export function useReadObserver({ scrollerRef, worldRef, far, scope, isRead, onRead }: Options) {
  const seen = useRef(new Map<string, Seen>());
  const live = useRef({ far, isRead, onRead });
  live.current = { far, isRead, onRead };

  useEffect(() => {
    const scroller = scrollerRef.current;
    const world = worldRef.current;
    if (!scroller || !world) return;
    const visible = new Set<HTMLElement>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) (e.isIntersecting ? visible.add(e.target as HTMLElement) : visible.delete(e.target as HTMLElement));
        measure();
      },
      { root: scroller },
    );
    world.querySelectorAll<HTMLElement>(".stop[data-key]").forEach((el) => io.observe(el));

    function measure() {
      const { far, isRead, onRead } = live.current;
      const vp = scroller!.getBoundingClientRect();
      const now = performance.now();
      const done: string[] = [];
      for (const el of visible) {
        const key = el.dataset.key!;
        if (isRead(key)) continue;
        const r = el.getBoundingClientRect();
        const top = Math.max(r.top, vp.top);
        const bottom = Math.min(r.bottom, vp.bottom);
        const next = sample(seen.current.get(key) ?? emptySeen(), bottom > top ? [top - r.top, bottom - r.top] : null, now, far);
        seen.current.set(key, next);
        if (isReadEnough(next, r.height)) done.push(key);
      }
      if (done.length) onRead(done);
    }

    let frame = 0;
    const onMove = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), measure()));
    };
    scroller.addEventListener("scroll", onMove, { passive: true });
    window.addEventListener("resize", onMove);
    const tick = window.setInterval(measure, 150);
    return () => {
      io.disconnect();
      scroller.removeEventListener("scroll", onMove);
      window.removeEventListener("resize", onMove);
      window.clearInterval(tick);
      cancelAnimationFrame(frame);
    };
  }, [scrollerRef, worldRef, scope, far]);
}
