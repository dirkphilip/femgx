import { defineConfig } from "vitest/config";
import { sourceAlias } from "./config/source-alias.ts";

export default defineConfig({
  resolve: { alias: sourceAlias },
  test: {
    include: ["test/**/*.test.ts"],
    // The performance budget gate runs standalone (see config/vitest.budget.config.ts)
    // so wall-clock budgets are not distorted by coverage instrumentation.
    exclude: [
      "test/bench/budget/budget.test.ts",
      "test/bench/large-model/*.test.ts",
      "test/bench/operations.test.ts",
      "test/bench/selection-sync.test.ts",
      "test/bench/scene/*.test.ts",
      "test/bench/node-selection-sync.test.ts",
      "test/bench/visibility/tet4-visibility-sync.test.ts",
      "test/bench/affected-part-sync.test.ts",
      "test/bench/cold-attachment.test.ts",
      // Svelte component tests run with the plugin in the demo component gate.
      "test/demo/ui*.test.ts",
      "test/demo/ui/**/*.test.ts",
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
