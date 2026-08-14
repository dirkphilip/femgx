import { describe, expect, it } from "vitest";
import { createResultsPreset } from "../../demo/fixture/results-preset";
import { createExampleModel } from "../../demo/workbench/model";
import {
  parseVectorGlyph,
  parseVectorLengthScale,
  parseVectorTransform,
  resultVectorFieldsForModel,
  vectorConfigForDisplay,
  vectorDisplayForModel,
  VECTOR_OFF_VALUE,
} from "../../demo/workbench/result-controls";

describe("demo orientation result controls", () => {
  it("starts from the authored field and preserves both available choices", () => {
    const model = createExampleModel(createResultsPreset());
    expect(resultVectorFieldsForModel(model).map((field) => field.id)).toEqual([
      "demo-normals",
      "demo-fibers",
    ]);
    expect(vectorDisplayForModel(model)).toMatchObject({
      fieldId: "demo-normals",
      glyph: "arrow",
      transform: "normal",
      lengthScale: 1,
    });
  });

  it("builds a selected vector role or clears it without changing scalar mode", () => {
    const model = createExampleModel(createResultsPreset());
    const display = {
      fieldId: "demo-fibers",
      glyph: "axis" as const,
      transform: "direction" as const,
      lengthScale: 2,
    };
    expect(vectorConfigForDisplay(model, display)).toMatchObject({
      field: { id: "demo-fibers" },
      glyph: "axis",
      transform: "direction",
      lengthScale: 2,
    });
    expect(
      vectorConfigForDisplay(model, { ...display, fieldId: VECTOR_OFF_VALUE }),
    ).toBeUndefined();
  });

  it("accepts only positive scales and renderer-owned presentation values", () => {
    expect(parseVectorLengthScale("0")).toBeUndefined();
    expect(parseVectorLengthScale("-1")).toBeUndefined();
    expect(parseVectorLengthScale("1.5")).toBe(1.5);
    expect(parseVectorGlyph("arrow")).toBe("arrow");
    expect(parseVectorGlyph("axis")).toBe("axis");
    expect(parseVectorGlyph("cone")).toBeUndefined();
    expect(parseVectorTransform("direction")).toBe("direction");
    expect(parseVectorTransform("normal")).toBe("normal");
    expect(parseVectorTransform("world")).toBeUndefined();
  });
});
