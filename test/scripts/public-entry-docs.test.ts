import { describe, expect, it } from "vitest";
import { findPublicEntryDocViolations } from "../../scripts/check-public-entry-docs.mjs";

describe("public entry documentation", () => {
  it("matches the declared package exports", () => {
    expect(findPublicEntryDocViolations()).toEqual([]);
  });
});
