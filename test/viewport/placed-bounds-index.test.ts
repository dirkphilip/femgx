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
import { PlacedBoundsIndex } from "../../src/viewport/bounds/placed-index";
import { scenePlacedBounds } from "../../src/viewport/scene-bounds";

describe("PlacedBoundsIndex", () => {
  it("shrinks a unique extreme after one logarithmic leaf update", () => {
    const initial = boundsScene();
    const runtime = createPackedSceneRuntime(initial);
    const index = new PlacedBoundsIndex(initial, runtime);
    expect(index.bounds).toEqual(scenePlacedBounds(initial, runtime));
    const transition = prepareSceneTransition(initial, (update) => {
      update.setPartOccurrenceTransform({
        assemblyId: 1,
        placementId: "far",
        transform: translation(2, 0, 0),
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
  return createScene()
    .addPart(part)
    .addAssembly({
      id: 1,
      placements: [
        {
          kind: "part",
          placementId: "middle",
          partId: 1,
          transform: translation(5, 0, 0),
        },
        {
          kind: "part",
          placementId: "far",
          partId: 1,
          transform: translation(10, 0, 0),
        },
      ],
    })
    .withRoot(1)
    .build();
}
