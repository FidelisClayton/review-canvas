import { describe, expect, it } from "vitest";
import { draftReview } from "./course.js";
import { fileByPath, fixture } from "./fixture.test-helper.js";
import { buildView } from "./view.js";

const { analysis } = fixture();
const review = draftReview(analysis);
const none = { tests: false, i18n: false, api: false };

describe("buildView", () => {
  it("numbers the course 1, 2, 3 with tests sharing their subject's number", () => {
    const view = buildView(review, none);
    const model = fileByPath(analysis, "app/models/order_sync.rb").id;
    const test = fileByPath(analysis, "order_sync_test.rb").id;
    expect(view.sub[test]).toBe("test");
    expect(view.ctl[test]).toBe(view.ctl[model]);
    const numbers = view.order.filter((id) => !view.sub[id]).map((id) => Number(view.ctl[id]));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it("moves filtered files out of bounds, renumbers, and hides their links", () => {
    const all = buildView(review, none);
    const noTests = buildView(review, { ...none, tests: true });
    const test = fileByPath(analysis, "order_sync_test.rb").id;
    expect(noTests.order).not.toContain(test);
    expect(noTests.oob.some((o) => o.path.endsWith("order_sync_test.rb") && o.kind === "tests")).toBe(true);
    expect(noTests.links.length).toBeLessThanOrEqual(all.links.length);
    const hunkIds = new Set(analysis.files.find((f) => f.id === test)!.hunks.map((h) => h.id));
    expect(noTests.links.some((l) => hunkIds.has(l.from) || hunkIds.has(l.to))).toBe(false);
  });

  it("keeps generated files out of bounds whatever the filters say", () => {
    const view = buildView(review, none);
    expect(view.oob.find((o) => o.path === "yarn.lock")?.kind).toBe("generated");
  });

  it("shows generated API files under the TypeSpec source when the filter is off", () => {
    const view = buildView(review, none);
    const zod = fileByPath(analysis, "orderSync.zod.ts").id;
    expect(view.sub[zod]).toBe("gen");
    expect(view.parent[zod]).toBe(fileByPath(analysis, "typespec/admin-syncs.tsp").id);
  });
});
