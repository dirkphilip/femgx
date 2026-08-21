import { defineConfig } from "vitest/config";
import { sourceAlias } from "./source-alias.ts";

/**
 * Isolated local selection-state scaling runner. It avoids competing with the
 * geometry-heavy large-model fixtures for the same allocation and GC budget.
 */
export default defineConfig({
  resolve: { alias: sourceAlias },
  test: {
    // The packed-region evidence test samples heap after explicit Node GC; it has no budget.
    execArgv: ["--expose-gc"],
    include: [
      "test/bench/large-model/interaction-state-scaling.test.ts",
      "test/bench/large-model/element-region-selection.test.ts",
    ],
    testTimeout: 60_000,
  },
});
