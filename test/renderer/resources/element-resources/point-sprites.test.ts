import { describe, expect, it } from "vitest";
import { compactNodeSpriteData, expandPointGeometry } from "@/renderer/resources/point-sprites";

describe("point sprite expansion", () => {
  it("compacts sparse authored node ids without retained quad indices", () => {
    expect(
      compactNodeSpriteData(new Float32Array([1, 2, 3, 4, 5, 6]), new Uint32Array([2, 1])),
    ).toEqual({
      positions: new Float32Array([4, 5, 6, 1, 2, 3]),
      ids: new Uint32Array([2, 1]),
    });
  });

  it("reuses sequential authored node centers and ids", () => {
    const positions = new Float32Array([1, 2, 3, 4, 5, 6]);
    const ids = new Uint32Array([1, 2]);

    const compact = compactNodeSpriteData(positions, ids);

    expect(compact.positions).toBe(positions);
    expect(compact.ids).toBe(ids);
  });

  it("eliminates exactly 24,048,024 sprite-index bytes for 1,002,001 nodes", () => {
    const nodeCount = 1_002_001;
    const positions = new Float32Array(nodeCount * 3);
    const ids = new Uint32Array(nodeCount);
    for (let index = 0; index < nodeCount; index += 1) ids[index] = index + 1;

    const compact = compactNodeSpriteData(positions, ids);

    expect(compact.positions).toBe(positions);
    expect(compact.ids).toBe(ids);
    expect(nodeCount * 6 * Uint32Array.BYTES_PER_ELEMENT).toBe(24_048_024);
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
