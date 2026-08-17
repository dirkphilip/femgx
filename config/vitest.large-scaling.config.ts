import { defineConfig } from "vitest/config";

/** Local-only large-model scaling runner; intentionally absent from default CI. */
export default defineConfig({
  test: {
    include: ["test/bench/large-scaling.test.ts"],
    testTimeout: 60_000,
  },
});
