import { describe, expect, it } from "vitest";
import { createPart } from "../../src/geometry/part";
import { translationMatrix } from "../../src/math/mat4";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import {
  applyOccurrenceMutations,
  prepareOccurrenceMutations,
} from "../../src/scene-runtime/occurrence-update";
import {
  applyTransformPatch,
  prepareTransformPatch,
} from "../../src/scene-runtime/transform-update";
import { createSceneBuilder } from "../../src/scene/scene";
import { prepareSceneTransition } from "../../src/scene/update";
import { PlacedBoundsIndex } from "../../src/viewport/bounds/placed-index";
import { scenePlacedBounds } from "../../src/viewport/scene-bounds";

describe("PlacedBoundsIndex", () => {
  it("shrinks a unique extreme after one logarithmic leaf update", () => {
    const initial = boundsScene();
    const runtime = createPackedSceneRuntime(initial);
    const index = new PlacedBoundsIndex(initial, runtime);
    expect(index.bounds).toEqual(scenePlacedBounds(initial, runtime));
    const transition = prepareSceneTransition(initial, (update) => {
      update.replacePlacement(1, {
        kind: "part",
        placementId: "far",
        partId: 1,
        transform: translationMatrix(2, 0, 0),
      });
    });
    if (transition === undefined) throw new Error("expected a scene transition");
    const patch = prepareTransformPatch(runtime, transition.scene, transition.changes);
    if (patch === undefined) throw new Error("expected a transform patch");

    const changed = applyTransformPatch(runtime, patch);
    index.update(runtime, changed);

    expect(index.bounds).toEqual(scenePlacedBounds(transition.scene, runtime));
    expect(index.bounds.maxX).toBe(6);
  });

  it("rolls back sparse changed leaves and counters exactly", () => {
    const initial = boundsScene();
    const runtime = createPackedSceneRuntime(initial);
    const index = new PlacedBoundsIndex(initial, runtime);
    const before = index.bounds;
    const transition = prepareSceneTransition(initial, (update) => {
      update.replacePlacement(1, {
        kind: "part",
        placementId: "far",
        partId: 1,
        transform: translationMatrix(2, 0, 0),
      });
    });
    if (transition === undefined) throw new Error("expected a scene transition");
    const patch = prepareTransformPatch(runtime, transition.scene, transition.changes);
    if (patch === undefined) throw new Error("expected a transform patch");
    const changed = applyTransformPatch(runtime, patch);
    const transaction = index.beginTransaction(changed, new Set());

    index.update(runtime, changed);
    expect(index.bounds).not.toEqual(before);
    transaction.rollback();

    expect(index.bounds).toEqual(before);
    expect(index.lastUpdatedLeafCount).toBe(0);
    expect(index.lastMergedNodeCount).toBe(0);
  });

  it("uses a newly admitted definition for added occurrence bounds", () => {
    const initial = boundsScene();
    const runtime = createPackedSceneRuntime(initial);
    const index = new PlacedBoundsIndex(initial, runtime);
    const added = createPart(2, {
      geometries: [
        {
          positions: new Float32Array([0, 0, 0, 4, 0, 0, 0, 2, 0]),
          indices: new Uint32Array([0, 1, 2]),
          primitive: "triangles",
        },
      ],
    });
    const transition = prepareSceneTransition(initial, (update) => {
      update.addPart(added);
      update.addPlacement(1, {
        kind: "part",
        placementId: "added",
        partId: 2,
        transform: translationMatrix(20, 0, 0),
      });
    });
    if (transition === undefined) throw new Error("expected a scene transition");
    const prepared = prepareOccurrenceMutations(runtime, transition.scene, transition.changes);
    if (prepared === undefined) throw new Error("expected occurrence mutations");

    const delta = applyOccurrenceMutations(runtime, prepared);
    index.updateParts(transition.scene.parts, delta.addedPartIds);
    index.update(
      runtime,
      delta.slots.map(({ slot }) => slot),
    );

    expect(index.bounds).toEqual(scenePlacedBounds(transition.scene, runtime));
    expect(index.bounds.maxX).toBe(24);
    expect(index.capacityGrowthCount).toBe(0);
    expect(index.rebuiltLeafCount).toBe(0);
    expect(index.lastUpdatedLeafCount).toBe(1);
    expect(index.lastMergedNodeCount).toBeGreaterThan(0);
  });
});

function boundsScene() {
  const part = createPart(1, {
    geometries: [
      {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
        primitive: "triangles",
      },
    ],
  });
  return createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      placements: [
        {
          kind: "part",
          placementId: "middle",
          partId: 1,
          transform: translationMatrix(5, 0, 0),
        },
        {
          kind: "part",
          placementId: "far",
          partId: 1,
          transform: translationMatrix(10, 0, 0),
        },
      ],
    })
    .setRootAssembly(1)
    .build();
}
