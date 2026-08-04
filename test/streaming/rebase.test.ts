import { describe, expect, it } from "vitest";
import type { Bounds } from "../../src/geometry/part";
import type { ChunkSource } from "../../src/streaming/chunk";
import { computeLocalOrigin, rebaseBounds, rebasePositions } from "../../src/streaming/rebase";
import { quadChunk } from "./fixtures";

const ORIGIN: readonly [number, number, number] = [10, -5, 100];

describe("rebasePositions", () => {
  it("subtracts the origin from every vertex", () => {
    const positions = new Float32Array([11, -5, 101, 20, 10, 0]);
    const rebased = rebasePositions(positions, ORIGIN);
    expect(Array.from(rebased)).toEqual([1, 0, 1, 10, 15, -100]);
  });

  it("returns a new buffer and leaves the input untouched", () => {
    const positions = new Float32Array([11, -5, 101]);
    const rebased = rebasePositions(positions, ORIGIN);
    expect(rebased).not.toBe(positions);
    expect(Array.from(positions)).toEqual([11, -5, 101]);
  });

  it("keeps near-origin coordinates representable for float32 precision", () => {
    const large = 6_000_000;
    const positions = new Float64Array([large + 0.5, large + 0.25, 0]);
    const rebased = rebasePositions(positions, [large, large, 0]);
    expect(rebased[0]).toBe(0.5);
    expect(rebased[1]).toBe(0.25);
  });

  it("documents that unrebaseed float32 storage loses sub-ulp detail", () => {
    const large = 10_000_000;
    expect(new Float32Array([large + 0.5])[0]).toBe(large);
  });
});

describe("rebaseBounds", () => {
  it("translates the axis-aligned bounds by the origin", () => {
    const bounds: Bounds = { minX: 9, minY: -6, minZ: 99, maxX: 12, maxY: -4, maxZ: 102 };
    expect(rebaseBounds(bounds, ORIGIN)).toEqual({
      minX: -1,
      minY: -1,
      minZ: -1,
      maxX: 2,
      maxY: 1,
      maxZ: 2,
    });
  });
});

describe("computeLocalOrigin", () => {
  it("returns the bounding-box center of the chunk union", () => {
    const chunks = [quadChunk(1, 0, 0), quadChunk(2, 1, 10)];
    const origin = computeLocalOrigin(chunks);
    expect(origin[0]).toBe(5);
    expect(origin[1]).toBe(0);
    expect(origin[2]).toBe(0);
  });

  it("computes bounds from data for chunks without precomputed bounds", () => {
    const withDataOnly: ChunkSource = { chunkId: 1, index: 0, data: quadChunk(1, 0, 8).data };
    const origin = computeLocalOrigin([withDataOnly]);
    expect(origin[0]).toBe(8);
  });

  it("is deterministic for a given chunk list", () => {
    const chunks = [quadChunk(1, 1, 3), quadChunk(2, 0, 7)];
    expect(computeLocalOrigin(chunks)).toEqual(computeLocalOrigin(chunks));
  });
});
