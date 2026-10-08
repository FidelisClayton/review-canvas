import { describe, expect, it } from "vitest";
import { layoutMap } from "./layout.js";

const size = { w: 500, h: 300 };

describe("layoutMap", () => {
  it("stacks bands in layer order regardless of course order", () => {
    const l = layoutMap({
      files: [
        { id: "ui", layer: "frontend" },
        { id: "model", layer: "data" },
      ],
      sizes: { ui: size, model: size },
      start: { w: 380, h: 200 },
      oob: [],
    });
    expect(l.bands.map((b) => b.layer)).toEqual(["data", "frontend"]);
    expect(l.pos.model!.y).toBeLessThan(l.pos.ui!.y);
  });

  it("stacks a dependent beneath its parent in the same column", () => {
    const l = layoutMap({
      files: [
        { id: "model", layer: "data" },
        { id: "test", layer: "data", parent: "model" },
      ],
      sizes: { model: size, test: { w: 400, h: 200 } },
      start: { w: 380, h: 200 },
      oob: [],
    });
    expect(l.pos.test!.x).toBe(l.pos.model!.x);
    expect(l.pos.test!.y).toBe(l.pos.model!.y + 300 + 40);
  });

  it("wraps long bands into rows that alternate direction", () => {
    const files = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, layer: "data" as const }));
    const sizes = Object.fromEntries(files.map((f) => [f.id, size]));
    const l = layoutMap({ files, sizes, start: { w: 380, h: 200 }, oob: [], maxRowWidth: 1800 });
    const rows = [...new Set(files.map((f) => l.pos[f.id]!.y))];
    expect(rows.length).toBeGreaterThan(1);
    // The second row runs right to left: its first unit sits furthest right.
    const second = files.filter((f) => l.pos[f.id]!.y === rows[1]);
    expect(l.pos[second[0]!.id]!.x).toBeGreaterThan(l.pos[second.at(-1)!.id]!.x);
  });

  it("puts out-of-bounds files in their own zone to the right", () => {
    const l = layoutMap({ files: [{ id: "a", layer: "data" }], sizes: { a: size, lock: { w: 460, h: 80 } }, start: { w: 380, h: 200 }, oob: ["lock"] });
    expect(l.oobRect).not.toBeNull();
    expect(l.pos.lock!.x).toBeGreaterThan(l.pos.a!.x + 500);
  });
});
