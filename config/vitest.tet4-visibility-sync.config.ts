import { defineConfig } from "vitest/config";

/** Local-only large Tet4 element-visibility skin benchmark. */
export default defineConfig({
  test: {
    include: ["test/bench/visibility/tet4-visibility-sync.test.ts"],
    testTimeout: 120_000,
  },
});
