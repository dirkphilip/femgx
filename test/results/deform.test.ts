import { describe, expect, it } from "vitest";
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

describe("deformPositions", () => {
  it("displaces each vertex by scale times its displacement", () => {
    const field = displacements([1, 2, 3, 0, 0, 1]);
    const positions = new Float32Array([0, 0, 0, 10, 20, 30]);
    expect(Array.from(deformPositions(positions, field, 2))).toEqual([2, 4, 6, 10, 20, 32]);
  });

  it("applies the default scale of one", () => {
    const field = displacements([1, 0, 0]);
    expect(Array.from(deformPositions(new Float32Array([5, 5, 5]), field))).toEqual([6, 5, 5]);
  });

  it("keeps original positions where the displacement is missing", () => {
    const field = displacements([1, 1, 1, NaN, NaN, NaN]);
    const positions = new Float32Array([0, 0, 0, 9, 9, 9]);
    expect(Array.from(deformPositions(positions, field))).toEqual([1, 1, 1, 9, 9, 9]);
  });

  it("deforms only the vertices that have a matching node", () => {
    const field = displacements([1, 0, 0]);
    const positions = new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]);
    expect(Array.from(deformPositions(positions, field))).toEqual([1, 0, 0, 1, 1, 1, 2, 2, 2]);
  });

  it("does not mutate the input positions", () => {
    const field = displacements([1, 1, 1]);
    const positions = new Float32Array([0, 0, 0]);
    deformPositions(positions, field, 3);
    expect(Array.from(positions)).toEqual([0, 0, 0]);
  });

  it("handles a zero scale by returning the original positions", () => {
    const field = displacements([5, 5, 5]);
    expect(Array.from(deformPositions(new Float32Array([1, 2, 3]), field, 0))).toEqual([1, 2, 3]);
  });
});

describe("deformGeometry", () => {
  it("returns a new geometry with displaced positions and the same indices", () => {
    const field = displacements([1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0]);
    const geometry = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]),
      indices: new Uint32Array([0, 1, 2, 2, 3, 0]),
    };
    const deformed = deformGeometry(geometry, field, 0.5);
    expect(Array.from(deformed.positions)).toEqual([0.5, 0, 0, 2, 0, 0, 3.5, 0, 0, 5, 0, 0]);
    expect(deformed.indices).toBe(geometry.indices);
    expect(Array.from(geometry.positions)).toEqual([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]);
  });

  it("preserves element tessellations on the deformed geometry", () => {
    const field = displacements([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
    const geometry = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]),
      indices: new Uint32Array([0, 1, 2, 2, 3, 0]),
      elements: [
        { id: 1, triangleStart: 0, triangleCount: 1 },
        { id: 2, triangleStart: 1, triangleCount: 1 },
      ],
    };
    const deformed = deformGeometry(geometry, field, 1);
    expect(deformed.elements).toBe(geometry.elements);
  });
});

describe("nodalDisplacements", () => {
  it("packs one vec3 per vertex per load case, load-case major", () => {
    const positions = new Float32Array(3 * 2);
    const bending = displacements([1, 2, 3, 4, 5, 6]);
    const twist = displacements([7, 8, 9, 10, 11, 12]);
    const buffer = nodalDisplacements(positions, [bending, twist]);
    expect(Array.from(buffer)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("writes zero deltas for missing or out-of-range vertices", () => {
    const positions = new Float32Array(3 * 3);
    const field = displacements([1, 1, 1, NaN, NaN, NaN]);
    const buffer = nodalDisplacements(positions, [field]);
    expect(Array.from(buffer)).toEqual([1, 1, 1, 0, 0, 0, 0, 0, 0]);
  });

  it("handles an empty load-case list with a zero-length buffer", () => {
    const positions = new Float32Array(3 * 2);
    expect(nodalDisplacements(positions, []).byteLength).toBe(0);
  });
});
