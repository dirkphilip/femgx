import { describe, expect, it } from "vitest";
import {
  regionGranularityForKey,
  regionTargetKey,
  subdivideRegion,
  type RegionRect,
} from "../../e2e/browser-support/helpers";

describe("region-localized e2e pick discovery", () => {
  it.each([
    ["n:", "node"],
    ["f:", "face"],
    ["e:", "element"],
    ["ed:", "edge"],
    ["", "face"],
  ] as const)("maps %s to %s region granularity", (prefix, expected) => {
    expect(regionGranularityForKey(prefix, prefix === "" ? "face" : null)).toBe(expected);
  });

  it("encodes region identities using the interaction dataset key", () => {
    expect(regionTargetKey({ kind: "node", instanceId: "1/0", nodeId: 4 })).toBe("n:1/0:4");
    expect(regionTargetKey({ kind: "face", instanceId: "1/0", elementId: 8, faceIndex: 2 })).toBe(
      "f:1/0:8:2",
    );
    expect(regionTargetKey({ kind: "part", partId: 3 })).toBe("p:3");
    expect(regionTargetKey({ kind: "unknown", id: 3 })).toBeUndefined();
  });

  it("subdivides a region into complete, non-overlapping quadrants", () => {
    const region: RegionRect = { left: 0, top: 0, right: 10, bottom: 8, width: 10, height: 8 };
    expect(subdivideRegion(region)).toEqual([
      { left: 0, top: 0, right: 5, bottom: 4, width: 5, height: 4 },
      { left: 5, top: 0, right: 10, bottom: 4, width: 5, height: 4 },
      { left: 0, top: 4, right: 5, bottom: 8, width: 5, height: 4 },
      { left: 5, top: 4, right: 10, bottom: 8, width: 5, height: 4 },
    ]);
  });
});
