import { defineConfig } from "vitest/config";

/** Local large-Hex8 selection-hide state and renderer-sync baseline. */
export default defineConfig({
  test: {
    include: ["test/bench/visibility/selection-hide-workflow.test.ts"],
    testTimeout: 120_000,
  },
});
