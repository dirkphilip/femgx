import { describe, expect, it } from "vitest";
import { createPart } from "../../src/geometry/part";
import { createInteractionState, setTargetSelected } from "../../src/index";
import { translation } from "../../src/math/mat4";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { createScene } from "../../src/scene/scene";
import {
  sceneWorldBounds,
  sceneWorldBoundsList,
  selectedSceneBounds,
} from "../../src/viewport/scene-bounds";

function sceneWithRepeatedPart() {
  const part = createPart(1, {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles",
  });
  return createScene()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "root",
      placements: [
        { kind: "part", partId: 1, transform: translation(0, 0, 0) },
        { kind: "part", partId: 1, transform: translation(10, 0, 0) },
      ],
    })
    .withRoot(1)
    .build();
}

describe("viewport scene bounds", () => {
  it("frames every visible occurrence for part selection and one occurrence for entity targets", () => {
    const scene = sceneWithRepeatedPart();
    const runtime = createPackedSceneRuntime(scene);
    const entityTargets = [
      { kind: "instance", instanceId: "1/1" },
      { kind: "body", instanceId: "1/1", bodyId: 4 },
      { kind: "element", instanceId: "1/1", elementId: 8 },
      { kind: "face", instanceId: "1/1", elementId: 8, key: "0/1/2" },
      { kind: "node", instanceId: "1/1", nodeId: 2 },
    ] as const;

    let interaction = createInteractionState();
    interaction = setTargetSelected(interaction, { kind: "part", partId: 1 }, true);
    expect(selectedSceneBounds(scene, runtime, interaction)).toMatchObject({
      minX: 0,
      maxX: 11,
    });

    for (const target of entityTargets) {
      const selected = setTargetSelected(createInteractionState(), target, true);
      expect(selectedSceneBounds(scene, runtime, selected)).toMatchObject({
        minX: 10,
        maxX: 11,
      });
    }
  });

  it("unions multiple selected occurrences and ignores hidden ones", () => {
    const scene = sceneWithRepeatedPart();
    const runtime = createPackedSceneRuntime(scene);
    let interaction = createInteractionState();
    interaction = setTargetSelected(interaction, { kind: "instance", instanceId: "1/0" }, true);
    interaction = setTargetSelected(interaction, { kind: "instance", instanceId: "1/1" }, true);
    expect(selectedSceneBounds(scene, runtime, interaction)).toMatchObject({
      minX: 0,
      maxX: 11,
    });

    runtime.setInstanceVisible(1, false);
    expect(sceneWorldBoundsList(scene, runtime)).toHaveLength(1);
    expect(sceneWorldBounds(scene, runtime)).toMatchObject({ minX: 0, maxX: 1 });
    expect(selectedSceneBounds(scene, runtime, interaction)).toMatchObject({
      minX: 0,
      maxX: 1,
    });
  });

  it("falls back to no selected bounds when every selected occurrence is hidden", () => {
    const scene = sceneWithRepeatedPart();
    const runtime = createPackedSceneRuntime(scene);
    runtime.setInstanceVisible(1, false);
    const selected = setTargetSelected(
      createInteractionState(),
      {
        kind: "instance",
        instanceId: "1/1",
      },
      true,
    );

    expect(selectedSceneBounds(scene, runtime, selected)).toBeUndefined();
  });
});
