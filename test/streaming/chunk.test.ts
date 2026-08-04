import { describe, expect, it } from "vitest";
import { chunkDataByteLength, partFromChunk } from "../../src/streaming/chunk";
import { parseChunk } from "../../src/streaming/parser";
import { quadChunk } from "./fixtures";

describe("chunkDataByteLength", () => {
  it("sums the position and index buffers", () => {
    const source = quadChunk(1, 0, 0);
    expect(chunkDataByteLength(source.data)).toBe(48 + 24);
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
