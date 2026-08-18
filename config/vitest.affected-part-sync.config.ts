import { defineConfig } from "vitest/config";

/** Local-only affected-part renderer synchronization benchmark. */
export default defineConfig({
  test: {
    include: ["test/bench/affected-part-sync.test.ts"],
    testTimeout: 300_000,
  },
});
