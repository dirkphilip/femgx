import { describe, expect, it } from "vitest";
import { buildFaceSubsetIndices } from "../../../src/renderer/selection/face-subset";

describe("GPU face subsets", () => {
  it("preserves declared face order while emitting selected triangle indices", () => {
    const geometry = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      primitive: "triangles" as const,
      faces: [
        {
          elementId: 10,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 1,
          key: "0/1/2",
          nodeIds: [0, 1, 2],
          neighborElementIds: [],
        },
        {
          elementId: 20,
          faceIndex: 0,
          primitiveStart: 1,
          primitiveCount: 1,
          key: "3/4/5",
          nodeIds: [3, 4, 5],
          neighborElementIds: [],
        },
      ],
      faceSubset: { faceIds: [{ elementId: 20, faceIndex: 0 }] },
    };

    expect(Array.from(buildFaceSubsetIndices(geometry))).toEqual([3, 4, 5]);
  });
});
