import {
  createElement,
  createElementModel,
  createPartFromElementModel,
  ElementShape,
  type ElementModel,
} from "femgx/model";
import {
  createSceneBuilder,
  identityMatrix,
  type AssemblyId,
  type Part,
  type PartId,
  type Scene,
} from "femgx";

/** Stable identities used by the repository-owned Tet4 fixture. */
export const TET4_FIXTURE_IDS = {
  assemblyId: 1 satisfies AssemblyId,
  bodyId: 1,
  elementIds: [101, 102],
  nodeIds: [10, 11, 12, 13, 14],
  partId: 4 satisfies PartId,
  placementId: "tet4-fixture-placement",
} as const;

/** CPU-only values shared by applications and focused tests. */
export interface Tet4Fixture {
  readonly elementModel: ElementModel;
  readonly part: Part;
  readonly scene: Scene;
}

/**
 * Builds the fixed two-element Tet4 fixture.
 *
 * The elements share the face formed by nodes 10, 11, and 12. No dimensions,
 * counts, or generation options are accepted so this remains authored data,
 * not a mesh-building API.
 */
export function createTet4Fixture(): Tet4Fixture {
  const elementModel = createTet4ElementModel();
  const part = createPartFromElementModel(TET4_FIXTURE_IDS.partId, elementModel);
  const scene = createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: TET4_FIXTURE_IDS.assemblyId,
      name: "Tet4 fixture assembly",
      placements: [
        {
          kind: "part",
          placementId: TET4_FIXTURE_IDS.placementId,
          partId: TET4_FIXTURE_IDS.partId,
          transform: identityMatrix(),
        },
      ],
    })
    .setRootAssembly(TET4_FIXTURE_IDS.assemblyId)
    .build();
  return { elementModel, part, scene };
}

function createTet4ElementModel(): ElementModel {
  return createElementModel(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1],
    [
      createElement(101, ElementShape.Tet4, [10, 11, 12, 13]),
      createElement(102, ElementShape.Tet4, [12, 11, 10, 14]),
    ],
    {
      nodeIds: TET4_FIXTURE_IDS.nodeIds,
      bodies: [{ id: TET4_FIXTURE_IDS.bodyId, name: "Tet4 fixture body", elementIds: [101, 102] }],
    },
  );
}
