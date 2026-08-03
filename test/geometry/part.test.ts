import { describe, expect, it } from "vitest";
import { computeBounds, type Part } from "../../src/geometry/part";
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
