import { describe, expect, it } from "vitest";
import { createPart } from "../../src/geometry/part";
import { createInteractionState, setTargetSelected } from "../../src/index";
import { translation } from "../../src/math/mat4";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { createScene } from "../../src/scene/scene";
import { padDegenerateBounds } from "../../src/viewport/geometry-bounds";
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
    elements: [{ id: 8, primitiveStart: 0, primitiveCount: 1, bodyId: 4 }],
    nodePickIds: new Uint32Array([1, 2, 3]),
    nodePositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    faces: [
      {
        elementId: 8,
        faceIndex: 0,
        primitiveStart: 0,
        primitiveCount: 1,
        key: "0/1/2",
        nodeIds: [0, 1, 2],
        neighborElementIds: [],
        bodyId: 4,
      },
    ],
    bodies: [{ id: 4, elementIds: [8] }],
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
  it("frames every visible occurrence for part selection and exact entity targets", () => {
    const scene = sceneWithRepeatedPart();
    const runtime = createPackedSceneRuntime(scene);
    const entityTargets = [
      {
        target: { kind: "instance", instanceId: "1/1" },
        expected: { minX: 10, maxX: 11, minY: 0, maxY: 1 },
      },
      {
        target: { kind: "body", instanceId: "1/1", bodyId: 4 },
        expected: { minX: 10, maxX: 11, minY: 0, maxY: 1 },
      },
      {
        target: { kind: "element", instanceId: "1/1", elementId: 8 },
        expected: { minX: 10, maxX: 11, minY: 0, maxY: 1 },
      },
      {
        target: { kind: "face", instanceId: "1/1", elementId: 8, faceIndex: 0 },
        expected: { minX: 10, maxX: 11, minY: 0, maxY: 1 },
      },
      {
        target: { kind: "node", instanceId: "1/1", nodeId: 2 },
        expected: { minX: 10, maxX: 10, minY: 1, maxY: 1 },
      },
    ] as const;

    let interaction = createInteractionState();
    interaction = setTargetSelected(interaction, { kind: "part", partId: 1 }, true);
    expect(selectedSceneBounds(scene, runtime, interaction)).toMatchObject({
      minX: 0,
      maxX: 11,
    });

    for (const { target, expected } of entityTargets) {
      const selected = setTargetSelected(createInteractionState(), target, true);
      expect(selectedSceneBounds(scene, runtime, selected)).toMatchObject(expected);
    }
  });

  it("includes active nodal deformation in exact bounds", () => {
    const scene = sceneWithRepeatedPart();
    const runtime = createPackedSceneRuntime(scene);
    const selected = setTargetSelected(
      createInteractionState(),
      { kind: "element", instanceId: "1/1", elementId: 8 },
      true,
    );
    const deformation = {
      scale: 2,
      displacements: new Map([[1, new Float32Array([0, 0, 0, 5, 0, 0, 0, 0, 0])]]),
    };

    expect(selectedSceneBounds(scene, runtime, selected, deformation)).toMatchObject({
      minX: 10,
      maxX: 21,
      minY: 0,
      maxY: 1,
    });
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

  it("pads only degenerate selected axes using the complete scene scale", () => {
    expect(
      padDegenerateBounds(
        { minX: 2, minY: 3, minZ: 4, maxX: 2, maxY: 8, maxZ: 4 },
        { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 0, maxZ: 0 },
      ),
    ).toMatchObject({ minX: 1.99, maxX: 2.01, minY: 3, maxY: 8, minZ: 3.99, maxZ: 4.01 });
  });
});
