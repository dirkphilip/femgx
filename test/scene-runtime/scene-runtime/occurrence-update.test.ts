import { describe, expect, it } from "vitest";
import { createPublicSceneRuntime } from "../../../src/scene-runtime/public-runtime";
import {
  applyOccurrenceMutations,
  prepareOccurrenceMutations,
} from "../../../src/scene-runtime/occurrence-update";
import { prepareSceneTransition } from "../../../src/scene/update";
import { buildScene, createPackedSceneRuntime, identity, translation } from "./support";

describe("incremental part occurrence storage", () => {
  it("reuses removed slots without moving surviving identities or exposing holes", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", placementId: "remove", partId: 1, transform: identity() },
            { kind: "part", placementId: "keep", partId: 1, transform: translation(1, 0, 0) },
          ],
        },
      ],
      [1, 2],
    );
    const runtime = createPackedSceneRuntime(scene);
    const prepared = prepareSceneTransition(scene, (update) => {
      update.removePartOccurrence({ assemblyId: 1, placementId: "remove" });
      update.addPartOccurrence({
        assemblyId: 1,
        placementId: "added",
        partId: 2,
        transform: translation(2, 0, 0),
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
    const publicRuntime = createPublicSceneRuntime(runtime);
    expect(publicRuntime.partOccurrenceCount).toBe(2);
    expect(publicRuntime.getPartOccurrenceIds()).toEqual(["1/added", "1/keep"]);
  });

  it("expands one authored placement across every retained owner assembly occurrence", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "assembly", placementId: "left", assemblyId: 2, transform: identity() },
            { kind: "assembly", placementId: "right", assemblyId: 2, transform: identity() },
          ],
        },
        { id: 2, placements: [] },
      ],
      [1],
    );
    const runtime = createPackedSceneRuntime(scene);
    const prepared = prepareSceneTransition(scene, (update) => {
      update.addPartOccurrence({
        assemblyId: 2,
        placementId: "shared",
        partId: 1,
        transform: identity(),
      });
    });
    if (prepared === undefined) throw new Error("expected a scene transition");
    const mutations = prepareOccurrenceMutations(runtime, prepared.scene, prepared.changes);
    if (mutations === undefined) throw new Error("expected occurrence mutations");

    applyOccurrenceMutations(runtime, mutations);

    expect(runtime.activeInstanceCount).toBe(2);
    expect(runtime.getInstanceSlot("1/left/shared")).toBeDefined();
    expect(runtime.getInstanceSlot("1/right/shared")).toBeDefined();
  });

  it("releases every nested expansion in a part-definition removal cascade", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "assembly", placementId: "left", assemblyId: 2, transform: identity() },
            { kind: "assembly", placementId: "right", assemblyId: 2, transform: identity() },
          ],
        },
        {
          id: 2,
          placements: [
            { kind: "part", placementId: "removed", partId: 1, transform: identity() },
            { kind: "part", placementId: "retained", partId: 2, transform: identity() },
          ],
        },
      ],
      [1, 2],
    );
    const runtime = createPackedSceneRuntime(scene);
    const prepared = prepareSceneTransition(scene, (update) => {
      update.removePart(1, { occurrences: "remove" });
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
