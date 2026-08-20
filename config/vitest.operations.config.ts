import { defineConfig } from "vitest/config";
import { sourceAlias } from "./source-alias.ts";

/** Local-only CPU operation benchmark; it emits one structured baseline report. */
export default defineConfig({
  resolve: { alias: sourceAlias },
  test: {
    include: ["test/bench/operations.test.ts"],
    testTimeout: 120_000,
  },
});
