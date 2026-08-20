import { defineConfig } from "vitest/config";

/** Local-only large Tet4 half-selection and bulk-hide workflow benchmark. */
export default defineConfig({
  test: {
    include: ["test/bench/workflows/selection-hide-workflow.test.ts"],
    testTimeout: 120_000,
  },
});
