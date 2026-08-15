import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The performance budget gate runs standalone (see vitest.budget.config.ts)
    // so wall-clock budgets are not distorted by coverage instrumentation.
    exclude: [
      "test/bench/budget.test.ts",
      "test/bench/large-scaling.test.ts",
      "test/bench/scene-update-scaling.test.ts",
      // Svelte component tests run with the plugin in the demo component gate.
      "test/demo/ui*.test.ts",
    ],
    server: {
      deps: {
        // wgsl_reflect ships a CommonJS "main" that Node misloads under the
        // package's ESM "type" field, so bundle it through Vite (its `module`
        // build) instead of running it as an externalized dependency.
        inline: ["wgsl_reflect"],
      },
    },
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
