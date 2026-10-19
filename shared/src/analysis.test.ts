import { describe, expect, it } from "vitest";
import { buildAnalysis } from "./analysis.js";
import { fileByPath, fixture } from "./fixture.test-helper.js";

describe("buildAnalysis on the synthetic PR", () => {
  const { analysis } = fixture();
  const byId = new Map(analysis.files.map((f) => [f.id, f]));
  const pathOf = (id: string | undefined) => (id ? byId.get(id)?.path : undefined);

  it("names the review after the repo, number and head commit", () => {
    expect(analysis.id).toBe("storefront-4182-4182abc");
    expect(analysis.pr.owner).toBe("acme");
  });

  it("seats each test beside its subject", () => {
    expect(pathOf(fileByPath(analysis, "order_sync_test.rb").subjectOf)).toBe("app/models/order_sync.rb");
    expect(pathOf(fileByPath(analysis, "order_sync_job_test.rb").subjectOf)).toBe("app/jobs/order_sync_job.rb");
  });

  it("points generated API files back at the TypeSpec source", () => {
    for (const suffix of ["AdminApi.openapi.yaml", "adminApi.ts", "orderSync.zod.ts", "syncsRetry200.zod.ts"]) {
      const f = fileByPath(analysis, suffix);
      expect(f.noise).toBe("api");
      expect(pathOf(f.generatedFrom)).toBe("typespec/admin-syncs.tsp");
    }
  });

  it("keeps lockfiles and schema dumps out of bounds", () => {
    expect(fileByPath(analysis, "yarn.lock").noise).toBe("generated");
    expect(fileByPath(analysis, "db/schema.rb").noise).toBe("generated");
  });
});

describe("static links", () => {
  const { analysis } = fixture();
  const hunkFile = new Map(analysis.files.flatMap((f) => f.hunks.map((h) => [h.id, f.path] as const)));
  const pairs = analysis.links.map((l) => `${hunkFile.get(l.from)} -> ${hunkFile.get(l.to)} (${l.label})`);

  it("finds calls the code actually makes", () => {
    expect(pairs).toContain("app/jobs/order_sync_job.rb -> app/models/order_sync.rb (calls record_failure!)");
    expect(pairs).toContain("app/controllers/admin/syncs_controller.rb -> app/models/order_sync.rb (calls retry!)");
  });

  it("links routes to the controller that serves them", () => {
    expect(pairs.some((p) => p.startsWith("config/routes.rb -> app/controllers/admin/syncs_controller.rb"))).toBe(true);
  });

  it("never links a file to itself and keeps one link per file pair", () => {
    const filePairs = analysis.links.map((l) => `${hunkFile.get(l.from)}>${hunkFile.get(l.to)}`);
    expect(new Set(filePairs).size).toBe(filePairs.length);
    for (const l of analysis.links) expect(hunkFile.get(l.from)).not.toBe(hunkFile.get(l.to));
  });
});


describe("exact base metadata", () => {
  it("keeps legacy metadata valid without inventing a base SHA", () => {
    const { pull, files } = fixture();
    expect(buildAnalysis(pull, files, {}).pr.baseSha).toBeUndefined();
  });
  it("preserves the exact base SHA when supplied by GitHub", () => {
    const { pull, files } = fixture(); const baseSha = "b".repeat(40);
    const analysis = buildAnalysis({ ...pull, base: { ...pull.base, sha: baseSha } }, files, {});
    expect(analysis.pr.baseSha).toBe(baseSha);
    expect(analysis.version).toBe(1);
  });
});
