import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/demo/**/*.test.ts"],
    exclude: ["test/demo/ui*.test.ts", "test/demo/ui/**/*.test.ts"],
    server: {
      deps: {
        inline: ["wgsl_reflect"],
      },
    },
    coverage: {
      provider: "v8",
      include: [
        "demo/workbench/{build-info,section-controls}.ts",
        "demo/workbench/interaction/{interaction,menu}.ts",
        "demo/workbench/models/model.ts",
        "demo/workbench/results/{result-controls,snapshot}.ts",
        "demo/workbench/selection/{box-preview,box-selection-resolver,inspect,pick,selection}.ts",
        "demo/workbench/state/{visibility-snapshot,visibility-tree}.ts",
        "demo/workbench/viewport/render-loop.ts",
      ],
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage/demo-core",
      thresholds: {
        lines: 80,
        functions: 85,
        branches: 70,
        statements: 80,
      },
    },
  },
});
