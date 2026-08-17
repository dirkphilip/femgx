import { defineConfig } from "vitest/config";

/** Local-only dense selection synchronization benchmark. */
export default defineConfig({
  test: {
    include: ["test/bench/selection-sync.test.ts"],
    testTimeout: 120_000,
  },
});
