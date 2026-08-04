import { describe, expect, it } from "vitest";
import { finiteRange, scalarRange } from "../../src/results/range";
import { createResultField } from "../../src/results/fields";

describe("finiteRange", () => {
  it("returns the min and max of finite values", () => {
    expect(finiteRange(new Float32Array([3, 1, 2, 4]))).toEqual({ min: 1, max: 4 });
  });

  it("skips NaN and infinite values", () => {
    expect(finiteRange([NaN, -Infinity, 5, Infinity, -2, NaN])).toEqual({ min: -2, max: 5 });
  });

  it("returns undefined when every value is missing", () => {
    expect(finiteRange(new Float32Array([NaN, NaN]))).toBeUndefined();
    expect(finiteRange(new Float32Array([]))).toBeUndefined();
  });

  it("handles a single finite value", () => {
    expect(finiteRange([7])).toEqual({ min: 7, max: 7 });
  });
});

describe("scalarRange", () => {
  it("computes the observed range of a scalar field ignoring missing data", () => {
    const field = createResultField({
      id: "s",
      name: "S",
      location: "nodal",
      shape: "scalar",
      count: 4,
      unit: "MPa",
      values: new Float32Array([NaN, 10, 40, 20]),
    });
    expect(scalarRange(field)).toEqual({ min: 10, max: 40 });
  });

  it("returns undefined for an all-missing field", () => {
    const field = createResultField({
      id: "s",
      name: "S",
      location: "nodal",
      shape: "scalar",
      count: 2,
      unit: "MPa",
      values: new Float32Array([NaN, NaN]),
    });
    expect(scalarRange(field)).toBeUndefined();
  });
});
