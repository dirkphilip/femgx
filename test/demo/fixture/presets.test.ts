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
import { createPresetInteraction } from "../../../demo/workbench/preset";

describe("createModelPresets", () => {
  it("offers the five supported product stories in stable order", () => {
    const presets = createModelPresets();
    expect(presets.map((preset) => preset.id)).toEqual([
      "bolted",
      "vtk",
      "gallery",
      "hex20-cylinder",
      "results",
    ]);
    expect(presets.map((preset) => preset.name)).toEqual([
      "Bolted plate assembly",
      "Imported VTK sample",
      "Supported element gallery",
      "Hex20 cylinder",
      "Static results · stress + deformation",
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
  it("includes all supported shapes and a polygon-authored face", () => {
    const preset = createGalleryPreset();
    expect(preset.partColors.size).toBe(10);
    expect(preset.overlayPartIds.length).toBe(3);
    const visible = visiblePartIdsForPreset(preset, "solid");
    expect(visible.size).toBe(10);
  });
});

describe("createVtkPreset", () => {
  it("imports the checked-in VTK sample mesh", () => {
    const preset = createVtkPreset();
    expect(preset.name).toBe("Imported VTK sample");
    expect(preset.scene.parts.size).toBe(1);
    expect(preset.bounds).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 2, maxZ: 1 });
  });
});

describe("createHex20CylinderPreset", () => {
  it("builds a small linearly tessellated Hex20 cylinder", () => {
    const preset = createHex20CylinderPreset();
    expect(preset.scene.parts.size).toBe(1);
    expect(preset.overlayPartIds).toEqual([]);
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

describe("createPresetInteraction", () => {
  it("can seed the per-part edge override for a new scene", () => {
    const preset = createBoltedPlatePreset();
    const withoutEdges = createPresetInteraction(preset);
    const withEdges = createPresetInteraction(preset, true);

    for (const partId of preset.scene.parts.keys()) {
      expect(withoutEdges.partOverrides.get(partId)?.edge).toBeUndefined();
      expect(withEdges.partOverrides.get(partId)?.edge).toBe(true);
    }
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
