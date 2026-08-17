import { describe, expect, it } from "vitest";
import {
  createElementFrameField,
  createNodalLoadField,
  frameAt,
  createResultField,
  scalarAt,
  vectorAt,
  type AnyResultField,
  type FieldLocation,
  type FieldShape,
  type ResultField,
} from "../../src/results/fields";

describe("createResultField", () => {
  it("creates a part-owned six-component nodal load", () => {
    const field = createNodalLoadField({
      partId: 7,
      id: "loads",
      name: "Nodal loads",
      count: 2,
      forceUnit: "N",
      momentUnit: "N·m",
      values: new Float32Array([1, 0, 0, NaN, NaN, NaN, NaN, NaN, NaN, 0, 0, 2]),
    });
    expect(field.partId).toBe(7);
    expect(field.shape).toBe("load");
    expect(field.values).toHaveLength(12);
  });

  it("rejects mixed finite and missing load triplets", () => {
    expect(() =>
      createNodalLoadField({
        partId: 7,
        id: "loads",
        name: "Nodal loads",
        count: 1,
        forceUnit: "N",
        momentUnit: "N·m",
        values: new Float32Array([1, NaN, 0, NaN, NaN, NaN]),
      }),
    ).toThrow("mixed finite/missing");
  });
  it("creates a nodal scalar field", () => {
    const field = createResultField({
      id: "disp-z",
      name: "Displacement Z",
      location: "nodal",
      shape: "scalar",
      count: 3,
      unit: "mm",
      values: new Float32Array([1, 2, NaN]),
    });
    expect(field.id).toBe("disp-z");
    expect(field.name).toBe("Displacement Z");
    expect(field.location).toBe("nodal");
    expect(field.shape).toBe("scalar");
    expect(field.count).toBe(3);
    expect(field.unit).toBe("mm");
    expect(field.values).toEqual(new Float32Array([1, 2, NaN]));
  });

  it("creates an elemental vector field", () => {
    const field = createResultField({
      id: "stress",
      name: "Stress",
      location: "elemental",
      shape: "vector",
      count: 2,
      unit: "MPa",
      values: new Float32Array([1, 2, 3, 4, 5, 6]),
    });
    expect(field.location).toBe("elemental");
    expect(field.shape).toBe("vector");
    expect(field.values.length).toBe(6);
  });

  it("preserves the reference to the value array for large models", () => {
    const values = new Float32Array(1024);
    const field = createResultField({
      id: "large",
      name: "Large",
      location: "nodal",
      shape: "scalar",
      count: 1024,
      unit: "mm",
      values,
    });
    expect(field.values).toBe(values);
  });

  it("rejects an empty id", () => {
    expect(() =>
      createResultField({
        id: "",
        name: "x",
        location: "nodal",
        shape: "scalar",
        count: 1,
        unit: "mm",
        values: new Float32Array([0]),
      }),
    ).toThrow("id must not be empty");
  });

  it("rejects an empty name", () => {
    expect(() =>
      createResultField({
        id: "f",
        name: "",
        location: "nodal",
        shape: "scalar",
        count: 1,
        unit: "mm",
        values: new Float32Array([0]),
      }),
    ).toThrow("name must not be empty");
  });

  it("rejects an empty unit", () => {
    expect(() =>
      createResultField({
        id: "f",
        name: "x",
        location: "nodal",
        shape: "scalar",
        count: 1,
        unit: "",
        values: new Float32Array([0]),
      }),
    ).toThrow("unit must not be empty");
  });

  it("rejects an unknown location", () => {
    expect(() =>
      createResultField({
        id: "f",
        name: "x",
        location: "surface" as FieldLocation,
        shape: "scalar",
        count: 1,
        unit: "mm",
        values: new Float32Array([0]),
      }),
    ).toThrow("Unknown result field location");
  });

  it("rejects an unknown shape", () => {
    expect(() =>
      createResultField({
        id: "f",
        name: "x",
        location: "nodal",
        shape: "matrix" as FieldShape,
        count: 1,
        unit: "mm",
        values: new Float32Array([0]),
      }),
    ).toThrow("Unknown result field shape");
  });

  it("rejects a non-integer or negative count", () => {
    const options = {
      id: "f",
      name: "x",
      location: "nodal",
      shape: "scalar",
      count: 2,
      unit: "mm",
      values: new Float32Array([0, 1]),
    } as const;
    expect(() =>
      createResultField({ ...options, count: 1.5, values: new Float32Array([0, 1]) }),
    ).toThrow("count must be a non-negative integer");
    expect(() =>
      createResultField({ ...options, count: -1, values: new Float32Array([0, 1]) }),
    ).toThrow("count must be a non-negative integer");
  });

  it("rejects a value length that does not match the shape", () => {
    expect(() =>
      createResultField({
        id: "f",
        name: "x",
        location: "nodal",
        shape: "vector",
        count: 2,
        unit: "mm",
        values: new Float32Array([0, 1]),
      }),
    ).toThrow(/expects 6 values but got 2/);
    expect(() =>
      createResultField({
        id: "f",
        name: "x",
        location: "nodal",
        shape: "scalar",
        count: 1,
        unit: "mm",
        values: new Float32Array([0, 1]),
      }),
    ).toThrow(/expects 1 values but got 2/);
  });
});

describe("createElementFrameField", () => {
  it("stores dense part-local XYZ rows and reads one frame", () => {
    const values = new Float32Array([
      1,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      ...new Array<number>(9).fill(Number.NaN),
    ]);
    const field = createElementFrameField({
      partId: 4,
      id: "frames",
      name: "Element frames",
      count: 2,
      unit: "unitless",
      values,
    });
    expect(field.shape).toBe("frame");
    expect(frameAt(field, 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(frameAt(field, 1).every(Number.isNaN)).toBe(true);
  });

  it("rejects a finite row with a zero axis", () => {
    expect(() =>
      createElementFrameField({
        partId: 1,
        id: "frames",
        name: "Element frames",
        count: 1,
        unit: "unitless",
        values: new Float32Array(9),
      }),
    ).toThrow(/zero axis/);
  });
});

describe("entity accessors", () => {
  const scalar = createResultField({
    id: "s",
    name: "S",
    location: "nodal",
    shape: "scalar",
    count: 3,
    unit: "mm",
    values: new Float32Array([1, NaN, 3]),
  });
  const vector = createResultField({
    id: "v",
    name: "V",
    location: "nodal",
    shape: "vector",
    count: 2,
    unit: "mm",
    values: new Float32Array([1, 2, 3, 4, 5, 6]),
  });

  it("reads a scalar value, returning NaN for missing data", () => {
    expect(scalarAt(scalar, 0)).toBe(1);
    expect(scalarAt(scalar, 1)).toBeNaN();
  });

  it("reads a vector triple", () => {
    expect(vectorAt(vector, 1)).toEqual([4, 5, 6]);
  });

  it("throws for an out-of-range entity", () => {
    expect(() => scalarAt(scalar, 3)).toThrow(/out of range/);
    expect(() => scalarAt(scalar, -1)).toThrow(/out of range/);
    expect(() => vectorAt(vector, 2)).toThrow(/out of range/);
  });

  it("exposes a field typed as AnyResultField", () => {
    const anyField: AnyResultField = scalar;
    expect(anyField.shape).toBe("scalar");
    const generic: ResultField<FieldShape, FieldLocation> = scalar;
    expect(generic.count).toBe(3);
  });
});
