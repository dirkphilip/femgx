import { describe, expect, it } from "vitest";
import { identity, multiply, rotationZ, scale, transformPoint, translation } from "../src/mat4";

describe("mat4", () => {
  it("returns the identity matrix", () => {
    const m = identity();
    expect(Array.from(m)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it("creates a translation matrix", () => {
    const m = translation(1, 2, 3);
    expect(m[12]).toBe(1);
    expect(m[13]).toBe(2);
    expect(m[14]).toBe(3);
  });

  it("multiplying by identity is a no-op", () => {
    const t = translation(4, 5, 6);
    const m = multiply(t, identity());
    expect(Array.from(m)).toEqual(Array.from(t));
  });

  it("composes translations", () => {
    const a = translation(1, 0, 0);
    const b = translation(0, 2, 0);
    const m = multiply(a, b);
    expect(m[12]).toBe(1);
    expect(m[13]).toBe(2);
  });

  it("multiplies general column-major transforms", () => {
    const m = multiply(translation(10, 0, 0), rotationZ(Math.PI / 2));
    const point = transformPoint(m, 1, 0, 0);
    expect(point[0]).toBeCloseTo(10);
    expect(point[1]).toBeCloseTo(1);
  });

  it("creates scale matrices", () => {
    expect(transformPoint(scale(2, 3, 4), 1, 1, 1)).toEqual([2, 3, 4]);
  });
});
