import { describe, expect, it } from "vitest";
import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  QUAD_SHAPE,
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
  ["quad", QUAD_SHAPE],
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
      quad: 4,
      tet4: 4,
      tet10: 10,
      hex8: 8,
      hex20: 20,
    };
    expect(topologyFor(shape).nodeCount).toBe(expected[_name]);
  });

  it("orders a point element as a single corner", () => {
    expect(topologyFor(POINT_SHAPE)).toEqual({
      family: "point",
      order: 0,
      nodeCount: 1,
      corners: [0],
      edges: [],
      edgeNodes: [],
    });
  });

  it("orders line corners before the mid-edge node", () => {
    expect(topologyFor(LINE_SHAPE)).toMatchObject({ corners: [0, 1], edgeNodes: [] });
    expect(topologyFor(LINE3_SHAPE)).toMatchObject({ corners: [0, 1], edgeNodes: [2] });
  });

  it("places tet10 mid-edge nodes on the six tet edges in canonical order", () => {
    const tet4 = topologyFor(TET4_SHAPE);
    const tet10 = topologyFor(TET10_SHAPE);
    expect(tet4.corners).toEqual([0, 1, 2, 3]);
    expect(tet4.edges).toHaveLength(6);
    expect(tet4.edgeNodes).toEqual([]);
    expect(tet10.edgeNodes).toEqual([4, 5, 6, 7, 8, 9]);
    expect(tet10.edges).toEqual(tet4.edges);
  });

  it("places hex20 mid-edge nodes on the twelve hex edges in canonical order", () => {
    const hex8 = topologyFor(HEX8_SHAPE);
    const hex20 = topologyFor(HEX20_SHAPE);
    expect(hex8.corners).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(hex8.edges).toHaveLength(12);
    expect(hex8.edgeNodes).toEqual([]);
    expect(hex20.edgeNodes).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(hex20.edges).toEqual(hex8.edges);
  });

  it("sits each hex20 mid-edge node on its VTK corner pair", () => {
    const hex20 = topologyFor(HEX20_SHAPE);
    const pairs = hex20.edges.map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as const);
    expect(pairs).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [0, 3],
      [4, 5],
      [5, 6],
      [6, 7],
      [4, 7],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ]);
    expect(hex20.edgeNodes).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
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
