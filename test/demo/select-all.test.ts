import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  setElementVisible,
  type FemViewport,
  type Part,
} from "../../src/index";
import { selectAllTargets } from "../../demo/workbench/selection/select-all";

const instanceId = "root/part";

describe("workbench select all", () => {
  it.each([
    ["element", ["element:1"]],
    ["face", ["face:1:0"]],
    ["node", ["node:0", "node:1", "node:2"]],
    ["edge", ["edge:0:1", "edge:1:2"]],
  ] as const)("collects explicitly visible %s targets", (granularity, expected) => {
    const interaction = setElementVisible(
      createInteractionState(),
      { instanceId, elementId: 2 },
      false,
    );
    const viewport = fakeViewport(interaction);

    expect(selectAllTargets(viewport, granularity).map(targetLabel)).toEqual(expected);
  });
});

function fakeViewport(interaction: FemViewport["interaction"]): FemViewport {
  const part = mixedPart();
  return {
    interaction,
    scene: { parts: new Map([[part.id, part]]) },
    runtime: {
      getVisibleInstanceIds: () => [instanceId],
      getInstance: () => ({ instanceId, partId: part.id }),
    },
  } as unknown as FemViewport;
}

function mixedPart(): Part {
  return {
    id: 1,
    elements: [
      {
        id: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
      },
      {
        id: 2,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
      },
    ],
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array(12),
        indices: new Uint32Array([0, 1, 2, 1, 2, 3]),
        nodePickIds: new Uint32Array([1, 2, 3, 4]),
        faces: [face(1, 0, 0, [0, 1, 2]), face(2, 0, 1, [1, 2, 3])],
        edges: [edge("0:1", [0, 1], [1]), edge("1:2", [1, 2], [1, 2]), edge("2:3", [2, 3], [2])],
      },
    ],
  } as unknown as Part;
}

function face(elementId: number, faceIndex: number, primitiveStart: number, nodeIds: number[]) {
  return {
    elementId,
    faceIndex,
    primitiveStart,
    primitiveCount: 1,
    key: nodeIds.join(":"),
    nodeIds,
    neighborElementIds: [],
  };
}

function edge(key: string, nodeIds: number[], incidentElementIds: number[]) {
  return { key, nodeIds, incidentElementIds, faceRefs: [] };
}

function targetLabel(target: ReturnType<typeof selectAllTargets>[number]): string {
  switch (target.kind) {
    case "element":
      return `element:${target.elementId}`;
    case "face":
      return `face:${target.elementId}:${target.faceIndex}`;
    case "node":
      return `node:${target.nodeId}`;
    case "edge":
      return `edge:${target.key}`;
    case "part":
    case "instance":
    case "block":
      return target.kind;
  }
}
