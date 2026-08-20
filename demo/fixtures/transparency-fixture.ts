import {
  createSceneBuilder,
  identityMatrix,
  translationMatrix,
  type AssemblyId,
  type Part,
  type PartId,
  type Scene,
} from "@/entries/root";
import { createPartFromElementModel, type ElementModel } from "@/entries/model";
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
  return {
    scene: transparencyScene(parts),
    partIds: { shell: SHELL_PART_ID, interior: INTERIOR_PART_ID, overlap: OVERLAP_PART_ID },
    elementModels: new Map([
      [SHELL_PART_ID, shellModel],
      [INTERIOR_PART_ID, interiorModel],
      [OVERLAP_PART_ID, overlapModel],
    ]),
  };
}

function trianglePart(id: PartId, model: ElementModel): Part {
  return createPartFromElementModel(id, model);
}

function transparencyScene(parts: readonly Part[]): Scene {
  let builder = createSceneBuilder();
  for (const part of parts) builder = builder.addPart(part);
  const root = {
    id: ROOT_ASSEMBLY_ID,
    name: "transparency-fixture",
    placements: [
      {
        kind: "part" as const,
        partId: INTERIOR_PART_ID,
        transform: translationMatrix(0.5, 0.5, 0.5),
      },
      { kind: "part" as const, partId: SHELL_PART_ID, transform: identityMatrix() },
      {
        kind: "part" as const,
        partId: OVERLAP_PART_ID,
        transform: translationMatrix(0.25, 0.25, 0.25),
      },
      {
        kind: "part" as const,
        partId: OVERLAP_PART_ID,
        transform: translationMatrix(0.4, 0.4, 0.4),
      },
    ],
  };
  return builder.addAssembly(root).setRootAssembly(root.id).build();
}
