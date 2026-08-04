import { describe, expect, it } from "vitest";
import {
  chunkDataByteLength,
  isLodChunkSource,
  partFromChunk,
  selectChunkDetail,
} from "../../src/streaming/chunk";
import { parseChunk } from "../../src/streaming/parser";
import { lodLineChunk, quadChunk } from "./fixtures";

describe("chunkDataByteLength", () => {
  it("sums the position and index buffers", () => {
    const source = quadChunk(1, 0, 0);
    expect(chunkDataByteLength(source.data)).toBe(48 + 24);
  });
});

describe("isLodChunkSource", () => {
  it("distinguishes LOD sources from plain chunks", () => {
    expect(isLodChunkSource(quadChunk(1, 0, 0))).toBe(false);
    expect(isLodChunkSource(lodLineChunk(1, 0, 0))).toBe(true);
  });
});

describe("selectChunkDetail", () => {
  it("returns the selected detail as a chunk that keeps id and index", () => {
    const source = lodLineChunk(7, 2, 10, [4, 2]);
    const coarse = selectChunkDetail(source, 1);
    expect(coarse.chunkId).toBe(7);
    expect(coarse.index).toBe(2);
    expect(coarse.data.positions).toHaveLength(6);
    expect(coarse.data.indices).toHaveLength(2);
    expect(coarse.bounds).toEqual(source.details[1]?.bounds);
  });

  it("clamps an out-of-range level to the coarsest detail", () => {
    expect(selectChunkDetail(lodLineChunk(1, 0, 0, [4, 2]), 99).data.indices).toHaveLength(2);
  });

  it("clamps a negative level to the finest detail", () => {
    expect(selectChunkDetail(lodLineChunk(1, 0, 0, [4, 2]), -1).data.indices).toHaveLength(4);
  });

  it("throws for a chunk with no detail levels", () => {
    expect(() => selectChunkDetail(lodLineChunk(1, 0, 0, []), 0)).toThrow(/detail levels/);
  });
});

describe("partFromChunk", () => {
  it("maps a parsed chunk to a renderable part", () => {
    const parsed = parseChunk(quadChunk(7, 2, 0));
    const part = partFromChunk(parsed);
    expect(part.id).toBe(7);
    expect(part.bounds).toEqual(parsed.bounds);
    expect(part.geometry.positions).toBe(parsed.positions);
    expect(part.geometry.indices).toBe(parsed.indices);
  });

  it("honors an explicit part id", () => {
    const parsed = parseChunk(quadChunk(7, 2, 0));
    expect(partFromChunk(parsed, 99).id).toBe(99);
  });
});
