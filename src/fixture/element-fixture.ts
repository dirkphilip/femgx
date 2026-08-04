import { elementPart, type ElementRenderMode } from "../geometry/element-mesh";
import type { Bounds, Part } from "../geometry/part";
import { transformPoint, translation } from "../math/mat4";
import { flattenAssembly } from "../runtime/flatten";
import { createScene, type Scene } from "../scene/scene";
import type { AssemblyId, PartId } from "../scene/types";
import { buildHexModel, buildPointLineModel, buildTetModel } from "./element-models";

/** Stable part identifiers produced by the element fixture. */
export interface ElementFixtureParts {
  readonly tetSolid: PartId;
  readonly tetSurface: PartId;
  readonly tetEdges: PartId;
  readonly hexSolid: PartId;
  readonly hexSurface: PartId;
  readonly hexEdges: PartId;
  readonly points: PartId;
  readonly lines: PartId;
}

/** Tuning knobs for the deterministic element fixture. */
export interface ElementFixtureOptions {
  /** Hex elements along each axis of the volume grids (default `2`). */
  readonly gridSize?: number;
  /** Edge length of one element in model units (default `1`). */
  readonly cellSize?: number;
}

/**
 * A deterministic CPU-only FE fixture: a gallery of linear and quadratic Tet,
 * Hex, point, and line elements. Each element family and render mode is a
 * reusable part, so mode selection is pure part visibility; every placement is
 * derived from the grid parameters.
 */
export interface ElementFixture {
  readonly scene: Scene;
  readonly partIds: ElementFixtureParts;
  /** Parts shown for each volume render mode (tet + hex). */
  readonly modePartIds: ReadonlyMap<ElementRenderMode, readonly PartId[]>;
  /** Point and line parts, always visible alongside the chosen mode. */
  readonly overlayPartIds: readonly PartId[];
  /** The volume mode visible by default. */
  readonly defaultMode: ElementRenderMode;
  /** Total part placements (one per reusable part). */
  readonly instanceCount: number;
  /** Overall model bounds, framing the full gallery. */
  readonly bounds: Bounds;
}

const HEX_PART_ID: PartId = 1;
const HEX_SURFACE_PART_ID: PartId = 2;
const HEX_EDGES_PART_ID: PartId = 3;
const TET_PART_ID: PartId = 4;
const TET_SURFACE_PART_ID: PartId = 5;
const TET_EDGES_PART_ID: PartId = 6;
const POINTS_PART_ID: PartId = 7;
const LINES_PART_ID: PartId = 8;
const ROOT_ASSEMBLY_ID: AssemblyId = 1;
const GAP = 1;

/** Builds the element gallery with a `gridSize` cube per family block. */
export function createElementFixture(options: ElementFixtureOptions = {}): ElementFixture {
  const gridSize = options.gridSize ?? 2;
  const cellSize = options.cellSize ?? 1;
  validateFixtureOptions(gridSize, cellSize);

  const blockSize = gridSize * cellSize;
  const hexModel = buildHexModel(gridSize, cellSize, false);
  const hex20Model = buildHexModel(gridSize, cellSize, true);
  const tetModel = buildTetModel(gridSize, cellSize, false);
  const tet10Model = buildTetModel(gridSize, cellSize, true);
  const pointLineModel = buildPointLineModel(gridSize, cellSize);

  const hexParts = [
    elementPart(HEX_PART_ID, hexModel, "hex", "solid"),
    elementPart(HEX_SURFACE_PART_ID, hex20Model, "hex", "surface"),
    elementPart(HEX_EDGES_PART_ID, hexModel, "hex", "edges"),
  ];
  const tetParts = [
    elementPart(TET_PART_ID, tet10Model, "tet", "solid"),
    elementPart(TET_SURFACE_PART_ID, tetModel, "tet", "surface"),
    elementPart(TET_EDGES_PART_ID, tetModel, "tet", "edges"),
  ];
  const pointPart = elementPart(POINTS_PART_ID, pointLineModel, "point", "points");
  const linePart = elementPart(LINES_PART_ID, pointLineModel, "line", "lines");

  const partIds: ElementFixtureParts = {
    tetSolid: TET_PART_ID,
    tetSurface: TET_SURFACE_PART_ID,
    tetEdges: TET_EDGES_PART_ID,
    hexSolid: HEX_PART_ID,
    hexSurface: HEX_SURFACE_PART_ID,
    hexEdges: HEX_EDGES_PART_ID,
    points: POINTS_PART_ID,
    lines: LINES_PART_ID,
  };

  let builder = createScene();
  for (const part of [...hexParts, ...tetParts, pointPart, linePart]) {
    builder = builder.addPart(part);
  }
  const root = {
    id: ROOT_ASSEMBLY_ID,
    name: "root",
    placements: [
      ...placed(hexParts, 0),
      ...placed(tetParts, blockSize + GAP),
      ...placed([pointPart, linePart], 2 * (blockSize + GAP)),
    ],
  };
  const scene = builder.addAssembly(root).withRoot(root.id).build();

  return {
    scene,
    partIds,
    modePartIds: new Map<ElementRenderMode, readonly PartId[]>([
      ["solid", [TET_PART_ID, HEX_PART_ID]],
      ["surface", [TET_SURFACE_PART_ID, HEX_SURFACE_PART_ID]],
      ["edges", [TET_EDGES_PART_ID, HEX_EDGES_PART_ID]],
    ]),
    overlayPartIds: [POINTS_PART_ID, LINES_PART_ID],
    defaultMode: "solid",
    instanceCount: 8,
    bounds: sceneBounds(scene),
  };
}

/** Part ids to show for a volume mode, plus the always-visible overlays. */
export function visiblePartIdsFor(
  fixture: ElementFixture,
  mode: ElementRenderMode,
): ReadonlySet<PartId> {
  const modeParts = fixture.modePartIds.get(mode) ?? [];
  return new Set([...modeParts, ...fixture.overlayPartIds]);
}

function placed(
  parts: readonly Part[],
  xOffset: number,
): ReadonlyArray<{
  readonly kind: "part";
  readonly partId: PartId;
  readonly transform: Float32Array;
}> {
  return parts.map((part) => ({
    kind: "part" as const,
    partId: part.id,
    transform: translation(xOffset, 0, 0),
  }));
}

function validateFixtureOptions(gridSize: number, cellSize: number): void {
  if (!Number.isInteger(gridSize) || gridSize < 1) {
    throw new Error("gridSize must be a positive integer");
  }
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error("cellSize must be a positive finite number");
  }
}

/** Merges the world bounds of every placed part into one model bounds. */
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

function mergeBounds(a: Bounds | undefined, b: Bounds): Bounds {
  if (a === undefined) return b;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}
