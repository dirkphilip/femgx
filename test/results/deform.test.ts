import { describe, expect, it } from "vitest";
import { createPart } from "../../src/geometry/part";
import { deformGeometry, deformPositions, nodalDisplacements } from "../../src/results/deform";
import { createResultField } from "../../src/results/fields";
import type { VectorField } from "../../src/results/fields";

function displacements(values: number[]): VectorField<"nodal"> {
  return createResultField({
    id: "u",
    name: "Displacement",
    location: "nodal",
    shape: "vector",
    count: values.length / 3,
    unit: "mm",
    values: new Float32Array(values),
  });
}

/** Identity per-vertex node map for node-aligned positions. */
function nodeAligned(count: number): Uint32Array {
  return Uint32Array.from({ length: count }, (_, vertex) => vertex + 1);
}

describe("deformPositions", () => {
  it("displaces each vertex by scale times its node's displacement", () => {
    const field = displacements([1, 2, 3, 0, 0, 1]);
    const positions = new Float32Array([0, 0, 0, 10, 20, 30]);
    expect(Array.from(deformPositions(positions, nodeAligned(2), field, 2))).toEqual([
      2, 4, 6, 10, 20, 32,
    ]);
  });

  it("applies the default scale of one", () => {
    const field = displacements([1, 0, 0]);
    expect(Array.from(deformPositions(new Float32Array([5, 5, 5]), nodeAligned(1), field))).toEqual(
      [6, 5, 5],
    );
  });

  it("keeps original positions where the displacement is missing", () => {
    const field = displacements([1, 1, 1, NaN, NaN, NaN]);
    const positions = new Float32Array([0, 0, 0, 9, 9, 9]);
    expect(Array.from(deformPositions(positions, nodeAligned(2), field))).toEqual([
      1, 1, 1, 9, 9, 9,
    ]);
  });

  it("keeps interpolated vertices and vertices without a matching node in place", () => {
    const field = displacements([1, 0, 0]);
    const positions = new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]);
    const nodePickIds = new Uint32Array([1, 0, 3]);
    expect(Array.from(deformPositions(positions, nodePickIds, field))).toEqual([
      1, 0, 0, 1, 1, 1, 2, 2, 2,
    ]);
  });

  it("deforms duplicated tessellation vertices by the node they share", () => {
    const field = displacements([1, 0, 0, 0, 0, 0, 0, 0, 0]);
    const positions = new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2, 0, 0, 0]);
    const nodePickIds = new Uint32Array([1, 2, 3, 1]);
    expect(Array.from(deformPositions(positions, nodePickIds, field))).toEqual([
      1, 0, 0, 1, 1, 1, 2, 2, 2, 1, 0, 0,
    ]);
  });

  it("does not mutate the input positions", () => {
    const field = displacements([1, 1, 1]);
    const positions = new Float32Array([0, 0, 0]);
    deformPositions(positions, nodeAligned(1), field, 3);
    expect(Array.from(positions)).toEqual([0, 0, 0]);
  });

  it("handles a zero scale by returning the original positions", () => {
    const field = displacements([5, 5, 5]);
    expect(
      Array.from(deformPositions(new Float32Array([1, 2, 3]), nodeAligned(1), field, 0)),
    ).toEqual([1, 2, 3]);
  });
});

describe("deformGeometry", () => {
  it("returns a new geometry with displaced positions and the same indices", () => {
    const field = displacements([1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0]);
    const geometry = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]),
      indices: new Uint32Array([0, 1, 2, 2, 3, 0]),
      primitive: "triangles" as const,
      nodePickIds: nodeAligned(4),
    };
    const deformed = deformGeometry(geometry, field, 0.5);
    expect(Array.from(deformed.positions)).toEqual([0.5, 0, 0, 2, 0, 0, 3.5, 0, 0, 5, 0, 0]);
    expect(deformed.indices).toBe(geometry.indices);
    expect(Array.from(geometry.positions)).toEqual([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]);
  });

  it("keeps part-level element tessellations beside the deformed geometry", () => {
    const field = displacements([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
    const geometry = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]),
      indices: new Uint32Array([0, 1, 2, 2, 3, 0]),
      primitive: "triangles" as const,
      nodePickIds: nodeAligned(4),
    };
    const part = createPart(1, {
      geometries: [geometry],
      elements: [
        {
          id: 1,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
        },
        {
          id: 2,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
        },
      ],
    });
    const sourceGeometry = part.geometries[0];
    if (sourceGeometry === undefined) throw new Error("deformation part geometry is missing");
    const deformed = deformGeometry(sourceGeometry, field, 1);
    expect(part.elements).toHaveLength(2);
    expect(deformed.indices).toBe(geometry.indices);
  });

  it("rejects geometry without a per-vertex node map", () => {
    const field = displacements([1, 0, 0]);
    const geometry = {
      positions: new Float32Array([0, 0, 0]),
      indices: new Uint32Array([0]),
      primitive: "triangles" as const,
    };
    expect(() => deformGeometry(geometry, field)).toThrow(/nodePickIds/);
  });
});

describe("nodalDisplacements", () => {
  it("packs one vec3 per node from the authored field", () => {
    const field = displacements([1, 2, 3, 4, 5, 6]);
    const buffer = nodalDisplacements(2, field);
    expect(Array.from(buffer)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("writes zero deltas for missing or out-of-range nodes", () => {
    const field = displacements([1, 1, 1, NaN, NaN, NaN]);
    const buffer = nodalDisplacements(3, field);
    expect(Array.from(buffer)).toEqual([1, 1, 1, 0, 0, 0, 0, 0, 0]);
  });

  it("handles an absent field with a zero-filled buffer", () => {
    expect(Array.from(nodalDisplacements(2, undefined))).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
