import { describe, expect, it } from "vitest";
import { createPart } from "../../src/geometry/part";
import {
  createInteractionState,
  setInstanceOverride,
  setPartOverride,
} from "../../src/interaction/interaction";
import { translation } from "../../src/math/mat4";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { createScene } from "../../src/scene/scene";
import { interactionDirtyParts } from "../../src/renderer/interaction-sync";
import { buildInstanceLayout } from "../../src/renderer/runtime-state";

function sceneRuntime() {
  const geometry = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
  };
  const scene = createScene()
    .addPart(createPart(1, geometry))
    .addAssembly({
      id: 1,
      name: "root",
      placements: [
        { kind: "part" as const, partId: 1, transform: translation(0, 0, 0) },
        { kind: "part" as const, partId: 1, transform: translation(2, 0, 0) },
      ],
    })
    .withRoot(1)
    .build();
  return createPackedSceneRuntime(scene);
}

describe("interactionDirtyParts", () => {
  it("marks node orders dirty when part or instance style overrides change", () => {
    const runtime = sceneRuntime();
    const layout = buildInstanceLayout(runtime);
    const empty = createInteractionState();
    const partState = setPartOverride(empty, 1, { nodes: true });
    const instanceState = setInstanceOverride(empty, "1/1", { nodes: true });

    expect(interactionDirtyParts(runtime, layout, empty, partState, false).nodeParts).toEqual(
      new Set([1]),
    );
    expect(interactionDirtyParts(runtime, layout, empty, instanceState, false).nodeParts).toEqual(
      new Set([1]),
    );
  });
});
