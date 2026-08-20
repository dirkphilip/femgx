import { describe, expect, it } from "vitest";
import { buildInfoPresentation } from "../../demo/workbench/build-info";

describe("demo build identityMatrix", () => {
  it("formats a CI timestamp and links the short SHA to the full commit", () => {
    expect(
      buildInfoPresentation("2026-08-13T14:22:09Z", "CB261DF0123456789ABCDEF0123456789ABCDEF0"),
    ).toEqual({
      timestamp: "Built 2026-08-13 14:22 UTC",
      shortRevision: "cb261df",
      commitUrl:
        "https://github.com/dirkphilip/femgx/commit/cb261df0123456789abcdef0123456789abcdef0",
    });
  });

  it("uses an explicit local fallback for missing or invalid revisions", () => {
    expect(buildInfoPresentation("2026-08-13T14:22:09Z", "")).toEqual({
      timestamp: "Built 2026-08-13 14:22 UTC",
      shortRevision: undefined,
      commitUrl: undefined,
    });
    expect(() => buildInfoPresentation("not-a-date", "local")).toThrow(/valid ISO date/);
  });
});
