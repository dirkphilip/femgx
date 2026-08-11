import { describe, expect, it } from "vitest";
import {
  bodyIdForElement,
  computeBounds,
  isFiniteBounds,
  validateBodies,
  validateElements,
  type Geometry,
  type Part,
} from "../../src/geometry/part";
import { translation } from "../../src/math/mat4";

function part(id: number, positions: number[]): Part {
  const geometry = { positions: new Float32Array(positions), indices: new Uint32Array([0, 1, 2]) };
  return { id, geometry, bounds: computeBounds(geometry) };
}

describe("computeBounds", () => {
  it("computes the bounding box of positions", () => {
    const b = computeBounds({
      positions: new Float32Array([-1, 0, 0, 3, 2, 5]),
      indices: new Uint32Array(),
    });
    expect(b).toEqual({ minX: -1, minY: 0, minZ: 0, maxX: 3, maxY: 2, maxZ: 5 });
  });

  it("returns infinite bounds for empty geometry", () => {
    const b = computeBounds({ positions: new Float32Array(), indices: new Uint32Array() });
    expect(b.minX).toBe(Infinity);
    expect(b.maxX).toBe(-Infinity);
    expect(isFiniteBounds(b)).toBe(false);
  });

  it("requires all six components to be finite", () => {
    expect(
      isFiniteBounds({
        minX: 0,
        minY: 0,
        minZ: 0,
        maxX: 1,
        maxY: Number.POSITIVE_INFINITY,
        maxZ: 1,
      }),
    ).toBe(false);
  });
});

describe("part", () => {
  it("keeps id, geometry, and computed bounds", () => {
    const p = part(1, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(p.id).toBe(1);
    expect(p.geometry.positions.length).toBe(9);
    expect(p.bounds.maxX).toBe(1);
  });

  it("combines a part with a transform", () => {
    const p = part(1, [0, 0, 0]);
    const t = translation(10, 0, 0);
    expect(t[12]).toBe(10);
    expect(p.bounds.minX).toBe(0);
  });
});

function twoElementGeometry(): Geometry {
  return {
    positions: new Float32Array(18),
    indices: new Uint32Array(18),
    elements: [
      { id: 0, triangleStart: 0, triangleCount: 2 },
      { id: 1, triangleStart: 2, triangleCount: 4 },
    ],
  };
}

describe("validateElements", () => {
  it("validates geometry without element descriptors", () => {
    expect(() => {
      validateElements({ indices: new Uint32Array(3) });
    }).not.toThrow();
  });

  it("accepts a full, disjoint, unique coverage of the triangles", () => {
    expect(() => {
      validateElements(twoElementGeometry());
    }).not.toThrow();
  });

  it("rejects an element outside the index buffer", () => {
    expect(() => {
      validateElements({
        ...twoElementGeometry(),
        elements: [{ id: 0, triangleStart: 6, triangleCount: 1 }],
      });
    }).toThrow(/outside the index buffer/);
  });

  it("rejects elements with no triangles", () => {
    expect(() => {
      validateElements({
        ...twoElementGeometry(),
        elements: [{ id: 0, triangleStart: 0, triangleCount: 0 }],
      });
    }).toThrow(/has no triangles/);
  });

  it("rejects duplicate element ids", () => {
    expect(() => {
      validateElements({
        ...twoElementGeometry(),
        elements: [
          { id: 1, triangleStart: 0, triangleCount: 1 },
          { id: 1, triangleStart: 1, triangleCount: 1 },
        ],
      });
    }).toThrow(/Duplicate element id 1/);
  });

  it("rejects triangles shared by more than one element", () => {
    expect(() => {
      validateElements({
        ...twoElementGeometry(),
        elements: [
          { id: 0, triangleStart: 0, triangleCount: 2 },
          { id: 1, triangleStart: 1, triangleCount: 1 },
        ],
      });
    }).toThrow(/belongs to more than one element/);
  });

  it("rejects triangles not covered by any element", () => {
    expect(() => {
      validateElements({
        ...twoElementGeometry(),
        elements: [{ id: 0, triangleStart: 0, triangleCount: 2 }],
      });
    }).toThrow(/not covered by any element/);
  });
});

describe("body metadata", () => {
  const geometry: Geometry = {
    positions: new Float32Array(9),
    indices: new Uint32Array(6),
    elements: [
      { id: 2, triangleStart: 0, triangleCount: 1, bodyId: 4 },
      { id: 8, triangleStart: 1, triangleCount: 1 },
    ],
    bodies: [{ id: 4, name: "housing", elementIds: [2] }],
  };

  it("validates and resolves stable body membership", () => {
    expect(() => {
      validateBodies(geometry);
    }).not.toThrow();
    expect(bodyIdForElement(geometry, 2)).toBe(4);
    expect(bodyIdForElement(geometry, 8)).toBeUndefined();
    expect(bodyIdForElement(geometry, 99)).toBeUndefined();
  });

  it("reports typed duplicate and unknown membership failures", () => {
    expect(() => {
      validateBodies({
        ...geometry,
        bodies: [
          { id: 4, elementIds: [2] },
          { id: 4, elementIds: [8] },
        ],
      });
    }).toThrow(expect.objectContaining({ code: "duplicate-body-id" }));
    expect(() => {
      validateBodies({ ...geometry, bodies: [{ id: 4, elementIds: [7] }] });
    }).toThrow(expect.objectContaining({ code: "unknown-body-element" }));
  });

  it("rejects duplicate memberships, mismatches, and non-deterministic order", () => {
    expect(() => {
      validateBodies({
        ...geometry,
        bodies: [
          { id: 4, elementIds: [2] },
          { id: 5, elementIds: [2] },
        ],
      });
    }).toThrow(/more than one body/);
    expect(() => {
      validateBodies({
        ...geometry,
        elements: (geometry.elements ?? []).map((element) =>
          element.id === 8 ? { ...element, bodyId: 4 } : element,
        ),
      });
    }).toThrow(/body membership does not match/);
    expect(() => {
      validateBodies({
        ...geometry,
        bodies: [
          { id: 9, elementIds: [] },
          { id: 4, elementIds: [] },
        ],
      });
    }).toThrow(/strictly ascending/);
  });
});
