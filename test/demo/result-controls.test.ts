import { describe, expect, it } from "vitest";
import { createResultsPreset } from "../../demo/fixture/results-preset";
import { createBoltedPlatePreset } from "../../demo/fixture/presets";
import { createExampleModel } from "../../demo/workbench/model";
import { setVectorField } from "../../demo/workbench/vector-actions";
import {
  BASE_RESULT_VALUE,
  DEFORMATION_OFF_VALUE,
  parseDeformationScale,
  parseVectorGlyph,
  parseVectorLengthScale,
  parseVectorTransform,
  resultVectorFieldsForModel,
  resultModeForDeformationSelection,
  resultModeForModel,
  resultModeForScalarSelection,
  vectorConfigForDisplay,
  vectorDisplayForField,
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

  it("installs canonical glyph and transform defaults atomically per vector role", () => {
    const model = createExampleModel(createResultsPreset());
    const current = {
      fieldId: "demo-normals",
      glyph: "arrow" as const,
      transform: "normal" as const,
      lengthScale: 2.5,
    };
    expect(vectorDisplayForField(model, "demo-fibers", current)).toEqual({
      fieldId: "demo-fibers",
      glyph: "axis",
      transform: "direction",
      lengthScale: 2.5,
    });
    expect(vectorDisplayForField(model, "demo-normals", current)).toEqual({
      ...current,
      fieldId: "demo-normals",
    });
  });

  it("applies field defaults in one transition while preserving the user length scale", () => {
    const model = createExampleModel(createResultsPreset());
    const owner = {
      model,
      vectorDisplay: {
        fieldId: "demo-normals",
        glyph: "arrow" as const,
        transform: "normal" as const,
        lengthScale: 3,
      },
      presentation: { reflectResults: () => undefined },
      applyResultMode: () => undefined,
    };
    setVectorField(owner, "demo-fibers");
    expect(owner.vectorDisplay).toEqual({
      fieldId: "demo-fibers",
      glyph: "axis",
      transform: "direction",
      lengthScale: 3,
    });
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

  it("keeps scalar, deformation, and base-mode transitions mutually explicit", () => {
    const resultsModel = createExampleModel(createResultsPreset());
    const plainModel = createExampleModel(createBoltedPlatePreset());
    const config = resultsModel.results;

    expect(resultModeForModel(resultsModel)).toBe("deformed");
    expect(resultModeForModel(plainModel)).toBe("base");
    expect(resultModeForScalarSelection(BASE_RESULT_VALUE, config, DEFORMATION_OFF_VALUE)).toBe(
      "base",
    );
    expect(resultModeForScalarSelection("demo-stress", config, DEFORMATION_OFF_VALUE)).toBe(
      "colored",
    );
    expect(resultModeForScalarSelection("demo-stress", config, "demo-displacement")).toBe(
      "deformed",
    );
    expect(resultModeForScalarSelection("missing", config, DEFORMATION_OFF_VALUE)).toBeUndefined();
    expect(resultModeForScalarSelection("demo-stress", undefined, DEFORMATION_OFF_VALUE)).toBe(
      undefined,
    );
    expect(resultModeForDeformationSelection(DEFORMATION_OFF_VALUE, config, "colored")).toBe(
      "colored",
    );
    expect(resultModeForDeformationSelection("demo-displacement", config, "colored")).toBe(
      "deformed",
    );
    expect(resultModeForDeformationSelection("demo-displacement", config, "base")).toBeUndefined();
    expect(resultModeForDeformationSelection("missing", config, "colored")).toBeUndefined();
    expect(resultModeForDeformationSelection(DEFORMATION_OFF_VALUE, undefined, "colored")).toBe(
      undefined,
    );
  });

  it("bounds numeric inputs and rejects unknown vector fields", () => {
    const model = createExampleModel(createResultsPreset());
    expect(parseDeformationScale("0")).toBe(0);
    expect(parseDeformationScale("-1")).toBeUndefined();
    expect(parseDeformationScale("not-a-number")).toBeUndefined();
    expect(
      vectorConfigForDisplay(model, {
        fieldId: "missing",
        glyph: "arrow",
        transform: "direction",
        lengthScale: 1,
      }),
    ).toBeUndefined();
    expect(vectorDisplayForModel(createExampleModel(createBoltedPlatePreset()))).toEqual({
      fieldId: VECTOR_OFF_VALUE,
      glyph: "arrow",
      transform: "direction",
      lengthScale: 1,
    });
  });
});
