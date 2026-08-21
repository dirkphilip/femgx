import { describe, expect, it } from "vitest";
import { createPart } from "@/geometry/part";
import { createInteractionState, setAssemblySelected } from "@/interaction/interaction";
import { identityMatrix } from "@/math/mat4";
import { buildInstanceLayout, buildSelectionOrder } from "@/renderer/runtime-state";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { createSceneBuilder } from "@/scene/scene";

describe("assembly selection order", () => {
  it("projects one logical assembly selection to its visible descendant slots", () => {
    const part = createPart(1, {
      geometries: [
        {
          primitive: "triangles",
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: new Uint32Array([0, 1, 2]),
        },
      ],
    });
    const scene = createSceneBuilder()
      .addPart(part)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", placementId: "a", partId: 1, transform: identityMatrix() },
          { kind: "part", placementId: "b", partId: 1, transform: identityMatrix() },
        ],
      })
      .setRootAssembly(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    const interaction = setAssemblySelected(createInteractionState(), 1, true);

    expect(buildSelectionOrder(layout, runtime, 1, interaction, scene.parts)).toEqual(
      new Uint32Array([0, 1]),
    );
  });
});
