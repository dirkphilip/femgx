import { describe, expect, it } from "vitest";
import { buildMeshEdges } from "../../src/renderer/gpu-edge";

describe("buildMeshEdges", () => {
  it("uses element boundary edges instead of triangulation diagonals", () => {
    const geometry = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      nodePickIds: new Uint32Array([1, 2, 3, 4]),
      faces: [
        {
          id: 0,
          elementId: 0,
          faceIndex: 0,
          key: "0/1/2/3",
          nodeIds: [0, 1, 2, 3],
          neighborElementIds: [],
        },
      ],
    };

    expect(Array.from(buildMeshEdges(geometry))).toEqual([0, 1, 1, 2, 2, 3, 3, 0]);
  });
});
