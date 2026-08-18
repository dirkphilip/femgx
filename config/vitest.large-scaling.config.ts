import { defineConfig } from "vitest/config";

/** Local-only large-model scaling runner; intentionally absent from default CI. */
export default defineConfig({
  test: {
    include: [
      "test/bench/large-model/fe-scaling.test.ts",
      "test/bench/large-model/glb-import-scaling.test.ts",
    ],
    testTimeout: 60_000,
  },
});
