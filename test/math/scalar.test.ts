import { describe, expect, it } from "vitest";
import { finiteOrZero, nextPowerOfTwo } from "../../src/math/scalar";

describe("scalar helpers", () => {
  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "maps %s to zero",
    (value) => {
      expect(finiteOrZero(value)).toBe(0);
    },
  );

  it.each([0, -3.25, Number.MIN_VALUE, 42.5])("preserves finite value %s", (value) => {
    expect(finiteOrZero(value)).toBe(value);
  });

  it.each([
    [1, 1],
    [2, 2],
    [4, 4],
    [8, 8],
    [3, 4],
    [5, 8],
    [9, 16],
  ])("returns the next power of two for %s", (value, expected) => {
    expect(nextPowerOfTwo(value)).toBe(expected);
  });
});
