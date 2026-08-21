import { describe, expect, it } from "vitest";
import {
  applyHierarchyMutations,
  prepareHierarchyMutations,
} from "@/scene-runtime/hierarchy-update";
import { createSceneOccurrences } from "@/scene-runtime/occurrences";
import { prepareSceneTransition } from "@/scene/update";
import { buildScene, createPackedSceneRuntime, identityMatrix, translationMatrix } from "./support";

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
  });
});
