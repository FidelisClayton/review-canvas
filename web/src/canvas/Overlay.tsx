import type { ReactNode } from "react";
import type { Link, Point, Rect } from "@review-canvas/shared";
import { pinDots } from "../pins";
import { layerBox } from "./Terrain";

const PURPLE = "#7b2cbf";
const INK = "#1e1b22";

export interface Box extends Rect {
  cx: number;
  cy: number;
}

export interface OverlayModel {
  world: Rect;
  stops: string[];
  rectOf: (id: string) => Box | null;
  finish: Point;
  current: string | null;
  punched: Set<string>;
  label: (id: string) => string;
  ctl: (id: string) => string;
  links: Link[];
  hunkAnchor: (hunkId: string, side: "l" | "r") => Point | null;
  fileOfHunk: (hunkId: string) => string | undefined;
  k: number;
  far: boolean;
  hot: string | null;
  oobRect: Rect | null;
  oobCount: number;
}

/** Where the line from a box's centre toward (tx, ty) leaves the box. */
function exitPoint(r: Box, tx: number, ty: number): Point {
  const dx = tx - r.cx, dy = ty - r.cy;
  if (!dx && !dy) return { x: r.cx, y: r.cy };
  const sx = dx ? r.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy ? r.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: r.cx + dx * s, y: r.cy + dy * s };
}

interface End {
  id: string;
  x: number;
  y: number;
  side: "l" | "r" | "t" | "b";
  active: boolean;
  done: boolean;
}

/**
 * Draws the course and the code paths. Returns two layers: `under` goes beneath the frames so
 * legs never cross code, `over` goes above them for control circles, numbers and labels.
 */
export function drawOverlay(m: OverlayModel, h: { onGoFile: (id: string) => void; onFinish: () => void; onGoHunk: (hunkId: string) => void }): { under: ReactNode; over: ReactNode } {
  const { onGoFile, onFinish, onGoHunk } = h;
  // The overprint is printed at a fixed size like a real course: symbols and type never shrink
  // below their reading-zoom size on screen, and strokes stay at least ~3px wide.
  const u = Math.max(1, 0.3 / m.k), us = Math.max(1, 0.8 / m.k), ut = Math.max(1, 0.55 / m.k);
  const under: ReactNode[] = [];
  const over: ReactNode[] = [];
  const ends: End[] = [];

  for (let i = 0; i < m.stops.length; i++) {
    const a = m.rectOf(m.stops[i]!);
    if (!a) continue;
    const isLast = i === m.stops.length - 1;
    const nextId = isLast ? null : m.stops[i + 1]!;
    const b = nextId ? m.rectOf(nextId) : null;
    const target = b ? { x: b.cx, y: b.cy } : m.finish;
    const p1 = exitPoint(a, target.x, target.y);
    let x2: number, y2: number;
    let side: End["side"] = "l";
    if (!b) {
      const ang = Math.atan2(m.finish.y - p1.y, m.finish.x - p1.x);
      x2 = m.finish.x - Math.cos(ang) * 30 * u;
      y2 = m.finish.y - Math.sin(ang) * 30 * u;
    } else {
      // The control circle sits just outside the frame edge, clear of its header.
      const p2 = exitPoint(b, a.cx, a.cy);
      const eps = 0.5;
      side = Math.abs(p2.x - b.x) < eps ? "l" : Math.abs(p2.x - (b.x + b.w)) < eps ? "r" : Math.abs(p2.y - b.y) < eps ? "t" : "b";
      const push = 22 * u + 4;
      x2 = p2.x + (side === "l" ? -push : side === "r" ? push : 0);
      y2 = p2.y + (side === "t" ? -push : side === "b" ? push : 0);
    }
    const active = nextId !== null && nextId === m.current;
    const done = nextId !== null && m.punched.has(nextId) && (i === 0 || m.punched.has(m.stops[i]!));
    const ang = Math.atan2(y2 - p1.y, x2 - p1.x);
    const r = 22 * u;
    const lx2 = b ? x2 - Math.cos(ang) * r : x2, ly2 = b ? y2 - Math.sin(ang) * r : y2;
    const lx1 = i === 0 ? p1.x + Math.cos(ang) * 56 * u : p1.x, ly1 = i === 0 ? p1.y + Math.sin(ang) * 56 * u : p1.y;
    under.push(
      <line key={`leg${i}`} x1={lx1} y1={ly1} x2={lx2} y2={ly2} stroke={PURPLE} strokeWidth={(active ? 6 : 3.5) * us} opacity={active ? 1 : done ? 0.38 : 0.7} strokeLinecap="round" />,
    );
    if (i === 0) {
      const t = 26 * u;
      const sx = p1.x + Math.cos(ang) * (t + 4), sy = p1.y + Math.sin(ang) * (t + 4);
      const pts = [0, 1, 2].map((k) => `${sx + Math.cos(ang + k * 2.094) * t},${sy + Math.sin(ang + k * 2.094) * t}`).join(" ");
      over.push(<polygon key="start" points={pts} fill="#fff" stroke={PURPLE} strokeWidth={3.5 * us} strokeLinejoin="round" />);
    }
    if (nextId) ends.push({ id: nextId, x: x2, y: y2, side, active, done: m.punched.has(nextId) });
  }

  for (const e of ends) {
    const fs = 30 * ut;
    const rc = m.rectOf(e.id)!;
    const lr = e.side === "l" || e.side === "r";
    // Numbers sit above the frame's top corner on side edges, left of the circle otherwise.
    const tx = lr ? (e.side === "r" ? e.x + 22 * u : e.x - 22 * u) : e.x - 28 * u;
    const ty = lr ? Math.min(rc.y - 6 * ut, e.y - 22 * u - 4) : e.y + fs * 0.35;
    over.push(
      <g key={`c-${e.id}`}>
        <circle cx={e.x} cy={e.y} r={22 * u} fill="#fff" stroke={PURPLE} strokeWidth={(e.active ? 5 : 3.5) * us} />
        {e.done && (
          <g transform={`translate(${e.x - 13 * u},${e.y - 13 * u}) scale(${1.45 * u})`} fill={PURPLE}>
            {pinDots(m.ctl(e.id)).map((d, i) => (
              <circle key={i} cx={d.cx} cy={d.cy} r={1.7} />
            ))}
          </g>
        )}
        <text x={tx} y={ty} textAnchor={lr ? (e.side === "r" ? "end" : "start") : "end"} className="ctl-num" fontSize={fs} strokeWidth={fs / 5}>
          {m.label(e.id)}
        </text>
        <circle className="hit" cx={e.x} cy={e.y} r={26 * u} fill="transparent" onClick={() => onGoFile(e.id)}>
          <title>Go to {m.label(e.id)}</title>
        </circle>
      </g>,
    );
  }

  over.push(
    <g key="finish">
      <circle cx={m.finish.x} cy={m.finish.y} r={30 * u} fill="#fff" stroke={PURPLE} strokeWidth={3.5 * us} />
      <circle cx={m.finish.x} cy={m.finish.y} r={19 * u} fill="none" stroke={PURPLE} strokeWidth={3.5 * us} />
      <text x={m.finish.x} y={m.finish.y + 30 * u + 30 * ut} textAnchor="middle" className="finish-label" fontSize={30 * ut} strokeWidth={5 * ut}>
        FINISH
      </text>
      <text x={m.finish.x} y={m.finish.y + 30 * u + 54 * ut} textAnchor="middle" className="finish-sub" fontSize={16 * ut} strokeWidth={4 * ut}>
        Submit your review
      </text>
      <circle className="hit" cx={m.finish.x} cy={m.finish.y + 20 * u} r={70 * u} fill="transparent" onClick={onFinish}>
        <title>Open your review</title>
      </circle>
    </g>,
  );

  if (m.oobRect) {
    const ofs = 34 * Math.max(1, 0.5 / m.k);
    over.push(
      <g key="oob">
        <text x={m.oobRect.x + 20} y={m.oobRect.y + ofs + 12} className="oob-label" fontSize={ofs} strokeWidth={ofs / 6}>
          OUT OF BOUNDS
        </text>
        {m.far && (
          <text x={m.oobRect.x + 20} y={m.oobRect.y + ofs * 2.2 + 12} className="oob-sub" fontSize={ofs * 0.55} strokeWidth={ofs / 8}>
            {m.oobCount} files skipped
          </text>
        )}
      </g>,
    );
  }

  // Code paths between hunks. Hidden at far zoom, where frames collapse to name tags.
  if (!m.far) {
    for (const l of m.links) {
      const fa = m.fileOfHunk(l.from), fb = m.fileOfHunk(l.to);
      if (!fa || !fb) continue;
      const ga = m.rectOf(fa), gb = m.rectOf(fb);
      if (!ga || !gb) continue;
      let sa: "l" | "r", sb: "l" | "r";
      if (gb.cx > ga.x + ga.w - 40) [sa, sb] = ["r", "l"];
      else if (gb.cx < ga.x + 40) [sa, sb] = ["l", "r"];
      else [sa, sb] = ["r", "r"];
      if (sa === "r" && sb === "l" && gb.x < ga.x + ga.w) sb = "r";
      const p1 = m.hunkAnchor(l.from, sa), p2 = m.hunkAnchor(l.to, sb);
      if (!p1 || !p2) continue;
      const bend = sa === sb ? 140 + Math.abs(p2.y - p1.y) * 0.12 : Math.max(80, Math.abs(p2.x - p1.x) * 0.45);
      const c1x = p1.x + (sa === "r" ? bend : -bend), c2x = p2.x + (sb === "r" ? bend : -bend);
      const d = `M${p1.x},${p1.y} C${c1x},${p1.y} ${c2x},${p2.y} ${p2.x},${p2.y}`;
      const hot = m.hot !== null && (m.hot === l.from || m.hot === l.to);
      const cur = fa === m.current || fb === m.current;
      const op = hot ? 1 : m.hot ? 0.16 : cur ? 0.78 : 0.42;
      under.push(<path key={`p-${l.id}`} d={d} fill="none" stroke={INK} strokeWidth={hot ? 4 : 2} strokeDasharray={hot ? undefined : "9 6"} opacity={op} />);
      over.push(
        <g key={`pe-${l.id}`}>
          <circle cx={p1.x} cy={p1.y} r={hot ? 5.5 : 4.5} fill={INK} />
          <circle cx={p2.x} cy={p2.y} r={hot ? 5.5 : 4.5} fill="#fff" stroke={INK} strokeWidth={2} />
        </g>,
      );
      if (hot || (cur && !m.hot)) {
        const t = 0.5, mt = 0.5;
        const mx = mt ** 3 * p1.x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t ** 3 * p2.x;
        const my = mt ** 3 * p1.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t ** 3 * p2.y;
        over.push(
          <text key={`pl-${l.id}`} x={mx} y={my + 5} textAnchor="middle" className="path-label hit" onClick={() => onGoHunk(l.to === m.hot ? l.from : l.to)}>
            {l.label}
          </text>,
        );
      }
    }
  }

  const box = layerBox(m.world);
  return {
    under: (
      <svg className="layer" id="under" viewBox={box.viewBox} style={box.style} aria-hidden="true">
        {under}
      </svg>
    ),
    over: (
      <svg className="layer" id="over" viewBox={box.viewBox} style={box.style}>
        {over}
      </svg>
    ),
  };
}
