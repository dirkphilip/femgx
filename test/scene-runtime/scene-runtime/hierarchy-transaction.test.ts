import { describe, expect, it } from "vitest";
import {
  applyHierarchyMutations,
  prepareHierarchyMutations,
} from "@/scene-runtime/hierarchy-update";
import { createSceneOccurrences } from "@/scene-runtime/occurrences";
import type { PackedSceneRuntime } from "@/scene-runtime/runtime";
import { prepareSceneTransition } from "@/scene/update";
import { buildScene, createPackedSceneRuntime, identityMatrix, translationMatrix } from "./support";

const HISTORICAL_HOLES = 4_096;

describe("assembly hierarchy transactions", () => {
  it("rolls back a provisional mixed hierarchy update to the exact prior runtime", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", placementId: "keep", partId: 1, transform: identityMatrix() },
            { kind: "assembly", placementId: "child", assemblyId: 2, transform: identityMatrix() },
          ],
        },
        {
          id: 2,
          placements: [
            { kind: "part", placementId: "nested", partId: 2, transform: identityMatrix() },
          ],
        },
      ],
      [1, 2],
    );
    const runtime = createPackedSceneRuntime(scene);
    const occurrences = createSceneOccurrences(() => runtime);
    const beforeParts = [...occurrences.partOccurrences()].map((item) => item.partOccurrenceId);
    const beforeNodes = [...occurrences.assemblyOccurrences()].map(
      (item) => item.assemblyOccurrenceId,
    );
    const keep = runtime.getInstanceSlot("1/keep");
    if (keep === undefined) throw new Error("fixture is incomplete");
    runtime.setInstanceVisible(keep, false);
    const beforeInstanceCapacity = runtime.instanceCapacity;
    const beforeNodeCapacity = runtime.nodeCapacity;
    const beforeInstanceFreeSlots = [...runtime.instanceFreeSlots];
    const beforeNodeFreeSlots = [...runtime.nodeFreeSlots];
    const transition = prepareSceneTransition(scene, (update) => {
      update.removePlacement(1, "child");
      update.addPlacement(1, {
        kind: "part",
        placementId: "added",
        partId: 2,
        transform: translationMatrix(8, 0, 0),
      });
      update.addPlacement(1, {
        kind: "part",
        placementId: "added-2",
        partId: 2,
        transform: translationMatrix(9, 0, 0),
      });
      update.addPlacement(1, {
        kind: "part",
        placementId: "added-3",
        partId: 2,
        transform: translationMatrix(10, 0, 0),
      });
    });
    if (transition === undefined) throw new Error("expected hierarchy transition");
    const prepared = prepareHierarchyMutations(
      runtime,
      scene,
      transition.scene,
      transition.changes,
    );
    if (prepared === undefined) throw new Error("expected hierarchy mutations");
    const transaction = runtime.beginHierarchyTransaction();

    applyHierarchyMutations(
      runtime,
      transition.scene,
      prepared,
      (_part, value) => value,
      (_assembly, value) => value,
    );
    expect(runtime.getInstanceSlot("1/added")).toBeDefined();
    transaction.rollback();

    expect([...occurrences.partOccurrences()].map((item) => item.partOccurrenceId)).toEqual(
      beforeParts,
    );
    expect([...occurrences.assemblyOccurrences()].map((item) => item.assemblyOccurrenceId)).toEqual(
      beforeNodes,
    );
    expect(runtime.getInstanceSlot("1/added")).toBeUndefined();
    expect(runtime.getInstanceSlot("1/child/nested")).toBeDefined();
    expect(runtime.instanceOverrideVisible[keep]).toBe(0);
    expect(runtime.instanceCapacity).toBe(beforeInstanceCapacity);
    expect(runtime.nodeCapacity).toBe(beforeNodeCapacity);
    expect(runtime.instanceFreeSlots).toEqual(beforeInstanceFreeSlots);
    expect(runtime.nodeFreeSlots).toEqual(beforeNodeFreeSlots);
  });

  it("reuses one historical free slot in LIFO order without scanning either free list", () => {
    for (const fixture of historicalFreeListFixtures()) {
      const before = [...fixture.freeSlots];
      const accesses = trackFreeList(fixture.runtime, fixture.name);
      const transaction = fixture.runtime.beginHierarchyTransaction();

      expect(fixture.add()).toBe(before.at(-1));
      transaction.commit();
      const counts = accesses.finish();

      expect(fixture.freeSlots).toEqual(before.slice(0, -1));
      expect(fixture.isAdded()).toBe(true);
      expect(counts).toEqual({ iterations: 0, pops: 1, pushes: 0, splices: 0 });
    }
  });

  it("restores one historical free slot in exact LIFO order after an injected failure", () => {
    for (const fixture of historicalFreeListFixtures()) {
      const before = [...fixture.freeSlots];
      const accesses = trackFreeList(fixture.runtime, fixture.name);
      const transaction = fixture.runtime.beginHierarchyTransaction();

      expect(() => {
        fixture.add();
        throw new Error("injected hierarchy preparation failure");
      }).toThrow("injected hierarchy preparation failure");
      transaction.rollback();
      const counts = accesses.finish();

      expect(fixture.freeSlots).toEqual(before);
      expect(fixture.isAdded()).toBe(false);
      expect(counts).toEqual({ iterations: 0, pops: 1, pushes: 1, splices: 0 });
    }
  });
});

interface HistoricalFreeListFixture {
  readonly name: "instanceFreeSlots" | "nodeFreeSlots";
  readonly runtime: PackedSceneRuntime;
  readonly freeSlots: number[];
  readonly add: () => number;
  readonly isAdded: () => boolean;
}

function historicalFreeListFixtures(): readonly HistoricalFreeListFixture[] {
  return [historicalInstanceFreeList(), historicalNodeFreeList()];
}

function historicalInstanceFreeList(): HistoricalFreeListFixture {
  const placements = Array.from({ length: HISTORICAL_HOLES + 1 }, (_, index) => ({
    kind: "part" as const,
    placementId: index === 0 ? "keep" : `historical-${index}`,
    partId: 1,
    transform: identityMatrix(),
  }));
  const runtime = createPackedSceneRuntime(buildScene(1, [{ id: 1, placements }], [1]));
  runtime.removeInstances(Array.from({ length: HISTORICAL_HOLES }, (_, index) => index + 1));
  return {
    name: "instanceFreeSlots",
    runtime,
    freeSlots: runtime.instanceFreeSlots,
    add: () =>
      runtime.addInstances([
        {
          instanceId: "1/added",
          partId: 1,
          owningNode: 0,
          partVisible: true,
          overrideVisible: true,
          worldTransform: identityMatrix(),
        },
      ])[0] ?? -1,
    isAdded: () => runtime.getInstanceSlot("1/added") !== undefined,
  };
}

function historicalNodeFreeList(): HistoricalFreeListFixture {
  const placements = Array.from({ length: HISTORICAL_HOLES }, (_, index) => ({
    kind: "assembly" as const,
    placementId: `historical-${index}`,
    assemblyId: 2,
    transform: identityMatrix(),
  }));
  const runtime = createPackedSceneRuntime(
    buildScene(
      1,
      [
        { id: 1, placements },
        { id: 2, placements: [] },
      ],
      [],
    ),
  );
  runtime.removeAssemblyNodes(Array.from({ length: HISTORICAL_HOLES }, (_, index) => index + 1));
  return {
    name: "nodeFreeSlots",
    runtime,
    freeSlots: runtime.nodeFreeSlots,
    add: () =>
      runtime.addAssemblyNode({
        nodeId: "1/added",
        assemblyId: 2,
        parent: 0,
        worldTransform: identityMatrix(),
        assemblyVisible: true,
      }),
    isAdded: () => runtime.getNodeSlot("1/added") !== undefined,
  };
}

function trackFreeList(runtime: PackedSceneRuntime, name: HistoricalFreeListFixture["name"]) {
  const freeSlots = runtime[name];
  let iterations = 0;
  let pops = 0;
  let pushes = 0;
  let splices = 0;
  const originalIterator = freeSlots[Symbol.iterator];
  const originalPop = freeSlots.pop;
  const originalPush = freeSlots.push;
  const originalSplice = freeSlots.splice;
  Object.assign(freeSlots, {
    *[Symbol.iterator]() {
      for (const slot of originalIterator.call(freeSlots)) {
        iterations += 1;
        yield slot;
      }
    },
    pop() {
      pops += 1;
      return originalPop.call(freeSlots);
    },
    push(...slots: number[]) {
      pushes += 1;
      return originalPush.apply(freeSlots, slots);
    },
    splice(start: number, deleteCount?: number, ...slots: number[]) {
      splices += 1;
      return deleteCount === undefined
        ? originalSplice.call(freeSlots, start, freeSlots.length - start)
        : originalSplice.call(freeSlots, start, deleteCount, ...slots);
    },
  });
  return {
    finish: () => {
      Reflect.deleteProperty(freeSlots, Symbol.iterator);
      Reflect.deleteProperty(freeSlots, "pop");
      Reflect.deleteProperty(freeSlots, "push");
      Reflect.deleteProperty(freeSlots, "splice");
      return { iterations, pops, pushes, splices };
    },
  };
}
