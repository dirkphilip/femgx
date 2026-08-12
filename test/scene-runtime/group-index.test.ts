import { describe, expect, it } from "vitest";
import { findGroupRange } from "../../src/scene-runtime/group-index";

describe("scene-runtime group index", () => {
  it("resolves deterministic packed ranges and preserves unknown-key misses", () => {
    const keys = new Uint32Array([2, 7]);
    const offsets = new Uint32Array([0, 2, 3]);
    expect(findGroupRange(keys, offsets, 3, 2)).toEqual([0, 2]);
    expect(findGroupRange(keys, offsets, 3, 7)).toEqual([2, 3]);
    expect(findGroupRange(keys, offsets, 3, 5)).toBeUndefined();
  });

  it("rejects truncated offsets and ranges beyond the packed list", () => {
    expect(() => findGroupRange(new Uint32Array([2]), new Uint32Array([0]), 1, 2)).toThrow(
      "group offsets are not terminated",
    );
    expect(() => findGroupRange(new Uint32Array([2]), new Uint32Array([0, 2]), 1, 2)).toThrow(
      "invalid group range",
    );
  });
});
