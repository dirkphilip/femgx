import { defineConfig } from "vitest/config";
import { sourceAlias } from "./source-alias.ts";

/**
 * Standalone runner for the performance budget gate. It intentionally does not
 * enable coverage: v8 coverage instrumentation distorts wall-clock timing by
 * several multiples, so budgets are measured on clean runs in a dedicated CI
 * step (`npm run bench:budget`) instead of inside `npm run test:coverage`.
 */
export default defineConfig({
  resolve: { alias: sourceAlias },
  test: {
    include: [
      "test/bench/budget/budget.test.ts",
      "test/bench/budget/explicit-topology-budgets.test.ts",
      "test/bench/scene/part-addition-scaling.test.ts",
      "test/bench/scene/hierarchy-update.test.ts",
      "test/bench/scene/part-removal-scaling.test.ts",
      "test/bench/scene/scene-update-scaling.test.ts",
      "test/bench/visibility/part-occurrence-visibility.test.ts",
    ],
    env: { FEMGX_PERFORMANCE_BUDGET: "1" },
    fileParallelism: false,
  },
});
