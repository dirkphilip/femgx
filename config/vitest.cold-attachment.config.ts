import { defineConfig } from "vitest/config";
import { sourceAlias } from "./source-alias.ts";

/** Local-only cold renderer-attachment benchmark. */
export default defineConfig({
  resolve: { alias: sourceAlias },
  test: {
    include: ["test/bench/cold-attachment.test.ts"],
    testTimeout: 300_000,
  },
});
