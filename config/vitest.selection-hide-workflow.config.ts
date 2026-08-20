import { defineConfig } from "vitest/config";
import { sourceAlias } from "./source-alias.ts";

/** Local large-Hex8 selection-hide state and renderer-sync baseline. */
export default defineConfig({
  resolve: { alias: sourceAlias },
  test: {
    include: ["test/bench/visibility/selection-hide-workflow.test.ts"],
    testTimeout: 120_000,
  },
});
