import { describe, expect, it } from "vitest";
import { sortFixedCanonicalRows, sortVariableCanonicalRows } from "@/elements/canonical-row-order";

describe("canonical topology row ordering", () => {
  it("orders fixed-width rows exactly across the unsafe-number boundary", () => {
    const rows = new Uint32Array([
      174_889, 174_950, 178_672, 1, 2, 3, 174_889, 174_950, 178_671, 1, 2, 3, 0xffff_fffd,
      0xffff_fffe, 0xffff_ffff,
    ]);

    expect(Array.from(sortFixedCanonicalRows(rows, 3))).toEqual([1, 3, 2, 0, 4]);
  });

  it("orders mixed face widths by their complete canonical node rows", () => {
    const offsets = new Uint32Array([0, 3, 7, 10, 14]);
    const nodes = new Uint32Array([1, 4, 9, 1, 4, 9, 10, 1, 4, 10, 1, 4, 9, 10]);

    expect(Array.from(sortVariableCanonicalRows(offsets, nodes))).toEqual([0, 1, 3, 2]);
  });
});
