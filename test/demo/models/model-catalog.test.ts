import { describe, expect, it } from "vitest";
import { benchmarkCaseSpecs } from "../../../demo/benchmark/model";
import { createBoltedPlatePreset } from "../../../demo/fixtures/presets";
import { createExampleModel, createLazyBenchmarkModel } from "../../../demo/workbench/models/model";
import {
  PERFORMANCE_MODEL_RETENTION_CAP_BYTES,
  WorkbenchModelCatalog,
} from "../../../demo/workbench/models/model-catalog";

describe("workbench model catalog", () => {
  it("keeps ordinary and Performance Lab entries separate and lazy", () => {
    const ordinary = createExampleModel(createBoltedPlatePreset());
    const performance = createLazyBenchmarkModel(
      benchmarkCaseSpecs(false).find((spec) => spec.id === "bodies-256") ??
        (() => {
          throw new Error("benchmark case missing");
        })(),
    );
    const catalog = new WorkbenchModelCatalog([ordinary], [performance]);

    expect(catalog.models).toEqual([ordinary]);
    expect(catalog.selectedId).toBe(ordinary.id);
    expect(performance.scene.parts.size).toBe(0);

    expect(catalog.setMode("performance")).toBe("");
    expect(catalog.models).toEqual([performance]);
    expect(catalog.select(performance.id)).toBe(true);
    catalog.rememberModel(performance);
    expect(catalog.selectedId).toBe(performance.id);

    expect(catalog.setMode("ordinary")).toBe(ordinary.id);
    expect(catalog.setMode("performance")).toBe(performance.id);
  });

  it("retains an opened local model only in the ordinary catalog", () => {
    const ordinary = createExampleModel(createBoltedPlatePreset());
    const opened = {
      ...ordinary,
      id: "opened-model",
      name: "opened.glb",
      source: "file" as const,
    };
    const catalog = new WorkbenchModelCatalog([ordinary], []);

    catalog.rememberModel(opened);
    expect(catalog.models.map((model) => model.id)).toEqual([ordinary.id, opened.id]);
    expect(catalog.setMode("performance")).toBe("");
    expect(catalog.models).toEqual([]);
    expect(catalog.setMode("ordinary")).toBe(opened.id);
    expect(catalog.models.map((model) => model.id)).toEqual([ordinary.id, opened.id]);
  });

  it("reuses one under-budget Performance Lab model without replacing placeholders", () => {
    const ordinary = createExampleModel(createBoltedPlatePreset());
    const placeholder = createLazyBenchmarkModel(
      benchmarkCaseSpecs(false).find((spec) => spec.id === "unique-250k") ??
        (() => {
          throw new Error("benchmark case missing");
        })(),
    );
    const loaded = {
      ...ordinary,
      id: placeholder.id,
      name: placeholder.name,
      estimatedCpuBytes: PERFORMANCE_MODEL_RETENTION_CAP_BYTES,
    };
    const catalog = new WorkbenchModelCatalog([ordinary], [placeholder]);

    catalog.setMode("performance");
    expect(catalog.select(placeholder.id)).toBe(true);
    const activated = catalog.rememberModel(loaded);
    expect(activated.performanceRetentionReason).toBe("rebuild");
    expect(catalog.models[0]).toBe(placeholder);

    catalog.setMode("ordinary");
    expect(catalog.setMode("performance")).toBe(placeholder.id);
    expect(catalog.resolveModel(placeholder.id)?.performanceRetentionReason).toBe("reused");
    expect(catalog.models[0]).toBe(placeholder);

    catalog.clearRetainedModel();
    expect(catalog.resolveModel(placeholder.id)).toBe(placeholder);
  });

  it("evicts the previous case when selecting another and never retains an over-budget case", () => {
    const ordinary = createExampleModel(createBoltedPlatePreset());
    const specs = benchmarkCaseSpecs(false);
    const first = createLazyBenchmarkModel(
      specs.find((spec) => spec.id === "unique-250k") ??
        (() => {
          throw new Error("benchmark case missing");
        })(),
    );
    const second = createLazyBenchmarkModel(
      specs.find((spec) => spec.id === "unique-1m") ??
        (() => {
          throw new Error("benchmark case missing");
        })(),
    );
    const catalog = new WorkbenchModelCatalog([ordinary], [first, second]);
    const loadedFirst = { ...ordinary, id: first.id, name: first.name, estimatedCpuBytes: 1 };
    const loadedSecond = {
      ...ordinary,
      id: second.id,
      name: second.name,
      estimatedCpuBytes: PERFORMANCE_MODEL_RETENTION_CAP_BYTES + 1,
    };

    catalog.setMode("performance");
    catalog.select(first.id);
    catalog.rememberModel(loadedFirst);
    expect(catalog.resolveModel(first.id)).toBeDefined();
    catalog.select(second.id);
    expect(catalog.resolveModel(first.id)).toBe(first);

    const evicted = catalog.rememberModel(loadedSecond);
    expect(evicted.performanceRetentionReason).toBe("evicted-over-budget");
    expect(catalog.resolveModel(second.id)).toBe(second);
    expect(catalog.selectedId).toBe(second.id);
    expect(catalog.setMode("ordinary")).toBe(ordinary.id);
    expect(catalog.setMode("performance")).toBe(second.id);
    expect(catalog.resolveModel(second.id)).toBe(second);
  });

  it("appends an unseen Performance Lab entry without replacing placeholders", () => {
    const ordinary = createExampleModel(createBoltedPlatePreset());
    const first = createLazyBenchmarkModel(
      benchmarkCaseSpecs(false).find((spec) => spec.id === "unique-250k") ??
        (() => {
          throw new Error("benchmark case missing");
        })(),
    );
    const extra = createLazyBenchmarkModel(
      benchmarkCaseSpecs(false).find((spec) => spec.id === "unique-1m") ??
        (() => {
          throw new Error("benchmark case missing");
        })(),
    );
    const catalog = new WorkbenchModelCatalog([ordinary], [first]);
    catalog.ensurePerformanceModel(first);
    catalog.ensurePerformanceModel(extra);
    catalog.setMode("performance");
    expect(catalog.models.map((model) => model.id)).toEqual([first.id, extra.id]);
  });
});
