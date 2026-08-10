import { describe, expect, it } from "vitest";
import {
  createBoltedPlatePreset,
  createDefaultPreset,
  createGalleryPreset,
  createHex20CylinderPreset,
  createModelPresets,
  createVtkPreset,
  visiblePartIdsForPreset,
} from "../../../demo/fixture/presets";

describe("createModelPresets", () => {
  it("offers the showcase, VTK sample, gallery, cylinder, and results workflow", () => {
    const presets = createModelPresets();
    expect(presets.map((preset) => preset.id)).toEqual([
      "bolted",
      "vtk",
      "gallery",
      "hex20-cylinder",
      "results",
    ]);
    expect(new Set(presets.map((preset) => preset.name)).size).toBe(5);
  });

  it("keeps the bolted plate as the default showcase", () => {
    expect(createDefaultPreset().id).toBe("bolted");
    expect(createModelPresets()[0]).toEqual(createDefaultPreset());
  });

  it("exposes element models for every part", () => {
    for (const preset of createModelPresets()) {
      for (const partId of preset.scene.parts.keys()) {
        expect(preset.elementModels.get(partId), `${preset.id} part ${partId}`).toBeDefined();
      }
    }
  });
});

describe("createGalleryPreset", () => {
  it("includes all seven supported shapes", () => {
    const preset = createGalleryPreset();
    expect(preset.partColors.size).toBe(7);
    expect(preset.overlayPartIds.length).toBe(3);
    const visible = visiblePartIdsForPreset(preset, "solid");
    expect(visible.size).toBe(7);
  });
});

describe("createVtkPreset", () => {
  it("imports the checked-in VTK sample mesh", () => {
    const preset = createVtkPreset();
    expect(preset.name).toBe("VTK sample block");
    expect(preset.scene.parts.size).toBe(3);
    expect(preset.bounds).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 2, maxZ: 1 });
  });
});

describe("createHex20CylinderPreset", () => {
  it("builds a small curved quadratic cylinder", () => {
    const preset = createHex20CylinderPreset();
    expect(preset.scene.parts.size).toBe(2);
    expect(preset.bounds.minZ).toBeCloseTo(-0.9);
    expect(preset.bounds.maxZ).toBeCloseTo(0.9);
  });
});

describe("createBoltedPlatePreset", () => {
  it("keeps the bolted assembly mode mapping", () => {
    const preset = createBoltedPlatePreset();
    expect(preset.modePartIds.get("solid")).toEqual([1, 4, 7, 10]);
    expect(preset.partNames.get(4)).toBe("Bolts");
  });
});

describe("results preset", () => {
  it("connects a tensor field and nodal deformation to one FE part", () => {
    const preset = createModelPresets().find((candidate) => candidate.id === "results");
    expect(preset?.results?.derive).toBe("vonMises");
    expect(preset?.results?.deformation?.field.location).toBe("nodal");
    expect(preset?.scene.parts.get(20)?.geometry.elements).toHaveLength(1);
  });
});
