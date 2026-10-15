import { useLayoutEffect, useState, type RefObject } from "react";

interface Point {
  x: number;
  y: number;
  first: number;
  fi: number;
  label: string;
}

/** Offset of `el` inside `root`, in the world's own pixels. */
export function posIn(el: HTMLElement | null, root: HTMLElement) {
  let x = 0;
  let y = 0;
  while (el && el !== root) {
    x += el.offsetLeft;
    y += el.offsetTop;
    el = el.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

const R = 20;

/** The purple route: a circle at every file frame, joined in stop order. Measured from the frames themselves. */
export function RouteLayer({ worldRef, stop, scope }: { worldRef: RefObject<HTMLElement | null>; stop: number; scope: string }) {
  const [geo, setGeo] = useState<{ w: number; h: number; pts: Point[] }>({ w: 0, h: 0, pts: [] });

  useLayoutEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    const measure = () => {
      const pts = [...world.querySelectorAll<HTMLElement>(".node[data-fi]")]
        .sort((a, b) => Number(a.dataset.fi) - Number(b.dataset.fi))
        .map((n) => {
          const p = posIn(n, world);
          return { x: p.x - 46, y: p.y + 24, first: Number(n.dataset.first), fi: Number(n.dataset.fi), label: n.querySelector(".ctl")?.textContent ?? "" };
        });
      setGeo((prev) => {
        const w = world.scrollWidth;
        const h = world.scrollHeight;
        const same = prev.w === w && prev.h === h && prev.pts.length === pts.length && prev.pts.every((q, i) => q.x === pts[i]!.x && q.y === pts[i]!.y && q.label === pts[i]!.label);
        return same ? prev : { w, h, pts };
      });
    };
    measure();
    // Expanded lines, an open composer and font loading all move the frames.
    const ro = new ResizeObserver(measure);
    ro.observe(world);
    world.querySelectorAll(".node").forEach((n) => ro.observe(n));
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [worldRef, scope]);

  const { pts } = geo;
  if (!pts.length) return <svg className="route" width={geo.w} height={geo.h} />;
  const cur = pts.reduce((c, p) => (p.first <= stop ? p.fi : c), 0);
  const f0 = pts[0]!;
  return (
    <svg className="route" width={geo.w} height={geo.h} aria-hidden="true">
      <path className="start" d={`M${f0.x - 70} ${f0.y - 16}L${f0.x - 46} ${f0.y + 18}H${f0.x - 94}Z`} />
      <path className="leg" d={`M${f0.x - 48} ${f0.y + 4}L${f0.x - R} ${f0.y}`} />
      {pts.slice(1).map((b, k) => {
        const a = pts[k]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        return <path key={b.fi} className={`leg${k + 1 <= cur ? " done" : ""}`} d={`M${a.x + (dx / d) * R} ${a.y + (dy / d) * R}L${b.x - (dx / d) * R} ${b.y - (dy / d) * R}`} />;
      })}
      {pts.map((p) => (
        <g key={p.fi}>
          <circle cx={p.x} cy={p.y} r={R} className={p.fi === cur ? "cur" : ""} />
          <text x={p.x - 10} y={p.y - 26} textAnchor="end">
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
