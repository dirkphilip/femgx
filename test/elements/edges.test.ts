import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { edgesOf, uniqueEdges } from "../../src/elements/edges";
import { ElementShape, topologyFor } from "../../src/elements/shapes";

const sequentialElement = (id: number, shape: ElementShape) =>
  createElement(
    id,
    shape,
    Array.from({ length: topologyFor(shape).nodeCount }, (_, index) => index),
  );

describe("edgesOf", () => {
  it("preserves the element's node identityMatrix, not connectivity positions", () => {
    const element = createElement(1, ElementShape.Tet4, [10, 20, 30, 40]);
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
    const element = sequentialElement(1, ElementShape.Hex20);
    expect(edgesOf(element)).toEqual(edgesOf(element));
  });
});

describe("uniqueEdges", () => {
  it("deduplicates edges shared between two tets", () => {
    const a = createElement(1, ElementShape.Tet4, [0, 1, 2, 3]);
    const b = createElement(2, ElementShape.Tet4, [0, 1, 2, 4]);
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
    const a = createElement(1, ElementShape.Tet10, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const b = createElement(2, ElementShape.Tet10, [0, 1, 2, 10, 4, 5, 6, 11, 12, 13]);
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
    const element = createElement(1, ElementShape.Tet10, [10, 20, 30, 40, 1, 2, 3, 4, 5, 6]);
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
    const line = createElement(1, ElementShape.Line, [0, 1]);
    const point = createElement(2, ElementShape.Point, [0]);
    const edges = uniqueEdges([line, point]);
    expect(edges.map((edge) => edge.nodeIds)).toEqual([[0, 1]]);
  });

  it("returns edges sorted deterministically regardless of element order", () => {
    const a = createElement(1, ElementShape.Tet4, [0, 1, 2, 3]);
    const b = createElement(2, ElementShape.Tet4, [0, 1, 2, 4]);
    expect(uniqueEdges([a, b])).toEqual(uniqueEdges([b, a]));
  });

  it("returns no edges for an empty input", () => {
    expect(uniqueEdges([])).toEqual([]);
  });
});
