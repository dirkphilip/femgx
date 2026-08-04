import { describe, expect, it } from "vitest";
import {
  decodePickId,
  encodePickId,
  MAX_PICK_ID,
  PICK_TEXTURE_FORMAT,
} from "../../src/renderer/pick-format";

describe("pick format", () => {
  it("targets an rgba8unorm attachment", () => {
    expect(PICK_TEXTURE_FORMAT).toBe("rgba8unorm");
  });

  it("round-trips the minimum supported pick id", () => {
    expect(encodePickId(1)).toEqual(new Uint8Array([1, 0, 0, 0]));
    expect(decodePickId(encodePickId(1))).toBe(1);
  });

  it("round-trips the maximum supported pick id", () => {
    expect(decodePickId(encodePickId(MAX_PICK_ID))).toBe(MAX_PICK_ID);
  });

  it("round-trips ids at every byte boundary", () => {
    for (const id of [0, 1, 255, 256, 65_535, 65_536, 16_777_215, 16_777_216]) {
      expect(decodePickId(encodePickId(id))).toBe(id);
    }
  });

  it("packs the id little-endian across the RGBA channels", () => {
    const bytes = encodePickId(0x04030201);
    expect([...bytes]).toEqual([0x01, 0x02, 0x03, 0x04]);
    expect(decodePickId([0x01, 0x02, 0x03, 0x04])).toBe(0x04030201);
  });

  it("decodes an id from an offset into a larger pixel buffer", () => {
    const buffer = new Uint8Array([9, 9, 7, 0, 0, 0]);
    expect(decodePickId(buffer, 2)).toBe(7);
  });

  it("decodes a cleared (all-zero) pixel as the no-hit id", () => {
    expect(decodePickId(new Uint8Array([0, 0, 0, 0]))).toBe(0);
  });
});
