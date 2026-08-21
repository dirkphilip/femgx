import { describe, expect, it } from "vitest";
import {
  applyHierarchyMutations,
  prepareHierarchyMutations,
} from "@/scene-runtime/hierarchy-update";
import { prepareSceneTransition } from "@/scene/update";
import { buildScene, createPackedSceneRuntime, identityMatrix, translationMatrix } from "./support";

describe("incremental assembly hierarchy storage", () => {
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
