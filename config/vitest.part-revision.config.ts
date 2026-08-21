import { defineConfig } from "vitest/config";
import { sourceAlias } from "./source-alias.ts";

/** Local-only immutable part-revision benchmark. */
export default defineConfig({
  resolve: { alias: sourceAlias },
  test: {
    include: ["test/bench/scene/part-revision.test.ts"],
    testTimeout: 300_000,
  },
});
