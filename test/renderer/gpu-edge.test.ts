import { describe, expect, it } from "vitest";
import { buildMeshEdgeData } from "../../src/renderer/gpu-edge";

describe("buildMeshEdgeData", () => {
  it("uses element boundary edges instead of triangulation diagonals", () => {
    const geometry = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      primitive: "triangles" as const,
      nodePickIds: new Uint32Array([1, 2, 3, 4]),
      faces: [
        {
          elementId: 0,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 2,
          key: "0/1/2/3",
          nodeIds: [0, 1, 2, 3],
          neighborElementIds: [],
        },
      ],
    };

    expect(Array.from(buildMeshEdgeData(geometry).sourceVertexIndices)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 0,
    ]);
  });

  it("deduplicates shared quadratic-ready topology and retains all body owners", () => {
    const geometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      primitive: "triangles" as const,
      nodePickIds: new Uint32Array([1, 2, 3, 1, 2, 4]),
      elements: [
        { id: 4, primitiveStart: 0, primitiveCount: 1, bodyId: 7 },
        { id: 5, primitiveStart: 1, primitiveCount: 1, bodyId: 8 },
      ],
      faces: [
        {
          elementId: 4,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 1,
          key: "0/1/2",
          nodeIds: [0, 1, 2],
          neighborElementIds: [],
        },
        {
          elementId: 5,
          faceIndex: 0,
          primitiveStart: 1,
          primitiveCount: 1,
          key: "0/1/3",
          nodeIds: [0, 1, 3],
          neighborElementIds: [],
        },
      ],
    };

    const data = buildMeshEdgeData(geometry);
    expect(data.indices.length).toBe(10);
    expect(data.bodyRanges.slice(0, 2)).toEqual(new Uint32Array([0, 2]));
    expect(data.bodyIds).toEqual(new Uint32Array([8, 0, 9, 0, 8, 0, 8, 0, 9, 0, 9, 0]));
    expect(data.elementIds).toEqual(new Uint32Array([5, 0, 6, 0, 5, 0, 5, 0, 6, 0, 6, 0]));
  });

  it("retains an unowned contributor on a shared edge", () => {
    const geometry = {
      positions: new Float32Array(12),
      indices: new Uint32Array([0, 1, 2, 0, 1, 3]),
      primitive: "triangles" as const,
      nodePickIds: new Uint32Array([1, 2, 3, 4]),
      elements: [
        { id: 4, primitiveStart: 0, primitiveCount: 1, bodyId: 7 },
        { id: 5, primitiveStart: 1, primitiveCount: 1 },
      ],
      faces: [
        {
          elementId: 4,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 1,
          key: "0/1/2",
          nodeIds: [0, 1, 2],
          neighborElementIds: [],
        },
        {
          elementId: 5,
          faceIndex: 0,
          primitiveStart: 1,
          primitiveCount: 1,
          key: "0/1/3",
          nodeIds: [0, 1, 3],
          neighborElementIds: [],
        },
      ],
    };

    const data = buildMeshEdgeData(geometry);
    expect(data.bodyRanges.slice(0, 2)).toEqual(new Uint32Array([0, 2]));
    expect(data.bodyIds.slice(0, 4)).toEqual(new Uint32Array([0, 0, 8, 0]));
  });

  it("retains element contributors on shared edges without declared faces", () => {
    const geometry = {
      positions: new Float32Array(12),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      primitive: "triangles" as const,
      nodePickIds: new Uint32Array([1, 2, 3, 4]),
      elements: [
        { id: 4, primitiveStart: 0, primitiveCount: 1 },
        { id: 5, primitiveStart: 1, primitiveCount: 1 },
      ],
    };

    const data = buildMeshEdgeData(geometry);

    expect(data.bodyRanges).toEqual(new Uint32Array([0, 1, 1, 1, 2, 2, 4, 1, 5, 1]));
    expect(data.elementIds).toEqual(new Uint32Array([5, 0, 5, 0, 5, 0, 6, 0, 6, 0, 6, 0]));
  });

  it("maps expanded endpoints to source vertices and one logical edge", () => {
    const geometry = {
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0, 50, 0, 0]),
      indices: new Uint32Array([5, 1, 3, 4, 2, 0]),
      primitive: "triangles" as const,
    };

    const data = buildMeshEdgeData(geometry);

    expect(data.indices).toEqual(new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
    expect(data.sourceVertexIndices).toEqual(new Uint32Array([5, 1, 1, 3, 3, 5, 4, 2, 2, 0, 0, 4]));
    expect(data.edgeIds).toEqual(new Uint32Array([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]));
    expect(data.positions).toEqual(
      new Float32Array([
        50, 0, 0, 10, 0, 0, 10, 0, 0, 30, 0, 0, 30, 0, 0, 50, 0, 0, 40, 0, 0, 20, 0, 0, 20, 0, 0, 0,
        0, 0, 0, 0, 0, 40, 0, 0,
      ]),
    );
  });

  it("retains block ownership on edges for block-aware parts", () => {
    const geometry = {
      positions: new Float32Array(12),
      indices: new Uint32Array([0, 1, 2, 0, 1, 3]),
      primitive: "triangles" as const,
      elements: [
        { id: 4, primitiveStart: 0, primitiveCount: 1, blockId: 10 },
        { id: 5, primitiveStart: 1, primitiveCount: 1, blockId: 11 },
      ],
      blocks: [
        { id: 10, elementIds: [4] },
        { id: 11, elementIds: [5] },
      ],
    };
    const data = buildMeshEdgeData(geometry);
    expect(data.blockIds?.slice(0, 4)).toEqual(new Uint32Array([11, 0, 12, 0]));
  });
});
