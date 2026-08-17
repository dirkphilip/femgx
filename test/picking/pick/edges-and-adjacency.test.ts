import { describe, expect, it } from "vitest";
import {
  tetModel,
  instanceAt,
  triangleGeometry,
  shared,
  createPart,
  geometryAdjacency,
  resolveEdgePickHit,
} from "./support";

describe("resolveEdgePickHit", () => {
  it("returns stable topology and a world-space canonical tangent", () => {
    const edgePart = createPart(1, {
      geometries: [
        {
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: new Uint32Array([0, 1, 2]),
          primitive: "triangles",
          edges: [
            {
              key: "0,1",
              nodeIds: [0, 1],
              incidentElementIds: [3],
              faceRefs: [],
            },
          ],
        },
      ],
      elements: [
        {
          id: 3,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
        },
      ],
      nodePositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    });
    const target = resolveEdgePickHit(
      { instances: [instanceAt(0)], parts: new Map([[1, edgePart]]) },
      1,
      "0,1",
      [0.25, 0, 0],
    );
    expect(target).toMatchObject({
      kind: "edge",
      key: "0,1",
      nodeIds: [0, 1],
      incidentElementIds: [3],
      faceRefs: [],
      worldPosition: [0.25, 0, 0],
      tangent: [1, 0, 0],
    });
  });
});

describe("geometryAdjacency", () => {
  it("collects neighbor elements and nodes from the face descriptors", () => {
    const geometry = triangleGeometry(shared());
    const adjacency = geometryAdjacency(geometry, 0);
    expect(adjacency.neighborElementIds).toEqual([1, 2]);
    expect(adjacency.neighborNodeIds).toEqual([1, 2, 3, 4]);
  });

  it("returns empty adjacency for an unknown node", () => {
    const geometry = triangleGeometry(tetModel());
    expect(geometryAdjacency(geometry, 99)).toEqual({
      neighborElementIds: [],
      neighborNodeIds: [],
    });
  });
});
