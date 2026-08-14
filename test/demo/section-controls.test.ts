import { describe, expect, it } from "vitest";
import {
  clampSectionOffset,
  sectionAxisBounds,
  sectionAxisMidpoint,
  sectionPlaneFor,
} from "../../demo/workbench/section-controls";

const bounds = { minX: -2, minY: 1, minZ: 4, maxX: 6, maxY: 5, maxZ: 10 };

describe("section controls", () => {
  it("maps axes to positive-half-space planes", () => {
    expect(sectionPlaneFor("x", 3)).toEqual({ normal: [1, 0, 0], distance: -3 });
    expect(sectionPlaneFor("y", 2)).toEqual({ normal: [0, 1, 0], distance: -2 });
    expect(sectionPlaneFor("z", 7)).toEqual({ normal: [0, 0, 1], distance: -7 });
    expect(sectionPlaneFor("off", 0)).toBeUndefined();
  });

  it("uses placed bounds and clamps slider values", () => {
    expect(sectionAxisBounds(bounds, "x")).toEqual({ min: -2, max: 6 });
    expect(sectionAxisMidpoint(bounds, "z")).toBe(7);
    expect(clampSectionOffset(-100, bounds, "y")).toBe(1);
    expect(clampSectionOffset(100, bounds, "y")).toBe(5);
  });
});
