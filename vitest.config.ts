import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Tests read the shared source, not a possibly stale shared/dist.
    alias: { "@review-canvas/shared": fileURLToPath(new URL("./shared/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["shared/src/**/*.test.ts", "server/src/**/*.test.ts", "web/src/**/*.test.ts"],
  },
});
