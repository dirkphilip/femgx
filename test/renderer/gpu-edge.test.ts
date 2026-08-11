import { describe, expect, it } from "vitest";
import { buildMeshEdgeData, buildMeshEdges } from "../../src/renderer/gpu-edge";

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

  it("deduplicates shared quadratic-ready topology and retains all body owners", () => {
    const geometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      nodePickIds: new Uint32Array([1, 2, 3, 1, 2, 4]),
      elements: [
        { id: 4, triangleStart: 0, triangleCount: 1, bodyId: 7 },
        { id: 5, triangleStart: 1, triangleCount: 1, bodyId: 8 },
      ],
      faces: [
        {
          id: 0,
          elementId: 4,
          faceIndex: 0,
          key: "0/1/2",
          nodeIds: [0, 1, 2],
          neighborElementIds: [],
        },
        {
          id: 1,
          elementId: 5,
          faceIndex: 0,
          key: "0/1/3",
          nodeIds: [0, 1, 3],
          neighborElementIds: [],
        },
      ],
    };

    const data = buildMeshEdgeData(geometry);
    expect(data.indices.length).toBe(10);
    expect(data.bodyRanges.slice(0, 2)).toEqual(new Uint32Array([0, 2]));
    expect(data.bodyIds).toEqual(new Uint32Array([8, 9, 8, 8, 9, 9]));
  });
});
