import { describe, expect, it } from "vitest";
import { buildMeshEdgeData, type MeshEdgeData } from "../../../src/renderer/edges/mesh-edge";
import {
  expandMeshEdgeData,
  meshEdgeEndpointData,
} from "../../../src/renderer/edges/edge-expansion";
import type { ElementTessellation, Geometry } from "../../../src/geometry/part";

type SemanticGeometry = Geometry & {
  readonly elements?: readonly ElementTessellation[];
};

function buildSemanticEdgeData(geometry: SemanticGeometry) {
  return buildMeshEdgeData(geometry, geometry.indices, geometry.elements ?? []);
}

describe("buildMeshEdgeData", () => {
  it("reuses endpoint geometry for the native presentation line list", () => {
    const data = {
      indices: new Uint32Array([0, 1]),
      sourceVertexIndices: new Uint32Array([2, 0]),
      edgeIds: new Uint32Array([3, 3]),
      positions: new Float32Array([0, 0, 0, 1, 0, 0]),
      bodyRanges: new Uint32Array([0, 0]),
      bodyIds: new Uint32Array([0]),
      elementIds: new Uint32Array([0]),
    } satisfies MeshEdgeData;

    const compact = meshEdgeEndpointData(data, new Uint32Array([7, 8, 9]));

    expect(compact.indices).toBe(data.indices);
    expect(compact.positions).toBe(data.positions);
    expect(compact.edgeIds).toBe(data.edgeIds);
    expect(compact.nodePickIds).toEqual(new Uint32Array([9, 7]));
  });

  it("expands each authored segment into one indexed quad", () => {
    const data = {
      indices: new Uint32Array([0, 1]),
      sourceVertexIndices: new Uint32Array([0, 1]),
      edgeIds: new Uint32Array([3, 3]),
      positions: new Float32Array([0, 0, 0, 1, 0, 0]),
      bodyRanges: new Uint32Array([0, 0]),
      bodyIds: new Uint32Array([0]),
      elementIds: new Uint32Array([0]),
    } satisfies MeshEdgeData;
    const expanded = expandMeshEdgeData(data, new Uint32Array([7, 8]));

    expect(expanded.indices).toEqual(new Uint32Array([0, 1, 2, 0, 2, 3]));
    expect(expanded.sourceVertexIndices).toEqual(new Uint32Array([0, 1, 1, 0]));
    expect(expanded.edgeIds).toEqual(new Uint32Array([3, 3, 3, 3]));
    expect(expanded.nodePickIds).toEqual(new Uint32Array([7, 8, 8, 7]));
    expect(expanded.positions).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0]));
  });

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
        },
      ],
    };

    expect(Array.from(buildSemanticEdgeData(geometry).sourceVertexIndices)).toEqual([
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
        {
          id: 4,
          primitiveRanges: [
            { primitive: "triangles" as const, primitiveStart: 0, primitiveCount: 1 },
          ],
          bodyId: 7,
        },
        {
          id: 5,
          primitiveRanges: [
            { primitive: "triangles" as const, primitiveStart: 1, primitiveCount: 1 },
          ],
          bodyId: 8,
        },
      ],
      faces: [
        {
          elementId: 4,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 1,
          key: "0/1/2",
          nodeIds: [0, 1, 2],
        },
        {
          elementId: 5,
          faceIndex: 0,
          primitiveStart: 1,
          primitiveCount: 1,
          key: "0/1/3",
          nodeIds: [0, 1, 3],
        },
      ],
    };

    const data = buildSemanticEdgeData(geometry);
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
        {
          id: 4,
          primitiveRanges: [
            { primitive: "triangles" as const, primitiveStart: 0, primitiveCount: 1 },
          ],
          bodyId: 7,
        },
        {
          id: 5,
          primitiveRanges: [
            { primitive: "triangles" as const, primitiveStart: 1, primitiveCount: 1 },
          ],
        },
      ],
      faces: [
        {
          elementId: 4,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 1,
          key: "0/1/2",
          nodeIds: [0, 1, 2],
        },
        {
          elementId: 5,
          faceIndex: 0,
          primitiveStart: 1,
          primitiveCount: 1,
          key: "0/1/3",
          nodeIds: [0, 1, 3],
        },
      ],
    };

    const data = buildSemanticEdgeData(geometry);
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
        {
          id: 4,
          primitiveRanges: [
            { primitive: "triangles" as const, primitiveStart: 0, primitiveCount: 1 },
          ],
        },
        {
          id: 5,
          primitiveRanges: [
            { primitive: "triangles" as const, primitiveStart: 1, primitiveCount: 1 },
          ],
        },
      ],
    };

    const data = buildSemanticEdgeData(geometry);

    expect(data.bodyRanges).toEqual(new Uint32Array([0, 1, 1, 1, 2, 2, 4, 1, 5, 1]));
    expect(data.elementIds).toEqual(new Uint32Array([5, 0, 5, 0, 5, 0, 6, 0, 6, 0, 6, 0]));
  });

  it("maps expanded endpoints to source vertices and one logical edge", () => {
    const geometry = {
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0, 50, 0, 0]),
      indices: new Uint32Array([5, 1, 3, 4, 2, 0]),
      primitive: "triangles" as const,
    };

    const data = buildSemanticEdgeData(geometry);

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
});
