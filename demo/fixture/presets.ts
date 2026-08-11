import type { ElementModel } from "../../src/elements/model";
import type { ElementRenderMode } from "../../src/geometry/element-mesh";
import type { Bounds } from "../../src/geometry/part";
import type { Color } from "../../src/interaction/interaction";
import { transformPoint } from "../../src/math/mat4";
import { flattenAssembly } from "../../src/runtime/flatten";
import type { Scene } from "../../src/scene/scene";
import type { PartId } from "../../src/scene/types";
import type { ViewportResultsConfig } from "../../src/viewport/results";
import { createBoltedPlateFixture } from "./bolted-plate";
import { createElementFixture, createHex20CylinderFixture } from "./element-fixture";
import { createResultsPreset } from "./results-preset";
import { createVtkFixture } from "./vtk-fixture";

/** A deterministic demo model and its presentation metadata. */
export interface ModelPreset {
  readonly id: string;
  readonly name: string;
  readonly scene: Scene;
  readonly elementModels: ReadonlyMap<PartId, ElementModel>;
  readonly partColors: ReadonlyMap<PartId, Color>;
  readonly fallbackColor: Color;
  readonly partNames: ReadonlyMap<PartId, string>;
  readonly modePartIds: ReadonlyMap<ElementRenderMode, readonly PartId[]>;
  readonly overlayPartIds: readonly PartId[];
  readonly defaultMode: ElementRenderMode;
  readonly bounds: Bounds;
  readonly results?: ViewportResultsConfig;
}

/** Resolves the active mode to visible parts and preserves point/line overlays. */
export function visiblePartIdsForPreset(
  preset: ModelPreset,
  mode: ElementRenderMode,
): ReadonlySet<PartId> {
  const modeParts = preset.modePartIds.get(mode === "edges" ? "solid" : mode) ?? [];
  return new Set([...modeParts, ...preset.overlayPartIds]);
}

/** Builds the gallery containing every currently supported element shape. */
export function createGalleryPreset(): ModelPreset {
  const fixture = createElementFixture();
  const partIds = fixture.partIds;
  return {
    id: "gallery",
    name: "Element gallery · all supported shapes",
    scene: fixture.scene,
    elementModels: fixture.elementModels,
    partColors: new Map<PartId, Color>([
      [partIds.point, { r: 0.98, g: 0.78, b: 0.24, a: 1 }],
      [partIds.line, { r: 0.18, g: 0.72, b: 0.98, a: 1 }],
      [partIds.line3, { r: 0.15, g: 0.92, b: 0.65, a: 1 }],
      [partIds.triangle, { r: 0.96, g: 0.42, b: 0.2, a: 1 }],
      [partIds.quad, { r: 0.98, g: 0.65, b: 0.2, a: 1 }],
      [partIds.polygon, { r: 0.95, g: 0.2, b: 0.58, a: 1 }],
      [partIds.tet4, { r: 0.95, g: 0.36, b: 0.3, a: 1 }],
      [partIds.tet10, { r: 0.98, g: 0.55, b: 0.25, a: 1 }],
      [partIds.hex8, { r: 0.25, g: 0.45, b: 0.96, a: 1 }],
      [partIds.hex20, { r: 0.55, g: 0.35, b: 0.96, a: 1 }],
    ]),
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    partNames: new Map<PartId, string>([
      [partIds.point, "Point"],
      [partIds.line, "Line"],
      [partIds.line3, "Line3"],
      [partIds.triangle, "Triangle"],
      [partIds.quad, "Quad"],
      [partIds.polygon, "Polygon face"],
      [partIds.tet4, "Tet4"],
      [partIds.tet10, "Tet10"],
      [partIds.hex8, "Hex8"],
      [partIds.hex20, "Hex20"],
    ]),
    modePartIds: fixture.modePartIds,
    overlayPartIds: fixture.overlayPartIds,
    defaultMode: fixture.defaultMode,
    bounds: fixture.bounds,
  };
}

/** Builds the imported ASCII VTK finite-element sample. */
export function createVtkPreset(): ModelPreset {
  const fixture = createVtkFixture();
  const { solid, surface, edges } = fixture.partIds;
  return {
    id: "vtk",
    name: "VTK sample block",
    scene: fixture.scene,
    elementModels: fixture.elementModels,
    partColors: new Map<PartId, Color>([
      [solid, { r: 0.23, g: 0.57, b: 0.84, a: 1 }],
      [surface, { r: 0.3, g: 0.68, b: 0.94, a: 1 }],
      [edges, { r: 0.12, g: 0.34, b: 0.6, a: 1 }],
    ]),
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    partNames: new Map<PartId, string>([
      [solid, "VTK Hex8 solid"],
      [surface, "VTK Hex8 surface"],
      [edges, "VTK Hex8 edges"],
    ]),
    modePartIds: fixture.modePartIds,
    overlayPartIds: [],
    defaultMode: "solid",
    bounds: fixture.bounds,
  };
}

/** Builds a small curved Hex20 cylinder to make quadratic tessellation visible. */
export function createHex20CylinderPreset(): ModelPreset {
  const fixture = createHex20CylinderFixture();
  const partId = fixture.partIds.hex20;
  const edgePartId = fixture.partIds.edges;
  return {
    id: "hex20-cylinder",
    name: "Hex20 cylinder",
    scene: fixture.scene,
    elementModels: fixture.elementModels,
    partColors: new Map<PartId, Color>([
      [partId, { r: 0.76, g: 0.34, b: 0.84, a: 1 }],
      [edgePartId, { r: 0.32, g: 0.1, b: 0.42, a: 1 }],
    ]),
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    partNames: new Map<PartId, string>([
      [partId, "Hex20 cylinder · solid"],
      [edgePartId, "Hex20 cylinder · curved mid-edge tessellation"],
    ]),
    modePartIds: fixture.modePartIds,
    overlayPartIds: [edgePartId],
    defaultMode: "solid",
    bounds: fixture.bounds,
  };
}

/** Builds the bolted plate assembly showcase preset. */
export function createBoltedPlatePreset(): ModelPreset {
  const fixture = createBoltedPlateFixture();
  const partIds = fixture.partIds;
  const colors = new Map<PartId, Color>([
    [partIds.plate.solid, { r: 0.45, g: 0.55, b: 0.68, a: 1 }],
    [partIds.plate.surface, { r: 0.5, g: 0.6, b: 0.72, a: 1 }],
    [partIds.plate.edges, { r: 0.36, g: 0.46, b: 0.6, a: 1 }],
    [partIds.bolt.solid, { r: 0.32, g: 0.36, b: 0.42, a: 1 }],
    [partIds.bolt.surface, { r: 0.36, g: 0.4, b: 0.47, a: 1 }],
    [partIds.bolt.edges, { r: 0.24, g: 0.28, b: 0.34, a: 1 }],
    [partIds.washer.solid, { r: 0.85, g: 0.87, b: 0.9, a: 1 }],
    [partIds.washer.surface, { r: 0.88, g: 0.9, b: 0.93, a: 1 }],
    [partIds.washer.edges, { r: 0.72, g: 0.74, b: 0.78, a: 1 }],
    [partIds.nut.solid, { r: 0.75, g: 0.55, b: 0.2, a: 1 }],
    [partIds.nut.surface, { r: 0.8, g: 0.6, b: 0.25, a: 1 }],
    [partIds.nut.edges, { r: 0.62, g: 0.45, b: 0.16, a: 1 }],
  ]);
  const names = new Map<PartId, string>([
    [partIds.plate.solid, "Steel plates"],
    [partIds.plate.surface, "Steel plates"],
    [partIds.plate.edges, "Steel plates"],
    [partIds.bolt.solid, "Bolts"],
    [partIds.bolt.surface, "Bolts"],
    [partIds.bolt.edges, "Bolts"],
    [partIds.washer.solid, "Washers"],
    [partIds.washer.surface, "Washers"],
    [partIds.washer.edges, "Washers"],
    [partIds.nut.solid, "Nuts"],
    [partIds.nut.surface, "Nuts"],
    [partIds.nut.edges, "Nuts"],
  ]);
  return {
    id: "bolted",
    name: "Bolted plate assembly",
    scene: fixture.scene,
    elementModels: fixture.elementModels,
    partColors: colors,
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    partNames: names,
    modePartIds: fixture.modePartIds,
    overlayPartIds: [],
    defaultMode: fixture.defaultMode,
    bounds: fixtureBounds(fixture.scene),
  };
}

/** The deterministic presets offered by the demo, in stable order. */
export function createModelPresets(): readonly ModelPreset[] {
  return [
    createBoltedPlatePreset(),
    createVtkPreset(),
    createGalleryPreset(),
    createHex20CylinderPreset(),
    createResultsPreset(),
  ];
}

/** The demo's default showcase preset (the bolted plate assembly). */
export function createDefaultPreset(): ModelPreset {
  return createModelPresets()[0] as ModelPreset;
}

function fixtureBounds(scene: Scene): Bounds {
  const instances = flattenAssembly({
    assemblyId: scene.rootAssemblyId,
    assemblies: scene.assemblies,
    visibleAssemblyIds: scene.visibleAssemblyIds,
    visiblePartIds: scene.visiblePartIds,
  });
  let result: Bounds | undefined;
  for (const instance of instances) {
    const part = scene.parts.get(instance.partId);
    if (part === undefined) continue;
    const bounds = transformBounds(part.bounds, instance.worldTransform);
    result = mergeBounds(result, bounds);
  }
  if (result === undefined) throw new Error("Preset scene must contain at least one part");
  return result;
}

function transformBounds(bounds: Bounds, transform: Float32Array): Bounds {
  let result: Bounds = {
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
        result = {
          minX: Math.min(result.minX, px),
          minY: Math.min(result.minY, py),
          minZ: Math.min(result.minZ, pz),
          maxX: Math.max(result.maxX, px),
          maxY: Math.max(result.maxY, py),
          maxZ: Math.max(result.maxZ, pz),
        };
      }
    }
  }
  return result;
}

function mergeBounds(first: Bounds | undefined, second: Bounds): Bounds {
  if (first === undefined) return second;
  return {
    minX: Math.min(first.minX, second.minX),
    minY: Math.min(first.minY, second.minY),
    minZ: Math.min(first.minZ, second.minZ),
    maxX: Math.max(first.maxX, second.maxX),
    maxY: Math.max(first.maxY, second.maxY),
    maxZ: Math.max(first.maxZ, second.maxZ),
  };
}
