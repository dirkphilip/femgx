import { describe, expect, it } from "vitest";
import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  QUAD8_SHAPE,
  QUAD_SHAPE,
  TRI6_SHAPE,
  TRIANGLE_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
  topologyFor,
  type ElementShape,
} from "../../src/elements/shapes";

const ALL_SHAPES: ReadonlyArray<readonly [string, ElementShape]> = [
  ["point", POINT_SHAPE],
  ["line", LINE_SHAPE],
  ["line3", LINE3_SHAPE],
  ["triangle", TRIANGLE_SHAPE],
  ["tri6", TRI6_SHAPE],
  ["quad", QUAD_SHAPE],
  ["quad8", QUAD8_SHAPE],
  ["tet4", TET4_SHAPE],
  ["tet10", TET10_SHAPE],
  ["hex8", HEX8_SHAPE],
  ["hex20", HEX20_SHAPE],
];

describe("topologyFor", () => {
  it.each(ALL_SHAPES)("reports the canonical node count for %s", (_name, shape) => {
    const expected: Record<string, number> = {
      point: 1,
      line: 2,
      line3: 3,
      triangle: 3,
      tri6: 6,
      quad: 4,
      quad8: 8,
      tet4: 4,
      tet10: 10,
      hex8: 8,
      hex20: 20,
    };
    expect(topologyFor(shape).nodeCount).toBe(expected[_name]);
  });

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

  it("keeps mid-edge nodes aligned with the edges they bisect", () => {
    for (const [_name, shape] of ALL_SHAPES) {
      const topology = topologyFor(shape);
      if (topology.order < 2) {
        expect(topology.edgeNodes).toEqual([]);
        continue;
      }
      expect(topology.edgeNodes).toHaveLength(topology.edges.length);
      topology.edges.forEach((edge, index) => {
        expect(topology.corners[edge[0]]).toBeDefined();
        expect(topology.corners[edge[1]]).toBeDefined();
        expect(topology.edgeNodes[index]).toBeDefined();
      });
    }
  });

  it("registers a topology whose family and order match every exported shape", () => {
    for (const [_name, shape] of ALL_SHAPES) {
      const topology = topologyFor(shape);
      expect(topology.family).toBe(shape.family);
      expect(topology.order).toBe(shape.order);
    }
  });

  it("throws for an unsupported order", () => {
    expect(() => topologyFor({ family: "tet", order: 3 as ElementShape["order"] })).toThrow(
      "Unsupported element shape",
    );
    expect(() => topologyFor({ family: "hex", order: 3 as ElementShape["order"] })).toThrow(
      "Unsupported element shape",
    );
    expect(() => topologyFor({ family: "line", order: 3 as ElementShape["order"] })).toThrow(
      "Unsupported element shape",
    );
  });

  it("throws for an unknown family", () => {
    expect(() => topologyFor({ family: "polygon" as ElementShape["family"], order: 1 })).toThrow(
      "Unsupported element shape",
    );
  });
});
