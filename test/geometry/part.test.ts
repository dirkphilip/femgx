import { describe, expect, it } from "vitest";
import {
  bodyIdForElement,
  boundsCorners,
  computeBounds,
  createPart,
  GeometryValidationError,
  faceForPrimitive,
  isFiniteBounds,
  MAX_PART_ID,
  validateBodies,
  validateElements,
  validatePickIds,
  type Geometry,
  type Part,
} from "../../src/geometry/part";
import { translation } from "../../src/math/mat4";

function part(id: number, positions: number[]): Part {
  const geometry = {
    positions: new Float32Array(positions),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
  };
  return createPart(id, geometry);
}

describe("computeBounds", () => {
  it("enumerates all corners in deterministic order", () => {
    expect(boundsCorners({ minX: -1, minY: -2, minZ: -3, maxX: 4, maxY: 5, maxZ: 6 })).toEqual([
      [-1, -2, -3],
      [-1, -2, 6],
      [-1, 5, -3],
      [-1, 5, 6],
      [4, -2, -3],
      [4, -2, 6],
      [4, 5, -3],
      [4, 5, 6],
    ]);
  });

  it("computes the bounding box of positions", () => {
    const b = computeBounds({
      positions: new Float32Array([-1, 0, 0, 3, 2, 5]),
      indices: new Uint32Array(),
      primitive: "triangles",
    });
    expect(b).toEqual({ minX: -1, minY: 0, minZ: 0, maxX: 3, maxY: 2, maxZ: 5 });
  });

  it("returns infinite bounds for empty geometry", () => {
    const b = computeBounds({
      positions: new Float32Array(),
      indices: new Uint32Array(),
      primitive: "triangles",
    });
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
    const p = part(1, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const t = translation(10, 0, 0);
    expect(t[12]).toBe(10);
    expect(p.bounds.minX).toBe(0);
  });

  it("derives finite bounds for an empty part", () => {
    const p = createPart(1, {
      positions: new Float32Array(),
      indices: new Uint32Array(),
      primitive: "triangles",
    });
    expect(p.bounds).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });
    expect(isFiniteBounds(p.bounds)).toBe(true);
  });

  it("validates primitive arrays before construction", () => {
    expect(() =>
      createPart(1, {
        positions: new Float32Array([0, 0, 0]),
        indices: new Uint32Array([0, 1, 2]),
        primitive: "triangles",
      }),
    ).toThrow(/outside positions/);
  });

  it("accepts the largest direct u32 part id", () => {
    expect(
      createPart(MAX_PART_ID, {
        positions: new Float32Array(),
        indices: new Uint32Array(),
        primitive: "triangles",
      }).id,
    ).toBe(MAX_PART_ID);
  });

  it("rejects part ids that cannot survive direct u32 storage", () => {
    for (const id of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      MAX_PART_ID + 1,
    ]) {
      expect(() =>
        createPart(id, {
          positions: new Float32Array(),
          indices: new Uint32Array(),
          primitive: "triangles",
        }),
      ).toThrow(/Part id .*finite integer/);
    }
  });

  it("retains caller arrays as owned geometry without copying", () => {
    const positions = new Float32Array([0, 0, 0]);
    const indices = new Uint32Array();
    const created = createPart(1, { positions, indices, primitive: "triangles" });
    expect(created.geometry.positions).toBe(positions);
    expect(created.geometry.indices).toBe(indices);
  });
});

function twoElementGeometry(): Geometry {
  return {
    positions: new Float32Array(18),
    indices: new Uint32Array(18),
    primitive: "triangles" as const,
    elements: [
      { id: 0, primitiveStart: 0, primitiveCount: 2 },
      { id: 1, primitiveStart: 2, primitiveCount: 4 },
    ],
  };
}

describe("validateElements", () => {
  it("validates geometry without element descriptors", () => {
    expect(() => {
      validateElements({ indices: new Uint32Array(3), primitive: "triangles" });
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
        elements: [{ id: 0, primitiveStart: 6, primitiveCount: 1 }],
      });
    }).toThrow(/outside the index buffer/);
  });

  it("rejects elements with no triangles", () => {
    expect(() => {
      validateElements({
        ...twoElementGeometry(),
        elements: [{ id: 0, primitiveStart: 0, primitiveCount: 0 }],
      });
    }).toThrow(/has no triangles/);
  });

  it("rejects duplicate element ids", () => {
    expect(() => {
      validateElements({
        ...twoElementGeometry(),
        elements: [
          { id: 1, primitiveStart: 0, primitiveCount: 1 },
          { id: 1, primitiveStart: 1, primitiveCount: 1 },
        ],
      });
    }).toThrow(/Duplicate element id 1/);
  });

  it("rejects an element id that would wrap its one-based pick id", () => {
    expect(() => {
      validateElements({
        indices: new Uint32Array(3),
        primitive: "triangles",
        elements: [{ id: MAX_PART_ID, primitiveStart: 0, primitiveCount: 1 }],
      });
    }).toThrow(/Element id .*finite integer/);
  });

  it("rejects triangles shared by more than one element", () => {
    expect(() => {
      validateElements({
        ...twoElementGeometry(),
        elements: [
          { id: 0, primitiveStart: 0, primitiveCount: 2 },
          { id: 1, primitiveStart: 1, primitiveCount: 1 },
        ],
      });
    }).toThrow(/belongs to more than one element/);
  });

  it("rejects triangles not covered by any element", () => {
    expect(() => {
      validateElements({
        ...twoElementGeometry(),
        elements: [{ id: 0, primitiveStart: 0, primitiveCount: 2 }],
      });
    }).toThrow(/not covered by any element/);
  });
});

describe("body metadata", () => {
  const geometry: Geometry = {
    positions: new Float32Array(9),
    indices: new Uint32Array(6),
    primitive: "triangles" as const,
    elements: [
      { id: 2, primitiveStart: 0, primitiveCount: 1, bodyId: 4 },
      { id: 8, primitiveStart: 1, primitiveCount: 1 },
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

  it("rejects a body id that would wrap its one-based pick id", () => {
    expect(() => {
      validateBodies({
        ...geometry,
        bodies: [{ id: 0xffff_ffff, elementIds: [2] }],
      });
    }).toThrow(/Body id .*finite integer/);
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

describe("pick metadata", () => {
  const face = {
    elementId: 4,
    faceIndex: 0,
    primitiveStart: 0,
    primitiveCount: 1,
    key: "0,1,2",
    nodeIds: [0, 1, 2],
    neighborElementIds: [],
  };

  it("accepts stable authored edge metadata with occurrence owners", () => {
    const created = createPart(1, {
      positions: new Float32Array(9),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles" as const,
      elements: [{ id: 4, primitiveStart: 0, primitiveCount: 1 }],
      faces: [face],
      edges: [
        {
          key: "0,1",
          nodeIds: [0, 1],
          incidentElementIds: [4],
          faceRefs: [{ elementId: 4, faceIndex: 0 }],
        },
      ],
    });
    expect(created.geometry.edges[0]?.key).toBe("0,1");
  });

  it("rejects authored edge identities that disagree with their node sequence", () => {
    expect(() =>
      createPart(1, {
        positions: new Float32Array(9),
        indices: new Uint32Array([0, 1, 2]),
        primitive: "triangles" as const,
        elements: [{ id: 4, primitiveStart: 0, primitiveCount: 1 }],
        faces: [face],
        edges: [
          {
            key: "0,2",
            nodeIds: [0, 1],
            incidentElementIds: [4],
            faceRefs: [{ elementId: 4, faceIndex: 0 }],
          },
        ],
      }),
    ).toThrow(GeometryValidationError);
  });

  it("rejects a face range without a declared element", () => {
    expect(() => {
      validatePickIds({
        positions: new Float32Array(9),
        indices: new Uint32Array(3),
        primitive: "triangles" as const,
        elements: [{ id: 1, primitiveStart: 0, primitiveCount: 1 }],
        faces: [face],
      });
    }).toThrow(/undeclared element 4/);
  });

  it("requires face owners and node references to resolve", () => {
    expect(() => {
      validatePickIds({
        positions: new Float32Array(9),
        indices: new Uint32Array(3),
        primitive: "triangles" as const,
        nodePositions: new Float32Array(9),
        elements: [{ id: 1, primitiveStart: 0, primitiveCount: 1 }],
        faces: [face],
      });
    }).toThrow(/undeclared element 4/);
    expect(() => {
      validatePickIds({
        positions: new Float32Array(9),
        indices: new Uint32Array(3),
        primitive: "triangles" as const,
        nodePositions: new Float32Array(6),
        faces: [{ ...face, nodeIds: [0, 1, 2] }],
      });
    }).toThrow(/outside nodePositions/);
  });

  it("rejects non-manifold face metadata", () => {
    expect(() => {
      validatePickIds({
        positions: new Float32Array(9),
        indices: new Uint32Array(3),
        primitive: "triangles" as const,
        faces: [{ ...face, neighborElementIds: [5, 6] }],
      });
    }).toThrow(/non-manifold faces are unsupported/);
  });

  it("resolves triangles by ranges rather than face-array order", () => {
    const geometry: Geometry = {
      positions: new Float32Array(18),
      indices: new Uint32Array(6),
      primitive: "triangles",
      elements: [{ id: 4, primitiveStart: 0, primitiveCount: 2 }],
      faces: [
        {
          elementId: 4,
          faceIndex: 1,
          primitiveStart: 1,
          primitiveCount: 1,
          key: "b",
          nodeIds: [],
          neighborElementIds: [],
        },
        {
          elementId: 4,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 1,
          key: "a",
          nodeIds: [],
          neighborElementIds: [],
        },
      ],
    };
    expect(() => {
      validatePickIds(geometry);
    }).not.toThrow();
    expect(faceForPrimitive(geometry, 0)?.faceIndex).toBe(0);
    expect(faceForPrimitive(geometry, 1)?.faceIndex).toBe(1);
  });

  it("rejects overlapping face ranges", () => {
    expect(() => {
      validatePickIds({
        positions: new Float32Array(18),
        indices: new Uint32Array(6),
        primitive: "triangles",
        faces: [
          {
            elementId: 4,
            faceIndex: 0,
            primitiveStart: 0,
            primitiveCount: 2,
            key: "a",
            nodeIds: [],
            neighborElementIds: [],
          },
          {
            elementId: 4,
            faceIndex: 1,
            primitiveStart: 1,
            primitiveCount: 1,
            key: "b",
            nodeIds: [],
            neighborElementIds: [],
          },
        ],
      });
    }).toThrow(/belongs to more than one face/);
  });
});
