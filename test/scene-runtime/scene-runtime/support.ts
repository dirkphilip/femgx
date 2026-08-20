import type { AssemblyDefinition, Placement } from "../../../src/scene/assembly";

import { identityMatrix, translationMatrix } from "../../../src/math/mat4";

import { createPart, MAX_PART_ID, type Part } from "../../../src/geometry/part";

import { createSceneBuilder, type Scene } from "../../../src/scene/scene";

import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import { emptyPart } from "../../support/scene-fixtures";
export { emptyPart as part };

/** Shared core test helper. */
export function buildScene(
  rootAssemblyId: number,
  assemblies: readonly AssemblyDefinition[],
  parts: readonly number[],
  hiddenPartIds: readonly number[] = [],
  hiddenAssemblyIds: readonly number[] = [],
): Scene {
  let builder = createSceneBuilder();
  for (const id of parts) {
    builder = builder.addPart(emptyPart(id));
  }
  for (const assembly of assemblies) {
    builder = builder.addAssembly({
      id: assembly.id,
      name: `assembly-${assembly.id}`,
      placements: assembly.placements,
    });
  }
  for (const id of hiddenPartIds) {
    builder = builder.setPartVisible(id, false);
  }
  for (const id of hiddenAssemblyIds) {
    builder = builder.setAssemblyVisible(id, false);
  }
  return builder.setRootAssembly(rootAssemblyId).build();
}

/** Shared core test helper. */
export function structuralScene(overrides: Partial<Scene> = {}): Scene {
  return {
    rootAssemblyId: 1,
    parts: new Map([[1, emptyPart(1)]]),
    assemblies: new Map([
      [1, { id: 1, placements: [{ kind: "part", partId: 1, transform: identityMatrix() }] }],
    ]),
    visiblePartIds: new Set([1]),
    visibleAssemblyIds: new Set([1]),
    ...overrides,
  };
}

/** Shared core test helper. */
export function sceneWithPlacement(placement: Placement): Scene {
  return structuralScene({
    assemblies: new Map([[1, { id: 1, placements: [placement] }]]),
  });
}

export {
  type AssemblyDefinition,
  type Placement,
  identityMatrix,
  translationMatrix,
  createPart,
  MAX_PART_ID,
  type Part,
  createSceneBuilder,
  type Scene,
  createPackedSceneRuntime,
};
