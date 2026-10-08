import { LAYERS, type LayerId } from "./types.js";

export interface Size {
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface Rect extends Point, Size {}

export interface LayoutFile {
  id: string;
  layer: LayerId;
  /** Set when the file rides beneath another visible file (a test, or generated output). */
  parent?: string;
  /**
   * A file with no layer of its own (locales, config) sits in the band of the file before it in
   * the course, so the route does not dive to a distant band and climb back.
   */
  float?: boolean;
}

export interface LayoutInput {
  /** Visible on-course files in course order. */
  files: LayoutFile[];
  sizes: Record<string, Size>;
  start: Size;
  oob: string[];
  maxRowWidth?: number;
}

export interface Band {
  layer: LayerId;
  top: number;
  bottom: number;
}

export interface Layout {
  pos: Record<string, Point>;
  start: Point;
  finish: Point;
  bands: Band[];
  oobRect: Rect | null;
  world: Rect;
}

const GAP_X = 130;
const GAP_STACK = 40;
const ROW_GAP = 170;
const BAND_HEAD = 190;
const BAND_FOOT = 120;
const LABEL_MARGIN = 560;

interface Unit {
  ids: string[];
  w: number;
  h: number;
}

/**
 * Places files on the map: one band per layer in a fixed top-to-bottom order, units (a file and
 * the files riding beneath it) in course order, rows wrapping at `maxRowWidth` and alternating
 * direction so the course snakes instead of jumping back to the left edge.
 */
export function layoutMap(input: LayoutInput): Layout {
  const maxRow = input.maxRowWidth ?? 3000;
  const size = (id: string): Size => input.sizes[id] ?? { w: 560, h: 300 };

  // Group into units, keeping course order.
  const units: (Unit & { layer: LayerId })[] = [];
  const unitOf = new Map<string, Unit>();
  let previousLayer: LayerId | null = null;
  for (const f of input.files) {
    const parentUnit = f.parent ? unitOf.get(f.parent) : undefined;
    if (parentUnit) {
      const s = size(f.id);
      parentUnit.ids.push(f.id);
      parentUnit.w = Math.max(parentUnit.w, s.w);
      parentUnit.h += GAP_STACK + s.h;
      unitOf.set(f.id, parentUnit);
      continue;
    }
    const s = size(f.id);
    const layer: LayerId = f.float && previousLayer ? previousLayer : f.layer;
    previousLayer = layer;
    const unit = { ids: [f.id], w: s.w, h: s.h, layer };
    units.push(unit);
    unitOf.set(f.id, unit);
  }

  // The start card leads the band of the first file on the course.
  const START = "__start";
  const firstLayer = units[0]?.layer;
  const byLayer = new Map<LayerId, Unit[]>();
  for (const layer of LAYERS) byLayer.set(layer, []);
  if (firstLayer) byLayer.get(firstLayer)!.push({ ids: [START], w: input.start.w, h: input.start.h });
  for (const u of units) byLayer.get(u.layer)!.push(u);

  // Break each band into rows.
  type Row = { units: Unit[]; width: number; height: number };
  const bandRows: { layer: LayerId; rows: Row[] }[] = [];
  for (const layer of LAYERS) {
    const list = byLayer.get(layer)!;
    if (!list.length) continue;
    const rows: Row[] = [];
    let row: Row = { units: [], width: 0, height: 0 };
    for (const u of list) {
      const add = (row.units.length ? GAP_X : 0) + u.w;
      if (row.units.length && row.width + add > maxRow) {
        rows.push(row);
        row = { units: [], width: 0, height: 0 };
      }
      row.width += (row.units.length ? GAP_X : 0) + u.w;
      row.height = Math.max(row.height, u.h);
      row.units.push(u);
    }
    rows.push(row);
    bandRows.push({ layer, rows });
  }

  const right = Math.max(0, ...bandRows.flatMap((b) => b.rows.map((r) => r.width)));
  const pos: Record<string, Point> = {};
  const bands: Band[] = [];
  let cursor = 0;
  let rowIndex = 0;
  let last: { unit: Unit; x: number; y: number; rtl: boolean } | null = null;

  for (const { layer, rows } of bandRows) {
    const top = cursor;
    let y = top + BAND_HEAD;
    for (const row of rows) {
      const rtl = rowIndex % 2 === 1;
      let x = rtl ? right : 0;
      for (const u of row.units) {
        const ux = rtl ? x - u.w : x;
        let uy = y;
        for (const id of u.ids) {
          pos[id] = { x: ux, y: uy };
          uy += (id === START ? input.start.h : size(id).h) + GAP_STACK;
        }
        if (!u.ids.includes(START)) last = { unit: u, x: ux, y, rtl };
        x = rtl ? ux - GAP_X : ux + u.w + GAP_X;
      }
      y += row.height + ROW_GAP;
      rowIndex++;
    }
    const bottom = y - ROW_GAP + BAND_FOOT;
    bands.push({ layer, top, bottom });
    cursor = bottom;
  }

  const start = pos[START] ?? { x: 0, y: BAND_HEAD };
  delete pos[START];
  const finish: Point = last
    ? { x: last.rtl ? last.x - 220 : last.x + last.unit.w + 220, y: last.y + 130 }
    : { x: start.x + input.start.w + 260, y: start.y + 80 };

  let oobRect: Rect | null = null;
  if (input.oob.length) {
    const x = right + 420;
    let y = (bands[0]?.top ?? 0) + 150;
    const startY = y;
    let w = 0;
    for (const id of input.oob) {
      const s = size(id);
      pos[id] = { x: x + 50, y: y + 70 };
      y += s.h + 24;
      w = Math.max(w, s.w);
    }
    oobRect = { x, y: startY, w: w + 100, h: y - startY + 110 };
  }

  const worldRight = Math.max(right, finish.x + 200, oobRect ? oobRect.x + oobRect.w : 0) + 260;
  const world: Rect = { x: -LABEL_MARGIN, y: 0, w: worldRight + LABEL_MARGIN, h: Math.max(cursor, oobRect ? oobRect.y + oobRect.h + 120 : 0) };
  if (!bands.length) bands.push({ layer: "other", top: 0, bottom: world.h || 800 });
  return { pos, start, finish, bands, oobRect, world };
}
