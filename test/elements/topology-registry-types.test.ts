import { describe, expect, it } from "vitest";
import type { ElementShape, KeyedTopology } from "../../src/elements/shapes";

function topology<K extends "line:1" | "tet:1">(entry: KeyedTopology<K>): KeyedTopology<K> {
  return entry;
}

describe("topology registry key pinning", () => {
  it("keeps the compile-only probes in the typechecked test project", () => {
    const valid = topology<"tet:1">({
      family: "tet",
      order: 1,
      nodeCount: 4,
      corners: [0, 1, 2, 3],
      edges: [],
      edgeNodes: [],
    });
    expect(valid.family).toBe("tet");
  });
});

const wrongFamily = topology<"tet:1">({
  // @ts-expect-error A topology key pins its family literal.
  family: "line",
  order: 1,
  nodeCount: 4,
  corners: [0, 1, 2, 3],
  edges: [],
  edgeNodes: [],
});

const wrongOrder = topology<"line:1">({
  family: "line",
  // @ts-expect-error A topology key pins its interpolation-order literal.
  order: 2,
  nodeCount: 2,
  corners: [0, 1],
  edges: [],
  edgeNodes: [],
});

void wrongFamily;
void wrongOrder;

// @ts-expect-error Only discriminants exposed by ElementShape are supported.
const unsupportedShape: ElementShape = "wedge:2";

void unsupportedShape;
