import { computeBounds, type Geometry, type Part } from "../geometry/part";
import { multiply, scale, translation } from "../math/mat4";
import { createScene, type Scene } from "../scene/scene";
import type { AssemblyId, PartId } from "../scene/types";

/** Stable part identifiers produced by the panel fixture. */
export interface PanelFixtureParts {
  readonly shell: PartId;
  readonly stiffenerX: PartId;
  readonly stiffenerY: PartId;
}

/** Stable assembly identifiers produced by the panel fixture. */
export interface PanelFixtureAssemblies {
  readonly root: AssemblyId;
  readonly rows: readonly AssemblyId[];
  readonly stiffenerX: AssemblyId;
  readonly stiffenerY: AssemblyId;
}

/** Model dimensions of the generated panel, in model units (meters). */
export interface PanelDimensions {
  /** Shell element size. */
  readonly cellSize: number;
  /** Number of shell elements along X. */
  readonly cellsX: number;
  /** Number of shell elements along Y. */
  readonly cellsY: number;
  /** Height of the upstanding stiffeners. */
  readonly stiffenerHeight: number;
  /** Overall model width along X. */
  readonly width: number;
  /** Overall model depth along Y. */
  readonly depth: number;
}

/** Tuning knobs for the deterministic panel fixture. */
export interface PanelFixtureOptions {
  readonly cellSize?: number;
  readonly cellsX?: number;
  readonly cellsY?: number;
  readonly stiffenerHeight?: number;
}

/**
 * A deterministic, CPU-only FE fixture: a stiffened deck panel.
 *
 * The scene is a pure function of the options: part and assembly ids are fixed,
 * and every placement is derived from the grid parameters, so tests and the demo
 * can rely on stable instance ids and exact counts.
 */
export interface PanelFixture {
  readonly scene: Scene;
  readonly dimensions: PanelDimensions;
  readonly partIds: PanelFixtureParts;
  readonly assemblyIds: PanelFixtureAssemblies;
  /** Number of part placements, i.e. the visible instance count. */
  readonly instanceCount: number;
}

const DEFAULT_CELL_SIZE = 1;
const DEFAULT_CELLS_X = 4;
const DEFAULT_CELLS_Y = 3;
const DEFAULT_STIFFENER_HEIGHT = 0.5;
const SHELL_PART_ID: PartId = 1;
const STIFFENER_X_PART_ID: PartId = 2;
const STIFFENER_Y_PART_ID: PartId = 3;
const ROOT_ASSEMBLY_ID: AssemblyId = 1;

/**
 * Builds a stiffened deck panel: a grid of shell elements arranged in nested row
 * assemblies, crossed by X and Y stiffener assemblies that span the full panel.
 *
 * Defaults produce a 4 x 3 shell grid of 1 m elements with 0.5 m ribs: 12 shells,
 * 4 X-stiffeners, and 5 Y-stiffeners (21 instances) over a 4 m x 3 m footprint.
 */
export function createPanelFixture(options: PanelFixtureOptions = {}): PanelFixture {
  const cellSize = options.cellSize ?? DEFAULT_CELL_SIZE;
  const cellsX = options.cellsX ?? DEFAULT_CELLS_X;
  const cellsY = options.cellsY ?? DEFAULT_CELLS_Y;
  const stiffenerHeight = options.stiffenerHeight ?? DEFAULT_STIFFENER_HEIGHT;
  validatePanelOptions({ cellSize, cellsX, cellsY, stiffenerHeight });

  const width = cellsX * cellSize;
  const depth = cellsY * cellSize;

  const parts: readonly Part[] = [
    makePart(SHELL_PART_ID, unitShellGeometry()),
    makePart(STIFFENER_X_PART_ID, unitStiffenerXGeometry()),
    makePart(STIFFENER_Y_PART_ID, unitStiffenerYGeometry()),
  ];
  const rows = buildRowAssemblies(cellsX, cellsY, cellSize);
  const stiffenerX = buildStiffenerXAssembly(cellsY, cellSize, width, stiffenerHeight);
  const stiffenerY = buildStiffenerYAssembly(cellsX, cellsY, cellSize, depth, stiffenerHeight);
  const root = buildRootAssembly(rows, stiffenerX.id, stiffenerY.id, cellSize);

  let builder = createScene();
  for (const part of parts) {
    builder = builder.addPart(part);
  }
  for (const assembly of [...rows, stiffenerX, stiffenerY]) {
    builder = builder.addAssembly(assembly);
  }
  const scene = builder.addAssembly(root).withRoot(root.id).build();

  return {
    scene,
    dimensions: { cellSize, cellsX, cellsY, stiffenerHeight, width, depth },
    partIds: {
      shell: SHELL_PART_ID,
      stiffenerX: STIFFENER_X_PART_ID,
      stiffenerY: STIFFENER_Y_PART_ID,
    },
    assemblyIds: {
      root: root.id,
      rows: rows.map((row) => row.id),
      stiffenerX: stiffenerX.id,
      stiffenerY: stiffenerY.id,
    },
    instanceCount: cellsX * cellsY + (cellsY + 1) + (cellsX + 1),
  };
}

function validatePanelOptions(options: {
  readonly cellSize: number;
  readonly cellsX: number;
  readonly cellsY: number;
  readonly stiffenerHeight: number;
}): void {
  if (!Number.isFinite(options.cellSize) || options.cellSize <= 0) {
    throw new Error("cellSize must be a positive finite number");
  }
  if (!Number.isFinite(options.stiffenerHeight) || options.stiffenerHeight <= 0) {
    throw new Error("stiffenerHeight must be a positive finite number");
  }
  if (!Number.isInteger(options.cellsX) || options.cellsX < 1) {
    throw new Error("cellsX must be a positive integer");
  }
  if (!Number.isInteger(options.cellsY) || options.cellsY < 1) {
    throw new Error("cellsY must be a positive integer");
  }
}

function makePart(id: PartId, geometry: Geometry): Part {
  return { id, geometry, bounds: computeBounds(geometry) };
}

function buildRowAssemblies(cellsX: number, cellsY: number, cellSize: number) {
  return Array.from({ length: cellsY }, (_, rowIndex) => ({
    id: ROOT_ASSEMBLY_ID + 1 + rowIndex,
    name: `row-${rowIndex}`,
    placements: Array.from({ length: cellsX }, (_, columnIndex) => ({
      kind: "part" as const,
      partId: SHELL_PART_ID,
      transform: translation(columnIndex * cellSize, 0, 0),
    })),
  }));
}

function buildStiffenerXAssembly(
  cellsY: number,
  cellSize: number,
  width: number,
  stiffenerHeight: number,
) {
  return {
    id: ROOT_ASSEMBLY_ID + 1 + cellsY,
    name: "stiffeners-x",
    placements: Array.from({ length: cellsY + 1 }, (_, index) => ({
      kind: "part" as const,
      partId: STIFFENER_X_PART_ID,
      transform: multiply(
        translation(width / 2, index * cellSize, 0),
        scale(width, 1, stiffenerHeight),
      ),
    })),
  };
}

function buildStiffenerYAssembly(
  cellsX: number,
  cellsY: number,
  cellSize: number,
  depth: number,
  stiffenerHeight: number,
) {
  return {
    id: ROOT_ASSEMBLY_ID + 2 + cellsY,
    name: "stiffeners-y",
    placements: Array.from({ length: cellsX + 1 }, (_, index) => ({
      kind: "part" as const,
      partId: STIFFENER_Y_PART_ID,
      transform: multiply(
        translation(index * cellSize, depth / 2, 0),
        scale(1, depth, stiffenerHeight),
      ),
    })),
  };
}

function buildRootAssembly(
  rows: ReadonlyArray<{ readonly id: AssemblyId }>,
  stiffenerXId: AssemblyId,
  stiffenerYId: AssemblyId,
  cellSize: number,
) {
  return {
    id: ROOT_ASSEMBLY_ID,
    name: "root",
    placements: [
      ...rows.map((row, index) => ({
        kind: "assembly" as const,
        assemblyId: row.id,
        transform: translation(0, index * cellSize, 0),
      })),
      { kind: "assembly" as const, assemblyId: stiffenerXId, transform: translation(0, 0, 0) },
      { kind: "assembly" as const, assemblyId: stiffenerYId, transform: translation(0, 0, 0) },
    ],
  };
}

function unitShellGeometry(): Geometry {
  return {
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    elements: [unitElement(0)],
  };
}

function unitStiffenerXGeometry(): Geometry {
  return {
    positions: new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 1, -0.5, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    elements: [unitElement(0)],
  };
}

function unitStiffenerYGeometry(): Geometry {
  return {
    positions: new Float32Array([0, -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    elements: [unitElement(0)],
  };
}

/** A single element covering a two-triangle quad. */
function unitElement(id: number) {
  return { id, triangleStart: 0, triangleCount: 2 };
}
