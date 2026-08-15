import { describe, expect, it } from "vitest";
import { expandSurfaceGeometry } from "../../src/renderer/resources/gpu-surface-geometry";

describe("expanded surface geometry", () => {
  it("retains the logical primitive for every shared indexed corner", () => {
    const geometry = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      indices: new Uint32Array([2, 1, 0, 0, 2, 3]),
      nodePickIds: new Uint32Array([11, 12, 13, 14]),
      primitive: "triangles" as const,
    };

    const expanded = expandSurfaceGeometry(geometry);

    expect(Array.from(expanded.indices)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(Array.from(expanded.primitiveIds)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(Array.from(expanded.nodePickIds)).toEqual([13, 12, 11, 11, 13, 14]);
    expect(Array.from(expanded.positions)).toEqual([
      1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0,
    ]);
  });

  it("maps a face subset back to its original primitive metadata", () => {
    const geometry = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      primitive: "triangles" as const,
    };

    const expanded = expandSurfaceGeometry(geometry, new Uint32Array([0, 2, 3]));

    expect(Array.from(expanded.primitiveIds)).toEqual([1, 1, 1]);
    expect(Array.from(expanded.indices)).toEqual([0, 1, 2]);
  });

  it("expands authored line segments into indexed screen-space quads", () => {
    const geometry = {
      positions: new Float32Array([0, 0, 0, 2, 0, 0, 2, 2, 0]),
      indices: new Uint32Array([0, 1, 1, 2]),
      nodePickIds: new Uint32Array([4, 5, 6]),
      primitive: "lines" as const,
    };

    const expanded = expandSurfaceGeometry(geometry);

    expect(Array.from(expanded.indices)).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    expect(Array.from(expanded.primitiveIds)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(Array.from(expanded.nodePickIds)).toEqual([4, 5, 5, 4, 5, 6, 6, 5]);
  });
});
