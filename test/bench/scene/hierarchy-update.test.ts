import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  applyHierarchyMutations,
  prepareHierarchyMutations,
} from "@/scene-runtime/hierarchy-update";
import { prepareSceneTransition } from "@/scene/update";
import {
  buildScene,
  createPackedSceneRuntime,
  identityMatrix,
  type Placement,
  type Scene,
} from "../../scene-runtime/scene-runtime/support";

const UNRELATED_OCCURRENCE_COUNTS = [1_000, 10_000, 100_000] as const;

interface HierarchyRow {
  readonly unrelatedOccurrences: number;
  readonly changedOwners: number;
  readonly changedLeaves: number;
  readonly activeLeaves: number;
  readonly activeAssemblyNodes: number;
  readonly elapsedMs: number;
}

describe("incremental hierarchy update scaling", () => {
  it("limits a nested assembly addition to the expanded changed subtree", () => {
    const rows = UNRELATED_OCCURRENCE_COUNTS.map(measureHierarchyAddition);
    expect(rows.map(({ changedOwners }) => changedOwners)).toEqual([1, 1, 1]);
    expect(rows.map(({ changedLeaves }) => changedLeaves)).toEqual([1, 1, 1]);
    console.log(JSON.stringify({ schemaVersion: 2, rows }, undefined, 2));
  }, 300_000);
});

function measureHierarchyAddition(unrelatedOccurrences: number): HierarchyRow {
  const scene = hierarchyScene(unrelatedOccurrences);
  const runtime = createPackedSceneRuntime(scene);
  const transition = prepareSceneTransition(scene, (update) => {
    update.addPlacement(2, {
      kind: "assembly",
      placementId: "nested",
      assemblyId: 3,
      transform: identityMatrix(),
    });
  });
  if (transition === undefined) throw new Error("expected hierarchy transition");
  const started = performance.now();
  const prepared = prepareHierarchyMutations(runtime, scene, transition.scene, transition.changes);
  if (prepared === undefined) throw new Error("expected prepared hierarchy update");
  const delta = applyHierarchyMutations(
    runtime,
    transition.scene,
    prepared,
    (_part, visible) => visible,
    (_assembly, visible) => visible,
  );
  const elapsedMs = performance.now() - started;
  expect(runtime.getInstanceSlot(`1/unrelated-${unrelatedOccurrences - 1}`)).toBe(
    unrelatedOccurrences - 1,
  );
  expect(runtime.getInstanceSlot("1/changed/nested/leaf")).toBeDefined();
  return {
    unrelatedOccurrences,
    changedOwners: prepared.owners.length,
    changedLeaves: delta.slots.length,
    activeLeaves: runtime.activeInstanceCount,
    activeAssemblyNodes: runtime.activeNodeCount,
    elapsedMs,
  };
}

function hierarchyScene(unrelatedOccurrences: number): Scene {
  const placements: Placement[] = Array.from({ length: unrelatedOccurrences }, (_, index) => ({
    kind: "part" as const,
    placementId: `unrelated-${index}`,
    partId: 1,
    transform: identityMatrix(),
  }));
  placements.push({
    kind: "assembly",
    placementId: "changed",
    assemblyId: 2,
    transform: identityMatrix(),
  });
  return buildScene(
    1,
    [
      { id: 1, placements },
      { id: 2, placements: [] },
      {
        id: 3,
        placements: [{ kind: "part", placementId: "leaf", partId: 2, transform: identityMatrix() }],
      },
    ],
    [1, 2],
  );
}
