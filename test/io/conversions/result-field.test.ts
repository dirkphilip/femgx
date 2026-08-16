import { describe, expect, it } from "vitest";
import { TRIANGLE_SHAPE } from "../../../src/elements/shapes";
import { createModelBuilder } from "../../../src/io/model-builder";
import { createResultFieldFromModelResult } from "../../../src/io/conversions/result-field";
import { IoError } from "../../../src/io/diagnostics";
import type { FemModel, ModelResultField } from "../../../src/io/fem-model";

function model(): FemModel {
  const builder = createModelBuilder();
  builder.appendNodes([10, 20, 30], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  builder.openElementShapeBlock(TRIANGLE_SHAPE);
  builder.appendElements([100, 300], [10, 20, 30, 10, 30, 20]);
  return builder.build();
}

function result(
  location: "node" | "element",
  components: number,
  ids: readonly number[],
  values: readonly number[],
): ModelResultField {
  return {
    name: "imported",
    location,
    components,
    ids: new Uint32Array(ids),
    values: new Float64Array(values),
  };
}

describe("createResultFieldFromModelResult", () => {
  it("maps sparse node ids to model rows and preserves missing scalar values", () => {
    const field = createResultFieldFromModelResult(model(), result("node", 1, [30, 10], [3, 1]), {
      id: "temperature",
      unit: "K",
      shape: "scalar",
    });

    expect(field.location).toBe("nodal");
    expect(field.count).toBe(3);
    expect([...field.values.slice(0, 1)]).toEqual([1]);
    expect(Number.isNaN(field.values[1])).toBe(true);
    expect([...field.values.slice(2)]).toEqual([3]);
  });

  it("maps sparse element ids without changing pick identity", () => {
    const field = createResultFieldFromModelResult(model(), result("element", 1, [300], [8]), {
      id: "stress",
      unit: "MPa",
      shape: "scalar",
    });

    expect(field.location).toBe("elemental");
    expect(field.count).toBe(301);
    expect(Number.isNaN(field.values[100])).toBe(true);
    expect(field.values[300]).toBe(8);
  });

  it("converts only explicitly requested three-component nodal vectors", () => {
    const field = createResultFieldFromModelResult(
      model(),
      result("node", 3, [20, 10], [2, 3, 4, 1, 2, 3]),
      { id: "displacement", unit: "mm", shape: "vector" },
    );

    expect(field.location).toBe("nodal");
    expect(field.shape).toBe("vector");
    expect([...field.values.slice(0, 3)]).toEqual([1, 2, 3]);
    expect([...field.values.slice(3, 6)]).toEqual([2, 3, 4]);
    expect([...field.values.slice(6)]).toEqual([NaN, NaN, NaN]);
  });

  it.each([
    ["duplicate-result-identity", result("node", 1, [10, 10], [1, 2]), { shape: "scalar" }],
    ["unknown-result-identity", result("node", 1, [99], [1]), { shape: "scalar" }],
    ["unsupported-result-shape", result("element", 3, [100], [1, 2, 3]), { shape: "vector" }],
  ] as const)("rejects %s at the conversion boundary", (code, input, options) => {
    try {
      const conversion = {
        id: "invalid",
        unit: "u",
        ...options,
      };
      if (conversion.shape === "scalar") {
        createResultFieldFromModelResult(model(), input, conversion);
      } else {
        createResultFieldFromModelResult(model(), input, conversion);
      }
      throw new Error("expected conversion to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(IoError);
      expect((error as IoError).issues[0]?.code).toBe(code);
    }
  });
});
