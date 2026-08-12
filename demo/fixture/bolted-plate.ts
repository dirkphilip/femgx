import {
  createScene,
  heterogeneousElementParts,
  identity,
  translation,
  type AssemblyId,
  type Body,
  type ElementModel,
  type Mat4,
  type NamedAssembly,
  type Part,
  type PartId,
  type Placement,
  type Scene,
} from "../../src/index";
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

/** The canonical triangle part id of one reusable component. */
export interface BoltedPlateComponentParts {
  readonly partId: PartId;
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
  /** The reusable fastener definition placed at every grid position. */
  readonly fastener: AssemblyId;
  /** The reusable washer-pair definition nested by the fastener. */
  readonly washers: AssemblyId;
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
  /** Total part placements in the canonical assembly graph. */
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
const FASTENER_CLEARANCE = 0.05;
const WASHER_HALF_THICKNESS = 0.125;
const NUT_HALF_HEIGHT = 0.5;

const PLATE_PART_ID: PartId = 1;
const BOLT_PART_ID: PartId = 4;
const WASHER_PART_ID: PartId = 7;
const NUT_PART_ID: PartId = 10;

const ROOT: AssemblyId = 1;
const PLATE_STACK: AssemblyId = 2;
const FASTENERS: AssemblyId = 3;
const FASTENER: AssemblyId = 4;
const WASHERS: AssemblyId = 5;

const COMPONENT_PARTS: BoltedPlateParts = {
  plate: { partId: PLATE_PART_ID },
  bolt: { partId: BOLT_PART_ID },
  washer: { partId: WASHER_PART_ID },
  nut: { partId: NUT_PART_ID },
};

const COMPONENT_BODY_NAMES: { readonly [K in keyof BoltedPlateParts]: readonly string[] } = {
  plate: ["Plate row A", "Plate row B"],
  bolt: ["Shaft", "Head"],
  washer: ["Washer"],
  nut: ["Nut"],
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

  const heights = fastenerHeights(plateThickness);
  const models = {
    plate: createPlateModel(plateLength, plateWidth, plateThickness),
    bolt: createBoltModel(heights.boltHeadBase),
    washer: createWasherModel(),
    nut: createNutModel(),
  };
  const parts: readonly Part[] = componentParts(COMPONENT_PARTS, models);
  const positions = fastenerPositions();
  const washers = washersAssembly(heights);
  const fastener = fastenerAssembly(heights.nut);
  const plateStack = plateStackAssembly(plateThickness, overlapOffset);
  const fasteners = fastenersGroup(positions);
  const root = rootAssembly(plateStack.id, fasteners.id);
  const scene = buildScene(parts, [plateStack, fasteners, fastener, washers, root]);

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
      fastener: fastener.id,
      washers: washers.id,
    },
    elementModels: componentModels(COMPONENT_PARTS, models),
    instanceCount: 2 + positions.length * 4,
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
  const build = (
    component: BoltedPlateComponentParts,
    model: ElementModel,
    bodyNames: readonly string[],
  ): readonly Part[] => {
    const bodies = bodyGroups(model, bodyNames);
    const part = heterogeneousElementParts({ triangle: component.partId }, model, {
      bodies,
    }).triangle;
    if (part === undefined) throw new Error("Bolted plate component has no triangle part");
    return [part];
  };
  return [
    ...build(parts.plate, models.plate, COMPONENT_BODY_NAMES.plate),
    ...build(parts.bolt, models.bolt, COMPONENT_BODY_NAMES.bolt),
    ...build(parts.washer, models.washer, COMPONENT_BODY_NAMES.washer),
    ...build(parts.nut, models.nut, COMPONENT_BODY_NAMES.nut),
  ];
}

function bodyGroups(model: ElementModel, names: readonly string[]): readonly Body[] {
  if (names.length === 0 || names.length > model.elements.length) {
    throw new Error("A bolted fixture body group must contain at least one element per name");
  }
  return names.map((name, index) => {
    const start = Math.floor((index * model.elements.length) / names.length);
    const end = Math.floor(((index + 1) * model.elements.length) / names.length);
    return {
      id: index + 1,
      name,
      elementIds: model.elements.slice(start, end).map((element) => element.id),
    };
  });
}

function componentModels(
  parts: BoltedPlateParts,
  models: { readonly [K in keyof BoltedPlateParts]: ElementModel },
): ReadonlyMap<PartId, ElementModel> {
  return new Map<PartId, ElementModel>([
    [parts.plate.partId, models.plate],
    [parts.bolt.partId, models.bolt],
    [parts.washer.partId, models.washer],
    [parts.nut.partId, models.nut],
  ]);
}

/** Places one canonical component part at a transform. */
function modePlacements(
  component: BoltedPlateComponentParts,
  transform: Mat4,
): readonly Placement[] {
  return [{ kind: "part", partId: component.partId, transform }];
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

function fastenerAssembly(nutY: number) {
  return {
    id: FASTENER,
    name: "Fastener",
    placements: [
      ...modePlacements(COMPONENT_PARTS.bolt, identity()),
      { kind: "assembly" as const, assemblyId: WASHERS, transform: identity() },
      ...modePlacements(COMPONENT_PARTS.nut, translation(0, nutY, 0)),
    ],
  };
}

function washersAssembly(heights: FastenerHeights) {
  return {
    id: WASHERS,
    name: "Washers",
    placements: [
      ...modePlacements(COMPONENT_PARTS.washer, translation(0, heights.topWasher, 0)),
      ...modePlacements(COMPONENT_PARTS.washer, translation(0, heights.bottomWasher, 0)),
    ],
  };
}

interface FastenerHeights {
  readonly topWasher: number;
  readonly bottomWasher: number;
  readonly boltHeadBase: number;
  readonly nut: number;
}

function fastenerHeights(plateThickness: number): FastenerHeights {
  const topWasher = plateThickness * 1.5 + WASHER_HALF_THICKNESS + FASTENER_CLEARANCE;
  const bottomWasher = -plateThickness * 0.5 - WASHER_HALF_THICKNESS - FASTENER_CLEARANCE;
  return {
    topWasher,
    bottomWasher,
    boltHeadBase: topWasher + WASHER_HALF_THICKNESS + FASTENER_CLEARANCE,
    nut: bottomWasher - WASHER_HALF_THICKNESS - NUT_HALF_HEIGHT - FASTENER_CLEARANCE,
  };
}

function fastenersGroup(positions: ReadonlyArray<{ readonly x: number; readonly z: number }>) {
  return {
    id: FASTENERS,
    name: "Fasteners",
    placements: positions.map((position) => ({
      kind: "assembly" as const,
      assemblyId: FASTENER,
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
