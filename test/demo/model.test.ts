import { describe, expect, it } from "vitest";
import { createGalleryPreset, createBoltedPlatePreset } from "../../demo/fixture/presets";
import {
  createExampleModel,
  createImportedModel,
  displayFileName,
  errorMessage,
  importFeedback,
  partStyleOverride,
} from "../../demo/workbench/models/model";

describe("demo workbench model boundary", () => {
  it("sanitizes browser file names and keeps a safe fallback", () => {
    expect(displayFileName(" /tmp\\model\n.glb ")).toBe("tmpmodel.glb");
    expect(displayFileName("/\\\u0000\u007f")).toBe("opened.model");
  });

  it("formats importer feedback with bounded warning counts", () => {
    const preset = createBoltedPlatePreset();
    const base = {
      scene: preset.scene,
      elementModels: preset.elementModels,
      partNames: preset.partNames,
      partStyles: new Map(),
      bounds: preset.bounds,
      results: preset.results,
      issues: [],
    } as const;
    expect(importFeedback("model.vtk", base)).toBe("Opened model.vtk.");
    expect(
      importFeedback("model.vtk", {
        ...base,
        issues: [{ code: "ignored", severity: "warning", message: "Ignored field" }],
      }),
    ).toContain("with 1 warning: Ignored field");
    expect(
      importFeedback("model.vtk", {
        ...base,
        issues: [
          { code: "one", severity: "warning", message: "First" },
          { code: "two", severity: "warning", message: "Second" },
        ],
      }),
    ).toContain("with 2 warnings: First");
  });

  it("keeps imported identity and applies topology-aware display overrides", () => {
    const preset = createBoltedPlatePreset();
    const imported = createImportedModel("opened.vtk", {
      scene: preset.scene,
      elementModels: preset.elementModels,
      partNames: preset.partNames,
      partStyles: new Map(),
      bounds: preset.bounds,
      results: preset.results,
      issues: [],
    });
    expect(imported).toMatchObject({ id: "opened-model", name: "opened.vtk", source: "file" });

    const gallery = createExampleModel(createGalleryPreset());
    const pointPart = [...gallery.scene.parts.values()].find(
      (part) => part.geometries[0]?.primitive === "points",
    );
    const surfacePart = [...gallery.scene.parts.values()].find(
      (part) => part.geometries[0]?.primitive !== "points",
    );
    if (pointPart === undefined || surfacePart === undefined) throw new Error("gallery incomplete");
    expect(partStyleOverride(gallery, pointPart.id, true, true)).not.toHaveProperty("nodes");
    expect(partStyleOverride(gallery, surfacePart.id, true, true)).toMatchObject({
      edge: true,
      nodes: true,
    });
    expect(partStyleOverride(gallery, surfacePart.id, false, false)).not.toHaveProperty("edge");
  });

  it("preserves actionable error text for Error and non-Error failures", () => {
    expect(errorMessage(new Error("bad model"))).toBe("bad model");
    expect(errorMessage("bad model")).toBe("bad model");
  });
});
