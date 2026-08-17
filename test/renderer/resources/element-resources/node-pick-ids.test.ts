import { expect, it, describe } from "vitest";
import {
  createPart,
  buildNodeBodyPickData,
  buildNodeBodyOwnerData,
  buildNodeSpritePickIds,
  partFor,
  type SemanticTestGeometry,
} from "./support";

describe("buildNodeBodyPickData", () => {
  it("keeps an empty node binding large enough for one record", () => {
    expect(
      Array.from(
        buildNodeBodyPickData({
          positions: new Float32Array(),
          indices: new Uint32Array(),
          primitive: "triangles" as const,
        }),
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
    expect(Array.from(buildNodeBodyPickData(partFor(geometry)))).toEqual([
      0, 8, 0, 5, 0, 0, 8, 0, 5, 0, 0, 8, 0, 5, 0,
    ]);
  });

  it("maps filtered sprite ids to their original body slots", () => {
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
    expect(Array.from(buildNodeBodyPickData(partFor(geometry), new Uint32Array([2, 4])))).toEqual([
      0, 8, 0, 5, 0, 0, 8, 0, 5, 0,
    ]);
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
    expect(buildNodeBodyOwnerData(partFor(geometry), new Uint32Array([1, 2, 3]))).toEqual({
      bodyRanges: new Uint32Array([0, 2, 2, 2, 4, 2]),
      bodyIds: new Uint32Array([8, 0, 9, 0, 8, 0, 9, 0, 8, 0, 9, 0]),
      elementIds: new Uint32Array([5, 0, 6, 0, 5, 0, 6, 0, 5, 0, 6, 0]),
    });
    expect(Array.from(buildNodeBodyPickData(partFor(geometry)))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
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

    expect(buildNodeBodyOwnerData(partFor(geometry), new Uint32Array([1, 2, 3, 4]))).toEqual({
      bodyRanges: new Uint32Array([0, 1, 1, 2, 3, 2, 5, 1]),
      bodyIds: new Uint32Array([8, 0, 8, 0, 9, 0, 8, 0, 9, 0, 9, 0]),
      elementIds: new Uint32Array([5, 0, 5, 0, 6, 0, 5, 0, 6, 0, 6, 0]),
    });
  });

  it("keeps unowned contributors for shared node visibility", () => {
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

    expect(buildNodeBodyOwnerData(partFor(geometry), new Uint32Array([1, 2, 3, 4]))).toEqual({
      bodyRanges: new Uint32Array([0, 2, 2, 2, 4, 1, 5, 1]),
      bodyIds: new Uint32Array([0, 0, 8, 0, 0, 0, 8, 0, 8, 0, 0, 0]),
      elementIds: new Uint32Array([6, 0, 5, 0, 6, 0, 5, 0, 5, 0, 6, 0]),
    });
    expect(Array.from(buildNodeBodyPickData(partFor(geometry)))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 0, 5, 0, 0, 0, 0, 6, 0,
    ]);
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
