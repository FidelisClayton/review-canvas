import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { layoutMap, type Draft, type Point, type PrFile, type Rect, type Review, type ReviewState, type ReviewView, type Size } from "@review-canvas/shared";
import { Icon } from "../icons";
import { FileFrame, OobTag, StartCard, type Chip, type Placement } from "./Frames";
import { drawOverlay, type Box } from "./Overlay";
import { Terrain } from "./Terrain";

const START = "__start";
const FAR_K = 0.46;
/** Below this, name tags would overlap on a big PR; the numbered controls carry the course alone. */
const TINY_K = 0.11;
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface CanvasHandle {
  goFile(id: string, opts?: { instant?: boolean }): void;
  goHunk(hunkId: string): void;
  fitAll(): void;
  goFinish(): void;
  goOob(): void;
  zoomBy(factor: number): void;
  zoomTo(k: number): void;
}

interface CanvasProps {
  review: Review;
  view: ReviewView;
  state: ReviewState;
  current: string | null;
  onSelect: (id: string) => void;
  onPunch: (id: string) => void;
  onAddDraft: (hunkId: string, lineIndex: number, body: string) => void;
  onDeleteDraft: (id: string) => void;
  onFinish: () => void;
  onInteract: () => void;
}

/** Frame width from the longest line, so code rarely clips and short files stay compact. */
function widthFor(f: PrFile) {
  let longest = 0;
  for (const h of f.hunks) for (const l of h.lines) longest = Math.max(longest, l.text.replace(/\t/g, "  ").length);
  return Math.round(Math.min(860, Math.max(500, longest * 7.25 + 120)));
}

export const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(props, ref) {
  const { review, view, state, current } = props;
  const vpRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const cam = useRef({ x: 0, y: 0, k: 1 });
  const [k, setK] = useState(1);
  const far = k < FAR_K;
  const farRef = useRef(false);
  farRef.current = far;

  // Sizes at reading zoom drive the layout; current sizes (which shrink at far zoom) drive
  // the overprint. Keeping them apart stops the map from re-forming every time you zoom out.
  const [near, setNear] = useState<Record<string, Size>>({});
  const [cur, setCur] = useState<Record<string, Size>>({});
  const [tops, setTops] = useState<Record<string, number>>({});
  const [dragged, setDragged] = useState<Record<string, Point>>({});
  const [hot, setHot] = useState<string | null>(null);
  const [space, setSpace] = useState(false);
  const [panning, setPanning] = useState(false);
  const initialized = useRef(false);

  // ---------- measurement ----------
  const observer = useMemo(
    () =>
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            const sizes: Record<string, Size> = {};
            const hunkTops: Record<string, number> = {};
            for (const e of entries) {
              const el = e.target as HTMLElement;
              const id = el.dataset.node;
              if (!id || !el.isConnected) continue;
              sizes[id] = { w: el.offsetWidth, h: el.offsetHeight };
              el.querySelectorAll<HTMLElement>(".hunk").forEach((hunk) => {
                if (hunk.dataset.hunk && hunk.offsetParent) hunkTops[hunk.dataset.hunk] = hunk.offsetTop;
              });
            }
            setCur((s) => ({ ...s, ...sizes }));
            if (!farRef.current) setNear((s) => ({ ...s, ...sizes }));
            if (Object.keys(hunkTops).length) setTops((s) => ({ ...s, ...hunkTops }));
          }),
    [],
  );
  useEffect(() => () => observer?.disconnect(), [observer]);
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const frameRef = useCallback(
    (id: string) => {
      let fn = refs.current.get(id);
      if (!fn) {
        let last: HTMLElement | null = null;
        fn = (el) => {
          if (last && observer) observer.unobserve(last);
          last = el;
          if (el && observer) observer.observe(el);
        };
        refs.current.set(id, fn);
      }
      return fn;
    },
    [observer],
  );

  // ---------- layout ----------
  const widths = useMemo(() => Object.fromEntries(view.order.map((id) => [id, widthFor(view.files.get(id)!)])), [view]);
  const layout = useMemo(
    () =>
      layoutMap({
        files: view.order.map((id) => {
          const f = view.files.get(id)!;
          const parent = view.parent[id];
          const float = f.layer === "other" && (f.noise === "i18n" || f.path.startsWith("config/"));
          return { id, layer: f.layer, ...(parent ? { parent } : {}), ...(float ? { float } : {}) };
        }),
        sizes: near,
        start: near[START] ?? { w: 400, h: 260 },
        oob: view.oob.map((o) => o.id),
      }),
    [view, near],
  );
  const pos = useCallback((id: string): Point | undefined => dragged[id] ?? (id === START ? layout.start : layout.pos[id]), [dragged, layout]);
  const rectOf = useCallback(
    (id: string): Box | null => {
      const p = pos(id);
      const s = cur[id] ?? near[id];
      if (!p || !s) return null;
      return { x: p.x, y: p.y, w: s.w, h: s.h, cx: p.x + s.w / 2, cy: p.y + s.h / 2 };
    },
    [pos, cur, near],
  );
  const allIds = useMemo(() => [START, ...view.order, ...view.oob.map((o) => o.id)], [view]);
  const ready = allIds.every((id) => near[id]);
  const at = (id: string, w: number): Placement => {
    const p = pos(id) ?? { x: 0, y: 0 };
    return { x: p.x, y: p.y, w, hidden: !near[id] };
  };

  // ---------- camera ----------
  const rafK = useRef(0);
  const apply = useCallback(() => {
    const { x, y, k } = cam.current;
    if (worldRef.current) worldRef.current.style.transform = `translate(${x}px,${y}px) scale(${k})`;
    vpRef.current?.style.setProperty("--inv", (1 / k).toFixed(4));
    if (!rafK.current)
      rafK.current = requestAnimationFrame(() => {
        rafK.current = 0;
        setK(cam.current.k);
      });
  }, []);
  const flight = useRef(0);
  const flyTo = useCallback(
    (target: { x: number; y: number; k: number }, ms = 520) => {
      cancelAnimationFrame(flight.current);
      if (reduceMotion() || ms === 0) {
        cam.current = { ...target };
        apply();
        return;
      }
      const from = { ...cam.current };
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        const e = 1 - Math.pow(2, -10 * t);
        cam.current = {
          x: from.x + (target.x - from.x) * e,
          y: from.y + (target.y - from.y) * e,
          // Zoom in log space so scale changes feel even.
          k: Math.exp(Math.log(from.k) + (Math.log(target.k) - Math.log(from.k)) * e),
        };
        apply();
        if (t < 1) flight.current = requestAnimationFrame(step);
      };
      flight.current = requestAnimationFrame(step);
    },
    [apply],
  );
  const zoomAt = useCallback(
    (k: number, px: number, py: number) => {
      const c = cam.current;
      const nk = Math.min(1.6, Math.max(0.06, k));
      const wx = (px - c.x) / c.k, wy = (py - c.y) / c.k;
      cam.current = { k: nk, x: px - wx * nk, y: py - wy * nk };
      apply();
    },
    [apply],
  );
  const frameRect = useCallback((r: Rect, k: number) => {
    const vw = vpRef.current?.clientWidth ?? 1200, vh = vpRef.current?.clientHeight ?? 800;
    // Wider than the screen (phones): pin the frame's left edge and let the reader pan across.
    const x = r.w * k > vw - 24 ? 12 - (r.x + 40) * k : vw / 2 - (r.x + r.w / 2) * k;
    const y = r.h * k < vh - 140 ? vh / 2 - (r.y + r.h / 2) * k : 70 - r.y * k;
    return { x, y, k };
  }, []);

  const handle: CanvasHandle = {
    goFile(id, opts) {
      const r = rectOf(id);
      if (!r) return;
      flyTo(frameRect({ x: r.x - 60, y: r.y - 60, w: r.w + 120, h: r.h + 120 }, 1), opts?.instant ? 0 : 520);
    },
    goHunk(hunkId) {
      const f = view.hunkFile.get(hunkId);
      const r = f && rectOf(f.id);
      if (!f || !r) return;
      props.onSelect(f.id);
      const top = tops[hunkId] ?? 0;
      const el = document.getElementById(`hunk-${hunkId}`);
      flyTo(frameRect({ x: r.x - 40, y: r.y + top - 30, w: r.w + 80, h: (el?.offsetHeight ?? 300) + 60 }, 1));
      if (el) {
        setTimeout(() => el.classList.add("linked"), reduceMotion() ? 0 : 380);
        setTimeout(() => el.classList.remove("linked"), 1800);
      }
    },
    fitAll() {
      const W = layout.world, vw = vpRef.current?.clientWidth ?? 1200, vh = vpRef.current?.clientHeight ?? 800;
      const k = Math.min((vw - 60) / W.w, (vh - 60) / W.h);
      flyTo({ k, x: vw / 2 - (W.x + W.w / 2) * k, y: vh / 2 - (W.y + W.h / 2) * k });
    },
    goFinish() {
      const f = layout.finish;
      flyTo(frameRect({ x: f.x - 220, y: f.y - 160, w: 440, h: 320 }, 0.8));
    },
    goOob() {
      if (layout.oobRect) flyTo(frameRect(layout.oobRect, 0.8));
    },
    zoomBy(f) {
      const vw = vpRef.current?.clientWidth ?? 0, vh = vpRef.current?.clientHeight ?? 0;
      zoomAt(cam.current.k * f, vw / 2, vh / 2);
    },
    zoomTo(nk) {
      const vw = vpRef.current?.clientWidth ?? 0, vh = vpRef.current?.clientHeight ?? 0;
      zoomAt(nk, vw / 2, vh / 2);
    },
  };
  useImperativeHandle(ref, () => handle);
  // Stable callbacks for memoized frames: they read the latest handle and props through refs.
  const live = useRef({ handle, props });
  live.current = { handle, props };
  const goHunk = useCallback((id: string) => live.current.handle.goHunk(id), []);

  // Open on the current control at reading scale once every frame has been measured.
  useEffect(() => {
    if (!ready || initialized.current) return;
    initialized.current = true;
    handle.goFile(current ?? START, { instant: true });
  });

  // ---------- interaction ----------
  const pan = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const drag = useRef<{ id: string; x: number; y: number; gx: number; gy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as HTMLElement;
    const onUi = target.closest("button,textarea,a,.hit,.ln,.hh,.desc,.pr-body,.route,.why,.zoom");
    const titlebar = target.closest<HTMLElement>("[data-drag]");
    if (space || e.button === 1 || (!onUi && !target.closest(".node"))) {
      pan.current = { x: e.clientX, y: e.clientY, cx: cam.current.x, cy: cam.current.y };
      setPanning(true);
      vpRef.current?.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (titlebar && !target.closest("button")) {
      const id = titlebar.dataset.drag!;
      const p = pos(id);
      if (!p) return;
      drag.current = { id, x: e.clientX, y: e.clientY, gx: p.x, gy: p.y };
      vpRef.current?.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (pan.current) {
      cam.current = { ...cam.current, x: pan.current.cx + e.clientX - pan.current.x, y: pan.current.cy + e.clientY - pan.current.y };
      apply();
    } else if (drag.current) {
      const d = drag.current;
      setDragged((s) => ({ ...s, [d.id]: { x: d.gx + (e.clientX - d.x) / cam.current.k, y: d.gy + (e.clientY - d.y) / cam.current.k } }));
    }
  };
  const endPointer = () => {
    if (pan.current || drag.current) props.onInteract();
    pan.current = null;
    drag.current = null;
    setPanning(false);
  };

  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".legend,.zoom")) return;
      e.preventDefault();
      cancelAnimationFrame(flight.current);
      const r = vp.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(cam.current.k * Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.012 : 0.004)), e.clientX - r.left, e.clientY - r.top);
      else {
        cam.current = { ...cam.current, x: cam.current.x - e.deltaX, y: cam.current.y - e.deltaY };
        apply();
      }
      live.current.props.onInteract();
    };
    // An overflow-hidden box can still be scrolled by focus; the camera owns position.
    const onScroll = () => {
      vp.scrollLeft = 0;
      vp.scrollTop = 0;
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    vp.addEventListener("scroll", onScroll);
    const onResize = () => apply();
    window.addEventListener("resize", onResize);
    return () => {
      vp.removeEventListener("wheel", onWheel);
      vp.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [apply, zoomAt]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === " " && !(e.target as HTMLElement).closest("textarea,input")) {
        setSpace(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => e.key === " " && setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Hovering a hunk lights its paths and the hunks at their far ends.
  const linksByHunk = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of view.links) {
      m.set(l.from, [...(m.get(l.from) ?? []), l.to]);
      m.set(l.to, [...(m.get(l.to) ?? []), l.from]);
    }
    return m;
  }, [view.links]);
  const setHotHunk = (id: string | null) => {
    if (id === hot) return;
    document.querySelectorAll(".hunk.linked-hot").forEach((x) => x.classList.remove("linked", "linked-hot"));
    for (const other of id ? (linksByHunk.get(id) ?? []) : []) document.getElementById(`hunk-${other}`)?.classList.add("linked", "linked-hot");
    setHot(id);
  };
  const onPointerOver = (e: React.PointerEvent) => setHotHunk((e.target as HTMLElement).closest<HTMLElement>(".hunk")?.dataset.hunk ?? null);

  // ---------- derived props ----------
  const chips = useMemo(() => {
    const out: Record<string, Record<string, Chip[]>> = {};
    const add = (hunkId: string, chip: Chip) => {
      const f = view.hunkFile.get(hunkId)!;
      const byHunk = (out[f.id] ??= {});
      (byHunk[hunkId] ??= []).push(chip);
    };
    for (const l of view.links) {
      const to = view.hunkFile.get(l.to), from = view.hunkFile.get(l.from);
      if (!to || !from) continue;
      add(l.from, { hunkId: l.to, label: l.label, out: true, otherPath: to.path });
      add(l.to, { hunkId: l.from, label: l.label, out: false, otherPath: from.path });
    }
    return out;
  }, [view]);
  const draftsByFile = useMemo(() => {
    const out: Record<string, Draft[]> = {};
    for (const d of state.drafts) {
      const f = view.hunkFile.get(d.hunkId);
      if (f) (out[f.id] ??= []).push(d);
    }
    return out;
  }, [state.drafts, view]);
  const punched = useMemo(() => new Set(Object.keys(state.punched)), [state.punched]);
  const NO_CHIPS = useMemo(() => ({}), []);
  const NO_DRAFTS = useMemo(() => [] as Draft[], []);

  const overlay = drawOverlay(
    {
      world: layout.world,
      stops: ready ? [START, ...view.order] : [],
      rectOf,
      finish: layout.finish,
      current,
      punched,
      label: (id) => view.ctl[id] + (view.sub[id] ? ` ${view.sub[id]}` : ""),
      ctl: (id) => view.ctl[id] ?? "",
      links: view.links,
      hunkAnchor: (hunkId, side) => {
        const f = view.hunkFile.get(hunkId);
        const r = f && rectOf(f.id);
        const top = tops[hunkId];
        if (!r || top === undefined) return null;
        return { x: side === "r" ? r.x + r.w : r.x, y: r.y + top + 20 };
      },
      fileOfHunk: (hunkId) => view.hunkFile.get(hunkId)?.id,
      k,
      far,
      hot,
      oobRect: layout.oobRect,
      oobCount: view.oob.length,
    },
    { onGoFile: (id) => props.onSelect(id), onFinish: props.onFinish, onGoHunk: goHunk },
  );

  return (
    <main
      className={`viewport${far ? " far" : ""}${k < TINY_K ? " tiny" : ""}${space ? " space" : ""}${panning ? " panning" : ""}`}
      ref={vpRef}
      aria-label="Review map"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    >
      <div className="world" ref={worldRef} style={{ visibility: ready ? undefined : "hidden" }}>
        <Terrain bands={layout.bands} world={layout.world} oobRect={layout.oobRect} seed={review.analysis.id} />
        {overlay.under}
        <div id="nodes" onPointerOver={onPointerOver} onPointerLeave={() => setHotHunk(null)}>
          <StartCard pr={review.analysis.pr} route={review.course.route} at={at(START, 400)} frameRef={frameRef(START)} />
          {view.order.map((id) => (
            <FileFrame
              key={id}
              file={view.files.get(id)!}
              ctl={view.ctl[id]!}
              {...(view.sub[id] ? { sub: view.sub[id] } : {})}
              {...(review.course.files[id] ? { notes: review.course.files[id] } : {})}
              hunkNotes={review.course.hunks}
              chips={chips[id] ?? NO_CHIPS}
              drafts={draftsByFile[id] ?? NO_DRAFTS}
              {...(state.punched[id] ? { punch: state.punched[id] } : {})}
              current={id === current}
              at={at(id, widths[id]!)}
              prUrl={review.analysis.pr.url}
              frameRef={frameRef(id)}
              onPunch={props.onPunch}
              onGoHunk={goHunk}
              onAddDraft={props.onAddDraft}
              onDeleteDraft={props.onDeleteDraft}
            />
          ))}
          {view.oob.map((o) => (
            <OobTag key={o.id} item={o} at={at(o.id, 460)} frameRef={frameRef(o.id)} />
          ))}
        </div>
        {overlay.over}
      </div>
      {!ready && <p className="loading-map">Drawing the map…</p>}
      <div className="zoom">
        <button onClick={() => handle.zoomBy(1 / 1.25)} aria-label="Zoom out">
          <Icon name="minus" />
        </button>
        <button className="pct" onClick={() => handle.zoomTo(1)} aria-label="Reset zoom to 100%">
          {Math.round(k * 100)}%
        </button>
        <button onClick={() => handle.zoomBy(1.25)} aria-label="Zoom in">
          <Icon name="plus" />
        </button>
        <button onClick={() => handle.fitAll()}>
          <Icon name="fit" />
          Whole course
        </button>
      </div>
    </main>
  );
});
