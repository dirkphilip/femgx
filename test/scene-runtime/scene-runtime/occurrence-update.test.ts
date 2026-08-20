import { describe, expect, it } from "vitest";
import { createSceneOccurrences } from "@/scene-runtime/occurrences";
import {
  applyOccurrenceMutations,
  prepareOccurrenceMutations,
} from "@/scene-runtime/occurrence-update";
import { prepareSceneTransition } from "@/scene/update";
import {
  buildScene,
  createPackedSceneRuntime,
  identityMatrix,
  part,
  translationMatrix,
} from "./support";

describe("incremental part occurrence storage", () => {
  it("reuses removed slots without moving surviving identities or exposing holes", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", placementId: "remove", partId: 1, transform: identityMatrix() },
            { kind: "part", placementId: "keep", partId: 1, transform: translationMatrix(1, 0, 0) },
          ],
        },
      ],
      [1, 2],
    );
    const runtime = createPackedSceneRuntime(scene);
    const prepared = prepareSceneTransition(scene, (update) => {
      update.removePlacement(1, "remove");
      update.addPlacement(1, {
        kind: "part",
        placementId: "added",
        partId: 2,
        transform: translationMatrix(2, 0, 0),
      });
    });
    if (prepared === undefined) throw new Error("expected a scene transition");
    const mutations = prepareOccurrenceMutations(runtime, prepared.scene, prepared.changes);
    if (mutations === undefined) throw new Error("expected occurrence mutations");

    const delta = applyOccurrenceMutations(runtime, mutations);

    expect(runtime.getInstanceSlot("1/keep")).toBe(1);
    expect(runtime.getInstanceSlot("1/added")).toBe(0);
    expect(runtime.getInstanceSlot("1/remove")).toBeUndefined();
    expect(runtime.activeInstanceCount).toBe(2);
    expect(delta.slots).toEqual([{ slot: 0, beforePartId: 1, afterPartId: 2 }]);
    const occurrences = createSceneOccurrences(() => runtime);
    expect(occurrences.partOccurrenceCount).toBe(2);
    expect(
      Array.from(occurrences.partOccurrences(), ({ partOccurrenceId }) => partOccurrenceId),
    ).toEqual(["1/added", "1/keep"]);
  });

  it("coalesces remove plus add of one placement identityMatrix into a retained-slot replacement", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", placementId: "item", partId: 1, transform: identityMatrix() },
          ],
        },
      ],
      [1, 2],
    );
    const runtime = createPackedSceneRuntime(scene);
    const slot = runtime.getInstanceSlot("1/item");
    if (slot === undefined) throw new Error("expected an instance slot");
    const prepared = prepareSceneTransition(scene, (update) => {
      update.removePlacement(1, "item");
      update.addPlacement(1, {
        kind: "part",
        placementId: "item",
        partId: 2,
        transform: translationMatrix(3, 0, 0),
      });
    });
    if (prepared === undefined) throw new Error("expected a scene transition");
    const mutations = prepareOccurrenceMutations(runtime, prepared.scene, prepared.changes);
    if (mutations === undefined) throw new Error("expected occurrence mutations");

    const delta = applyOccurrenceMutations(runtime, mutations);

    expect(runtime.getInstanceSlot("1/item")).toBe(slot);
    expect(runtime.getPartId(slot)).toBe(2);
    expect(runtime.getTransform(slot)?.[12]).toBe(3);
    expect(delta.slots).toEqual([{ slot, beforePartId: 1, afterPartId: 2 }]);
  });

  it("expands one authored placement across every retained owner assembly occurrence", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "assembly", placementId: "left", assemblyId: 2, transform: identityMatrix() },
            { kind: "assembly", placementId: "right", assemblyId: 2, transform: identityMatrix() },
          ],
        },
        { id: 2, placements: [] },
      ],
      [1],
    );
    const runtime = createPackedSceneRuntime(scene);
    const prepared = prepareSceneTransition(scene, (update) => {
      update.addPart(part(2));
      update.addPlacement(2, {
        kind: "part",
        placementId: "shared",
        partId: 2,
        transform: identityMatrix(),
      });
    });
    if (prepared === undefined) throw new Error("expected a scene transition");
    const mutations = prepareOccurrenceMutations(runtime, prepared.scene, prepared.changes);
    if (mutations === undefined) throw new Error("expected occurrence mutations");

    const delta = applyOccurrenceMutations(runtime, mutations);

    expect(delta.addedPartIds).toEqual(new Set([2]));
    expect(runtime.activeInstanceCount).toBe(2);
    expect(runtime.getInstanceSlot("1/left/shared")).toBeDefined();
    expect(runtime.getInstanceSlot("1/right/shared")).toBeDefined();
  });

  it("admits an unplaced definition without compiling or allocating an occurrence", () => {
    const scene = buildScene(1, [{ id: 1, placements: [] }], [1]);
    const runtime = createPackedSceneRuntime(scene);
    const prepared = prepareSceneTransition(scene, (update) => {
      update.addPart(part(2));
    });
    if (prepared === undefined) throw new Error("expected a scene transition");
    const mutations = prepareOccurrenceMutations(runtime, prepared.scene, prepared.changes);
    if (mutations === undefined) throw new Error("expected occurrence mutations");

    const delta = applyOccurrenceMutations(runtime, mutations);

    expect(delta.addedPartIds).toEqual(new Set([2]));
    expect(delta.slots).toEqual([]);
    expect(runtime.activeInstanceCount).toBe(0);
  });

  it("releases every nested expansion in a part-definition removal cascade", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "assembly", placementId: "left", assemblyId: 2, transform: identityMatrix() },
            { kind: "assembly", placementId: "right", assemblyId: 2, transform: identityMatrix() },
          ],
        },
        {
          id: 2,
          placements: [
            { kind: "part", placementId: "removed", partId: 1, transform: identityMatrix() },
            { kind: "part", placementId: "retained", partId: 2, transform: identityMatrix() },
          ],
        },
      ],
      [1, 2],
    );
    const runtime = createPackedSceneRuntime(scene);
    const prepared = prepareSceneTransition(scene, (update) => {
      update.removePart(1, { placements: "remove" });
    });
    if (prepared === undefined) throw new Error("expected a scene transition");
    const mutations = prepareOccurrenceMutations(runtime, prepared.scene, prepared.changes);
    if (mutations === undefined) throw new Error("expected occurrence mutations");

    const delta = applyOccurrenceMutations(runtime, mutations);

    expect(delta.removedPartIds).toEqual(new Set([1]));
    expect(delta.removedOccurrenceSlots).toHaveLength(2);
    expect(runtime.getInstanceSlot("1/left/removed")).toBeUndefined();
    expect(runtime.getInstanceSlot("1/right/removed")).toBeUndefined();
    expect(runtime.getInstanceSlot("1/left/retained")).toBeDefined();
    expect(runtime.getInstanceSlot("1/right/retained")).toBeDefined();
    expect(runtime.activeInstanceCount).toBe(2);
  });
});
