import { expect, it, describe } from "vitest";
import {
  buildBodyPrimitivePickIds,
  buildElementPrimitiveOrdinals,
  buildElementPrimitivePickIds,
  buildFacePrimitivePickIds,
  buildPrimitiveFaceBodyPickData,
  type SemanticTestGeometry,
} from "./support";

describe("buildElementPrimitivePickIds", () => {
  it("maps each triangle to its element pick id (element id + 1)", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array(9),
      primitive: "triangles" as const,
      elements: [
        {
          id: 0,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 2 }],
        },
        {
          id: 3,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 2, primitiveCount: 1 }],
        },
      ],
    };
    expect(Array.from(buildElementPrimitivePickIds(geometry, geometry.elements))).toEqual([
      1, 1, 4,
    ]);
  });

  it("produces all-zero ids when the geometry has no elements", () => {
    expect(
      Array.from(
        buildElementPrimitivePickIds({
          positions: new Float32Array(9),
          indices: new Uint32Array(3),
          primitive: "triangles" as const,
        }),
      ),
    ).toEqual([0]);
  });

  it("maps authored line segments and point sprites to their element ids", () => {
    expect(
      Array.from(
        buildElementPrimitivePickIds(
          {
            positions: new Float32Array(6),
            indices: new Uint32Array([0, 1]),
            primitive: "lines",
          },
          [
            {
              id: 4,
              primitiveRanges: [{ primitive: "lines", primitiveStart: 0, primitiveCount: 1 }],
            },
          ],
        ),
      ),
    ).toEqual([5]);
    expect(
      Array.from(
        buildElementPrimitivePickIds(
          {
            positions: new Float32Array(6),
            indices: new Uint32Array([0]),
            primitive: "points",
          },
          [
            {
              id: 8,
              primitiveRanges: [{ primitive: "points", primitiveStart: 0, primitiveCount: 1 }],
            },
          ],
        ),
      ),
    ).toEqual([9]);
  });
});

describe("buildElementPrimitiveOrdinals", () => {
  it("maps each primitive to its stable part-wide element ordinal", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array(9),
      primitive: "triangles" as const,
      elements: [
        {
          id: 40,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 2 }],
        },
        {
          id: 2,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 2, primitiveCount: 1 }],
        },
      ],
    };
    expect(
      Array.from(
        buildElementPrimitiveOrdinals(
          geometry,
          geometry.elements ?? [],
          new Map([
            [40, 4],
            [2, 2],
          ]),
        ),
      ),
    ).toEqual([4, 4, 2]);
  });
});

describe("buildBodyPrimitivePickIds", () => {
  it("maps triangles to their reusable body pick ids", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array(6),
      primitive: "triangles" as const,
      elements: [
        {
          id: 4,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 2 }],
          bodyId: 7,
        },
      ],
      bodies: [{ id: 7, elementIds: [4] }],
    };
    expect(Array.from(buildBodyPrimitivePickIds(geometry, geometry.elements))).toEqual([8, 8]);
  });
});

describe("buildFacePrimitivePickIds", () => {
  it("derives dense ids from exact face ranges", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array(9),
      primitive: "triangles" as const,
      faces: [
        {
          elementId: 0,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 1,
          key: "a",
          nodeIds: [],
        },
        {
          elementId: 0,
          faceIndex: 1,
          primitiveStart: 2,
          primitiveCount: 1,
          key: "b",
          nodeIds: [],
        },
      ],
    };
    expect(Array.from(buildFacePrimitivePickIds(geometry))).toEqual([1, 0, 2]);
  });

  it("produces all-zero ids when the geometry has no faces", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array(3),
      primitive: "triangles" as const,
    };
    expect(Array.from(buildFacePrimitivePickIds(geometry))).toEqual([0]);
  });
});

describe("buildPrimitiveFaceBodyPickData", () => {
  it("packs face and body ids into the shared triangle buffer", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array(6),
      primitive: "triangles" as const,
      elements: [
        {
          id: 4,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 2 }],
          bodyId: 7,
        },
      ],
      bodies: [{ id: 7, elementIds: [4] }],
      faces: [
        {
          elementId: 4,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 2,
          key: "a",
          nodeIds: [],
        },
      ],
    };
    expect(Array.from(buildPrimitiveFaceBodyPickData(geometry, geometry.elements))).toEqual([
      1, 8, 0, 5, 0, 1, 8, 0, 5, 0,
    ]);
  });
});
