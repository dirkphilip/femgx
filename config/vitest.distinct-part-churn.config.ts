import { defineConfig } from "vitest/config";
import { sourceAlias } from "./source-alias.ts";

/** Local-only 100k distinct-part viewport scene-churn benchmark. */
export default defineConfig({
  resolve: { alias: sourceAlias },
  test: {
    include: ["test/bench/scene/distinct-part-churn.test.ts"],
    disableConsoleIntercept: true,
    fileParallelism: false,
    testTimeout: 300_000,
  },
});
