import { defineConfig } from "vitest/config";

/**
 * Standalone runner for the performance budget gate. It intentionally does not
 * enable coverage: v8 coverage instrumentation distorts wall-clock timing by
 * several multiples, so budgets are measured on clean runs in a dedicated CI
 * step (`npm run bench:budget`) instead of inside `npm run test:coverage`.
 */
export default defineConfig({
  test: {
    include: ["test/bench/budget.test.ts", "test/bench/scene-update-scaling.test.ts"],
  },
});
