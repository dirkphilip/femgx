import type { ElementModel } from "../elements/model";
import { elementPart, type ElementRenderMode } from "../geometry/element-mesh";
import type { Part } from "../geometry/part";
import { identity, translation, type Mat4 } from "../math/mat4";
import type { NamedAssembly, Placement } from "../scene/assembly";
import { createScene, type Scene } from "../scene/scene";
import type { AssemblyId, PartId } from "../scene/types";
import {
  createBoltModel,
  createNutModel,
  createPlateModel,
  createWasherModel,
} from "./bolted-plate-mesh";

/**
 * A deterministic, CPU-only engineering showcase fixture: a bolted lap joint
 * built from two overlapping plates clamped by a grid of fasteners. Every
 * fastener reuses the same bolt, washer, and nut part definitions placed
 * through nested assemblies, so the model demonstrates reusable parts, GPU
 * instancing, and hierarchical hide/show at every level.
 */

/** The three render-mode part ids of one reusable component. */
export interface BoltedPlateComponentParts {
  readonly solid: PartId;
  readonly surface: PartId;
  readonly edges: PartId;
}

/** Stable part identifiers produced by the bolted-plate fixture. */
export interface BoltedPlateParts {
  readonly plate: BoltedPlateComponentParts;
  readonly bolt: BoltedPlateComponentParts;
  readonly washer: BoltedPlateComponentParts;
  readonly nut: BoltedPlateComponentParts;
}

/** Stable assembly identifiers produced by the bolted-plate fixture. */
export interface BoltedPlateAssemblies {
  readonly root: AssemblyId;
  readonly plateStack: AssemblyId;
  readonly fasteners: AssemblyId;
  /** One fastener sub-assembly per fastener, in deterministic order. */
  readonly fastener: readonly AssemblyId[];
  /** One washers sub-assembly per fastener, in deterministic order. */
  readonly washers: readonly AssemblyId[];
}

/** Model dimensions of the bolted lap joint, in model units (meters). */
export interface BoltedPlateDimensions {
  /** Plate length along X. */
  readonly plateLength: number;
  /** Plate width along Z. */
  readonly plateWidth: number;
  /** Plate thickness along Y. */
  readonly plateThickness: number;
  /** X offset of the upper plate, leaving an overlap zone for the fasteners. */
  readonly overlapOffset: number;
  /** X positions of the fastener rows (inside the overlap). */
  readonly fastenerRows: readonly number[];
  /** Z positions of the fastener columns. */
  readonly fastenerColumns: readonly number[];
}

/** Tuning knobs for the deterministic bolted-plate fixture. */
export interface BoltedPlateOptions {
  readonly plateLength?: number;
  readonly plateWidth?: number;
  readonly plateThickness?: number;
  readonly overlapOffset?: number;
}

/**
 * A deterministic, CPU-only FE fixture: a bolted lap joint.
 *
 * The scene is a pure function of the options: part and assembly ids are
 * fixed, and every placement is derived from the fastener grid, so tests and
 * the demo can rely on stable instance ids and exact counts.
 */
export interface BoltedPlateFixture {
  readonly scene: Scene;
  readonly dimensions: BoltedPlateDimensions;
  readonly partIds: BoltedPlateParts;
  readonly assemblyIds: BoltedPlateAssemblies;
  /** The element model each part was tessellated from, keyed by part id. */
  readonly elementModels: ReadonlyMap<PartId, ElementModel>;
  readonly modePartIds: ReadonlyMap<ElementRenderMode, readonly PartId[]>;
  /** The volume mode visible by default. */
  readonly defaultMode: ElementRenderMode;
  /** Total part placements, one per mode-tessellated part placement. */
  readonly instanceCount: number;
  /** Part placements visible in the default mode. */
  readonly visibleInstanceCount: number;
}

const DEFAULT_PLATE_LENGTH = 30;
const DEFAULT_PLATE_WIDTH = 14;
const DEFAULT_PLATE_THICKNESS = 2;
const DEFAULT_OVERLAP_OFFSET = 6;
const FASTENER_ROWS = [-4, 10] as const;
const FASTENER_COLUMNS = [-4.5, -1.5, 1.5, 4.5] as const;
const TOP_WASHER_Y = 3.05;
const BOTTOM_WASHER_Y = -1.05;
const NUT_Y = -2.5;

const PLATE_SOLID: PartId = 1;
const PLATE_SURFACE: PartId = 2;
const PLATE_EDGES: PartId = 3;
const BOLT_SOLID: PartId = 4;
const BOLT_SURFACE: PartId = 5;
const BOLT_EDGES: PartId = 6;
const WASHER_SOLID: PartId = 7;
const WASHER_SURFACE: PartId = 8;
const WASHER_EDGES: PartId = 9;
const NUT_SOLID: PartId = 10;
const NUT_SURFACE: PartId = 11;
const NUT_EDGES: PartId = 12;

const ROOT: AssemblyId = 1;
const PLATE_STACK: AssemblyId = 2;
const FASTENERS: AssemblyId = 3;
const FASTENER_BASE: AssemblyId = 4;
const WASHER_BASE: AssemblyId = 12;

const COMPONENT_PARTS: BoltedPlateParts = {
  plate: { solid: PLATE_SOLID, surface: PLATE_SURFACE, edges: PLATE_EDGES },
  bolt: { solid: BOLT_SOLID, surface: BOLT_SURFACE, edges: BOLT_EDGES },
  washer: { solid: WASHER_SOLID, surface: WASHER_SURFACE, edges: WASHER_EDGES },
  nut: { solid: NUT_SOLID, surface: NUT_SURFACE, edges: NUT_EDGES },
};

/**
 * Builds the bolted lap-joint fixture. Defaults produce two 30 x 14 x 2 m
 * plates overlapping by 24 m, clamped by 8 fasteners (2 rows x 4 columns)
 * where every fastener reuses shared bolt, washer, and nut parts.
 */
export function createBoltedPlateFixture(options: BoltedPlateOptions = {}): BoltedPlateFixture {
  const plateLength = options.plateLength ?? DEFAULT_PLATE_LENGTH;
  const plateWidth = options.plateWidth ?? DEFAULT_PLATE_WIDTH;
  const plateThickness = options.plateThickness ?? DEFAULT_PLATE_THICKNESS;
  const overlapOffset = options.overlapOffset ?? DEFAULT_OVERLAP_OFFSET;
  validateBoltedPlateOptions({ plateLength, plateWidth, plateThickness, overlapOffset });

  const models = {
    plate: createPlateModel(plateLength, plateWidth, plateThickness),
    bolt: createBoltModel(),
    washer: createWasherModel(),
    nut: createNutModel(),
  };
  const parts: readonly Part[] = componentParts(COMPONENT_PARTS, models);
  const positions = fastenerPositions();
  const modePartIds = new Map<ElementRenderMode, readonly PartId[]>([
    ["solid", [PLATE_SOLID, BOLT_SOLID, WASHER_SOLID, NUT_SOLID]],
    ["surface", [PLATE_SURFACE, BOLT_SURFACE, WASHER_SURFACE, NUT_SURFACE]],
    ["edges", [PLATE_EDGES, BOLT_EDGES, WASHER_EDGES, NUT_EDGES]],
  ]);

  const washerAssemblies = positions.map((_, index) => washersAssembly(WASHER_BASE + index));
  const fastenerAssemblies = positions.map((_, index) =>
    fastenerAssembly(FASTENER_BASE + index, WASHER_BASE + index),
  );
  const plateStack = plateStackAssembly(plateThickness, overlapOffset);
  const fasteners = fastenersGroup(positions);
  const root = rootAssembly(plateStack.id, fasteners.id);
  const scene = buildScene(parts, [
    plateStack,
    fasteners,
    ...fastenerAssemblies,
    ...washerAssemblies,
    root,
  ]);

  return {
    scene,
    dimensions: {
      plateLength,
      plateWidth,
      plateThickness,
      overlapOffset,
      fastenerRows: [...FASTENER_ROWS],
      fastenerColumns: [...FASTENER_COLUMNS],
    },
    partIds: COMPONENT_PARTS,
    assemblyIds: {
      root: root.id,
      plateStack: plateStack.id,
      fasteners: fasteners.id,
      fastener: fastenerAssemblies.map((assembly) => assembly.id),
      washers: washerAssemblies.map((assembly) => assembly.id),
    },
    elementModels: componentModels(COMPONENT_PARTS, models),
    modePartIds,
    defaultMode: "solid",
    instanceCount: 6 + positions.length * 12,
    visibleInstanceCount: 2 + positions.length * 4,
  };
}

function validateBoltedPlateOptions(options: {
  readonly plateLength: number;
  readonly plateWidth: number;
  readonly plateThickness: number;
  readonly overlapOffset: number;
}): void {
  for (const [name, value] of Object.entries(options)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive finite number`);
    }
  }
}

function componentParts(
  parts: BoltedPlateParts,
  models: { readonly [K in keyof BoltedPlateParts]: ElementModel },
): readonly Part[] {
  const build = (component: BoltedPlateComponentParts, model: ElementModel): readonly Part[] => [
    elementPart(component.solid, model, "hex", "solid"),
    elementPart(component.surface, model, "hex", "surface"),
    elementPart(component.edges, model, "hex", "edges"),
  ];
  return [
    ...build(parts.plate, models.plate),
    ...build(parts.bolt, models.bolt),
    ...build(parts.washer, models.washer),
    ...build(parts.nut, models.nut),
  ];
}

function componentModels(
  parts: BoltedPlateParts,
  models: { readonly [K in keyof BoltedPlateParts]: ElementModel },
): ReadonlyMap<PartId, ElementModel> {
  return new Map<PartId, ElementModel>([
    [parts.plate.solid, models.plate],
    [parts.plate.surface, models.plate],
    [parts.plate.edges, models.plate],
    [parts.bolt.solid, models.bolt],
    [parts.bolt.surface, models.bolt],
    [parts.bolt.edges, models.bolt],
    [parts.washer.solid, models.washer],
    [parts.washer.surface, models.washer],
    [parts.washer.edges, models.washer],
    [parts.nut.solid, models.nut],
    [parts.nut.surface, models.nut],
    [parts.nut.edges, models.nut],
  ]);
}

/** The solid, surface, and edges placements of one part at a transform. */
function modePlacements(
  component: BoltedPlateComponentParts,
  transform: Mat4,
): readonly Placement[] {
  return [
    { kind: "part", partId: component.solid, transform },
    { kind: "part", partId: component.surface, transform },
    { kind: "part", partId: component.edges, transform },
  ];
}

function plateStackAssembly(plateThickness: number, overlapOffset: number) {
  return {
    id: PLATE_STACK,
    name: "Plate stack",
    placements: [
      ...modePlacements(COMPONENT_PARTS.plate, identity()),
      ...modePlacements(COMPONENT_PARTS.plate, translation(overlapOffset, plateThickness, 0)),
    ],
  };
}

function fastenerAssembly(id: AssemblyId, washersId: AssemblyId) {
  return {
    id,
    name: `Fastener ${id - FASTENER_BASE + 1}`,
    placements: [
      ...modePlacements(COMPONENT_PARTS.bolt, identity()),
      { kind: "assembly" as const, assemblyId: washersId, transform: identity() },
      ...modePlacements(COMPONENT_PARTS.nut, translation(0, NUT_Y, 0)),
    ],
  };
}

function washersAssembly(id: AssemblyId) {
  return {
    id,
    name: "Washers",
    placements: [
      ...modePlacements(COMPONENT_PARTS.washer, translation(0, TOP_WASHER_Y, 0)),
      ...modePlacements(COMPONENT_PARTS.washer, translation(0, BOTTOM_WASHER_Y, 0)),
    ],
  };
}

function fastenersGroup(positions: ReadonlyArray<{ readonly x: number; readonly z: number }>) {
  return {
    id: FASTENERS,
    name: "Fasteners",
    placements: positions.map((position, index) => ({
      kind: "assembly" as const,
      assemblyId: FASTENER_BASE + index,
      transform: translation(position.x, 0, position.z),
    })),
  };
}

function rootAssembly(plateStackId: AssemblyId, fastenersId: AssemblyId) {
  return {
    id: ROOT,
    name: "Bolted joint",
    placements: [
      { kind: "assembly" as const, assemblyId: plateStackId, transform: identity() },
      { kind: "assembly" as const, assemblyId: fastenersId, transform: identity() },
    ],
  };
}

function buildScene(parts: readonly Part[], assemblies: readonly NamedAssembly[]): Scene {
  let builder = createScene();
  for (const part of parts) {
    builder = builder.addPart(part);
  }
  for (const assembly of assemblies) {
    builder = builder.addAssembly(assembly);
  }
  return builder.withRoot(ROOT).build();
}

function fastenerPositions(): ReadonlyArray<{ readonly x: number; readonly z: number }> {
  return FASTENER_ROWS.flatMap((x) => FASTENER_COLUMNS.map((z) => ({ x, z })));
}
