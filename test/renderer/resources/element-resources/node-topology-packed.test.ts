import { describe, expect, it } from "vitest";
import { createPart } from "../../../../src/geometry/part";
import { buildPackedNodeTopologyData } from "../../../../src/renderer/picking/node-topology";
import { packTopologyData } from "../../../../src/renderer/resources/geometry-buffers";

describe("packed node topology", () => {
  it("matches generic packing for mixed, repeated, and noncanonical owners", () => {
    const part = createPart(1, {
      geometries: [
        {
          positions: new Float32Array(15),
          indices: new Uint32Array([0, 1, 2, 0, 3, 4]),
          primitive: "triangles",
          nodePickIds: new Uint32Array([1, 2, 3, 4, 5]),
        },
        {
          positions: new Float32Array(6),
          indices: new Uint32Array([0, 1]),
          primitive: "lines",
          nodePickIds: new Uint32Array([1, 2]),
        },
      ],
      nodePositions: new Float32Array(15),
      elements: [
        {
          id: 5,
          bodyId: 8,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
        },
        {
          id: 4,
          bodyId: 7,
          primitiveRanges: [
            { primitive: "triangles", primitiveStart: 0, primitiveCount: 1 },
            { primitive: "lines", primitiveStart: 0, primitiveCount: 1 },
          ],
        },
      ],
      bodies: [
        { id: 7, elementIds: [4] },
        { id: 8, elementIds: [5] },
      ],
    });
    const sprites = new Uint32Array([1, 1, 3, 5]);

    expect(buildPackedNodeTopologyData(part, sprites)).toEqual(expectedMixedTopology());
  });

  it("preserves the generic empty sentinel layout", () => {
    const part = createPart(1, {
      geometries: [
        {
          positions: new Float32Array(),
          indices: new Uint32Array(),
          primitive: "triangles",
        },
      ],
    });
    const sprites = new Uint32Array();

    expect(buildPackedNodeTopologyData(part, sprites)).toEqual(
      packTopologyData(
        new Uint32Array(5),
        new Uint32Array([0, 0]),
        new Uint32Array([0, 0]),
        new Uint32Array([0, 0]),
      ),
    );
  });
});

function expectedMixedTopology(): Uint32Array {
  return packTopologyData(
    new Uint32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 0, 5, 0, 0, 9, 0, 6, 0]),
    new Uint32Array([0, 2, 2, 2, 4, 1, 5, 1]),
    new Uint32Array([8, 0, 9, 0, 8, 0, 9, 0, 8, 0, 9, 0]),
    new Uint32Array([5, 0, 6, 0, 5, 0, 6, 0, 5, 0, 6, 0]),
    {
      elementOrdinals: new Uint32Array([0, 0, 2, 1]),
      conditionElementOrdinals: new Uint32Array([2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 0]),
      primitiveIds: [],
      edgeIds: [],
    },
  );
}
