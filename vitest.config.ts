import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The performance budget gate runs standalone (see vitest.budget.config.ts)
    // so wall-clock budgets are not distorted by coverage instrumentation.
    exclude: ["test/bench/budget.test.ts"],
    benchmark: {
      include: ["test/bench/*.bench.ts"],
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/index.ts"],
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
