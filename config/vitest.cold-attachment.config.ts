import { defineConfig } from "vitest/config";

/** Local-only cold renderer-attachment benchmark. */
export default defineConfig({
  test: {
    include: ["test/bench/cold-attachment.test.ts"],
    testTimeout: 300_000,
  },
});
