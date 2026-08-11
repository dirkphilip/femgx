import { describe, expect, it } from "vitest";
import { add, average, cross, dot, length, normalize, scale, subtract } from "../../src/math/vec3";

describe("vec3", () => {
  it("provides pure foundational operations", () => {
    const a = [1, 2, 3] as const;
    const b = [4, 5, 6] as const;

    expect(add(a, b)).toEqual([5, 7, 9]);
    expect(subtract(b, a)).toEqual([3, 3, 3]);
    expect(scale(a, 2)).toEqual([2, 4, 6]);
    expect(cross(a, b)).toEqual([-3, 6, -3]);
    expect(dot(a, b)).toBe(32);
    expect(length(a)).toBeCloseTo(Math.sqrt(14));
    expect(average([a, b])).toEqual([2.5, 3.5, 4.5]);
  });

  it("preserves explicit fallback behavior for degenerate normalization", () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 1]);
    expect(normalize([0, 0, 0], [1, 0, 0])).toEqual([1, 0, 0]);
    expect(normalize([1e-10, 0, 0], [0, 1, 0], 1e-8)).toEqual([0, 1, 0]);
  });
});
