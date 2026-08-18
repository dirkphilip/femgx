import { describe, expect, it } from "vitest";
import {
  buildNodeSpriteBuffers,
  expandPointGeometry,
} from "../../../../src/renderer/resources/point-sprites";

describe("point sprite expansion", () => {
  it("expands sparse authored node ids into exact node overlay buffers", () => {
    expect(
      buildNodeSpriteBuffers(new Float32Array([1, 2, 3, 4, 5, 6]), new Uint32Array([2, 1])),
    ).toEqual({
      positions: new Float32Array([
        4, 5, 6, 4, 5, 6, 4, 5, 6, 4, 5, 6, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3,
      ]),
      ids: new Uint32Array([2, 2, 2, 2, 1, 1, 1, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
    });
  });

  it("uses indexed centers and metadata for ordinary point geometry", () => {
    expect(
      expandPointGeometry({
        primitive: "points",
        positions: new Float32Array([1, 2, 3, 4, 5, 6]),
        indices: new Uint32Array([1, 0]),
        nodePickIds: new Uint32Array([10, 20]),
      }),
    ).toEqual({
      positions: new Float32Array([
        4, 5, 6, 4, 5, 6, 4, 5, 6, 4, 5, 6, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3,
      ]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
      nodePickIds: new Uint32Array([20, 20, 20, 20, 10, 10, 10, 10]),
      primitiveIds: new Uint32Array([0, 0, 0, 0, 1, 1, 1, 1]),
    });
  });
});
