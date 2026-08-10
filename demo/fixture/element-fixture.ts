import type { ElementModel } from "../../src/elements/model";
import { elementPart, type ElementRenderMode } from "../../src/geometry/element-mesh";
import type { Bounds, Part } from "../../src/geometry/part";
import { transformPoint, translation } from "../../src/math/mat4";
import { flattenAssembly } from "../../src/runtime/flatten";
import { createScene, type Scene } from "../../src/scene/scene";
import type { AssemblyId, PartId } from "../../src/scene/types";
import {
  buildHex20CylinderModel,
  buildHexModel,
  buildPointLineModel,
  buildTetModel,
} from "./element-models";

/** Stable part identifiers for every element shape supported by femgx. */
export interface ElementFixtureParts {
  readonly point: PartId;
  readonly line: PartId;
  readonly line3: PartId;
  readonly tet4: PartId;
  readonly tet10: PartId;
  readonly hex8: PartId;
  readonly hex20: PartId;
}

/** Tuning knobs for the deterministic element gallery. */
export interface ElementFixtureOptions {
  /** Hex elements along each axis of the volume grids (default `2`). */
  readonly gridSize?: number;
  /** Edge length of one element in model units (default `1`). */
  readonly cellSize?: number;
}

/** A deterministic gallery containing one visible example per supported shape. */
export interface ElementFixture {
  readonly scene: Scene;
  readonly partIds: ElementFixtureParts;
  readonly modePartIds: ReadonlyMap<ElementRenderMode, readonly PartId[]>;
  readonly overlayPartIds: readonly PartId[];
  readonly elementModels: ReadonlyMap<PartId, ElementModel>;
  readonly defaultMode: ElementRenderMode;
  readonly instanceCount: number;
  readonly bounds: Bounds;
}

const POINT_PART_ID: PartId = 1;
const LINE_PART_ID: PartId = 2;
const LINE3_PART_ID: PartId = 3;
const TET4_PART_ID: PartId = 4;
const TET10_PART_ID: PartId = 5;
const HEX8_PART_ID: PartId = 6;
const HEX20_PART_ID: PartId = 7;
const ROOT_ASSEMBLY_ID: AssemblyId = 1;
const GAP = 1;

/** Builds the element gallery with all point, line, Tet, and Hex shapes. */
export function createElementFixture(options: ElementFixtureOptions = {}): ElementFixture {
  const gridSize = options.gridSize ?? 2;
  const cellSize = options.cellSize ?? 1;
  validateFixtureOptions(gridSize, cellSize);

  const blockSize = gridSize * cellSize;
  const pointLineModel = buildPointLineModel(gridSize, cellSize);
  const lineModel = buildPointLineModel(gridSize, cellSize, "linear");
  const line3Model = buildPointLineModel(gridSize, cellSize, "quadratic");
  const tet4Model = buildTetModel(gridSize, cellSize, false);
  const tet10Model = buildTetModel(gridSize, cellSize, true);
  const hex8Model = buildHexModel(gridSize, cellSize, false);
  const hex20Model = buildHexModel(gridSize, cellSize, true);
  const models = new Map<PartId, ElementModel>([
    [POINT_PART_ID, pointLineModel],
    [LINE_PART_ID, lineModel],
    [LINE3_PART_ID, line3Model],
    [TET4_PART_ID, tet4Model],
    [TET10_PART_ID, tet10Model],
    [HEX8_PART_ID, hex8Model],
    [HEX20_PART_ID, hex20Model],
  ]);
  const parts: readonly Part[] = [
    elementPart(POINT_PART_ID, pointLineModel, "point", "points"),
    elementPart(LINE_PART_ID, lineModel, "line", "lines"),
    elementPart(LINE3_PART_ID, line3Model, "line", "lines"),
    elementPart(TET4_PART_ID, tet4Model, "tet", "solid"),
    elementPart(TET10_PART_ID, tet10Model, "tet", "solid"),
    elementPart(HEX8_PART_ID, hex8Model, "hex", "solid"),
    elementPart(HEX20_PART_ID, hex20Model, "hex", "solid"),
  ];
  const scene = galleryScene(parts, blockSize);
  const volumePartIds = [TET4_PART_ID, TET10_PART_ID, HEX8_PART_ID, HEX20_PART_ID];
  return {
    scene,
    partIds: {
      point: POINT_PART_ID,
      line: LINE_PART_ID,
      line3: LINE3_PART_ID,
      tet4: TET4_PART_ID,
      tet10: TET10_PART_ID,
      hex8: HEX8_PART_ID,
      hex20: HEX20_PART_ID,
    },
    elementModels: models,
    modePartIds: new Map<ElementRenderMode, readonly PartId[]>([
      ["solid", volumePartIds],
      ["surface", volumePartIds],
      ["edges", volumePartIds],
    ]),
    overlayPartIds: [POINT_PART_ID, LINE_PART_ID, LINE3_PART_ID],
    defaultMode: "solid",
    instanceCount: parts.length,
    bounds: sceneBounds(scene),
  };
}

/** Fixture shape with a second reusable edge-overlay part. */
type Hex20CylinderFixture = Omit<ElementFixture, "partIds"> & {
  readonly partIds: ElementFixtureParts & { readonly edges: PartId };
};

/** Builds the Hex20 cylinder example used by the gallery preset. */
export function createHex20CylinderFixture(): Hex20CylinderFixture {
  const model = buildHex20CylinderModel();
  const edgePartId: PartId = 8;
  const parts = [
    elementPart(HEX20_PART_ID, model, "hex", "solid", { edgeSegments: 4 }),
    elementPart(edgePartId, model, "hex", "edges", { edgeSegments: 4 }),
  ];
  const scene = galleryScene(parts, 0);
  const modePartIds = new Map<ElementRenderMode, readonly PartId[]>([
    ["solid", [HEX20_PART_ID]],
    ["surface", [HEX20_PART_ID]],
    ["edges", [HEX20_PART_ID]],
  ]);
  return {
    scene,
    partIds: {
      point: POINT_PART_ID,
      line: LINE_PART_ID,
      line3: LINE3_PART_ID,
      tet4: TET4_PART_ID,
      tet10: TET10_PART_ID,
      hex8: HEX8_PART_ID,
      hex20: HEX20_PART_ID,
      edges: edgePartId,
    },
    elementModels: new Map([
      [HEX20_PART_ID, model],
      [edgePartId, model],
    ]),
    modePartIds,
    overlayPartIds: [edgePartId],
    defaultMode: "solid",
    instanceCount: parts.length,
    bounds: sceneBounds(scene),
  };
}

function galleryScene(parts: readonly Part[], blockSize: number): Scene {
  let builder = createScene();
  for (const part of parts) builder = builder.addPart(part);
  const spacing = blockSize === 0 ? 0 : blockSize + GAP;
  const root = {
    id: ROOT_ASSEMBLY_ID,
    name: "element-gallery",
    placements: parts.map((part, index) => ({
      kind: "part" as const,
      partId: part.id,
      transform: translation(index * spacing, 0, 0),
    })),
  };
  return builder.addAssembly(root).withRoot(root.id).build();
}

function validateFixtureOptions(gridSize: number, cellSize: number): void {
  if (!Number.isInteger(gridSize) || gridSize < 1) {
    throw new Error("gridSize must be a positive integer");
  }
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error("cellSize must be a positive finite number");
  }
}

function sceneBounds(scene: Scene): Bounds {
  const instances = flattenAssembly({
    assemblyId: scene.rootAssemblyId,
    assemblies: scene.assemblies,
    visibleAssemblyIds: scene.visibleAssemblyIds,
    visiblePartIds: scene.visiblePartIds,
  });
  let bounds: Bounds | undefined;
  for (const instance of instances) {
    const part = scene.parts.get(instance.partId);
    if (part === undefined) continue;
    bounds = mergeBounds(bounds, transformBounds(part.bounds, instance.worldTransform));
  }
  return bounds ?? { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
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
