import { defineConfig } from "vitest/config";
import { sourceAlias } from "./source-alias.ts";

/** Local-only affected-part renderer synchronization benchmark. */
export default defineConfig({
  resolve: { alias: sourceAlias },
  test: {
    include: ["test/bench/affected-part-sync.test.ts"],
    testTimeout: 300_000,
  },
});
