import { defineConfig } from "vitest/config";

/** Local-only CPU operation benchmark; it emits one structured baseline report. */
export default defineConfig({
  test: {
    include: ["test/bench/operations.test.ts"],
    testTimeout: 120_000,
  },
});
