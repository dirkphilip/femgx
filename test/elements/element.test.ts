import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
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

const nodeIds = (shape: ElementShape): number[] =>
  Array.from({ length: topologyFor(shape).nodeCount }, (_, index) => index);

describe("createElement", () => {
  it.each(ALL_SHAPES)("creates a valid %s element", (_name, shape) => {
    const element = createElement(1, shape, nodeIds(shape));
    expect(element.id).toBe(1);
    expect(element.shape).toEqual(shape);
    expect(element.nodeIds).toEqual(nodeIds(shape));
  });

  it("owns a copy of the connectivity", () => {
    const nodes = [0, 1, 2, 3];
    const element = createElement(1, ElementShape.Tet4, nodes);
    nodes[0] = 99;
    expect(element.nodeIds[0]).toBe(0);
  });

  it.each(ALL_SHAPES)("rejects a connectivity that is too short for %s", (_name, shape) => {
    const tooFew = nodeIds(shape).slice(0, -1);
    expect(() => createElement(1, shape, tooFew)).toThrow(/expects .* nodes but got/);
  });

  it.each(ALL_SHAPES)("rejects a connectivity that is too long for %s", (_name, shape) => {
    const tooMany = [...nodeIds(shape), 999];
    expect(() => createElement(1, shape, tooMany)).toThrow(/expects .* nodes but got/);
  });

  it("rejects duplicate node references", () => {
    expect(() => createElement(1, ElementShape.Tet4, [0, 1, 1, 2])).toThrow(
      "references node 1 more than once",
    );
    expect(() => createElement(2, ElementShape.Hex8, [0, 1, 2, 3, 4, 5, 6, 0])).toThrow(
      "references node 0 more than once",
    );
  });

  it("rejects negative node ids", () => {
    expect(() => createElement(1, ElementShape.Tet4, [0, 1, 2, -1])).toThrow("invalid node id -1");
  });

  it("rejects non-integer node ids", () => {
    expect(() => createElement(1, ElementShape.Tet4, [0, 1, 2, 1.5])).toThrow(
      "invalid node id 1.5",
    );
  });

  it("rejects negative and non-integer element ids", () => {
    expect(() => createElement(-1, ElementShape.Tet4, [0, 1, 2, 3])).toThrow(
      "Element id must be a safe integer",
    );
    expect(() => createElement(1.5, ElementShape.Tet4, [0, 1, 2, 3])).toThrow(
      "Element id must be a safe integer",
    );
    expect(() => createElement(0xffff_ffff, ElementShape.Tet4, [0, 1, 2, 3])).toThrow(
      "Element id must be a safe integer",
    );
  });

  it("accepts the largest element id representable by one-based GPU picking", () => {
    expect(createElement(0xffff_fffe, ElementShape.Tet4, [0, 1, 2, 3]).id).toBe(0xffff_fffe);
  });
});
