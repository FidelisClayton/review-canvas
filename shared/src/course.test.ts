import { describe, expect, it } from "vitest";
import { defaultCourse, mergeCourse, normalizeOrder } from "./course.js";
import { fileByPath, fixture } from "./fixture.test-helper.js";
import { courseInputSchema } from "./schemas.js";

const { analysis } = fixture();
const id = (suffix: string) => fileByPath(analysis, suffix).id;

describe("normalizeOrder", () => {
  it("appends forgotten files, drops out-of-bounds ones, and warns about both", () => {
    const warnings: string[] = [];
    const order = normalizeOrder(analysis, [id("order_sync.rb"), id("yarn.lock"), "f999"], warnings);
    expect(order[0]).toBe(id("order_sync.rb"));
    expect(order).not.toContain(id("yarn.lock"));
    expect(order).toContain(id("SyncStatusBadge.tsx"));
    expect(warnings.join("\n")).toMatch(/unknown file id "f999"/);
    expect(warnings.join("\n")).toMatch(/yarn\.lock is out of bounds/);
    expect(warnings.join("\n")).toMatch(/were missing/);
  });

  it("moves a test directly after its subject wherever the agent put it", () => {
    const order = normalizeOrder(analysis, [id("order_sync_test.rb"), id("SyncStatusBadge.tsx"), id("app/models/order_sync.rb")]);
    const subject = order.indexOf(id("app/models/order_sync.rb"));
    expect(order[subject + 1]).toBe(id("order_sync_test.rb"));
  });
});

describe("normalizeOrder with dependents left out", () => {
  it("seats tests and generated files beside their parent without a warning", () => {
    const warnings: string[] = [];
    const roots = defaultCourse(analysis).order.filter((x) => {
      const f = analysis.files.find((g) => g.id === x)!;
      return !f.subjectOf && !f.generatedFrom;
    });
    const order = normalizeOrder(analysis, roots, warnings);
    expect(warnings).toEqual([]);
    const model = order.indexOf(id("app/models/order_sync.rb"));
    expect(order[model + 1]).toBe(id("order_sync_test.rb"));
  });
});

describe("defaultCourse", () => {
  it("puts migrations before the models that read them", () => {
    const order = defaultCourse(analysis).order;
    expect(order.indexOf(id("add_retry_fields_to_order_syncs.rb"))).toBeLessThan(order.indexOf(id("app/models/order_sync.rb")));
  });

  it("runs top to bottom by layer", () => {
    const order = defaultCourse(analysis).order.map((x) => analysis.files.find((f) => f.id === x)!.layer);
    const firstFrontend = order.indexOf("frontend");
    expect(order.slice(0, firstFrontend)).not.toContain("frontend");
    expect(order[0]).toBe("data");
  });
});

describe("mergeCourse", () => {
  const hunkOf = (suffix: string) => fileByPath(analysis, suffix).hunks[0]!.id;

  it("accepts an agent link only when the symbol appears in both hunks", () => {
    const input = courseInputSchema.parse({
      order: [id("order_sync.rb")],
      links: [
        { from: hunkOf("sync_mailer.rb"), to: hunkOf("config/locales/en.yml"), label: "reads", symbol: "subject" },
        { from: hunkOf("sync_mailer.rb"), to: hunkOf("config/locales/en.yml"), label: "invented", symbol: "imaginaryThing" },
      ],
    });
    const review = mergeCourse(analysis, input);
    expect(review.agentLinks.map((l) => l.symbol)).toEqual(["subject"]);
    expect(review.warnings.join("\n")).toMatch(/"imaginaryThing" does not appear in both/);
  });

  it("keeps notes for known ids and warns about unknown ones", () => {
    const input = courseInputSchema.parse({
      order: [id("order_sync.rb")],
      files: { [id("order_sync.rb")]: { what: "Adds retries.", why: "Start here." }, nope: { what: "x" } },
      hunks: { [hunkOf("order_sync.rb")]: "Enum changes.", "nope.h1": "x" },
    });
    const review = mergeCourse(analysis, input);
    expect(review.course.files[id("order_sync.rb")]?.why).toBe("Start here.");
    expect(review.course.files.nope).toBeUndefined();
    expect(review.warnings.filter((w) => w.includes("unknown"))).toHaveLength(2);
  });
});
