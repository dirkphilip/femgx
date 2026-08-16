import { describe, expect, it } from "vitest";
import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  PYRAMID5_SHAPE,
  QUAD8_SHAPE,
  QUAD_SHAPE,
  TRI6_SHAPE,
  TRIANGLE_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
  topologyFor,
  type ElementShape,
  WEDGE6_SHAPE,
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
  ["wedge6", WEDGE6_SHAPE],
  ["pyramid5", PYRAMID5_SHAPE],
  ["hex8", HEX8_SHAPE],
  ["hex20", HEX20_SHAPE],
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
