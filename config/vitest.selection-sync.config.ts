import { defineConfig } from "vitest/config";
import { sourceAlias } from "./source-alias.ts";

/** Local-only dense selection synchronization benchmark. */
export default defineConfig({
  resolve: { alias: sourceAlias },
  test: {
    include: ["test/bench/selection-sync.test.ts"],
    testTimeout: 120_000,
  },
});
