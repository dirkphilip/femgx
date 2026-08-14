import { describe, expect, it } from "vitest";
import { normalizeSectionPlane } from "../../src/math/section-plane";

describe("section-plane state", () => {
  it("normalizes the normal and its signed distance together", () => {
    expect(normalizeSectionPlane({ normal: [0, 0, 2], distance: 4 })).toEqual({
      normal: [0, 0, 1],
      distance: 2,
    });
  });

  it.each([
    { normal: [0, 0, 0], distance: 0 },
    { normal: [Number.NaN, 0, 1], distance: 0 },
    { normal: [0, 1, 0], distance: Number.POSITIVE_INFINITY },
  ] as const)("rejects invalid plane %#", (plane) => {
    expect(() => normalizeSectionPlane(plane)).toThrow(RangeError);
  });
});
