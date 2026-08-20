import { describe, expect, it } from "vitest";
import { identityMatrix, scalingMatrix, translationMatrix } from "@/entries/root";
import type { BoxSelectionFrustum } from "@/entries/interaction";
import {
  classifyLocalBounds,
  localBoundsPlanes,
} from "../../../demo/workbench/selection/through-box-bounds";

const box: BoxSelectionFrustum = {
  left: { normal: [1, 0, 0], distance: 1 },
  right: { normal: [-1, 0, 0], distance: 1 },
  top: { normal: [0, -1, 0], distance: 1 },
  bottom: { normal: [0, 1, 0], distance: 1 },
  near: { normal: [0, 0, 1], distance: 1 },
  far: { normal: [0, 0, -1], distance: 1 },
};

const section = { normal: [1, 0, 0] as const, distance: -0.5 };

describe("through-box local bounds", () => {
  it.each([
    ["wholly inside", new Float32Array([-0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), true],
    ["wholly outside", new Float32Array([2, -0.5, -0.5, 3, 0.5, 0.5]), false],
    ["crossing", new Float32Array([-2, -0.5, -0.5, 0.5, 0.5, 0.5]), undefined],
  ])("classifies %s bounds", (_name, bounds, expected) => {
    const planes = localBoundsPlanes(identityMatrix(), box, undefined);
    expect(planes).toBeDefined();
    expect(classifyLocalBounds(bounds, 0, planes ?? [], 0)).toBe(expected);
  });

  it("transforms world planes for translated and scaled affine occurrences", () => {
    const planes = localBoundsPlanes(translationMatrix(10, 0, 0), box, undefined);
    expect(planes).toBeDefined();
    expect(
      classifyLocalBounds(new Float32Array([-0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), 0, planes ?? [], 0),
    ).toBe(false);

    const scaled = localBoundsPlanes(scalingMatrix(2, 2, 2), box, undefined);
    expect(scaled).toBeDefined();
    expect(
      classifyLocalBounds(
        new Float32Array([-0.25, -0.25, -0.25, 0.25, 0.25, 0.25]),
        0,
        scaled ?? [],
        0,
      ),
    ).toBe(true);
  });

  it("keeps section-plane crossings on the exact primitive path", () => {
    const planes = localBoundsPlanes(identityMatrix(), box, section);
    expect(planes).toBeDefined();
    expect(
      classifyLocalBounds(
        new Float32Array([-0.75, -0.25, -0.25, 0.75, 0.25, 0.25]),
        0,
        planes ?? [],
        0,
      ),
    ).toBeUndefined();
  });

  it("disables the bounds shortcut for non-affine transforms", () => {
    const nonAffine = new Float32Array(identityMatrix());
    nonAffine[15] = 2;
    expect(localBoundsPlanes(nonAffine, box, undefined)).toBeUndefined();
  });
});
