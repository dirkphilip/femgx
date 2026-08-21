import { describe, expect, it } from "vitest";
import {
  applyHierarchyMutations,
  prepareHierarchyMutations,
} from "@/scene-runtime/hierarchy-update";
import { createSceneOccurrences } from "@/scene-runtime/occurrences";
import { prepareSceneTransition } from "@/scene/update";
import { buildScene, createPackedSceneRuntime, identityMatrix, translationMatrix } from "./support";

describe("incremental assembly hierarchy storage", () => {
  it("prepares an explicit placement without a late identity migration", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            {
              kind: "part",
              placementId: "0",
              partId: 1,
              transform: identityMatrix(),
            },
          ],
        },
      ],
      [1],
    );
    const runtime = createPackedSceneRuntime(scene);
    const transition = prepareSceneTransition(scene, (update) => {
      update.addPlacement(1, {
        kind: "part",
        placementId: "added",
        partId: 1,
        transform: identityMatrix(),
      });
    });
    if (transition === undefined) throw new Error("expected ambiguous transition");

    expect(
      prepareHierarchyMutations(runtime, scene, transition.scene, transition.changes),
    ).toBeDefined();
    expect(runtime.activeInstanceCount).toBe(1);
    expect(runtime.getInstanceId(0)).toBe("1/0");
  });

  it("patches a retained assembly transform alongside topology without resetting overrides", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "assembly", placementId: "child", assemblyId: 2, transform: identityMatrix() },
          ],
        },
        {
          id: 2,
          placements: [
            { kind: "part", placementId: "keep", partId: 1, transform: identityMatrix() },
          ],
        },
      ],
      [1],
    );
    const runtime = createPackedSceneRuntime(scene);
    const childNode = runtime.getNodeSlot("1/child");
    const keepSlot = runtime.getInstanceSlot("1/child/keep");
    if (childNode === undefined || keepSlot === undefined) throw new Error("fixture is incomplete");
    runtime.setInstanceVisible(keepSlot, false);
    const transition = prepareSceneTransition(scene, (update) => {
      update.replacePlacement(1, {
        kind: "assembly",
        placementId: "child",
        assemblyId: 2,
        transform: translationMatrix(5, 0, 0),
      });
      update.addPlacement(2, {
        kind: "part",
        placementId: "added",
        partId: 1,
        transform: translationMatrix(2, 0, 0),
      });
    });
    if (transition === undefined) throw new Error("expected mixed hierarchy transition");
    const prepared = prepareHierarchyMutations(
      runtime,
      scene,
      transition.scene,
      transition.changes,
    );
    if (prepared === undefined) throw new Error("expected hierarchy mutations");

    applyHierarchyMutations(
      runtime,
      transition.scene,
      prepared,
      (_part, value) => value,
      (_assembly, value) => value,
    );

    expect(runtime.getNodeSlot("1/child")).toBe(childNode);
    expect(runtime.getInstanceSlot("1/child/keep")).toBe(keepSlot);
    expect(runtime.instanceOverrideVisible[keepSlot]).toBe(0);
    expect(runtime.getTransform(keepSlot)?.[12]).toBe(5);
    const added = runtime.getInstanceSlot("1/child/added");
    expect(added).toBeDefined();
    expect(runtime.getTransform(added ?? -1)?.[12]).toBe(7);
  });

  it("preserves authored DFS order independently of reused physical slots", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", placementId: "first", partId: 1, transform: identityMatrix() },
            { kind: "assembly", placementId: "middle", assemblyId: 2, transform: identityMatrix() },
            { kind: "part", placementId: "last", partId: 1, transform: identityMatrix() },
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
    const firstSlot = runtime.getInstanceSlot("1/first");
    const lastSlot = runtime.getInstanceSlot("1/last");
    const middleNode = runtime.getNodeSlot("1/middle");
    if (firstSlot === undefined || lastSlot === undefined || middleNode === undefined)
      throw new Error("fixture is incomplete");
    const transition = prepareSceneTransition(scene, (update) => {
      update.replaceAssembly({
        id: 1,
        placements: [
          { kind: "part", placementId: "last", partId: 1, transform: identityMatrix() },
          { kind: "assembly", placementId: "middle", assemblyId: 2, transform: identityMatrix() },
          { kind: "part", placementId: "first", partId: 1, transform: identityMatrix() },
        ],
      });
    });
    if (transition === undefined) throw new Error("expected authored reorder");
    const prepared = prepareHierarchyMutations(
      runtime,
      scene,
      transition.scene,
      transition.changes,
    );
    if (prepared === undefined) throw new Error("expected hierarchy reorder");

    applyHierarchyMutations(
      runtime,
      transition.scene,
      prepared,
      (_part, value) => value,
      (_assembly, value) => value,
    );

    expect(runtime.getInstanceSlot("1/first")).toBe(firstSlot);
    expect(runtime.getInstanceSlot("1/last")).toBe(lastSlot);
    expect(runtime.getNodeSlot("1/middle")).toBe(middleNode);
    expect([...occurrences.partOccurrences()].map((item) => item.partOccurrenceId)).toEqual([
      "1/last",
      "1/middle/nested",
      "1/first",
    ]);
    expect([...occurrences.visiblePartOccurrenceIds()]).toEqual([
      "1/last",
      "1/middle/nested",
      "1/first",
    ]);
    expect(occurrences.getAssemblyOccurrence("1")?.getPartOccurrenceId(0)).toBe("1/last");
    expect(occurrences.getAssemblyOccurrence("1")?.getPartOccurrenceId(1)).toBe("1/first");
  });

  it("expands and collapses one reused assembly placement without moving survivors", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "assembly", placementId: "left", assemblyId: 2, transform: identityMatrix() },
            {
              kind: "assembly",
              placementId: "right",
              assemblyId: 2,
              transform: translationMatrix(4, 0, 0),
            },
          ],
        },
        {
          id: 2,
          placements: [
            { kind: "part", placementId: "keep", partId: 1, transform: identityMatrix() },
          ],
        },
        {
          id: 3,
          placements: [
            { kind: "part", placementId: "leaf", partId: 2, transform: translationMatrix(1, 0, 0) },
          ],
        },
      ],
      [1, 2],
    );
    const runtime = createPackedSceneRuntime(scene);
    const retainedNode = runtime.getNodeSlot("1/right");
    const retainedSlot = runtime.getInstanceSlot("1/right/keep");
    if (retainedNode === undefined || retainedSlot === undefined)
      throw new Error("fixture is incomplete");
    const transition = prepareSceneTransition(scene, (update) => {
      update.addPlacement(2, {
        kind: "assembly",
        placementId: "added",
        assemblyId: 3,
        transform: translationMatrix(1, 0, 0),
      });
    });
    if (transition === undefined) throw new Error("expected a hierarchy transition");
    const prepared = prepareHierarchyMutations(
      runtime,
      scene,
      transition.scene,
      transition.changes,
    );
    if (prepared === undefined) throw new Error("expected hierarchy mutations");

    const delta = applyHierarchyMutations(
      runtime,
      transition.scene,
      prepared,
      (_part, visible) => visible,
      (_assembly, visible) => visible,
    );

    expect(runtime.getNodeSlot("1/right")).toBe(retainedNode);
    expect(runtime.getInstanceSlot("1/right/keep")).toBe(retainedSlot);
    expect(runtime.getInstanceSlot("1/left/added/leaf")).toBeDefined();
    expect(runtime.getInstanceSlot("1/right/added/leaf")).toBeDefined();
    expect(delta.affectedPartIds).toEqual(new Set([2]));

    const removal = prepareSceneTransition(transition.scene, (update) => {
      update.removePlacement(1, "left");
    });
    if (removal === undefined) throw new Error("expected a hierarchy removal");
    const removed = prepareHierarchyMutations(
      runtime,
      transition.scene,
      removal.scene,
      removal.changes,
    );
    if (removed === undefined) throw new Error("expected hierarchy removal mutations");

    applyHierarchyMutations(
      runtime,
      removal.scene,
      removed,
      (_part, visible) => visible,
      (_assembly, visible) => visible,
    );

    expect(runtime.getNodeSlot("1/left")).toBeUndefined();
    expect(runtime.getInstanceSlot("1/left/keep")).toBeUndefined();
    expect(runtime.getNodeSlot("1/right")).toBe(retainedNode);
    expect(runtime.getInstanceSlot("1/right/keep")).toBe(retainedSlot);
  });

  it("replaces a direct part with a nested assembly under the retained placement identity", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "part", placementId: "item", partId: 1, transform: identityMatrix() },
          ],
        },
        {
          id: 2,
          placements: [
            { kind: "part", placementId: "leaf", partId: 2, transform: identityMatrix() },
          ],
        },
      ],
      [1, 2],
    );
    const runtime = createPackedSceneRuntime(scene);
    const transition = prepareSceneTransition(scene, (update) => {
      update.replacePlacement(1, {
        kind: "assembly",
        placementId: "item",
        assemblyId: 2,
        transform: translationMatrix(2, 0, 0),
      });
    });
    if (transition === undefined) throw new Error("expected kind replacement");
    const prepared = prepareHierarchyMutations(
      runtime,
      scene,
      transition.scene,
      transition.changes,
    );
    if (prepared === undefined) throw new Error("expected hierarchy mutations");

    applyHierarchyMutations(
      runtime,
      transition.scene,
      prepared,
      (_part, visible) => visible,
      (_assembly, visible) => visible,
    );

    expect(runtime.getInstanceSlot("1/item")).toBeUndefined();
    expect(runtime.getNodeSlot("1/item")).toBeDefined();
    expect(runtime.getInstanceSlot("1/item/leaf")).toBeDefined();
  });

  it("retargets every reused owner of a revised assembly definition in retained leaf slots", () => {
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
            { kind: "part", placementId: "leaf", partId: 1, transform: identityMatrix() },
          ],
        },
      ],
      [1, 2],
    );
    const runtime = createPackedSceneRuntime(scene);
    const left = runtime.getInstanceSlot("1/left/leaf");
    const right = runtime.getInstanceSlot("1/right/leaf");
    if (left === undefined || right === undefined) throw new Error("fixture is incomplete");
    const transition = prepareSceneTransition(scene, (update) => {
      update.replaceAssembly({
        id: 2,
        placements: [
          { kind: "part", placementId: "leaf", partId: 2, transform: translationMatrix(2, 0, 0) },
        ],
      });
    });
    if (transition === undefined) throw new Error("expected definition revision");
    const prepared = prepareHierarchyMutations(
      runtime,
      scene,
      transition.scene,
      transition.changes,
    );
    if (prepared === undefined) throw new Error("expected hierarchy mutations");

    applyHierarchyMutations(
      runtime,
      transition.scene,
      prepared,
      (_part, visible) => visible,
      (_assembly, visible) => visible,
    );

    expect(runtime.getInstanceSlot("1/left/leaf")).toBe(left);
    expect(runtime.getInstanceSlot("1/right/leaf")).toBe(right);
    expect(runtime.getPartId(left)).toBe(2);
    expect(runtime.getPartId(right)).toBe(2);
  });

  it("rejects only a changed edge that would introduce a cycle before runtime mutation", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            { kind: "assembly", placementId: "child", assemblyId: 2, transform: identityMatrix() },
          ],
        },
        { id: 2, placements: [] },
      ],
      [1],
    );
    const runtime = createPackedSceneRuntime(scene);

    expect(() => {
      prepareSceneTransition(scene, (update) => {
        update.replaceAssembly({
          id: 2,
          placements: [
            { kind: "assembly", placementId: "cycle", assemblyId: 1, transform: identityMatrix() },
          ],
        });
      });
    }).toThrow("AssemblyDefinition hierarchy contains a cycle through 1");
    expect(runtime.getNodeSlot("1/child")).toBeDefined();
  });
});
