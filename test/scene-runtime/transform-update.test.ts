import { describe, expect, it } from "vitest";
import { createPart } from "../../src/geometry/part";
import { translation } from "../../src/math/mat4";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import {
  applyTransformPatch,
  prepareTransformPatch,
} from "../../src/scene-runtime/transform-update";
import { createScene } from "../../src/scene/scene";
import { prepareSceneTransition } from "../../src/scene/update";

describe("incremental runtime transform updates", () => {
  it("patches only an affected assembly subtree and retains runtime slots", () => {
    const initial = repeatedAssemblyScene();
    const runtime = createPackedSceneRuntime(initial);
    const leftSlot = requiredSlot(runtime, "1/left/item");
    const rightSlot = requiredSlot(runtime, "1/right/item");
    const transition = prepareSceneTransition(initial, (update) => {
      update.setAssemblyOccurrenceTransform({
        parentAssemblyId: 1,
        placementId: "left",
        transform: translation(30, 0, 0),
      });
    });
    if (transition === undefined) throw new Error("expected a scene transition");

    const patch = prepareTransformPatch(runtime, transition.scene, transition.changes);
    if (patch === undefined) throw new Error("expected an incremental transform patch");
    expect(applyTransformPatch(runtime, patch)).toEqual([leftSlot]);
    expect(runtime.getInstanceSlot("1/left/item")).toBe(leftSlot);
    expect(runtime.getInstanceSlot("1/right/item")).toBe(rightSlot);
    expect(runtime.getTransform(leftSlot)?.[12]).toBe(31);
    expect(runtime.getTransform(rightSlot)?.[12]).toBe(21);
  });

  it("patches every expanded occurrence of a transformed definition placement", () => {
    const initial = repeatedAssemblyScene();
    const runtime = createPackedSceneRuntime(initial);
    const transition = prepareSceneTransition(initial, (update) => {
      update.setPartOccurrenceTransform({
        assemblyId: 2,
        placementId: "item",
        transform: translation(5, 0, 0),
      });
    });
    if (transition === undefined) throw new Error("expected a scene transition");

    const patch = prepareTransformPatch(runtime, transition.scene, transition.changes);
    if (patch === undefined) throw new Error("expected an incremental transform patch");
    expect(new Set(applyTransformPatch(runtime, patch))).toEqual(
      new Set([requiredSlot(runtime, "1/left/item"), requiredSlot(runtime, "1/right/item")]),
    );
    expect(runtime.getTransform(requiredSlot(runtime, "1/left/item"))?.[12]).toBe(15);
    expect(runtime.getTransform(requiredSlot(runtime, "1/right/item"))?.[12]).toBe(25);
  });
});

function repeatedAssemblyScene() {
  const part = createPart(1, {
    geometries: [
      {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
        primitive: "triangles",
      },
    ],
  });
  return createScene()
    .addPart(part)
    .addAssembly({
      id: 2,
      placements: [
        {
          kind: "part",
          placementId: "item",
          partId: 1,
          transform: translation(1, 0, 0),
        },
      ],
    })
    .addAssembly({
      id: 1,
      placements: [
        {
          kind: "assembly",
          placementId: "left",
          assemblyId: 2,
          transform: translation(10, 0, 0),
        },
        {
          kind: "assembly",
          placementId: "right",
          assemblyId: 2,
          transform: translation(20, 0, 0),
        },
      ],
    })
    .withRoot(1)
    .build();
}

function requiredSlot(runtime: ReturnType<typeof createPackedSceneRuntime>, id: string): number {
  const slot = runtime.getInstanceSlot(id);
  if (slot === undefined) throw new Error(`missing runtime slot ${id}`);
  return slot;
}
