import { defineConfig } from "vitest/config";
import { sourceAlias } from "./source-alias.ts";

/** Local-only large Tet4 element-visibility skin benchmark. */
export default defineConfig({
  resolve: { alias: sourceAlias },
  test: {
    include: [
      "test/bench/visibility/tet4-visibility-sync.test.ts",
      "test/bench/visibility/tet4-edge-residency.test.ts",
    ],
    testTimeout: 120_000,
  },
});
