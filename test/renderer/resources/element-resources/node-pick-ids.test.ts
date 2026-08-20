import { expect, it, describe } from "vitest";
import {
  createPart,
  buildNodeSpritePickIds,
  buildPackedNodeTopologyData,
  partFor,
  type Part,
  type SemanticTestGeometry,
} from "./support";

describe("packed node topology semantics", () => {
  it("keeps an empty node binding large enough for one record", () => {
    expect(
      Array.from(
        unpackNodeTopology(
          partFor({
            positions: new Float32Array(),
            indices: new Uint32Array(),
            primitive: "triangles" as const,
          }),
        ).faceBodyPickIds,
      ),
    ).toEqual([0, 0, 0, 0, 0]);
  });

  it("assigns a body to nodes that belong to exactly one body", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      primitive: "triangles" as const,
      nodePickIds: new Uint32Array([1, 2, 3, 1, 2, 3]),
      nodePositions: new Float32Array(9),
      elements: [
        {
          id: 4,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 2 }],
          bodyId: 7,
        },
      ],
      bodies: [{ id: 7, elementIds: [4] }],
    };
    expect(Array.from(unpackNodeTopology(partFor(geometry)).faceBodyPickIds)).toEqual([
      0, 8, 0, 5, 0, 0, 8, 0, 5, 0, 0, 8, 0, 5, 0,
    ]);
  });

  it("maps sparse sprite ids and keeps unowned nodes empty", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      primitive: "triangles" as const,
      nodePickIds: new Uint32Array([2, 2, 4, 4, 0, 0]),
      nodePositions: new Float32Array(12),
      elements: [
        {
          id: 4,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 2 }],
          bodyId: 7,
        },
      ],
      bodies: [{ id: 7, elementIds: [4] }],
    };
    expect(unpackNodeTopology(partFor(geometry), new Uint32Array([1, 2, 4]))).toEqual({
      faceBodyPickIds: new Uint32Array([0, 0, 0, 0, 0, 0, 8, 0, 5, 0, 0, 8, 0, 5, 0]),
      bodyRanges: new Uint32Array([0, 0, 0, 1, 1, 1]),
      bodyIds: new Uint32Array([8, 0, 8, 0]),
      elementIds: new Uint32Array([5, 0, 5, 0]),
    });
  });

  it("keeps every owner for shared nodes so all-hidden topology can disappear", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      primitive: "triangles" as const,
      nodePickIds: new Uint32Array([1, 2, 3, 1, 2, 3]),
      nodePositions: new Float32Array(9),
      elements: [
        {
          id: 4,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
          bodyId: 7,
        },
        {
          id: 5,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
          bodyId: 8,
        },
      ],
      bodies: [
        { id: 7, elementIds: [4] },
        { id: 8, elementIds: [5] },
      ],
    };
    expect(unpackNodeTopology(partFor(geometry), new Uint32Array([1, 2, 3]))).toMatchObject({
      bodyRanges: new Uint32Array([0, 2, 2, 2, 4, 2]),
      bodyIds: new Uint32Array([8, 0, 9, 0, 8, 0, 9, 0, 8, 0, 9, 0]),
      elementIds: new Uint32Array([5, 0, 6, 0, 5, 0, 6, 0, 5, 0, 6, 0]),
    });
    expect(Array.from(unpackNodeTopology(partFor(geometry)).faceBodyPickIds)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it("sorts each node's owners independently of authored element order", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      primitive: "triangles",
      nodePickIds: new Uint32Array([1, 2, 3, 1, 4, 5]),
      nodePositions: new Float32Array(15),
      elements: [
        {
          id: 5,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
          bodyId: 7,
        },
        {
          id: 4,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
          bodyId: 7,
        },
      ],
      bodies: [{ id: 7, elementIds: [4, 5] }],
    };

    expect(unpackNodeTopology(partFor(geometry), new Uint32Array([1]))).toEqual({
      faceBodyPickIds: new Uint32Array([0, 8, 0, 0, 0]),
      bodyRanges: new Uint32Array([0, 2]),
      bodyIds: new Uint32Array([8, 0, 8, 0]),
      elementIds: new Uint32Array([5, 0, 6, 0]),
    });
  });

  it("follows indexed primitive vertices when assigning shared node owners", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(12),
      indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
      primitive: "triangles",
      nodePickIds: new Uint32Array([1, 2, 3, 4]),
      nodePositions: new Float32Array(12),
      elements: [
        {
          id: 4,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
          bodyId: 7,
        },
        {
          id: 5,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
          bodyId: 8,
        },
      ],
      bodies: [
        { id: 7, elementIds: [4] },
        { id: 8, elementIds: [5] },
      ],
    };

    expect(unpackNodeTopology(partFor(geometry), new Uint32Array([1, 2, 3, 4]))).toMatchObject({
      bodyRanges: new Uint32Array([0, 1, 1, 2, 3, 2, 5, 1]),
      bodyIds: new Uint32Array([8, 0, 8, 0, 9, 0, 8, 0, 9, 0, 9, 0]),
      elementIds: new Uint32Array([5, 0, 5, 0, 6, 0, 5, 0, 6, 0, 6, 0]),
    });
  });

  it("orders unowned contributors first for shared node visibility", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(12),
      indices: new Uint32Array([0, 1, 2, 0, 1, 3]),
      primitive: "triangles",
      nodePickIds: new Uint32Array([1, 2, 3, 4]),
      nodePositions: new Float32Array(12),
      elements: [
        {
          id: 4,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
          bodyId: 7,
        },
        {
          id: 5,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
        },
      ],
      bodies: [{ id: 7, elementIds: [4] }],
    };

    expect(unpackNodeTopology(partFor(geometry), new Uint32Array([1, 2, 3, 4]))).toMatchObject({
      bodyRanges: new Uint32Array([0, 2, 2, 2, 4, 1, 5, 1]),
      bodyIds: new Uint32Array([0, 0, 8, 0, 0, 0, 8, 0, 8, 0, 0, 0]),
      elementIds: new Uint32Array([6, 0, 5, 0, 6, 0, 5, 0, 5, 0, 6, 0]),
    });
    expect(Array.from(unpackNodeTopology(partFor(geometry)).faceBodyPickIds)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 0, 5, 0, 0, 0, 0, 6, 0,
    ]);
  });

  it("deduplicates one element-node owner across primitives and geometry groups", () => {
    const part = createPart(1, {
      geometries: [
        {
          positions: new Float32Array(9),
          indices: new Uint32Array([0, 1, 2, 0, 1, 2]),
          primitive: "triangles",
          nodePickIds: new Uint32Array([1, 2, 3]),
        },
        {
          positions: new Float32Array(6),
          indices: new Uint32Array([0, 1]),
          primitive: "lines",
          nodePickIds: new Uint32Array([1, 2]),
        },
        {
          positions: new Float32Array(3),
          indices: new Uint32Array([0]),
          primitive: "points",
          nodePickIds: new Uint32Array([4]),
        },
      ],
      nodePositions: new Float32Array(12),
      elements: [
        {
          id: 4,
          bodyId: 7,
          primitiveRanges: [
            { primitive: "triangles", primitiveStart: 0, primitiveCount: 2 },
            { primitive: "lines", primitiveStart: 0, primitiveCount: 1 },
            { primitive: "points", primitiveStart: 0, primitiveCount: 1 },
          ],
        },
      ],
      bodies: [{ id: 7, elementIds: [4] }],
    });

    expect(unpackNodeTopology(part, new Uint32Array([1, 2, 3, 4]))).toEqual({
      faceBodyPickIds: new Uint32Array([
        0, 8, 0, 5, 0, 0, 8, 0, 5, 0, 0, 8, 0, 5, 0, 0, 8, 0, 5, 0,
      ]),
      bodyRanges: new Uint32Array([0, 1, 1, 1, 2, 1, 3, 1]),
      bodyIds: new Uint32Array([8, 0, 8, 0, 8, 0, 8, 0]),
      elementIds: new Uint32Array([5, 0, 5, 0, 5, 0, 5, 0]),
    });
  });
});

describe("buildNodeSpritePickIds", () => {
  it("returns unique ascending original ids and skips interpolated vertices", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array(6),
      primitive: "triangles" as const,
      nodePickIds: new Uint32Array([4, 2, 4, 0, 2, 0]),
      nodePositions: new Float32Array(12),
    };
    expect(Array.from(buildNodeSpritePickIds(partFor(geometry)))).toEqual([2, 4]);
  });

  it("does not cover authored point elements with node-overlay sprites", () => {
    const surface: SemanticTestGeometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles",
      nodePickIds: new Uint32Array([1, 2, 3]),
      nodePositions: new Float32Array(12),
    };
    const point: SemanticTestGeometry = {
      positions: new Float32Array([0, 0, 0]),
      indices: new Uint32Array([0]),
      primitive: "points",
      nodePickIds: new Uint32Array([4]),
      nodePositions: new Float32Array(12),
    };
    const part = createPart(1, {
      geometries: [surface, point],
      nodePositions: new Float32Array(12),
    });

    expect(Array.from(buildNodeSpritePickIds(part))).toEqual([1, 2, 3]);
  });
});

function unpackNodeTopology(
  part: Part,
  sprites?: Uint32Array,
): {
  readonly faceBodyPickIds: Uint32Array;
  readonly bodyRanges: Uint32Array;
  readonly bodyIds: Uint32Array;
  readonly elementIds: Uint32Array;
} {
  const data = buildPackedNodeTopologyData(part, sprites);
  const faceEnd = 5 + (data[0] ?? 0) * 5;
  const rangeEnd = faceEnd + (data[1] ?? 0) * 2;
  const bodyEnd = rangeEnd + (data[2] ?? 0) * 2;
  const elementEnd = bodyEnd + (data[2] ?? 0) * 2;
  const sentinel = new Uint32Array([0, 0]);
  return {
    faceBodyPickIds: data.subarray(5, faceEnd),
    bodyRanges: data.subarray(faceEnd, rangeEnd),
    bodyIds: bodyEnd === rangeEnd ? sentinel : data.subarray(rangeEnd, bodyEnd),
    elementIds: elementEnd === bodyEnd ? sentinel : data.subarray(bodyEnd, elementEnd),
  };
}
