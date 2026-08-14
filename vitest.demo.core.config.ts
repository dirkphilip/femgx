import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/demo/**/*.test.ts"],
    exclude: ["test/demo/ui*.test.ts"],
    server: {
      deps: {
        inline: ["wgsl_reflect"],
      },
    },
    coverage: {
      provider: "v8",
      include: [
        "demo/workbench/{box-preview,box-selection-resolver,build-info,inspect,interaction,menu,model,pick,render-loop,result-controls,section-controls,selection,snapshot,visibility-tree,visibility-snapshot}.ts",
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
