import {
  createScene,
  heterogeneousElementParts,
  identity,
  translation,
  type AssemblyId,
  type Bounds,
  type ElementModel,
  type Part,
  type PartId,
  type Scene,
} from "../../src/index";
import type { ElementDisplayMode } from "./types";
import { buildHexModel } from "./element-models";

/** Stable geometry identities for the order-independent transparency fixture. */
export interface TransparencyFixtureParts {
  readonly shell: PartId;
  readonly interior: PartId;
  readonly overlap: PartId;
}

/** Small scene containing opaque interior geometry and overlapping transparent placements. */
export interface TransparencyFixture {
  readonly scene: Scene;
  readonly partIds: TransparencyFixtureParts;
  readonly elementModels: ReadonlyMap<PartId, ElementModel>;
  readonly modePartIds: ReadonlyMap<ElementDisplayMode, readonly PartId[]>;
  readonly overlayPartIds: readonly PartId[];
  readonly defaultMode: ElementDisplayMode;
  readonly bounds: Bounds;
  readonly instanceCount: number;
}

const ROOT_ASSEMBLY_ID: AssemblyId = 31;
const SHELL_PART_ID: PartId = 31;
const INTERIOR_PART_ID: PartId = 32;
const OVERLAP_PART_ID: PartId = 33;

/** Builds the deterministic shell/interior/overlap scene used by renderer e2e coverage. */
export function createTransparencyFixture(): TransparencyFixture {
  const shellModel = buildHexModel(1, 2, false);
  const interiorModel = buildHexModel(1, 1, false);
  const overlapModel = buildHexModel(1, 1.5, false);
  const parts = [
    trianglePart(SHELL_PART_ID, shellModel),
    trianglePart(INTERIOR_PART_ID, interiorModel),
    trianglePart(OVERLAP_PART_ID, overlapModel),
  ];
  const visibleParts = [SHELL_PART_ID, INTERIOR_PART_ID, OVERLAP_PART_ID];
  return {
    scene: transparencyScene(parts),
    partIds: { shell: SHELL_PART_ID, interior: INTERIOR_PART_ID, overlap: OVERLAP_PART_ID },
    elementModels: new Map([
      [SHELL_PART_ID, shellModel],
      [INTERIOR_PART_ID, interiorModel],
      [OVERLAP_PART_ID, overlapModel],
    ]),
    modePartIds: new Map<ElementDisplayMode, readonly PartId[]>([
      ["solid", visibleParts],
      ["surface", visibleParts],
      ["edges", visibleParts],
    ]),
    overlayPartIds: [],
    defaultMode: "solid",
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 2, maxZ: 2 },
    instanceCount: 4,
  };
}

function trianglePart(id: PartId, model: ElementModel): Part {
  const part = heterogeneousElementParts({ triangle: id }, model).triangle;
  if (part === undefined) throw new Error(`Transparency fixture has no triangle part ${id}`);
  return part;
}

function transparencyScene(parts: readonly Part[]): Scene {
  let builder = createScene();
  for (const part of parts) builder = builder.addPart(part);
  const root = {
    id: ROOT_ASSEMBLY_ID,
    name: "transparency-fixture",
    placements: [
      { kind: "part" as const, partId: INTERIOR_PART_ID, transform: translation(0.5, 0.5, 0.5) },
      { kind: "part" as const, partId: SHELL_PART_ID, transform: identity() },
      {
        kind: "part" as const,
        partId: OVERLAP_PART_ID,
        transform: translation(0.25, 0.25, 0.25),
      },
      {
        kind: "part" as const,
        partId: OVERLAP_PART_ID,
        transform: translation(0.4, 0.4, 0.4),
      },
    ],
  };
  return builder.addAssembly(root).withRoot(root.id).build();
}
