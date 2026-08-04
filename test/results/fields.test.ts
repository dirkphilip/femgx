import { describe, expect, it } from "vitest";
import {
  createResultField,
  scalarAt,
  tensorAt,
  vectorAt,
  type AnyResultField,
  type FieldLocation,
  type FieldShape,
  type ResultField,
} from "../../src/results/fields";

describe("createResultField", () => {
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

  it("creates an elemental tensor field", () => {
    const field = createResultField({
      id: "stress",
      name: "Stress",
      location: "elemental",
      shape: "tensor",
      count: 2,
      unit: "MPa",
      values: new Float32Array([1, 2, 3, 4, 5, 6, 0, 0, 0, 0, 0, 0]),
    });
    expect(field.location).toBe("elemental");
    expect(field.shape).toBe("tensor");
    expect(field.values.length).toBe(12);
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
  const tensor = createResultField({
    id: "t",
    name: "T",
    location: "elemental",
    shape: "tensor",
    count: 1,
    unit: "MPa",
    values: new Float32Array([10, 20, 30, 40, 50, 60]),
  });

  it("reads a scalar value, returning NaN for missing data", () => {
    expect(scalarAt(scalar, 0)).toBe(1);
    expect(scalarAt(scalar, 1)).toBeNaN();
  });

  it("reads a vector triple", () => {
    expect(vectorAt(vector, 1)).toEqual([4, 5, 6]);
  });

  it("reads a tensor in Voigt order", () => {
    expect(tensorAt(tensor, 0)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("throws for an out-of-range entity", () => {
    expect(() => scalarAt(scalar, 3)).toThrow(/out of range/);
    expect(() => scalarAt(scalar, -1)).toThrow(/out of range/);
    expect(() => vectorAt(vector, 2)).toThrow(/out of range/);
    expect(() => tensorAt(tensor, 1)).toThrow(/out of range/);
  });

  it("exposes a field typed as AnyResultField", () => {
    const anyField: AnyResultField = scalar;
    expect(anyField.shape).toBe("scalar");
    const generic: ResultField<FieldShape, FieldLocation> = anyField;
    expect(generic.count).toBe(3);
  });
});
