import { describe, expect, it } from "vitest";
import { clampZoom, isFar, zoomScroll } from "./zoomMath";

describe("zoomMath", () => {
  it("keeps the world point under the cursor fixed", () => {
    const scroll = { left: 120, top: 80 };
    const [mx, my] = [400, 300];
    const world = { x: (scroll.left + mx) / 1, y: (scroll.top + my) / 1 };
    const next = zoomScroll(scroll, 1, 0.5, mx, my);
    expect((next.left + mx) / 0.5).toBeCloseTo(world.x);
    expect((next.top + my) / 0.5).toBeCloseTo(world.y);
  });

  it("clamps at 0.2 and 1.6", () => {
    expect(clampZoom(0.05)).toBe(0.2);
    expect(clampZoom(9)).toBe(1.6);
    expect(clampZoom(1)).toBe(1);
  });

  it("is far below 60%", () => {
    expect(isFar(0.59)).toBe(true);
    expect(isFar(0.6)).toBe(false);
  });
});
