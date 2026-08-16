import { describe, expect, it } from "vitest";
import { benchmarkCaseSpecs } from "../../../demo/benchmark/model";
import { createBoltedPlatePreset } from "../../../demo/fixtures/presets";
import { createExampleModel, createLazyBenchmarkModel } from "../../../demo/workbench/models/model";
import { WorkbenchModelCatalog } from "../../../demo/workbench/models/model-catalog";

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
    expect(catalog.setMode("performance")).toBe("");
  });

  it("retains an opened local model only in the ordinary catalog", () => {
    const ordinary = createExampleModel(createBoltedPlatePreset());
    const opened = {
      ...ordinary,
      id: "opened-model",
      name: "opened.vtk",
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
});
