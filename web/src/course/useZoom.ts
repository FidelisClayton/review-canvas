import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import "./zoom.css";
import { clampZoom, isFar, OVERVIEW_ZOOM, zoomScroll } from "./zoomMath";

export interface Zoom {
  zoom: number;
  /** Zoomed out far enough that frames collapse to titles. */
  far: boolean;
  setZoom: (zoom: number, originX?: number, originY?: number) => void;
  toggleOverview: () => void;
  /** Zoom to reading size centred on a frame. */
  zoomToElement: (el: HTMLElement) => void;
}

const isTextField = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest("input,textarea,select,[contenteditable='true']");

/** CSS zoom on the world around the cursor, trackpad and touch pinch, F overview, Space+drag pan. */
export function useZoom(scrollerRef: RefObject<HTMLElement | null>, worldRef: RefObject<HTMLElement | null>): Zoom {
  const [zoom, setZoomState] = useState(1);
  const z = useRef(1);

  // Zoom around a viewport point (default: the centre), keeping the world point under it fixed.
  const setZoom = useCallback(
    (next: number, mx?: number, my?: number) => {
      const vp = scrollerRef.current;
      const world = worldRef.current;
      if (!vp || !world) return;
      const to = clampZoom(next);
      const x = mx ?? vp.clientWidth / 2;
      const y = my ?? vp.clientHeight / 2;
      const target = zoomScroll({ left: vp.scrollLeft, top: vp.scrollTop }, z.current, to, x, y);
      z.current = to;
      world.style.zoom = String(to);
      vp.scrollLeft = target.left;
      vp.scrollTop = target.top;
      setZoomState(to);
    },
    [scrollerRef, worldRef],
  );

  const toggleOverview = useCallback(() => setZoom(isFar(z.current) ? 1 : OVERVIEW_ZOOM), [setZoom]);

  const zoomToElement = useCallback(
    (el: HTMLElement) => {
      const vp = scrollerRef.current;
      if (!vp) return;
      // Frame box in scroll space at the current zoom, then in world units.
      const r = el.getBoundingClientRect();
      const v = vp.getBoundingClientRect();
      const from = z.current;
      const box = { x: (r.left - v.left + vp.scrollLeft) / from, y: (r.top - v.top + vp.scrollTop) / from, w: r.width / from };
      setZoom(1);
      vp.scrollTo({ left: Math.max(0, box.x + box.w / 2 - vp.clientWidth / 2), top: Math.max(0, box.y - 24) });
      // An animation, not a class: React rewrites className when the frame becomes the current one.
      el.animate([{ outline: "3px solid var(--ink)", outlineOffset: "3px" }, { outline: "3px solid transparent", outlineOffset: "3px" }], { duration: 1200, easing: "ease-out" });
    },
    [scrollerRef, setZoom],
  );

  useEffect(() => {
    const vp = scrollerRef.current;
    if (!vp) return;
    const at = (e: { clientX: number; clientY: number }): [number, number] => {
      const r = vp.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    // Trackpad pinch is ctrl+wheel in Chrome, Edge and Firefox. Listening on the document keeps the browser from page-zooming.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(z.current * Math.exp(-e.deltaY * 0.01), ...at(e));
    };
    // Safari trackpad pinch.
    let z0 = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      z0 = z.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      setZoom(z0 * g.scale, ...at(g));
    };
    const onGestureEnd = (e: Event) => e.preventDefault();
    const opts = { passive: false } as const;
    document.addEventListener("wheel", onWheel, opts);
    document.addEventListener("gesturestart", onGestureStart, opts);
    document.addEventListener("gesturechange", onGestureChange, opts);
    document.addEventListener("gestureend", onGestureEnd, opts);

    // Touch pinch with two pointers.
    const pts = new Map<number, { x: number; y: number }>();
    let d0 = 0;
    let zt = 1;
    const pair = () => {
      const [a, b] = [...pts.values()];
      return a && b ? { a, b, d: Math.hypot(a.x - b.x, a.y - b.y) } : null;
    };

    // Space+drag pan.
    let space = false;
    let pan: { x: number; y: number } | null = null;
    let moved = false;
    const show = () => (vp.dataset.pan = pan ? "drag" : space ? "ready" : "");

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 2) {
          d0 = pair()?.d ?? 0;
          zt = z.current;
        }
        return;
      }
      if (!space || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      pan = { x: e.clientX, y: e.clientY };
      moved = false;
      vp.setPointerCapture(e.pointerId);
      show();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (pts.has(e.pointerId)) {
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const p = pts.size === 2 && d0 ? pair() : null;
        if (p) {
          const r = vp.getBoundingClientRect();
          setZoom((zt * p.d) / d0, (p.a.x + p.b.x) / 2 - r.left, (p.a.y + p.b.y) / 2 - r.top);
        }
        return;
      }
      if (!pan) return;
      vp.scrollBy(pan.x - e.clientX, pan.y - e.clientY);
      moved = true;
      pan = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) d0 = 0;
      if (pan) {
        pan = null;
        show();
      }
    };
    // A pan that ends over a button must not click it.
    const onClick = (e: MouseEvent) => {
      if (!moved) return;
      moved = false;
      e.preventDefault();
      e.stopPropagation();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== " " || isTextField(e.target)) return;
      // Space scrolls the page when nothing is focused; stop that, but let it press a focused button or follow a link.
      const t = e.target;
      const idle = t === document.body || (t instanceof HTMLElement && vp.contains(t) && !t.closest("button,a,summary,[role=button]"));
      if (idle || pan) e.preventDefault();
      space = true;
      show();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      space = false;
      show();
    };
    const onCancel = (e: PointerEvent) => {
      moved = false;
      onPointerUp(e);
    };
    const onBlur = () => {
      space = false;
      pan = null;
      moved = false;
      show();
    };

    vp.addEventListener("pointerdown", onPointerDown, true);
    vp.addEventListener("pointermove", onPointerMove);
    vp.addEventListener("pointerup", onPointerUp);
    vp.addEventListener("pointercancel", onCancel);
    vp.addEventListener("click", onClick, true);
    vp.style.touchAction = "pan-x pan-y";
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("gesturestart", onGestureStart);
      document.removeEventListener("gesturechange", onGestureChange);
      document.removeEventListener("gestureend", onGestureEnd);
      vp.removeEventListener("pointerdown", onPointerDown, true);
      vp.removeEventListener("pointermove", onPointerMove);
      vp.removeEventListener("pointerup", onPointerUp);
      vp.removeEventListener("pointercancel", onCancel);
      vp.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [scrollerRef, setZoom]);

  return { zoom, far: isFar(zoom), setZoom, toggleOverview, zoomToElement };
}
