import { memo, useMemo } from "react";
import { LAYER_INFO, type Band, type LayerId, type Rect } from "@review-canvas/shared";

const FILLS: Record<LayerId, string> = {
  data: "#ffffff",
  domain: "url(#t-forest)",
  jobs: "url(#t-marsh)",
  mail: "#fdf0c4",
  http: "#ffe8a3",
  frontend: "url(#t-thicket)",
  other: "url(#t-rough)",
};

function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function smoothClosed(pts: [number, number][]) {
  const n = pts.length;
  let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!, p1 = pts[i]!, p2 = pts[(i + 1) % n]!, p3 = pts[(i + 2) % n]!;
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

/** Contour rings around random hills. Seeded by the review so a PR always has the same terrain. */
function contours(world: Rect, seed: number) {
  const r = rng(seed);
  const paths: { d: string; index: boolean }[] = [];
  const hills = Math.round(Math.min(90, Math.max(24, (world.w * world.h) / 420000)));
  for (let i = 0; i < hills; i++) {
    const cx = world.x + r() * world.w, cy = world.y + r() * world.h;
    const levels = 4 + Math.floor(r() * 7), step = 24 + r() * 22, r0 = 26 + r() * 50;
    const harm = [1, 2, 3, 5].map((k) => ({ k, a: (0.05 + r() * 0.16) / k ** 0.6, p: r() * 6.28 }));
    const stretch = 0.6 + r() * 0.8, rot = r() * 3.14;
    for (let l = 0; l < levels; l++) {
      const rad = r0 + l * step;
      const pts: [number, number][] = [];
      for (let t = 0; t < 48; t++) {
        const th = (t / 48) * Math.PI * 2;
        let m = 1;
        for (const h of harm) m += h.a * (1 + l * 0.08) * Math.sin(h.k * th + h.p + l * 0.18);
        const x = Math.cos(th) * rad * m, y = Math.sin(th) * rad * m * stretch;
        pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
      }
      paths.push({ d: smoothClosed(pts), index: (l + 1) % 5 === 0 });
    }
  }
  return paths;
}

/** SVG layers span the world plus a margin, in world units, so 1 SVG unit is 1 world pixel. */
export function layerBox(world: Rect) {
  const m = 2000;
  const box = { x: world.x - m, y: world.y - m, w: world.w + 2 * m, h: world.h + 2 * m };
  return {
    viewBox: `${box.x} ${box.y} ${box.w} ${box.h}`,
    style: { left: box.x, top: box.y, width: box.w, height: box.h },
  };
}

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export const Terrain = memo(function Terrain({ bands, world, oobRect, seed }: { bands: Band[]; world: Rect; oobRect: Rect | null; seed: string }) {
  const rings = useMemo(() => contours(world, hash(seed)), [world.x, world.y, world.w, world.h, seed]);
  const box = layerBox(world);
  return (
    <svg className="layer" viewBox={box.viewBox} style={box.style} aria-hidden="true">
      <defs>
        <pattern id="t-marsh" width="22" height="9" patternUnits="userSpaceOnUse">
          <rect width="22" height="9" fill="#eef6fb" />
          <path d="M0 4.5h15" stroke="#5fa7d6" strokeWidth="1.6" opacity=".65" />
        </pattern>
        <pattern id="t-thicket" width="11" height="11" patternUnits="userSpaceOnUse">
          <rect width="11" height="11" fill="#f2f4e6" />
          <circle cx="3" cy="3" r="1.9" fill="#a5b36a" opacity=".8" />
          <circle cx="8.5" cy="8.5" r="1.9" fill="#a5b36a" opacity=".8" />
        </pattern>
        <pattern id="t-forest" width="14" height="14" patternUnits="userSpaceOnUse">
          <rect width="14" height="14" fill="#f4f7ee" />
          <circle cx="7" cy="7" r="1.2" fill="#a5b36a" opacity=".55" />
        </pattern>
        <pattern id="t-rough" width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="#fbf6e6" />
          <circle cx="3" cy="3" r="1" fill="#c9a24a" opacity=".5" />
          <circle cx="9" cy="9" r="1" fill="#c9a24a" opacity=".5" />
        </pattern>
        <pattern id="t-oob" width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M3 0v12" stroke="#7b2cbf" strokeWidth="2" opacity=".42" />
        </pattern>
        <clipPath id="t-clip">
          <rect x={world.x} y={world.y} width={world.w} height={world.h} />
        </clipPath>
      </defs>
      {bands.map((b) => (
        <rect key={b.layer} x={world.x} y={b.top} width={world.w} height={b.bottom - b.top} fill={FILLS[b.layer]} />
      ))}
      <g clipPath="url(#t-clip)">
        {rings.map((r, i) => (
          <path key={i} d={r.d} fill="none" stroke="#8c5a2b" strokeWidth={r.index ? 1.9 : 1.05} opacity={r.index ? 0.42 : 0.3} />
        ))}
      </g>
      {bands.map((b, i) => (
        <g key={`l-${b.layer}`}>
          {i > 0 && <path d={`M${world.x} ${b.top}H${world.x + world.w}`} stroke="#1e1b22" strokeWidth="1.2" opacity=".55" />}
          <text x={world.x + 34} y={b.top + 104} className="band-name">
            {LAYER_INFO[b.layer].name.toUpperCase()}
          </text>
          <text x={world.x + 38} y={b.top + 148} className="band-sub">
            {LAYER_INFO[b.layer].sub}
          </text>
        </g>
      ))}
      {oobRect && (
        <>
          <rect x={oobRect.x} y={oobRect.y} width={oobRect.w} height={oobRect.h} fill="#fff" opacity=".7" />
          <rect x={oobRect.x} y={oobRect.y} width={oobRect.w} height={oobRect.h} fill="url(#t-oob)" stroke="#7b2cbf" strokeWidth="2.5" />
        </>
      )}
      <rect x={world.x} y={world.y} width={world.w} height={world.h} fill="none" stroke="#1e1b22" strokeWidth="2" />
    </svg>
  );
});
