import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ["browser"],
  },
  test: {
    include: ["test/demo/ui-interactions.test.ts"],
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      include: ["demo/workbench/ui/**/*.svelte"],
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage/demo-components",
      thresholds: {
        lines: 80,
        functions: 85,
        branches: 70,
        statements: 80,
      },
    },
  },
});
