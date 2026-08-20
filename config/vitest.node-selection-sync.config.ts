import { defineConfig } from "vitest/config";
import { sourceAlias } from "./source-alias.ts";

/** Local-only large Tet4 node-selection synchronization benchmark. */
export default defineConfig({
  resolve: { alias: sourceAlias },
  test: {
    include: ["test/bench/node-selection-sync.test.ts"],
    testTimeout: 120_000,
  },
});
