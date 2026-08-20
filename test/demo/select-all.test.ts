import { describe, expect, it } from "vitest";
import { createPart, type Viewport, type Part } from "../../src/entries/root";
import {
  createInteractionState,
  setBodyVisible,
  setElementVisible,
} from "../../src/entries/interaction";
import { selectAllTargets } from "../../demo/workbench/selection/select-all";

const partOccurrenceId = "root/part";

describe("workbench select all", () => {
  it.each([
    ["part", ["part:1"]],
    ["partOccurrence", ["instance:root/part"]],
    ["body", ["body:10"]],
    ["element", ["element:1"]],
    ["face", ["face:1:0"]],
    ["node", ["node:0", "node:1", "node:2"]],
    ["edge", ["edge:0,1", "edge:1,2"]],
  ] as const)("collects explicitly visible %s targets", (granularity, expected) => {
    const interaction = setElementVisible(
      createInteractionState(),
      { partOccurrenceId, elementId: 2 },
      false,
    );
    const viewport = fakeViewport(interaction);

    expect(selectAllTargets(viewport, granularity).map(targetLabel)).toEqual(expected);
  });

  it("deduplicates a reusable part across visible instances", () => {
    const part = mixedPart();
    const viewport = {
      interaction: { state: createInteractionState() },
      scene: { parts: new Map([[part.id, part]]) },
      occurrences: {
        visiblePartOccurrenceIds: () => ["root/first", "root/second"],
        getPartOccurrence: (partOccurrenceId: string) => ({ partOccurrenceId, partId: part.id }),
      },
    } as unknown as Viewport;

    expect(selectAllTargets(viewport, "part").map(targetLabel)).toEqual(["part:1"]);
    expect(selectAllTargets(viewport, "partOccurrence").map(targetLabel)).toEqual([
      "instance:root/first",
      "instance:root/second",
    ]);
  });

  it("excludes elements from hidden bodies", () => {
    const interaction = setBodyVisible(
      createInteractionState(),
      { partOccurrenceId, bodyId: 10 },
      false,
    );

    expect(selectAllTargets(fakeViewport(interaction), "element").map(targetLabel)).toEqual([
      "element:2",
    ]);
  });
});

function fakeViewport(interaction: Viewport["interaction"]["state"]): Viewport {
  const part = mixedPart();
  return {
    interaction: { state: interaction } as Viewport["interaction"],
    scene: { parts: new Map([[part.id, part]]) },
    occurrences: {
      visiblePartOccurrenceIds: () => [partOccurrenceId],
      getPartOccurrence: () => ({ partOccurrenceId, partId: part.id }),
    },
  } as unknown as Viewport;
}

function mixedPart(): Part {
  return createPart(1, {
    elements: [
      {
        id: 1,
        bodyId: 10,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
      },
      {
        id: 2,
        bodyId: 20,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
      },
    ],
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array(12),
        indices: new Uint32Array([0, 1, 2, 1, 2, 3]),
        nodePickIds: new Uint32Array([1, 2, 3, 4]),
        faces: [face(1, 10, 0, 0, [0, 1, 2]), face(2, 20, 0, 1, [1, 2, 3])],
        edges: [edge("0,1", [0, 1], [1]), edge("1,2", [1, 2], [1, 2]), edge("2,3", [2, 3], [2])],
      },
    ],
    bodies: [
      { id: 10, elementIds: [1] },
      { id: 20, elementIds: [2] },
    ],
  });
}

function face(
  elementId: number,
  bodyId: number,
  faceIndex: number,
  primitiveStart: number,
  nodeIds: number[],
) {
  return {
    elementId,
    bodyId,
    faceIndex,
    primitiveStart,
    primitiveCount: 1,
    key: nodeIds.join(":"),
    nodeIds,
  };
}

function edge(key: string, nodeIds: number[], incidentElementIds: number[]) {
  return { key, nodeIds, incidentElementIds, faceRefs: [] };
}

function targetLabel(target: ReturnType<typeof selectAllTargets>[number]): string {
  switch (target.kind) {
    case "body":
      return `body:${target.bodyId}`;
    case "element":
      return `element:${target.elementId}`;
    case "face":
      return `face:${target.elementId}:${target.faceIndex}`;
    case "node":
      return `node:${target.nodeId}`;
    case "edge":
      return `edge:${target.key}`;
    case "part":
      return `part:${target.partId}`;
    case "partOccurrence":
      return `instance:${target.partOccurrenceId}`;
  }
}
