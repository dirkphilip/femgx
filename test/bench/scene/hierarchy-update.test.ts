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

const CHANGE_COUNTS = [1, 1_000, 100_000] as const;
const UNRELATED_OCCURRENCES = 100_000;

interface HierarchyRow {
  readonly shape: "subtree" | "repeated-owner";
  readonly unrelatedOccurrences: number;
  readonly requestedChanges: number;
  readonly changedOwners: number;
  readonly changedLeaves: number;
  readonly activeLeaves: number;
  readonly elapsedMs: number;
}

describe("incremental hierarchy update scaling", () => {
  it("measures changed subtree size independently from 100k unrelated leaves", () => {
    const rows = CHANGE_COUNTS.map((count) => measureSubtree(count));
    expect(rows.map(({ changedOwners }) => changedOwners)).toEqual([1, 1, 1]);
    expect(rows.map(({ changedLeaves }) => changedLeaves)).toEqual(CHANGE_COUNTS);
    emit(rows);
  }, 300_000);

  it("measures repeated definition owners independently from 100k unrelated leaves", () => {
    const rows = CHANGE_COUNTS.map((count) => measureRepeatedOwners(count));
    expect(rows.map(({ changedOwners }) => changedOwners)).toEqual(CHANGE_COUNTS);
    expect(rows.map(({ changedLeaves }) => changedLeaves)).toEqual(CHANGE_COUNTS);
    emit(rows);
  }, 300_000);
});

function measureSubtree(changedLeaves: number): HierarchyRow {
  return measure(subtreeScene(changedLeaves), "subtree", changedLeaves, (update) => {
    update.addPlacement(2, {
      kind: "assembly",
      placementId: "nested",
      assemblyId: 3,
      transform: identityMatrix(),
    });
  });
}

function measureRepeatedOwners(ownerCount: number): HierarchyRow {
  return measure(repeatedOwnerScene(ownerCount), "repeated-owner", ownerCount, (update) => {
    update.addPlacement(2, {
      kind: "part",
      placementId: "leaf",
      partId: 2,
      transform: identityMatrix(),
    });
  });
}

function measure(
  scene: Scene,
  shape: HierarchyRow["shape"],
  requestedChanges: number,
  operation: Parameters<typeof prepareSceneTransition>[1],
): HierarchyRow {
  const runtime = createPackedSceneRuntime(scene);
  const transition = prepareSceneTransition(scene, operation);
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
  return {
    shape,
    unrelatedOccurrences: UNRELATED_OCCURRENCES,
    requestedChanges,
    changedOwners: prepared.owners.length,
    changedLeaves: delta.slots.length,
    activeLeaves: runtime.activeInstanceCount,
    elapsedMs: performance.now() - started,
  };
}

function subtreeScene(changedLeaves: number): Scene {
  return buildScene(
    1,
    [
      { id: 1, placements: [...unrelatedPlacements(), assemblyPlacement("changed", 2)] },
      { id: 2, placements: [] },
      { id: 3, placements: leafPlacements("changed-leaf", changedLeaves) },
    ],
    [1, 2],
  );
}

function repeatedOwnerScene(ownerCount: number): Scene {
  const owners = Array.from({ length: ownerCount }, (_, index) =>
    assemblyPlacement(`owner-${index}`, 2),
  );
  return buildScene(
    1,
    [
      { id: 1, placements: [...unrelatedPlacements(), ...owners] },
      { id: 2, placements: [] },
    ],
    [1, 2],
  );
}

function unrelatedPlacements(): Placement[] {
  return leafPlacements("unrelated", UNRELATED_OCCURRENCES, 1);
}

function leafPlacements(prefix: string, count: number, partId = 2): Placement[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "part" as const,
    placementId: `${prefix}-${index}`,
    partId,
    transform: identityMatrix(),
  }));
}

function assemblyPlacement(placementId: string, assemblyId: number): Placement {
  return { kind: "assembly", placementId, assemblyId, transform: identityMatrix() };
}

function emit(rows: readonly HierarchyRow[]): void {
  console.log(JSON.stringify({ schemaVersion: 3, rows }, undefined, 2));
}
