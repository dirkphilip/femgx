import type { Assembly, Placement } from "../../../src/scene/assembly";

import { identity, translation } from "../../../src/math/mat4";

import { createPart, MAX_PART_ID, type Part } from "../../../src/geometry/part";

import { createScene, type Scene } from "../../../src/scene/scene";

import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";

/** Shared core test helper. */
export function part(id: number): Part {
  const geometry = {
    positions: new Float32Array([0, 0, 0]),
    indices: new Uint32Array(),
    primitive: "triangles" as const,
  };
  return createPart(id, { geometries: [geometry] });
}

/** Shared core test helper. */
export function buildScene(
  rootAssemblyId: number,
  assemblies: readonly Assembly[],
  parts: readonly number[],
  hiddenPartIds: readonly number[] = [],
  hiddenAssemblyIds: readonly number[] = [],
): Scene {
  let builder = createScene();
  for (const id of parts) {
    builder = builder.addPart(part(id));
  }
  for (const assembly of assemblies) {
    builder = builder.addAssembly({
      id: assembly.id,
      name: `assembly-${assembly.id}`,
      placements: assembly.placements,
    });
  }
  for (const id of hiddenPartIds) {
    builder = builder.hidePart(id);
  }
  for (const id of hiddenAssemblyIds) {
    builder = builder.hideAssembly(id);
  }
  return builder.withRoot(rootAssemblyId).build();
}

/** Shared core test helper. */
export function structuralScene(overrides: Partial<Scene> = {}): Scene {
  return {
    rootAssemblyId: 1,
    parts: new Map([[1, part(1)]]),
    assemblies: new Map([
      [1, { id: 1, placements: [{ kind: "part", partId: 1, transform: identity() }] }],
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
  type Assembly,
  type Placement,
  identity,
  translation,
  createPart,
  MAX_PART_ID,
  type Part,
  createScene,
  type Scene,
  createPackedSceneRuntime,
};
