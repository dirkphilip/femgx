import { describe, expect, it } from "vitest";
import { getPartSemanticIndex } from "../../src/geometry/part-semantic-index";
import { createPart } from "../../src/geometry/part";
import { createInteractionState } from "../../src/interaction/interaction";
import { updateInteractionState } from "../../src/interaction/state";
import { translation } from "../../src/math/mat4";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { createScene } from "../../src/scene/scene";
import { reconcileInteractionState } from "../../src/viewport/scene-reconciliation";

function reusableScene() {
  const part = createPart(1, {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
    elements: [{ id: 10, primitiveStart: 0, primitiveCount: 1, bodyId: 7, blockId: 11 }],
    faces: [
      {
        elementId: 10,
        faceIndex: 0,
        primitiveStart: 0,
        primitiveCount: 1,
        key: "0/1/2",
        nodeIds: [0, 1, 2],
        neighborElementIds: [],
        bodyId: 7,
        blockId: 11,
      },
    ],
    edges: [
      {
        key: "0,1",
        nodeIds: [0, 1],
        incidentElementIds: [10],
        faceRefs: [{ elementId: 10, faceIndex: 0 }],
      },
    ],
    nodePickIds: new Uint32Array([1, 2, 3]),
    nodePositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    bodies: [{ id: 7, elementIds: [10] }],
    blocks: [{ id: 11, elementIds: [10] }],
  });
  const scene = createScene()
    .addPart(part)
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
  return { part, scene, runtime: createPackedSceneRuntime(scene) };
}

describe("reconcileInteractionState", () => {
  it("preserves valid semantic selections across repeated occurrences", () => {
    const { part, scene, runtime } = reusableScene();
    const first = runtime.getInstanceId(0);
    const second = runtime.getInstanceId(1);
    if (first === undefined || second === undefined) throw new Error("test instances are missing");
    const state = updateInteractionState(createInteractionState(), {
      selectedBodyIds: new Map([
        [first, new Set([7])],
        [second, new Set([7])],
      ]),
      selectedBlockIds: new Map([
        [first, new Set([11])],
        [second, new Set([11])],
      ]),
      selectedElementIds: new Map([
        [first, new Set([10])],
        [second, new Set([10])],
      ]),
      selectedNodeIds: new Map([
        [first, new Set([2])],
        [second, new Set([2])],
      ]),
      selectedFaces: new Map([
        [first, new Map([["10/0", { instanceId: first, elementId: 10, faceIndex: 0 }]])],
        [second, new Map([["10/0", { instanceId: second, elementId: 10, faceIndex: 0 }]])],
      ]),
      selectedEdges: new Map([
        [first, new Map([["0,1", { instanceId: first, key: "0,1" }]])],
        [second, new Map([["0,1", { instanceId: second, key: "0,1" }]])],
      ]),
    });

    expect(getPartSemanticIndex(part)).toBe(getPartSemanticIndex(part));
    expect(reconcileInteractionState(state, runtime, scene.parts)).toBe(state);
  });
});
