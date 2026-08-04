import { describe, expect, it } from "vitest";
import { deformGeometry, deformPositions } from "../../src/results/deform";
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
});
