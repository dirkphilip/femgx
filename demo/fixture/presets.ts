import {
  createResultField,
  createSceneRuntime,
  transformPoint,
  type Bounds,
  type Color,
  type ElementModel,
  type PartId,
  type Scene,
  type ViewportResultsConfig,
} from "../../src/index";
import { createBoltedPlateFixture } from "./bolted-plate";
import { createElementFixture, createHex20CylinderFixture } from "./element-fixture";
import { createPerformancePreset } from "./performance-fixture";
import { createResultsPreset } from "./results-preset";
import { createTransparencyFixture } from "./transparency-fixture";
import { createVtkFixture } from "./vtk-fixture";

/** A deterministic demo model and its presentation metadata. */
export interface ModelPreset {
  readonly id: string;
  readonly name: string;
  readonly scene: Scene;
  readonly elementModels: ReadonlyMap<PartId, ElementModel>;
  readonly partColors: ReadonlyMap<PartId, Color>;
  readonly fallbackColor: Color;
  readonly partOpacities?: ReadonlyMap<PartId, number>;
  readonly partNames: ReadonlyMap<PartId, string>;
  readonly bounds: Bounds;
  readonly results?: ViewportResultsConfig;
}

/** Builds the gallery of built-in topology helpers and a generic solver mapping. */
export function createGalleryPreset(): ModelPreset {
  const fixture = createElementFixture();
  const partIds = fixture.partIds;
  return {
    id: "gallery",
    name: "Element tessellation and mapping gallery",
    scene: fixture.scene,
    elementModels: fixture.elementModels,
    partColors: new Map<PartId, Color>([
      [partIds.point, { r: 0.98, g: 0.78, b: 0.24, a: 1 }],
      [partIds.line, { r: 0.18, g: 0.72, b: 0.98, a: 1 }],
      [partIds.line3, { r: 0.15, g: 0.92, b: 0.65, a: 1 }],
      [partIds.triangle, { r: 0.96, g: 0.42, b: 0.2, a: 1 }],
      [partIds.tri6, { r: 0.98, g: 0.3, b: 0.74, a: 1 }],
      [partIds.quad, { r: 0.98, g: 0.65, b: 0.2, a: 1 }],
      [partIds.quad8, { r: 0.25, g: 0.82, b: 0.88, a: 1 }],
      [partIds.generic, { r: 0.95, g: 0.2, b: 0.58, a: 1 }],
      [partIds.tet4, { r: 0.95, g: 0.36, b: 0.3, a: 1 }],
      [partIds.tet10, { r: 0.98, g: 0.55, b: 0.25, a: 1 }],
      [partIds.hex8, { r: 0.25, g: 0.45, b: 0.96, a: 1 }],
      [partIds.hex20, { r: 0.55, g: 0.35, b: 0.96, a: 1 }],
      [partIds.wedge6, { r: 0.25, g: 0.82, b: 0.48, a: 1 }],
      [partIds.pyramid5, { r: 0.96, g: 0.48, b: 0.18, a: 1 }],
    ]),
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    partNames: new Map<PartId, string>([
      [partIds.point, "Built-in helper · Point"],
      [partIds.line, "Built-in helper · Line"],
      [partIds.line3, "Built-in helper · Line3"],
      [partIds.triangle, "Built-in helper · Triangle"],
      [partIds.tri6, "Built-in helper · Tri6"],
      [partIds.quad, "Built-in helper · Quad"],
      [partIds.quad8, "Built-in helper · Quad8"],
      [partIds.generic, "Generic solver-mapped element"],
      [partIds.tet4, "Built-in helper · Tet4"],
      [partIds.tet10, "Built-in helper · Tet10"],
      [partIds.hex8, "Built-in helper · Hex8"],
      [partIds.hex20, "Built-in helper · Hex20"],
      [partIds.wedge6, "Built-in helper · Wedge6"],
      [partIds.pyramid5, "Built-in helper · Pyramid5"],
    ]),
    bounds: fixtureBounds(fixture.scene),
  };
}

/** Builds the imported ASCII VTK finite-element sample. */
export function createVtkPreset(): ModelPreset {
  const fixture = createVtkFixture();
  const { solid } = fixture.partIds;
  return {
    id: "vtk",
    name: "Imported VTK sample",
    scene: fixture.scene,
    elementModels: fixture.elementModels,
    partColors: new Map<PartId, Color>([[solid, { r: 0.23, g: 0.57, b: 0.84, a: 1 }]]),
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    partNames: new Map<PartId, string>([[solid, "VTK Hex8 exterior"]]),
    bounds: fixtureBounds(fixture.scene),
    results: fixture.results,
  };
}

/** Builds a small linearly tessellated Hex20 cylinder. */
export function createHex20CylinderPreset(): ModelPreset {
  const fixture = createHex20CylinderFixture();
  const partId = fixture.partIds.hex20;
  const model = fixture.elementModels.get(partId);
  if (model === undefined) throw new Error("Hex20 cylinder fixture has no element model");
  const elementCount = Math.max(...model.elements.map((element) => element.id)) + 1;
  const stressValues = new Float32Array(elementCount);
  for (const [index, element] of model.elements.entries()) {
    stressValues[element.id] = 0.5 + index / Math.max(1, model.elements.length - 1);
  }
  const displacementValues = new Float32Array(model.nodes.length);
  for (let node = 0; node < model.nodes.length / 3; node += 1) {
    const offset = node * 3;
    const x = model.nodes[offset] ?? 0;
    const y = model.nodes[offset + 1] ?? 0;
    const z = model.nodes[offset + 2] ?? 0;
    displacementValues[offset] = x * 0.08 + z * 0.03;
    displacementValues[offset + 1] = y * 0.08;
    displacementValues[offset + 2] = x * 0.04;
  }
  return {
    id: "hex20-cylinder",
    name: "Hex20 cylinder",
    scene: fixture.scene,
    elementModels: fixture.elementModels,
    partColors: new Map<PartId, Color>([[partId, { r: 0.76, g: 0.34, b: 0.84, a: 1 }]]),
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    partNames: new Map<PartId, string>([[partId, "Hex20 cylinder · authored-node facets"]]),
    bounds: fixtureBounds(fixture.scene),
    results: {
      scalar: {
        field: createResultField({
          id: "hex20-cylinder-stress",
          name: "Hex20 cylinder stress",
          location: "elemental",
          shape: "scalar",
          count: elementCount,
          unit: "MPa",
          values: stressValues,
        }),
      },
      deformation: {
        field: createResultField({
          id: "hex20-cylinder-displacement",
          name: "Hex20 cylinder displacement",
          location: "nodal",
          shape: "vector",
          count: model.nodes.length / 3,
          unit: "mm",
          values: displacementValues,
        }),
        scale: 1,
      },
    },
  };
}

/** Builds the deterministic multi-layer volume used by section-plane controls. */
export function createSectionPlanePreset(): ModelPreset {
  const cylinder = createHex20CylinderPreset();
  return {
    ...cylinder,
    id: "section-volume",
    name: "Section-plane volume",
  };
}

/** Builds the bolted plate assembly showcase preset. */
export function createBoltedPlatePreset(): ModelPreset {
  const fixture = createBoltedPlateFixture();
  const partIds = fixture.partIds;
  const colors = new Map<PartId, Color>([
    [partIds.plate.partId, { r: 0.45, g: 0.55, b: 0.68, a: 1 }],
    [partIds.bolt.partId, { r: 0.32, g: 0.36, b: 0.42, a: 1 }],
    [partIds.washer.partId, { r: 0.85, g: 0.87, b: 0.9, a: 1 }],
    [partIds.nut.partId, { r: 0.75, g: 0.55, b: 0.2, a: 1 }],
  ]);
  const names = new Map<PartId, string>([
    [partIds.plate.partId, "Steel plates"],
    [partIds.bolt.partId, "Bolts"],
    [partIds.washer.partId, "Washers"],
    [partIds.nut.partId, "Nuts"],
  ]);
  return {
    id: "bolted",
    name: "Bolted plate assembly",
    scene: fixture.scene,
    elementModels: fixture.elementModels,
    partColors: colors,
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    partNames: names,
    bounds: fixtureBounds(fixture.scene),
  };
}

/** Builds the deterministic shell/interior transparency demonstration. */
export function createTransparencyPreset(options: { readonly opacity?: number } = {}): ModelPreset {
  const fixture = createTransparencyFixture();
  const { shell, interior, overlap } = fixture.partIds;
  const shellOpacity = options.opacity ?? 0.38;
  const overlapOpacity = options.opacity ?? 0.3;
  return {
    id: "transparency",
    name: "Order-independent transparency",
    scene: fixture.scene,
    elementModels: fixture.elementModels,
    partColors: new Map<PartId, Color>([
      [shell, { r: 0.95, g: 0.25, b: 0.2, a: 1 }],
      [interior, { r: 0.2, g: 0.45, b: 0.95, a: 1 }],
      [overlap, { r: 0.2, g: 0.85, b: 0.45, a: 1 }],
    ]),
    partOpacities: new Map<PartId, number>([
      [shell, shellOpacity],
      [overlap, overlapOpacity],
    ]),
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    partNames: new Map<PartId, string>([
      [shell, "Translucent shell"],
      [interior, "Solid interior"],
      [overlap, "Overlapping translucent placements"],
    ]),
    bounds: fixtureBounds(fixture.scene),
  };
}

/** The deterministic presets offered by the demo, in stable order. */
export function createModelPresets(
  options: { readonly transparencyOpacity?: number } = {},
): readonly ModelPreset[] {
  return [
    createBoltedPlatePreset(),
    createVtkPreset(),
    createGalleryPreset(),
    createHex20CylinderPreset(),
    createSectionPlanePreset(),
    createResultsPreset(),
    createTransparencyPreset(
      options.transparencyOpacity === undefined ? {} : { opacity: options.transparencyOpacity },
    ),
    createPerformancePreset(),
  ];
}

/** The demo's default showcase preset (the bolted plate assembly). */
export function createDefaultPreset(): ModelPreset {
  return createModelPresets()[0] as ModelPreset;
}

function fixtureBounds(scene: Scene): Bounds {
  const runtime = createSceneRuntime(scene);
  let result: Bounds | undefined;
  for (const instanceId of runtime.getDrawList()) {
    const partId = runtime.getPartId(instanceId);
    const transform = runtime.getTransform(instanceId);
    const part = partId === undefined ? undefined : scene.parts.get(partId);
    if (part === undefined || transform === undefined) continue;
    const bounds = transformBounds(part.bounds, transform);
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
