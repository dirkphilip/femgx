import { describe, expect, it } from "vitest";
import { ElementShape, topologyFor } from "../../src/elements/shapes";

const ALL_SHAPES: ReadonlyArray<readonly [string, ElementShape]> = [
  ["point", ElementShape.Point],
  ["line", ElementShape.Line],
  ["line3", ElementShape.Line3],
  ["triangle", ElementShape.Triangle],
  ["tri6", ElementShape.Tri6],
  ["quad", ElementShape.Quad],
  ["quad8", ElementShape.Quad8],
  ["tet4", ElementShape.Tet4],
  ["tet10", ElementShape.Tet10],
  ["wedge6", ElementShape.Wedge6],
  ["pyramid5", ElementShape.Pyramid5],
  ["hex8", ElementShape.Hex8],
  ["hex20", ElementShape.Hex20],
];

describe("topologyFor", () => {
  it("assigns every connectivity position as either a corner or a mid-edge node", () => {
    for (const [_name, shape] of ALL_SHAPES) {
      const topology = topologyFor(shape);
      const positions = new Set([...topology.corners, ...topology.edgeNodes]);
      expect(positions.size).toBe(topology.nodeCount);
      for (let position = 0; position < topology.nodeCount; position += 1) {
        expect(positions.has(position)).toBe(true);
      }
    }
  });

  it("exposes every documented shape as one primitive discriminant", () => {
    expect(Object.values(ElementShape)).toEqual(ALL_SHAPES.map(([, shape]) => shape));
    expect(new Set(Object.values(ElementShape)).size).toBe(ALL_SHAPES.length);
  });
});
