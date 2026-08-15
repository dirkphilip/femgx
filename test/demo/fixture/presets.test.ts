import { describe, expect, it } from "vitest";
import {
  createBoltedPlatePreset,
  createDefaultPreset,
  createGalleryPreset,
  createHex20CylinderPreset,
  createSectionPlanePreset,
  createModelPresets,
  createTransparencyPreset,
  createVtkPreset,
} from "../../../demo/fixture/presets";
import { createResultsPreset } from "../../../demo/fixture/results-preset";
import { deformGeometry } from "../../../src/results/deform";
import { computeBounds } from "../../../src/geometry/part";
import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import { mapScalar } from "../../../src/results/mapping";
import { resolveViewportResults, viewportOrientationRecords } from "../../../src/viewport/results";
import { createPresetInteraction } from "../../../demo/workbench/preset";
import { readInteractionState } from "../../../src/interaction/state";
import { transformPoint } from "../../../src/math/mat4";
import { cross, dot, normalize } from "../../../src/math/vec3";

describe("createModelPresets", () => {
  it("offers the seven supported product stories in stable order", () => {
    const presets = createModelPresets();
    expect(presets.map((preset) => preset.id)).toEqual([
      "bolted",
      "vtk",
      "gallery",
      "hex20-cylinder",
      "section-volume",
      "results",
      "transparency",
    ]);
    expect(presets.map((preset) => preset.name)).toEqual([
      "Bolted plate assembly",
      "Imported VTK sample",
      "Element tessellation and mapping gallery",
      "Hex20 cylinder",
      "Section-plane volume",
      "Static results · scalar + deformation + orientation",
      "Order-independent transparency",
    ]);
    expect(new Set(presets.map((preset) => preset.name)).size).toBe(7);
  });

  it("keeps the bolted plate as the default showcase", () => {
    expect(createDefaultPreset().id).toBe("bolted");
    expect(createModelPresets()[0]).toEqual(createDefaultPreset());
  });

  it("exposes element models for every typed FE preset part", () => {
    for (const preset of createModelPresets().filter(
      (candidate) => candidate.id !== "performance",
    )) {
      for (const partId of preset.scene.parts.keys()) {
        const part = preset.scene.parts.get(partId);
        const hasTypedElements = part?.elements?.some((element) => element.shape !== undefined);
        if (hasTypedElements) {
          expect(preset.elementModels.get(partId), `${preset.id} part ${partId}`).toBeDefined();
        }
      }
    }
  });
});

describe("createGalleryPreset", () => {
  it("includes the helper set and generic mapped element", () => {
    const preset = createGalleryPreset();
    expect(preset.partNames.get(10)).toBe("Generic solver-mapped element");
    expect(preset.partNames.get(15)).toBe("Mixed point, line, and triangle element");
    expect(preset.partColors.get(15)).toEqual({ r: 0.28, g: 0.68, b: 0.64, a: 1 });
  });
});

describe("createVtkPreset", () => {
  it("imports the checked-in VTK sample mesh", () => {
    const preset = createVtkPreset();
    expect(preset.name).toBe("Imported VTK sample");
    expect(preset.scene.parts.size).toBe(1);
    expect(preset.bounds).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 2, maxZ: 1 });
    expect(preset.results?.scalar?.field.name).toBe("stress");
    expect(preset.results?.deformation?.field.name).toBe("displacement");
    expect(preset.resultScalarFields?.map((field) => field.id)).toEqual([
      "vtk-stress",
      "vtk-temperature",
    ]);
  });
});

describe("createHex20CylinderPreset", () => {
  it("builds a small linearly tessellated Hex20 cylinder", () => {
    const preset = createHex20CylinderPreset();
    expect(preset.results?.deformation?.field.count).toBeGreaterThan(20);
    expect(preset.results?.scalar?.field.shape).toBe("scalar");
  });
});

describe("createSectionPlanePreset", () => {
  it("uses a deterministic multi-layer volume with solver metadata", () => {
    const preset = createSectionPlanePreset();
    expect(preset.id).toBe("section-volume");
    expect(preset.scene.parts.size).toBe(1);
    expect(preset.results?.deformation?.field.count).toBeGreaterThan(20);
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

  it("can make only the transparent parts alpha-zero for overlay coverage tests", () => {
    const preset = createTransparencyPreset({ opacity: 0 });
    expect(preset.partOpacities?.get(31)).toBe(0);
    expect(preset.partOpacities?.get(33)).toBe(0);
    expect(preset.partOpacities?.has(32)).toBe(false);
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

  it("enables node overlays for eligible parts but not point glyph parts", () => {
    const preset = createGalleryPreset();
    const state = createPresetInteraction(preset, false, true);
    const data = readInteractionState(state);
    expect(data.partOverrides.get(1)?.nodes).toBeUndefined();
    expect(data.partOverrides.get(8)?.nodes).toBe(true);
  });
});

describe("results preset", () => {
  it("connects authored scalar, deformation, and elemental orientation fields", () => {
    const preset = createResultsPreset();
    const model = preset.elementModels.get(20);
    expect(preset.results?.scalar?.field.shape).toBe("scalar");
    expect(preset.results?.deformation?.field.location).toBe("nodal");
    expect(preset.results?.vectors?.field.id).toBe("demo-normals");
    expect(preset.resultScalarFields?.map((field) => [field.id, field.location])).toEqual([
      ["demo-stress", "elemental"],
      ["demo-temperature", "nodal"],
    ]);
    expect(preset.resultVectorFields?.map((field) => field.id)).toEqual([
      "demo-normals",
      "demo-fibers",
    ]);
    expect(preset.scene.assemblies.get(20)?.placements).toHaveLength(2);
    expect(model?.elements).toHaveLength(8);
    expect(model?.nodes).toHaveLength(45);
    expect(new Set(model?.elements.flatMap((element) => element.nodeIds)).size).toBe(15);
    expect(model?.elements.map((element) => element.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const part = preset.scene.parts.get(20);
    const displacement = preset.results?.deformation?.field;
    if (part === undefined || displacement === undefined) {
      throw new Error("Results preset has no deformable part");
    }
    const geometry = part.geometries[0];
    if (geometry === undefined) throw new Error("Results preset has no geometry");
    const deformedBounds = computeBounds(deformGeometry(geometry, displacement));
    expect(preset.bounds.minX).toBe(0);
    expect(preset.bounds.minY).toBe(0);
    expect(preset.bounds.minZ).toBe(0);
    expect(preset.bounds.maxX).toBeCloseTo(9.5);
    expect(preset.bounds.maxY).toBeGreaterThan(5.5);
    expect(preset.bounds.maxZ).toBeGreaterThan(0.65);
    expect(deformedBounds.maxX).toBeCloseTo(4.08);
    expect(deformedBounds.maxY).toBeCloseTo(2.12);
    expect(deformedBounds.maxZ).toBeGreaterThan(0.85);
  });

  it("keeps deformed results occurrences separated on both layout axes", () => {
    const preset = createResultsPreset();
    const part = preset.scene.parts.get(20);
    const displacement = preset.results?.deformation?.field;
    if (part === undefined || displacement === undefined) {
      throw new Error("Results preset has no deformable part");
    }
    const geometry = part.geometries[0];
    if (geometry === undefined) throw new Error("Results preset has no geometry");
    const bounds = computeBounds(deformGeometry(geometry, displacement));
    const runtime = createPackedSceneRuntime(preset.scene);
    const instances = runtime.getDrawList();
    const placed = Array.from(instances, (instanceId) => {
      const transform = runtime.getTransform(instanceId);
      if (transform === undefined) throw new Error("Results occurrence has no transform");
      return transformedBounds(bounds, transform);
    });
    const first = placed[0];
    const second = placed[1];
    if (first === undefined || second === undefined)
      throw new Error("Results preset lost occurrence");
    expect(first.maxX).toBeLessThan(second.minX);
    expect(first.maxY).toBeLessThan(second.minY);
  });

  it("uses exact monotone authored scalar bands for the results strip", () => {
    const preset = createResultsPreset();
    const config = preset.results;
    if (config === undefined) throw new Error("Results preset has no results config");
    const runtime = createPackedSceneRuntime(preset.scene);
    const resolved = resolveViewportResults(config, preset.scene, runtime);

    const scalar = resolved.scalar;
    if (scalar === undefined) throw new Error("Results preset has no scalar role");
    expect(Array.from(scalar.field.values)).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(scalar.range).toEqual({ min: 10, max: 80 });
    expect(mapScalar(scalar.colorMap, 10)).toEqual(scalar.colorMap.stops[0]?.color);
    expect(mapScalar(scalar.colorMap, 45)).toMatchObject({ r: 0.95, g: 0.85, a: 1 });
    expect(mapScalar(scalar.colorMap, 45).b).toBeCloseTo(0.2);
    expect(mapScalar(scalar.colorMap, 80)).toEqual(scalar.colorMap.stops.at(-1)?.color);
  });

  it("authors every shell vector from its consistently wound face", () => {
    const preset = createResultsPreset();
    const normals = preset.resultVectorFields?.find((field) => field.id === "demo-normals");
    if (normals === undefined) throw new Error("Results preset has no normals field");
    expect(normals.values).toHaveLength(24);
    for (let index = 0; index < normals.values.length; index += 3) {
      const x = normals.values[index] ?? Number.NaN;
      const y = normals.values[index + 1] ?? Number.NaN;
      const z = normals.values[index + 2] ?? Number.NaN;
      expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1);
      expect(z).toBeGreaterThan(0);
    }
    const model = preset.elementModels.get(20);
    const runtime = createPackedSceneRuntime(preset.scene);
    const results = preset.results;
    if (results === undefined) throw new Error("Results preset has no result configuration");
    const state = resolveViewportResults(results, preset.scene, runtime);
    const records = viewportOrientationRecords(state)?.get(20);
    if (model === undefined || records === undefined) {
      throw new Error("Results preset has no shell orientation records");
    }
    for (const element of model.elements) {
      const first = pointAt(model.nodes, element.nodeIds[0]);
      const second = pointAt(model.nodes, element.nodeIds[1]);
      const third = pointAt(model.nodes, element.nodeIds[2]);
      const geometricNormal = normalize(cross(subtract(second, first), subtract(third, first)));
      const vectorBase = element.id * 3;
      const authored = [
        normals.values[vectorBase] ?? Number.NaN,
        normals.values[vectorBase + 1] ?? Number.NaN,
        normals.values[vectorBase + 2] ?? Number.NaN,
      ] as const;
      expect(dot(authored, geometricNormal)).toBeGreaterThan(0.99);
      const recordIndex = records.elementIds.indexOf(element.id);
      expect(recordIndex).toBeGreaterThanOrEqual(0);
      const anchorBase = recordIndex * 3;
      const centroid = element.nodeIds.reduce<[number, number, number]>(
        (sum, nodeId) => {
          const point = pointAt(model.nodes, nodeId);
          return [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]];
        },
        [0, 0, 0],
      );
      for (let axis = 0; axis < 3; axis += 1) {
        expect(records.anchors[anchorBase + axis] ?? Number.NaN).toBeCloseTo(
          (centroid[axis] ?? Number.NaN) / element.nodeIds.length,
        );
      }
    }
    expect(preset.resultVectorFields?.[1]?.values.slice(0, 6)).toEqual(
      new Float32Array([1, 0.25, 0, -1, -0.25, 0]),
    );
  });
});

function pointAt(nodes: ArrayLike<number>, nodeId: number | undefined): [number, number, number] {
  if (nodeId === undefined) throw new Error("Shell element is missing a node");
  const offset = nodeId * 3;
  return [nodes[offset] ?? 0, nodes[offset + 1] ?? 0, nodes[offset + 2] ?? 0];
}

function subtract(a: readonly [number, number, number], b: readonly [number, number, number]) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] as [number, number, number];
}

function transformedBounds(
  bounds: ReturnType<typeof computeBounds>,
  transform: Float32Array,
): ReturnType<typeof computeBounds> {
  const result = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  for (const x of [bounds.minX, bounds.maxX]) {
    for (const y of [bounds.minY, bounds.maxY]) {
      for (const z of [bounds.minZ, bounds.maxZ]) {
        const [px, py, pz] = transformPoint(transform, x, y, z);
        result.minX = Math.min(result.minX, px);
        result.minY = Math.min(result.minY, py);
        result.minZ = Math.min(result.minZ, pz);
        result.maxX = Math.max(result.maxX, px);
        result.maxY = Math.max(result.maxY, py);
        result.maxZ = Math.max(result.maxZ, pz);
      }
    }
  }
  return result;
}
