import { describe, expect, it } from "vitest";
import { buildNodeDraws } from "@/renderer/frame/node-draw";

describe("procedural node draws", () => {
  it("uses one four-vertex strip per flattened node occurrence", () => {
    expect(buildNodeDraws(3, 2)).toEqual([
      { vertexCount: 4, instanceCount: 6, firstInstance: 0, orderByteOffset: 0 },
    ]);
  });

  it("keeps a nonzero occurrence range aligned with the node order", () => {
    expect(buildNodeDraws(3, 2, 5)).toEqual([
      { vertexCount: 4, instanceCount: 6, firstInstance: 15, orderByteOffset: 0 },
    ]);
  });

  it("splits beyond the WebGPU instance bound and rebinds the order range", () => {
    expect(buildNodeDraws(4, 1_073_741_824, 0, 4)).toEqual([
      { vertexCount: 4, instanceCount: 4_294_967_292, firstInstance: 0, orderByteOffset: 0 },
      {
        vertexCount: 4,
        instanceCount: 4,
        firstInstance: 0,
        orderByteOffset: 4_294_967_292,
      },
    ]);
  });

  it("rejects an aligned order range whose flattened start cannot fit", () => {
    expect(() => buildNodeDraws(100_000_000, 1, 63)).toThrow(
      "Node sprite draw range exceeds WebGPU's 32-bit instance range",
    );
  });
});
