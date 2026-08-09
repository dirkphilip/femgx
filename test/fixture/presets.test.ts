import { describe, expect, it } from "vitest";
import {
  createBoltedPlatePreset,
  createDefaultPreset,
  createFramePreset,
  createGalleryPreset,
  createModelPresets,
  createPanelPreset,
  visiblePartIdsForPreset,
} from "../../src/fixture/presets";

describe("createModelPresets", () => {
  it("offers at least four deterministic models with the bolted showcase first", () => {
    const presets = createModelPresets();
    expect(presets.map((preset) => preset.id)).toEqual(["bolted", "gallery", "panel", "frame"]);
    expect(new Set(presets.map((preset) => preset.name)).size).toBe(4);
  });

  it("exposes the bolted plate assembly as the default showcase", () => {
    expect(createDefaultPreset().id).toBe("bolted");
    expect(createModelPresets()[0]).toEqual(createDefaultPreset());
  });

  it("exposes element models for every part of every preset", () => {
    for (const preset of createModelPresets()) {
      for (const partId of preset.scene.parts.keys()) {
        expect(preset.elementModels.get(partId), `${preset.id} part ${partId}`).toBeDefined();
      }
    }
  });

  it("resolves the default mode part set plus overlays", () => {
    const gallery = createGalleryPreset();
    expect(gallery.defaultMode).toBe("solid");
    const solid = gallery.modePartIds.get("solid") ?? [];
    const visible = visiblePartIdsForPreset(gallery, "solid");
    expect(visible.size).toBe(solid.length + gallery.overlayPartIds.length);
    for (const partId of [...solid, ...gallery.overlayPartIds]) {
      expect(visible.has(partId)).toBe(true);
    }
  });
});

describe("createGalleryPreset", () => {
  it("keeps the gallery bounds and theme", () => {
    const preset = createGalleryPreset();
    expect(preset.bounds).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 8, maxY: 2, maxZ: 2 });
    expect(preset.partColors.size).toBe(8);
    expect(preset.overlayPartIds.length).toBe(2);
  });
});

describe("createPanelPreset", () => {
  it("keeps the panel footprint and shows all parts in every mode", () => {
    const preset = createPanelPreset();
    expect(preset.bounds.maxX).toBe(4);
    expect(preset.bounds.maxY).toBe(3);
    for (const mode of ["solid", "surface", "edges"] as const) {
      expect(preset.modePartIds.get(mode)).toHaveLength(3);
    }
  });
});

describe("createBoltedPlatePreset", () => {
  it("keeps the bolted footprint and mode part ids", () => {
    const preset = createBoltedPlatePreset();
    expect(preset.bounds).toEqual({
      minX: -15,
      minY: -4,
      minZ: -7,
      maxX: 21,
      maxY: 4.349999904632568,
      maxZ: 7,
    });
    expect(preset.modePartIds.get("solid")).toEqual([1, 4, 7, 10]);
    expect(preset.partNames.get(4)).toBe("Bolts");
    expect(preset.partNames.get(7)).toBe("Washers");
    expect(preset.partNames.get(10)).toBe("Nuts");
  });
});

describe("createFramePreset", () => {
  it("reports the frame footprint and mode parts", () => {
    const preset = createFramePreset();
    expect(preset.bounds).toEqual({ minX: 0, minY: -1, minZ: -1, maxX: 7, maxY: 6, maxZ: 2 });
    expect(preset.modePartIds.get("solid")).toEqual([1]);
  });
});
