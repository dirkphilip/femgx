import { describe, expect, it } from "vitest";
import { hit, type PickHit, interactionTargetFromHit } from "./support";

describe("interactionTargetFromHit", () => {
  it.each([
    ["part", { kind: "part", partId: 4 }],
    ["partOccurrence", { kind: "partOccurrence", partOccurrenceId: "1/2" }],
    ["body", { kind: "body", partOccurrenceId: "1/2", bodyId: 9 }],
    ["element", { kind: "element", partOccurrenceId: "1/2", elementId: 7 }],
    ["face", { kind: "face", partOccurrenceId: "1/2", elementId: 7, faceIndex: 1 }],
  ] as const)("maps a face hit to %s", (granularity, expected) => {
    expect(interactionTargetFromHit(hit, granularity)).toEqual(expected);
  });

  it("maps a node hit to a node target and rejects unsupported precision", () => {
    const node: PickHit = {
      kind: "node",
      partId: 4,
      partOccurrenceId: "1/2",
      elementId: 7,
      nodeId: 2,
      localPosition: [0, 0, 0],
      worldPosition: [2, 3, 4],
      neighborElementIds: [7],
      neighborNodeIds: [1],
    };
    expect(interactionTargetFromHit(node, "node")).toEqual({
      kind: "node",
      partOccurrenceId: "1/2",
      nodeId: 2,
    });
    expect(interactionTargetFromHit(node, "face")).toBeUndefined();
    expect(interactionTargetFromHit(node, "body")).toBeUndefined();
  });

  it("does not promote a node-only hit to a fabricated element target", () => {
    const node: PickHit = {
      kind: "node",
      partId: 4,
      partOccurrenceId: "1/2",
      nodeId: 2,
      localPosition: [0, 0, 0],
      worldPosition: [2, 3, 4],
      neighborElementIds: [],
      neighborNodeIds: [],
    };

    expect(interactionTargetFromHit(node, "element")).toBeUndefined();
  });
});
