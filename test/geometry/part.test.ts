import { describe, expect, it } from "vitest";
import {
  boundsCorners,
  computeBounds,
  createPart,
  isFiniteBounds,
  MAX_PART_ID,
  type ElementTessellation,
  type Geometry,
  validateBodies,
  validateElements,
  validatePickIds,
} from "../../src/geometry/part";
import { faceSubsetPrimitiveMask } from "../../src/geometry/face-validation";

function triangle(): Extract<Geometry, { primitive: "triangles" }> {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles",
  };
}

function line(): Geometry {
  return {
    positions: new Float32Array([0, 0, 0, 0, 0, 1]),
    indices: new Uint32Array([0, 1]),
    primitive: "lines",
  };
}

function point(): Geometry {
  return {
    positions: new Float32Array([0, 0, 1]),
    indices: new Uint32Array([0]),
    primitive: "points",
  };
}

function range(
  id: number,
  primitive: "triangles" | "lines" | "points",
  primitiveStart = 0,
  primitiveCount = 1,
): ElementTessellation {
  return { id, primitiveRanges: [{ primitive, primitiveStart, primitiveCount }] };
}

describe("part geometry", () => {
  it("reuses one face-subset primitive mask for validated consumers", () => {
    const geometry: Extract<Geometry, { primitive: "triangles" }> = {
      ...triangle(),
      faces: [
        {
          elementId: 1,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 1,
          key: "0/1/2",
          nodeIds: [0, 1, 2],
          neighborElementIds: [],
        },
      ],
      faceSubset: { faceIds: [{ elementId: 1, faceIndex: 0 }] },
    };
    const part = createPart(1, { geometries: [geometry] });
    const mask = faceSubsetPrimitiveMask(geometry);

    expect(mask).toBeDefined();
    expect(faceSubsetPrimitiveMask(part.geometries[0] as typeof geometry)).toBe(mask);
    expect(mask).toEqual(new Uint8Array([1]));
  });

  it("rejects duplicate face-subset identities during part validation", () => {
    const geometry: Extract<Geometry, { primitive: "triangles" }> = {
      ...triangle(),
      faces: [
        {
          elementId: 1,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 1,
          key: "0/1/2",
          nodeIds: [0, 1, 2],
          neighborElementIds: [],
        },
      ],
      faceSubset: {
        faceIds: [
          { elementId: 1, faceIndex: 0 },
          { elementId: 1, faceIndex: 0 },
        ],
      },
    };

    expect(() => createPart(1, { geometries: [geometry] })).toThrow(
      "faceSubset repeats element 1 face 0",
    );
  });

  it("requires and retains a non-empty plural geometry collection", () => {
    const geometry = triangle();
    const part = createPart(1, { geometries: [geometry] });
    expect(part.geometries).toEqual([geometry]);
    expect(part.geometries).not.toHaveProperty("geometry");
    expect(part.bounds.maxX).toBe(1);
  });

  it("supports every primitive in one mixed part and keeps non-first semantics", () => {
    const geometries = [triangle(), line(), point()];
    const elements: ElementTessellation[] = [
      {
        id: 7,
        primitiveRanges: [
          { primitive: "triangles", primitiveStart: 0, primitiveCount: 1 },
          { primitive: "lines", primitiveStart: 0, primitiveCount: 1 },
          { primitive: "points", primitiveStart: 0, primitiveCount: 1 },
        ],
        bodyId: 2,
        blockId: 3,
      },
    ];
    const part = createPart(1, {
      geometries,
      elements,
      nodePositions: new Float32Array(9),
      bodies: [{ id: 2, elementIds: [7] }],
      blocks: [{ id: 3, elementIds: [7] }],
    });
    expect(part.elements).toEqual(elements);
    expect(part.bodies?.[0]?.elementIds).toEqual([7]);
    expect(part.blocks?.[0]?.elementIds).toEqual([7]);
  });

  it("does not make semantic ownership depend on geometry order", () => {
    const elements: ElementTessellation[] = [
      {
        id: 7,
        primitiveRanges: [
          { primitive: "triangles", primitiveStart: 0, primitiveCount: 1 },
          { primitive: "lines", primitiveStart: 0, primitiveCount: 1 },
          { primitive: "points", primitiveStart: 0, primitiveCount: 1 },
        ],
        bodyId: 2,
      },
    ];
    const input = {
      elements,
      nodePositions: new Float32Array(9),
      bodies: [{ id: 2, elementIds: [7] }],
    } as const;
    const first = createPart(1, { ...input, geometries: [triangle(), line(), point()] });
    const reordered = createPart(1, { ...input, geometries: [point(), triangle(), line()] });
    expect(reordered.elements).toEqual(first.elements);
    expect(reordered.bodies).toEqual(first.bodies);
    expect(reordered.bounds).toEqual(first.bounds);
  });

  it("rejects empty collections, duplicate primitive groups, and conflicting element ids", () => {
    expect(() => createPart(1, { geometries: [] })).toThrow(/at least one geometry/);
    expect(() => createPart(1, { geometries: [triangle(), triangle()] })).toThrow(
      /duplicate triangles/,
    );
    expect(() =>
      createPart(1, {
        geometries: [triangle(), line()],
        elements: [range(7, "triangles"), range(7, "lines")],
      }),
    ).toThrow(/Duplicate element id 7/);
  });

  it("rejects incomplete, missing-group, and overlapping semantic ranges", () => {
    expect(() =>
      createPart(1, {
        geometries: [triangle(), line()],
        elements: [range(7, "triangles")],
      }),
    ).toThrow(/Line segments 0 is not covered/);
    expect(() =>
      createPart(1, {
        geometries: [triangle()],
        elements: [range(7, "lines")],
      }),
    ).toThrow(/references missing lines geometry group/);
    expect(() =>
      createPart(1, {
        geometries: [triangle()],
        elements: [range(7, "triangles"), range(8, "triangles")],
      }),
    ).toThrow(/triangles 0 belongs to more than one element/);
    expect(() =>
      createPart(1, {
        geometries: [triangle()],
        elements: [{ id: 7, primitiveRanges: [] }],
      }),
    ).toThrow(/at least one primitive range/);
  });

  it("retains typed arrays and computes finite bounds", () => {
    const geometry = triangle();
    const part = createPart(1, { geometries: [geometry] });
    expect(part.geometries[0]?.positions).toBe(geometry.positions);
    expect(part.geometries[0]?.indices).toBe(geometry.indices);
    expect(computeBounds(geometry)).toEqual({
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 1,
      maxY: 1,
      maxZ: 0,
    });
    expect(boundsCorners(computeBounds(geometry))).toHaveLength(8);
    expect(isFiniteBounds(part.bounds)).toBe(true);
    expect(createPart(MAX_PART_ID, { geometries: [geometry] }).id).toBe(MAX_PART_ID);
    expect(() => createPart(MAX_PART_ID + 1, { geometries: [geometry] })).toThrow(
      /Part id .*finite integer/,
    );
  });
});

describe("part validators", () => {
  it("validates ranges against the owning primitive group", () => {
    const geometry = triangle();
    const elements = [range(1, "triangles")];
    expect(() => {
      validateElements(geometry, elements);
    }).not.toThrow();
    expect(() => {
      validatePickIds(geometry, elements, new Float32Array(9));
    }).not.toThrow();
    expect(() => {
      validateBodies({ elements, bodies: [{ id: 2, elementIds: [1] }] });
    }).toThrow(/body membership does not match/);
  });
});
