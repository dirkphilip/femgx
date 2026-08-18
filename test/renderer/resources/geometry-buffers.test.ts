import { describe, expect, it } from "vitest";
import {
  packTopologyData,
  packUnownedEdgeTopologyData,
} from "../../../src/renderer/resources/geometry-buffers";

describe("packed topology data", () => {
  it("stores element ordinals before primitive and edge metadata", () => {
    const data = packTopologyData(
      new Uint32Array([10, 11, 12, 13, 14]),
      new Uint32Array([0, 1]),
      new Uint32Array([20, 21]),
      new Uint32Array([30, 31]),
      {
        elementOrdinals: new Uint32Array([41, 42]),
        primitiveIds: new Uint32Array([51, 52]),
        edgeIds: new Uint32Array([61, 62]),
      },
    );

    expect(Array.from(data)).toEqual([
      1, 1, 1, 2, 10, 11, 12, 13, 14, 0, 1, 20, 21, 30, 31, 41, 42, 2, 51, 52, 61, 62,
    ]);
  });

  it("packs bodyless edge topology directly without changing its storage layout", () => {
    const faceData = new Uint32Array([0, 0, 0, 21, 0, 0, 0, 0, 9, 0]);
    const bodyRanges = new Uint32Array([0, 2, 2, 1]);
    const bodyIds = new Uint32Array(6);
    const elementIds = new Uint32Array([9, 0, 21, 0, 9, 0]);
    const elementOrdinals = new Uint32Array([4, 5]);
    const edgeIds = new Uint32Array([0, 0, 1, 1]);

    const expected = packTopologyData(faceData, bodyRanges, bodyIds, elementIds, {
      elementOrdinals,
      primitiveIds: [],
      edgeIds,
    });
    const actual = packUnownedEdgeTopologyData(
      {
        indices: edgeIds,
        sourceVertexIndices: edgeIds,
        edgeIds,
        positions: new Float32Array(),
        bodyRanges,
        bodyIds,
        elementIds,
      },
      elementOrdinals,
      new Uint32Array([21, 9]),
      edgeIds,
    );

    expect(actual).toEqual(expected);
  });

  it("strips empty condition sentinels in the direct topology path", () => {
    const empty = {
      indices: new Uint32Array(),
      sourceVertexIndices: new Uint32Array(),
      edgeIds: new Uint32Array(),
      positions: new Float32Array(),
      bodyRanges: new Uint32Array([0, 0]),
      bodyIds: new Uint32Array([0]),
      elementIds: new Uint32Array([0]),
    };
    const expected = packTopologyData(
      new Uint32Array(),
      empty.bodyRanges,
      empty.bodyIds,
      empty.elementIds,
    );

    expect(
      packUnownedEdgeTopologyData(empty, new Uint32Array(), new Uint32Array(), new Uint32Array()),
    ).toEqual(expected);
  });

  it("appends triangle corner connectivity after primitive metadata", () => {
    const data = packTopologyData(
      new Uint32Array([0, 0, 0, 7, 0]),
      new Uint32Array([0, 1]),
      new Uint32Array([0]),
      new Uint32Array([0]),
      {
        elementOrdinals: new Uint32Array([2]),
        primitiveIds: new Uint32Array([3]),
        edgeIds: new Uint32Array(),
        cornerIndices: new Uint32Array([4, 5, 6]),
      },
    );

    expect(Array.from(data)).toEqual([1, 1, 0, 1, 0, 0, 0, 7, 0, 0, 1, 2, 1, 3, 4, 5, 6]);
  });
});
