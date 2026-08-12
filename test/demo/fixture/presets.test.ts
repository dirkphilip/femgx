import { describe, expect, it } from "vitest";
import {
  createBoltedPlatePreset,
  createDefaultPreset,
  createGalleryPreset,
  createHex20CylinderPreset,
  createModelPresets,
  createTransparencyPreset,
  createVtkPreset,
} from "../../../demo/fixture/presets";
import { createResultsPreset } from "../../../demo/fixture/results-preset";
import { deformGeometry } from "../../../src/results/deform";
import { computeBounds } from "../../../src/geometry/part";
import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import { mapScalar } from "../../../src/results/mapping";
import { resolveViewportResults } from "../../../src/viewport/results";
import { createPresetInteraction } from "../../../demo/workbench/preset";
import { readInteractionState } from "../../../src/interaction/state";

describe("createModelPresets", () => {
  it("offers the six supported product stories in stable order", () => {
    const presets = createModelPresets();
    expect(presets.map((preset) => preset.id)).toEqual([
      "bolted",
      "vtk",
      "gallery",
      "hex20-cylinder",
      "results",
      "transparency",
    ]);
    expect(presets.map((preset) => preset.name)).toEqual([
      "Bolted plate assembly",
      "Imported VTK sample",
      "Supported element gallery",
      "Hex20 cylinder",
      "Static results · stress + deformation",
      "Order-independent transparency",
    ]);
    expect(new Set(presets.map((preset) => preset.name)).size).toBe(6);
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
    expect(createPackedSceneRuntime(preset.scene).getDrawList()).toHaveLength(10);
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
    expect(preset.bounds.minZ).toBeCloseTo(-0.9);
    expect(preset.bounds.maxZ).toBeCloseTo(0.9);
    expect(preset.results?.deformation?.field.count).toBeGreaterThan(20);
    expect(preset.results?.field.shape).toBe("scalar");
  });
});

describe("createBoltedPlatePreset", () => {
  it("starts with every reusable component visible", () => {
    const preset = createBoltedPlatePreset();
    expect(preset.partNames.get(4)).toBe("Bolts");
    expect(createPackedSceneRuntime(preset.scene).visibleCount).toBe(34);
  });
});

describe("createTransparencyPreset", () => {
  it("keeps a solid interior behind a shell and two transparent placements", () => {
    const preset = createTransparencyPreset();
    expect(preset.scene.parts.size).toBe(3);
    expect(preset.scene.assemblies.get(31)?.placements).toHaveLength(4);
    expect(preset.partOpacities?.get(31)).toBeCloseTo(0.38);
    expect(preset.partOpacities?.get(33)).toBeCloseTo(0.3);
  });
});

describe("createPresetInteraction", () => {
  it("can seed the per-part edge override for a new scene", () => {
    const preset = createBoltedPlatePreset();
    const withoutEdges = createPresetInteraction(preset);
    const withEdges = createPresetInteraction(preset, true);

    for (const partId of preset.scene.parts.keys()) {
      expect(readInteractionState(withoutEdges).partOverrides.get(partId)?.edge).toBeUndefined();
      expect(readInteractionState(withEdges).partOverrides.get(partId)?.edge).toBe(true);
    }
  });
});

describe("results preset", () => {
  it("connects a tensor field and nodal deformation to one FE part", () => {
    const preset = createResultsPreset();
    const model = preset.elementModels.get(20);
    expect(preset.results?.derive).toBe("vonMises");
    expect(preset.results?.deformation?.field.location).toBe("nodal");
    expect(model?.elements).toHaveLength(8);
    expect(model?.nodes).toHaveLength(90);
    expect(new Set(model?.elements.flatMap((element) => element.nodeIds)).size).toBe(30);
    expect(model?.elements.map((element) => element.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const part = preset.scene.parts.get(20);
    const displacement = preset.results?.deformation?.field;
    if (part === undefined || displacement === undefined) {
      throw new Error("Results preset has no deformable part");
    }
    const deformedBounds = computeBounds(deformGeometry(part.geometry, displacement));
    expect(preset.bounds).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 4, maxY: 2, maxZ: 1 });
    expect(deformedBounds.maxX).toBeCloseTo(4.08);
    expect(deformedBounds.maxY).toBeCloseTo(2.12);
    expect(deformedBounds.maxZ).toBeCloseTo(1.47);
  });

  it("uses exact monotone von Mises bands for the results strip", () => {
    const preset = createResultsPreset();
    const config = preset.results;
    if (config === undefined) throw new Error("Results preset has no results config");
    const runtime = createPackedSceneRuntime(preset.scene);
    const resolved = resolveViewportResults(config, preset.scene, runtime);

    expect(Array.from(resolved.scalarField.values)).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(resolved.range).toEqual({ min: 10, max: 80 });
    expect(mapScalar(resolved.colorMap, 10)).toEqual(resolved.colorMap.stops[0]?.color);
    expect(mapScalar(resolved.colorMap, 45)).toMatchObject({ r: 0.95, g: 0.85, a: 1 });
    expect(mapScalar(resolved.colorMap, 45).b).toBeCloseTo(0.2);
    expect(mapScalar(resolved.colorMap, 80)).toEqual(resolved.colorMap.stops.at(-1)?.color);
  });
});
