import { describe, expect, it } from "vitest";
import {
  createFramePreset,
  createGalleryPreset,
  createModelPresets,
  createPanelPreset,
  visiblePartIdsForPreset,
} from "../../src/fixture/presets";

describe("createModelPresets", () => {
  it("offers at least three deterministic models", () => {
    const presets = createModelPresets();
    expect(presets.map((preset) => preset.id)).toEqual(["gallery", "panel", "frame"]);
    expect(new Set(presets.map((preset) => preset.name)).size).toBe(3);
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

describe("createFramePreset", () => {
  it("reports the frame footprint and mode parts", () => {
    const preset = createFramePreset();
    expect(preset.bounds).toEqual({ minX: 0, minY: -1, minZ: -1, maxX: 7, maxY: 6, maxZ: 2 });
    expect(preset.modePartIds.get("solid")).toEqual([1]);
  });
});
