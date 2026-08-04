import { describe, expect, it } from "vitest";
import type { ChunkData, ChunkSource } from "../../src/streaming/chunk";
import { chunkTransferables, parseChunk, validateChunkData } from "../../src/streaming/parser";
import { computeLocalOrigin } from "../../src/streaming/rebase";
import { quadChunk } from "./fixtures";

describe("validateChunkData", () => {
  it("accepts valid chunk data", () => {
    expect(() => {
      validateChunkData(quadChunk(1, 0, 0).data);
    }).not.toThrow();
  });

  it("rejects indices that reference missing vertices", () => {
    const data: ChunkData = {
      positions: new Float32Array([0, 0, 0, 1, 1, 1]),
      indices: new Uint32Array([0, 1, 5]),
    };
    expect(() => {
      validateChunkData(data);
    }).toThrow(/out of range/);
  });

  it("rejects position buffers that are not a multiple of three", () => {
    const data: ChunkData = {
      positions: new Float32Array([0, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    };
    expect(() => {
      validateChunkData(data);
    }).toThrow(/not a multiple of 3/);
  });
});

describe("parseChunk", () => {
  it("computes bounds when the source has none", () => {
    const source: ChunkSource = { chunkId: 1, index: 0, data: quadChunk(1, 0, 0).data };
    const parsed = parseChunk(source);
    expect(parsed.bounds.minX).toBe(-0.5);
    expect(parsed.bounds.maxX).toBe(0.5);
    expect(parsed.positions).toBe(source.data.positions);
    expect(parsed.indices).toBe(source.data.indices);
  });

  it("carries the source bounds when present", () => {
    const source = quadChunk(1, 0, 5);
    const parsed = parseChunk(source);
    expect(parsed.bounds).toEqual(source.bounds);
  });

  it("rebases positions and bounds by a local origin without mutating the source", () => {
    const source = quadChunk(1, 0, 5);
    const parsed = parseChunk(source, { origin: [5, 0, 0] });
    expect(parsed.positions[0]).toBe(-0.5);
    expect(parsed.positions[3]).toBe(0.5);
    expect(parsed.bounds.minX).toBe(-0.5);
    expect(parsed.bounds.maxX).toBe(0.5);
    expect(source.data.positions[0]).toBe(4.5);
    expect(parsed.positions).not.toBe(source.data.positions);
  });

  it("keeps element tessellations when present", () => {
    const source = quadChunk(1, 0, 0);
    const parsed = parseChunk({
      ...source,
      data: { ...source.data, elements: [{ id: 0, triangleStart: 0, triangleCount: 2 }] },
    });
    expect(parsed.elements).toHaveLength(1);
  });

  it("throws when declared elements do not cover the triangles", () => {
    const source = quadChunk(1, 0, 0);
    const data = { ...source.data, elements: [{ id: 0, triangleStart: 0, triangleCount: 1 }] };
    expect(() => parseChunk({ ...source, data })).toThrow(/not covered/);
  });
});

describe("chunkTransferables", () => {
  it("returns the position and index buffers for a transfer list", () => {
    const parsed = parseChunk(quadChunk(1, 0, 0));
    const transferables = chunkTransferables(parsed);
    expect(transferables).toEqual([parsed.positions.buffer, parsed.indices.buffer]);
  });
});

describe("parseChunk integration", () => {
  it("reprojects a model far from the world origin near the local origin", () => {
    const farChunk = quadChunk(1, 0, 10_000_000);
    const origin = computeLocalOrigin([farChunk]);
    const parsed = parseChunk(farChunk, { origin });
    expect(Math.abs(parsed.positions[0] ?? 0)).toBeLessThanOrEqual(1);
    expect(Math.abs(parsed.bounds.maxX)).toBeLessThanOrEqual(1);
  });

  it("preserves sub-float32 detail when parsing double-precision input", () => {
    const large = 6_000_000;
    const positions = new Float64Array([large + 0.5, large + 0.25, 0, large, 0, 0, large, 1, 0]);
    const source: ChunkSource = {
      chunkId: 1,
      index: 0,
      data: { positions, indices: new Uint32Array([0, 1, 2]) },
    };
    const parsed = parseChunk(source, { origin: [large, large, 0] });
    expect(parsed.positions).toBeInstanceOf(Float32Array);
    expect(parsed.positions[0]).toBe(0.5);
    expect(parsed.positions[1]).toBe(0.25);
    expect(parsed.bounds.minX).toBe(0);
    expect(parsed.bounds.maxX).toBe(0.5);
  });

  it("converts double-precision input to float32 without an origin", () => {
    const source: ChunkSource = {
      chunkId: 1,
      index: 0,
      data: {
        positions: new Float64Array([1.5, 2.5, 3.5, 0, 0, 0, 1, 1, 1]),
        indices: new Uint32Array([0, 1, 2]),
      },
    };
    const parsed = parseChunk(source);
    expect(parsed.positions).toBeInstanceOf(Float32Array);
    expect(parsed.positions[0]).toBe(1.5);
  });
});
