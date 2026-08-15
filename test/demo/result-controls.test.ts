import { describe, expect, it, vi } from "vitest";
import { createResultsPreset } from "../../demo/fixture/results-preset";
import { createBoltedPlatePreset } from "../../demo/fixture/presets";
import { createExampleModel } from "../../demo/workbench/models/model";
import { setResultField } from "../../demo/workbench/results/result-actions";
import { createResultPlaybackActions } from "../../demo/workbench/results/result-playback";
import { setVectorField, setVectorWidthPixels } from "../../demo/workbench/results/vector-actions";
import {
  BASE_RESULT_VALUE,
  DEFORMATION_OFF_VALUE,
  parseDeformationScale,
  parseVectorGlyph,
  parseVectorLengthScale,
  parseVectorWidthPixels,
  parseVectorTransform,
  resultVectorFieldsForModel,
  resultModeForDeformationSelection,
  resultModeForModel,
  resultModeForScalarSelection,
  resultScalarFieldsForModel,
  vectorConfigForDisplay,
  vectorDisplayForField,
  vectorDisplayForModel,
  VECTOR_OFF_VALUE,
} from "../../demo/workbench/results/result-controls";

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
      widthPixels: 2,
    });
  });

  it("builds a selected vector role or clears it without changing scalar mode", () => {
    const model = createExampleModel(createResultsPreset());
    const display = {
      fieldId: "demo-fibers",
      glyph: "axis" as const,
      transform: "direction" as const,
      lengthScale: 2,
      widthPixels: 2,
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
      widthPixels: 2,
    };
    expect(vectorDisplayForField(model, "demo-fibers", current)).toEqual({
      fieldId: "demo-fibers",
      glyph: "axis",
      transform: "direction",
      lengthScale: 2.5,
      widthPixels: 2,
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
        widthPixels: 1.5,
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
      widthPixels: 1.5,
    });
  });

  it("accepts only positive scales and renderer-owned presentation values", () => {
    expect(parseVectorLengthScale("0")).toBeUndefined();
    expect(parseVectorLengthScale("-1")).toBeUndefined();
    expect(parseVectorLengthScale("1.5")).toBe(1.5);
    expect(parseVectorWidthPixels("1")).toBe(1);
    expect(parseVectorWidthPixels("1.5")).toBe(1.5);
    expect(parseVectorWidthPixels("8")).toBe(8);
    expect(parseVectorWidthPixels("0")).toBeUndefined();
    expect(parseVectorWidthPixels("8.1")).toBeUndefined();
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
        widthPixels: 2,
      }),
    ).toBeUndefined();
    expect(vectorDisplayForModel(createExampleModel(createBoltedPlatePreset()))).toEqual({
      fieldId: VECTOR_OFF_VALUE,
      glyph: "arrow",
      transform: "direction",
      lengthScale: 1,
      widthPixels: 2,
    });
  });

  it("changes only width while preserving the selected vector presentation", () => {
    const model = createExampleModel(createResultsPreset());
    const applied: boolean[] = [];
    const owner = {
      model,
      vectorDisplay: {
        fieldId: "demo-normals",
        glyph: "arrow" as const,
        transform: "normal" as const,
        lengthScale: 1.5,
        widthPixels: 2,
      },
      presentation: { reflectResults: () => undefined },
      applyResultMode: (render: boolean) => applied.push(render),
    };
    setVectorWidthPixels(owner, "1");
    expect(owner.vectorDisplay).toEqual({ ...owner.vectorDisplay, widthPixels: 1 });
    expect(applied).toEqual([true]);
    setVectorWidthPixels(owner, "9");
    expect(owner.vectorDisplay.widthPixels).toBe(1);
    expect(applied).toEqual([true]);
  });

  it("advertises nodal and elemental scalars and switches the active field", () => {
    const model = createExampleModel(createResultsPreset());
    expect(resultScalarFieldsForModel(model).map((field) => [field.id, field.location])).toEqual([
      ["demo-stress", "elemental"],
      ["demo-temperature", "nodal"],
    ]);
    const applied: boolean[] = [];
    const owner = {
      model,
      resultMode: "deformed" as const,
      scalarFieldId: "demo-stress",
      deformationScale: 1,
      presentation: { reflectResults: () => undefined },
      applyResultMode: (render: boolean) => applied.push(render),
    };
    setResultField(owner, "demo-temperature");
    expect(owner.scalarFieldId).toBe("demo-temperature");
    expect(owner.resultMode).toBe("deformed");
    expect(applied).toEqual([true]);
    setResultField(owner, BASE_RESULT_VALUE);
    expect(owner.scalarFieldId).toBe(BASE_RESULT_VALUE);
    expect(owner.resultMode).toBe("base");
    expect(applied).toEqual([true, true]);
  });

  it("steps exact authored snapshots through one stable range", () => {
    const model = createExampleModel(createResultsPreset());
    const applied: boolean[] = [];
    const published: number[] = [];
    const owner = {
      model,
      resultMode: "base" as const,
      resultPlaybackIndex: 0,
      resultPlaybackRate: 1,
      resultPlaybackPlaying: false,
      resultPlaybackActive: false,
      resultPlaybackTimer: undefined,
      disposed: false,
      applyResultMode: (render: boolean) => applied.push(render),
      publishSnapshot: () => published.push(owner.resultPlaybackIndex),
    };
    const actions = createResultPlaybackActions(owner);

    actions.resetForModel(model);
    expect(actions.snapshot()).toMatchObject({
      active: true,
      index: 0,
      count: 4,
      time: 0,
      range: { min: 10, max: 100 },
    });
    actions.setIndex("2");
    expect(actions.snapshot()).toMatchObject({ active: true, index: 2, time: 2 });
    expect(owner.resultMode).toBe("deformed");
    expect(actions.currentStep()?.snapshot.scalar.id).toBe("demo-stress-snapshot-2");
    expect(applied).toEqual([true]);
    actions.setIndex("99");
    expect(actions.snapshot()?.index).toBe(2);
    actions.disable();
    expect(actions.currentStep()).toBeUndefined();
    expect(actions.snapshot()?.active).toBe(false);
    expect(published).toEqual([]);
  });

  it("pauses and resets playback without leaving a stale timer", () => {
    vi.useFakeTimers();
    try {
      const model = createExampleModel(createResultsPreset());
      const applied: boolean[] = [];
      const owner = {
        model,
        resultMode: "base" as const,
        resultPlaybackIndex: 0,
        resultPlaybackRate: 1,
        resultPlaybackPlaying: false,
        resultPlaybackActive: false,
        resultPlaybackTimer: undefined,
        disposed: false,
        applyResultMode: (render: boolean) => applied.push(render),
        publishSnapshot: () => undefined,
      };
      const actions = createResultPlaybackActions(owner);

      actions.togglePlaying();
      expect(actions.snapshot()).toMatchObject({ playing: true, index: 0 });
      vi.advanceTimersByTime(1000);
      expect(actions.snapshot()).toMatchObject({ playing: true, index: 1 });
      actions.stop();
      const appliedWhilePaused = applied.length;
      vi.advanceTimersByTime(3000);
      expect(actions.snapshot()).toMatchObject({ playing: false, index: 1 });
      expect(applied).toHaveLength(appliedWhilePaused);

      actions.setIndex("2");
      actions.togglePlaying();
      actions.resetForModel(model);
      expect(actions.snapshot()).toMatchObject({ playing: false, index: 0, active: true });
      vi.advanceTimersByTime(3000);
      expect(actions.snapshot()).toMatchObject({ playing: false, index: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
});
