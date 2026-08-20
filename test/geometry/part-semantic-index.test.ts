import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { createElementModel } from "../../src/elements/model";
import { ElementShape } from "../../src/elements/shapes";
import { createPartFromElementModel } from "../../src/geometry/element-model-part";
import { createPart } from "../../src/geometry/part";
import { getPartSemanticIndex } from "../../src/geometry/part-semantic-index";
import type { GeometryFaces } from "../../src/geometry/semantic/geometry-semantic-capabilities";

describe("getPartSemanticIndex", () => {
  it("indexes every authored triangle face under each incident node", () => {
    const part = createPartFromElementModel(
      1,
      createElementModel(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1],
        [
          createElement(1, ElementShape.Tet4, [0, 1, 2, 3]),
          createElement(2, ElementShape.Tet4, [0, 1, 2, 4]),
        ],
      ),
    );
    const triangle = part.geometries.find((geometry) => geometry.primitive === "triangles");
    const index = getPartSemanticIndex(part);
    if (triangle?.primitive !== "triangles") throw new Error("triangle geometry is missing");
    expect(index).toBe(getPartSemanticIndex(part));
    expect(index.nodeTriangleFaceOffsets).toBeInstanceOf(Uint32Array);
    expect(index.nodeTriangleFaceIds).toBeInstanceOf(Uint32Array);
    expect(index.nodeTriangleFaceOffsets.length).toBe(6);
    expect(index.nodeTriangleFaceIds.length).toBe(24);
    expect(faceElementIds(index, triangle.faces, 0)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(faceElementIds(index, triangle.faces, 4)).toEqual([2, 2, 2]);
  });

  it("does not allocate node-face arrays for non-triangle parts", () => {
    const part = createPart(2, {
      geometries: [
        {
          positions: new Float32Array([0, 0, 0, 1, 0, 0]),
          indices: new Uint32Array([0, 1]),
          primitive: "points",
          nodePickIds: new Uint32Array([1, 2]),
        },
      ],
      nodePositions: new Float32Array([0, 0, 0, 1, 0, 0]),
    });
    const index = getPartSemanticIndex(part);
    expect(index.nodeCount).toBe(2);
    expect(index.nodeTriangleFaceOffsets).toHaveLength(0);
    expect(index.nodeTriangleFaceIds).toHaveLength(0);
  });
});

function faceElementIds(
  index: ReturnType<typeof getPartSemanticIndex>,
  faces: GeometryFaces | undefined,
  nodeId: number,
): number[] {
  const start = index.nodeTriangleFaceOffsets[nodeId] ?? 0;
  const end = index.nodeTriangleFaceOffsets[nodeId + 1] ?? start;
  return Array.from({ length: end - start }, (_, offset) => {
    const faceId = index.nodeTriangleFaceIds[start + offset] ?? 0;
    return faces?.at(faceId)?.elementId ?? -1;
  }).sort((left, right) => left - right);
}
