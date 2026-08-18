import { defineConfig } from "vitest/config";

/** Local-only large Tet4 node-selection synchronization benchmark. */
export default defineConfig({
  test: {
    include: ["test/bench/node-selection-sync.test.ts"],
    testTimeout: 120_000,
  },
});
