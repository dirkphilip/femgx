import { describe, expect, it } from "vitest";
import { ElementShape } from "../../src/elements/shapes";
import { createPart } from "../../src/geometry/part";
import { getPartSemanticIndex } from "../../src/geometry/part-semantic-index";
import { buildPrimitiveFaceBodyPickData } from "../../src/renderer/picking/ids";
import {
  geometrySemanticGraph,
  partSemanticGraph,
} from "../../src/geometry/semantic/part-semantic-graph";
import { graphBodyAt, graphElementAt } from "../../src/geometry/semantic/part-semantic-views";
import {
  geometrySemanticCapabilities,
  semanticCapabilitiesForGeometry,
} from "../../src/geometry/semantic/geometry-semantic-capabilities";

describe("Part semantic graph", () => {
  it("packs FE semantics into typed columns while raw display parts retain none", () => {
    const raw = createPart(1, { geometries: [triangleGeometry()] });
    const part = createPart(2, {
      geometries: [triangleGeometry()],
      elements: [
        {
          id: 9,
          shape: ElementShape.Triangle,
          bodyId: 7,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
        },
      ],
      bodies: [{ id: 7, name: "plate", elementIds: [9] }],
    });

    const graph = partSemanticGraph(part);

    expect(partSemanticGraph(raw)).toBeUndefined();
    expect(geometrySemanticGraph(raw.geometries[0] ?? {})).toBeUndefined();
    expect(semanticCapabilitiesForGeometry(raw.geometries[0] ?? {})).toBeUndefined();
    expect(geometrySemanticGraph(part.geometries[0] ?? {})?.geometryOrdinal).toBe(0);
    expect(graph?.elementIds).toEqual(new Uint32Array([9]));
    expect(graph?.elementRangeGeometryOrdinals).toEqual(new Uint8Array([0]));
    expect(graph?.bodyIds).toEqual(new Uint32Array([7]));
    expect(graph?.bodyNameDefined).toEqual(new Uint8Array([1]));
    expect(graph?.bodyElementOrdinals).toEqual(new Uint32Array([0]));
    expect(graph?.faceGeometryOrdinals).toBeInstanceOf(Uint8Array);
    expect(graph?.edgeNodeOffsets).toBeInstanceOf(Uint32Array);
    if (graph === undefined) throw new Error("Expected canonical semantic graph");
    expect(graphElementAt(graph, 0)?.id).toBe(9);
    expect(graphBodyAt(graph, 0)).toEqual({ id: 7, name: "plate", elementIds: [9] });
    expect(geometrySemanticCapabilities(graph, 0).faces.count).toBe(0);
  });

  it("uses the fixed empty body-ownership column when generic parts have no bodies", () => {
    const part = createPart(4, {
      geometries: [triangleGeometry()],
      elements: [
        {
          id: 9,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
        },
      ],
    });
    expect(partSemanticGraph(part)?.elementBodyIds).toEqual(new Uint32Array(0));
  });

  it("resolves generic face subsets through sparse ids, not element authoring order", () => {
    const part = createPart(6, {
      geometries: [
        {
          primitive: "triangles",
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: new Uint32Array([0, 1, 2, 0, 1, 2]),
          faces: [
            {
              elementId: 9,
              faceIndex: 0,
              primitiveStart: 0,
              primitiveCount: 1,
              key: "0,1,2",
              nodeIds: [0, 1, 2],
            },
            {
              elementId: 3,
              faceIndex: 0,
              primitiveStart: 1,
              primitiveCount: 1,
              key: "0,1,2",
              nodeIds: [0, 1, 2],
            },
          ],
          faceSubset: {
            faceIds: [
              { elementId: 3, faceIndex: 0 },
              { elementId: 9, faceIndex: 0 },
            ],
          },
        },
      ],
      elements: [
        {
          id: 9,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
        },
        {
          id: 3,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
        },
      ],
    });
    const graph = partSemanticGraph(part);
    expect(graph?.faceSubsetOrdinals).toEqual(new Uint32Array([1, 0]));
    expect(graph?.faceElementOffsets).toEqual(new Uint32Array([0, 1, 2]));
    expect(graph?.faceElementOffsets.byteLength).toBe(3 * Uint32Array.BYTES_PER_ELEMENT);
  });

  it("resolves typed body, face, and edge identities without retaining query records", () => {
    const part = createPart(3, {
      geometries: [
        {
          ...triangleGeometry(),
          faces: [
            {
              elementId: 9,
              faceIndex: 2,
              primitiveStart: 0,
              primitiveCount: 1,
              key: "0,1,2",
              nodeIds: [0, 1, 2],
              bodyId: 7,
            },
          ],
          edges: [
            {
              key: "0,1",
              nodeIds: [0, 1],
              incidentElementIds: [9],
              faceRefs: [{ elementId: 9, faceIndex: 2 }],
            },
          ],
        },
      ],
      elements: [
        {
          id: 9,
          bodyId: 7,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
        },
      ],
      bodies: [{ id: 7, elementIds: [9] }],
    });
    const semantic = getPartSemanticIndex(part);
    const graph = partSemanticGraph(part);
    const body = semantic.body(7);
    const face = semantic.face(9, 2)?.face;
    const edge = semantic.edge("0,1");

    expect(body).toEqual({ id: 7, elementIds: [9] });
    expect(face?.elementId).toBe(9);
    expect(edge?.incidentElementIds).toEqual([9]);
    expect(semantic.body(7)).not.toBe(body);
    expect(semantic.face(9, 2)?.face).not.toBe(face);
    expect(semantic.edge("0,1")).not.toBe(edge);
    if (graph === undefined) throw new Error("Expected graph");
    const geometry = geometrySemanticCapabilities(graph, 0);
    expect(geometry.faces.get(9, 2)).toEqual(face);
    expect(geometry.edges.get("0,1")).toEqual(edge);
    expect(
      Array.from(buildPrimitiveFaceBodyPickData(part.geometries[0] ?? triangleGeometry())),
    ).toEqual([1, 8, 0, 10, 0]);
    expect(semanticCapabilitiesForGeometry(part.geometries[0] ?? {})?.faces.count).toBe(1);
  });

  it("validates and publishes sparse 100k generic descriptors through typed columns", () => {
    const count = 100_000;
    const firstId = 4_294_967_294 - count + 1;
    const indices = new Uint32Array(count * 3);
    const elements = new Array<{
      id: number;
      primitiveRanges: { primitive: "triangles"; primitiveStart: number; primitiveCount: number }[];
    }>(count);
    const faces = new Array<{
      elementId: number;
      faceIndex: number;
      primitiveStart: number;
      primitiveCount: number;
      key: string;
      nodeIds: number[];
    }>(count);
    const edges = new Array<{
      key: string;
      nodeIds: number[];
      incidentElementIds: number[];
      faceRefs: { elementId: number; faceIndex: number }[];
    }>(count);
    const faceIds = new Array<{ elementId: number; faceIndex: number }>(count);
    for (let row = 0; row < count; row += 1) {
      const id = firstId + row;
      indices[row * 3] = 0;
      indices[row * 3 + 1] = 1;
      indices[row * 3 + 2] = 2;
      elements[row] = {
        id,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: row, primitiveCount: 1 }],
      };
      faces[row] = {
        elementId: id,
        faceIndex: 0,
        primitiveStart: row,
        primitiveCount: 1,
        key: "0,1,2",
        nodeIds: [0, 1, 2],
      };
      edges[row] = {
        key: `${row},${row + 1}`,
        nodeIds: [row, row + 1],
        incidentElementIds: [id],
        faceRefs: [{ elementId: id, faceIndex: 0 }],
      };
      faceIds[row] = { elementId: id, faceIndex: 0 };
    }
    const part = createPart(5, {
      geometries: [
        {
          primitive: "triangles",
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices,
          faces,
          edges,
          faceSubset: { faceIds },
        },
      ],
      elements,
    });
    const graph = partSemanticGraph(part);

    expect(graph?.elementIds.length).toBe(count);
    expect(graph?.elementIds[0]).toBe(firstId);
    expect(graph?.elementIds[count - 1]).toBe(4_294_967_294);
    expect(graph?.faceSubsetOrdinals.length).toBe(count);
    expect(graph?.edgeIndexNext).toBeInstanceOf(Int32Array);
    expect(Array.isArray(graph?.elementIds)).toBe(false);
    expect(Array.isArray(graph?.faceLookupOrdinals)).toBe(false);
    expect(part.elements?.get(4_294_967_294)?.id).toBe(4_294_967_294);
    expect(part.geometries[0]?.primitive === "triangles" && part.geometries[0].faces?.count).toBe(
      count,
    );
  });
});

function triangleGeometry() {
  return {
    primitive: "triangles" as const,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  };
}
