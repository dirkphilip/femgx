import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
  topologyFor,
  type ElementShape,
} from "../../src/elements/shapes";

const ALL_SHAPES: ReadonlyArray<readonly [string, ElementShape]> = [
  ["point", POINT_SHAPE],
  ["line", LINE_SHAPE],
  ["line3", LINE3_SHAPE],
  ["tet4", TET4_SHAPE],
  ["tet10", TET10_SHAPE],
  ["hex8", HEX8_SHAPE],
  ["hex20", HEX20_SHAPE],
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
    const element = createElement(1, TET4_SHAPE, nodes);
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
    expect(() => createElement(1, TET4_SHAPE, [0, 1, 1, 2])).toThrow(
      "references node 1 more than once",
    );
    expect(() => createElement(2, HEX8_SHAPE, [0, 1, 2, 3, 4, 5, 6, 0])).toThrow(
      "references node 0 more than once",
    );
  });

  it("rejects an unsupported shape order", () => {
    expect(() =>
      createElement(1, { family: "tet", order: 3 as ElementShape["order"] }, [0, 1, 2, 3]),
    ).toThrow("Unsupported element shape");
  });

  it("rejects negative node ids", () => {
    expect(() => createElement(1, TET4_SHAPE, [0, 1, 2, -1])).toThrow("invalid node id -1");
  });

  it("rejects non-integer node ids", () => {
    expect(() => createElement(1, TET4_SHAPE, [0, 1, 2, 1.5])).toThrow("invalid node id 1.5");
  });

  it("rejects negative and non-integer element ids", () => {
    expect(() => createElement(-1, TET4_SHAPE, [0, 1, 2, 3])).toThrow(
      "Element id must be a non-negative integer",
    );
    expect(() => createElement(1.5, TET4_SHAPE, [0, 1, 2, 3])).toThrow(
      "Element id must be a non-negative integer",
    );
  });
});
