import type { ElementModel } from "../elements/model";
import type { ElementRenderMode } from "../geometry/element-mesh";
import type { Bounds } from "../geometry/part";
import type { Color } from "../interaction/interaction";
import { transformPoint } from "../math/mat4";
import { flattenAssembly } from "../runtime/flatten";
import type { Scene } from "../scene/scene";
import type { PartId } from "../scene/types";
import { createBoltedPlateFixture } from "./bolted-plate";
import { createElementFixture } from "./element-fixture";
import { createFrameFixture } from "./frame-fixture";
import { createPanelFixture } from "./panel";

/**
 * A deterministic demo model: the scene, the per-part element models used for
 * CPU-side node/face picking and emphasis, a part theme, and the per-mode
 * visibility mapping. Every preset is CPU-renderable and derived purely from
 * fixed options, so the demo and tests share identical structure.
 */
export interface ModelPreset {
  /** Stable preset key used by the demo's model selector. */
  readonly id: string;
  /** Human-readable preset name. */
  readonly name: string;
  readonly scene: Scene;
  /** The element model each part was tessellated from, keyed by part id. */
  readonly elementModels: ReadonlyMap<PartId, ElementModel>;
  /** Display theme per part, shared by every renderer. */
  readonly partColors: ReadonlyMap<PartId, Color>;
  readonly fallbackColor: Color;
  /** Human-readable part names for the visibility panel. */
  readonly partNames: ReadonlyMap<PartId, string>;
  /** Parts shown for each element render mode. */
  readonly modePartIds: ReadonlyMap<ElementRenderMode, readonly PartId[]>;
  /** Parts always shown alongside the active mode (e.g. point/line overlays). */
  readonly overlayPartIds: readonly PartId[];
  /** The element mode visible by default. */
  readonly defaultMode: ElementRenderMode;
  /** Overall model bounds, framing the initial camera. */
  readonly bounds: Bounds;
}

/** The volume render modes a structural preset supports. */
const VOLUME_MODES: readonly ElementRenderMode[] = ["solid", "surface", "edges"];

/**
 * Part ids to show in the inspection demo plus the always-visible overlays.
 * The edges mode is a display style; the controller enables the existing
 * per-instance edge overlay instead of switching to edge-only geometry.
 */
export function visiblePartIdsForPreset(
  preset: ModelPreset,
  mode: ElementRenderMode,
): ReadonlySet<PartId> {
  const modeParts = preset.modePartIds.get(mode === "edges" ? "solid" : mode) ?? [];
  return new Set([...modeParts, ...preset.overlayPartIds]);
}

/** Builds the element gallery preset (tet/hex gallery plus point/line overlay). */
export function createGalleryPreset(): ModelPreset {
  const fixture = createElementFixture();
  const partIds = fixture.partIds;
  return {
    id: "gallery",
    name: "Element gallery",
    scene: fixture.scene,
    elementModels: fixture.elementModels,
    partColors: new Map<PartId, Color>([
      [partIds.hexSolid, { r: 0.23, g: 0.51, b: 0.96, a: 1 }],
      [partIds.hexSurface, { r: 0.32, g: 0.6, b: 0.98, a: 1 }],
      [partIds.hexEdges, { r: 0.18, g: 0.42, b: 0.85, a: 1 }],
      [partIds.tetSolid, { r: 0.95, g: 0.45, b: 0.35, a: 1 }],
      [partIds.tetSurface, { r: 0.96, g: 0.56, b: 0.44, a: 1 }],
      [partIds.tetEdges, { r: 0.8, g: 0.36, b: 0.28, a: 1 }],
      [partIds.points, { r: 0.95, g: 0.78, b: 0.28, a: 1 }],
      [partIds.lines, { r: 0.3, g: 0.85, b: 0.7, a: 1 }],
    ]),
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    partNames: new Map<PartId, string>([
      [partIds.hexSolid, "Hex solid"],
      [partIds.hexSurface, "Hex20 surface"],
      [partIds.hexEdges, "Hex edges"],
      [partIds.tetSolid, "Tet10 solid"],
      [partIds.tetSurface, "Tet surface"],
      [partIds.tetEdges, "Tet edges"],
      [partIds.points, "Point nodes"],
      [partIds.lines, "Line outline"],
    ]),
    modePartIds: fixture.modePartIds,
    overlayPartIds: fixture.overlayPartIds,
    defaultMode: fixture.defaultMode,
    bounds: fixture.bounds,
  };
}

/** Builds the stiffened deck panel preset. */
export function createPanelPreset(): ModelPreset {
  const fixture = createPanelFixture();
  const partIds = fixture.partIds;
  const panelModes = new Map<ElementRenderMode, readonly PartId[]>(
    VOLUME_MODES.map((mode) => [mode, [partIds.shell, partIds.stiffenerX, partIds.stiffenerY]]),
  );
  return {
    id: "panel",
    name: "Stiffened deck panel",
    scene: fixture.scene,
    elementModels: fixture.elementModels,
    partColors: new Map<PartId, Color>([
      [partIds.shell, { r: 0.33, g: 0.62, b: 0.98, a: 1 }],
      [partIds.stiffenerX, { r: 0.96, g: 0.58, b: 0.24, a: 1 }],
      [partIds.stiffenerY, { r: 0.85, g: 0.4, b: 0.16, a: 1 }],
    ]),
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    partNames: new Map<PartId, string>([
      [partIds.shell, "Deck shell"],
      [partIds.stiffenerX, "X stiffeners"],
      [partIds.stiffenerY, "Y stiffeners"],
    ]),
    modePartIds: panelModes,
    overlayPartIds: [],
    defaultMode: "surface",
    bounds: fixtureBounds(fixture.scene),
  };
}

/** Builds the structural portal-frame preset. */
export function createFramePreset(): ModelPreset {
  const fixture = createFrameFixture();
  const partIds = fixture.partIds;
  return {
    id: "frame",
    name: "Portal frame",
    scene: fixture.scene,
    elementModels: fixture.elementModels,
    partColors: new Map<PartId, Color>([
      [partIds.solid, { r: 0.47, g: 0.62, b: 0.85, a: 1 }],
      [partIds.surface, { r: 0.55, g: 0.7, b: 0.92, a: 1 }],
      [partIds.edges, { r: 0.3, g: 0.42, b: 0.65, a: 1 }],
    ]),
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    partNames: new Map<PartId, string>([
      [partIds.solid, "Frame solid"],
      [partIds.surface, "Frame surface"],
      [partIds.edges, "Frame edges"],
    ]),
    modePartIds: fixture.modePartIds,
    overlayPartIds: [],
    defaultMode: fixture.defaultMode,
    bounds: fixture.bounds,
  };
}

/** Builds the bolted-plate assembly showcase preset. */
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
    createGalleryPreset(),
    createPanelPreset(),
    createFramePreset(),
  ];
}

/** The demo's default showcase preset (the bolted plate assembly). */
export function createDefaultPreset(): ModelPreset {
  return createModelPresets()[0] as ModelPreset;
}

/** World bounds of every placed part in the scene, merged into one box. */
function fixtureBounds(scene: Scene): Bounds {
  const instances = flattenAssembly({
    assemblyId: scene.rootAssemblyId,
    assemblies: scene.assemblies,
    visibleAssemblyIds: scene.visibleAssemblyIds,
    visiblePartIds: scene.visiblePartIds,
  });
  let result: Bounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  for (const instance of instances) {
    const part = scene.parts.get(instance.partId);
    if (part === undefined) continue;
    for (const x of [part.bounds.minX, part.bounds.maxX]) {
      for (const y of [part.bounds.minY, part.bounds.maxY]) {
        for (const z of [part.bounds.minZ, part.bounds.maxZ]) {
          const [px, py, pz] = transformPoint(instance.worldTransform, x, y, z);
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
  }
  return result;
}
