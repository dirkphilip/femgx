import { describe, expect, it } from "vitest";
import {
  magnitude,
  magnitudeField,
  magnitudes,
  maxPrincipalField,
  principalValues,
  principals,
  tensorMagnitude,
  vonMises,
  vonMisesField,
  vonMisesValues,
} from "../../src/results/derived";
import { createResultField } from "../../src/results/fields";
import type { Tensor6 } from "../../src/results/fields";

describe("point-wise derived quantities", () => {
  it("computes vector magnitude", () => {
    expect(magnitude(3, 4, 0)).toBe(5);
    expect(magnitude(0, 0, 0)).toBe(0);
  });

  it("computes the Frobenius norm of a tensor", () => {
    expect(tensorMagnitude([1, 0, 0, 0, 0, 0])).toBe(1);
    expect(tensorMagnitude([0, 0, 0, 1, 0, 0])).toBeCloseTo(Math.SQRT2);
  });

  it("computes von Mises stress for pure tension and pure shear", () => {
    expect(vonMises([100, 0, 0, 0, 0, 0])).toBeCloseTo(100);
    expect(vonMises([0, 0, 0, 50, 0, 0])).toBeCloseTo(50 * Math.sqrt(3));
  });

  it("propagates NaN through point-wise quantities", () => {
    expect(magnitude(NaN, 0, 0)).toBeNaN();
    expect(tensorMagnitude([NaN, 0, 0, 0, 0, 0])).toBeNaN();
    expect(vonMises([NaN, 0, 0, 0, 0, 0])).toBeNaN();
    expect(principalValues([NaN, 0, 0, 0, 0, 0])).toEqual([NaN, NaN, NaN]);
  });
});

describe("principalValues", () => {
  it("returns the eigenvalues of a diagonal tensor sorted descending", () => {
    expect(principalValues([1, 2, 3, 0, 0, 0])).toEqual([3, 2, 1]);
    expect(principalValues([-1, -2, -3, 0, 0, 0])).toEqual([-1, -2, -3]);
  });

  it("returns a single value for a hydrostatic tensor", () => {
    const values = principalValues([5, 5, 5, 0, 0, 0]);
    expect(values[0]).toBeCloseTo(5);
    expect(values[1]).toBeCloseTo(5);
    expect(values[2]).toBeCloseTo(5);
  });

  it("solves a mixed tensor with a repeated eigenvalue", () => {
    const values = principalValues([3, 3, 4, 1, 0, 0]);
    expect(values[0]).toBeCloseTo(4);
    expect(values[1]).toBeCloseTo(4);
    expect(values[2]).toBeCloseTo(2);
  });

  it("is exact for a diagonal tensor within floating point tolerance", () => {
    const values = principalValues([7, 11, 13, 0, 0, 0]);
    expect(values[0]).toBeCloseTo(13);
    expect(values[1]).toBeCloseTo(11);
    expect(values[2]).toBeCloseTo(7);
  });
});

describe("field-level derived values", () => {
  const vectorField = createResultField({
    id: "disp",
    name: "Displacement",
    location: "nodal",
    shape: "vector",
    count: 3,
    unit: "mm",
    values: new Float32Array([3, 4, 0, NaN, 1, 1, 0, 0, 0]),
  });
  const tensorField = createResultField({
    id: "stress",
    name: "Stress",
    location: "elemental",
    shape: "tensor",
    count: 2,
    unit: "MPa",
    values: new Float32Array([100, 0, 0, 0, 0, 0, 30, 30, 30, 10, 0, 0]),
  });

  it("computes per-entity magnitudes with NaN for missing entities", () => {
    const values = magnitudes(vectorField);
    expect(values[0]).toBeCloseTo(5);
    expect(values[1]).toBeNaN();
    expect(values[2]).toBe(0);
  });

  it("computes per-entity tensor magnitudes", () => {
    const values = magnitudes(tensorField);
    expect(values[0]).toBeCloseTo(100);
    const expected = Math.sqrt(30 * 30 * 3 + 2 * 10 * 10);
    expect(values[1]).toBeCloseTo(expected);
  });

  it("computes per-entity von Mises values", () => {
    const values = vonMisesValues(tensorField);
    expect(values[0]).toBeCloseTo(100);
    const [xx, yy, zz, xy] = [30, 30, 30, 10];
    const expected = Math.sqrt(
      0.5 * ((xx - yy) ** 2 + (yy - zz) ** 2 + (zz - xx) ** 2) + 3 * xy * xy,
    );
    expect(values[1]).toBeCloseTo(expected);
  });

  it("computes per-entity principal value triples", () => {
    const values = principals(tensorField);
    expect(values[0]).toBeCloseTo(100);
    expect(values[1]).toBeCloseTo(0);
    expect(values[2]).toBeCloseTo(0);
    expect(values[3]).toBeCloseTo(40);
    expect(values[4]).toBeCloseTo(30);
    expect(values[5]).toBeCloseTo(20);
  });

  it("derives scalar fields that keep the source location and unit", () => {
    const magnitudeScalar = magnitudeField("m", "Magnitude", vectorField);
    expect(magnitudeScalar.shape).toBe("scalar");
    expect(magnitudeScalar.location).toBe("nodal");
    expect(magnitudeScalar.unit).toBe("mm");
    expect(magnitudeScalar.count).toBe(3);
    expect(magnitudeScalar.values[0]).toBeCloseTo(5);

    const misesScalar = vonMisesField("vm", "von Mises", tensorField);
    expect(misesScalar.shape).toBe("scalar");
    expect(misesScalar.location).toBe("elemental");
    expect(misesScalar.unit).toBe("MPa");
    expect(misesScalar.values[0]).toBeCloseTo(100);

    const maxPrincipal = maxPrincipalField("p1", "Max principal", tensorField);
    expect(maxPrincipal.values[0]).toBeCloseTo(100);
    expect(maxPrincipal.values[1]).toBeCloseTo(40);
  });
});

describe("tensor typing", () => {
  it("accepts a six-component tuple literal", () => {
    const stress: Tensor6 = [1, 2, 3, 4, 5, 6];
    expect(tensorMagnitude(stress)).toBeCloseTo(Math.sqrt(1 + 4 + 9 + 2 * (16 + 25 + 36)));
  });
});
