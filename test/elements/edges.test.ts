import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { edgesOf, uniqueEdges } from "../../src/elements/edges";
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

const sequentialElement = (id: number, shape: ElementShape) =>
  createElement(
    id,
    shape,
    Array.from({ length: topologyFor(shape).nodeCount }, (_, index) => index),
  );

describe("edgesOf", () => {
  it("extracts the six Tet4 edges in canonical order", () => {
    expect(edgesOf(sequentialElement(1, TET4_SHAPE)).map((edge) => edge.nodeIds)).toEqual([
      [0, 1],
      [1, 2],
      [2, 0],
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
  });

  it("keeps the mid-edge node between the corners of a Tet10 edge", () => {
    expect(edgesOf(sequentialElement(1, TET10_SHAPE)).map((edge) => edge.nodeIds)).toEqual([
      [0, 4, 1],
      [1, 5, 2],
      [2, 6, 0],
      [0, 7, 3],
      [1, 8, 3],
      [2, 9, 3],
    ]);
  });

  it("extracts the twelve Hex8 edges in canonical order", () => {
    expect(edgesOf(sequentialElement(1, HEX8_SHAPE)).map((edge) => edge.nodeIds)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [3, 7],
      [2, 6],
    ]);
  });

  it("keeps the mid-edge node between the corners of a Hex20 edge", () => {
    expect(edgesOf(sequentialElement(1, HEX20_SHAPE)).map((edge) => edge.nodeIds)).toEqual([
      [0, 8, 1],
      [1, 9, 2],
      [2, 10, 3],
      [3, 11, 0],
      [4, 12, 5],
      [5, 13, 6],
      [6, 14, 7],
      [7, 15, 4],
      [0, 16, 4],
      [1, 17, 5],
      [3, 19, 7],
      [2, 18, 6],
    ]);
  });

  it("exposes a line element as a single edge and a point element as none", () => {
    expect(edgesOf(createElement(1, LINE_SHAPE, [0, 1])).map((edge) => edge.nodeIds)).toEqual([
      [0, 1],
    ]);
    expect(edgesOf(createElement(1, LINE3_SHAPE, [0, 1, 2])).map((edge) => edge.nodeIds)).toEqual([
      [0, 2, 1],
    ]);
    expect(edgesOf(createElement(1, POINT_SHAPE, [0]))).toEqual([]);
  });

  it("preserves the element's node identity, not connectivity positions", () => {
    const element = createElement(1, TET4_SHAPE, [10, 20, 30, 40]);
    expect(edgesOf(element).map((edge) => edge.nodeIds)).toEqual([
      [10, 20],
      [20, 30],
      [30, 10],
      [10, 40],
      [20, 40],
      [30, 40],
    ]);
  });

  it("is deterministic across repeated calls", () => {
    const element = sequentialElement(1, HEX20_SHAPE);
    expect(edgesOf(element)).toEqual(edgesOf(element));
  });
});

describe("uniqueEdges", () => {
  it("deduplicates edges shared between two tets", () => {
    const a = createElement(1, TET4_SHAPE, [0, 1, 2, 3]);
    const b = createElement(2, TET4_SHAPE, [0, 1, 2, 4]);
    const edges = uniqueEdges([a, b]);
    expect(edges).toHaveLength(9);
    expect(edges.map((edge) => edge.nodeIds)).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [1, 2],
      [1, 3],
      [1, 4],
      [2, 3],
      [2, 4],
    ]);
  });

  it("deduplicates quadratic edges shared between two Tet10 elements", () => {
    const a = createElement(1, TET10_SHAPE, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const b = createElement(2, TET10_SHAPE, [0, 1, 2, 10, 4, 5, 6, 11, 12, 13]);
    const edges = uniqueEdges([a, b]);
    expect(edges).toHaveLength(9);
    expect(edges.map((edge) => edge.nodeIds)).toEqual([
      [0, 4, 1],
      [0, 6, 2],
      [0, 7, 3],
      [0, 11, 10],
      [1, 5, 2],
      [1, 8, 3],
      [1, 12, 10],
      [2, 9, 3],
      [2, 13, 10],
    ]);
  });

  it("canonicalizes each edge to ascending corners with the mid node centered", () => {
    const element = createElement(1, TET10_SHAPE, [10, 20, 30, 40, 1, 2, 3, 4, 5, 6]);
    expect(uniqueEdges([element]).map((edge) => edge.nodeIds)).toEqual([
      [10, 1, 20],
      [10, 3, 30],
      [10, 4, 40],
      [20, 2, 30],
      [20, 5, 40],
      [30, 6, 40],
    ]);
  });

  it("keeps line and point element output without deduping away their topology", () => {
    const line = createElement(1, LINE_SHAPE, [0, 1]);
    const point = createElement(2, POINT_SHAPE, [0]);
    const edges = uniqueEdges([line, point]);
    expect(edges.map((edge) => edge.nodeIds)).toEqual([[0, 1]]);
  });

  it("returns edges sorted deterministically regardless of element order", () => {
    const a = createElement(1, TET4_SHAPE, [0, 1, 2, 3]);
    const b = createElement(2, TET4_SHAPE, [0, 1, 2, 4]);
    expect(uniqueEdges([a, b])).toEqual(uniqueEdges([b, a]));
  });

  it("returns no edges for an empty input", () => {
    expect(uniqueEdges([])).toEqual([]);
  });
});
