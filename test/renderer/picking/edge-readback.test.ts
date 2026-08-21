import { describe, expect, it } from "vitest";
import {
  createPickTargets,
  ensureEdgePickTarget,
  ensurePickTargets,
  READBACK_BYTE_STRIDE,
  readEdgePickPixel,
} from "@/renderer/picking/pick";
import { createPickDepthReadback } from "@/renderer/picking/depth";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "../fake-gpu";

describe("authored-edge pick readback", () => {
  it("maps ordinary ids, depth, and the exact edge id together", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice({
        pickValue: 3,
        elementPickValue: 9,
        facePickValue: 12,
        nodePickValue: 20,
        edgePickValue: 2,
        ndcDepth: 0.375,
      });
      const pick = createPickTargets(await createPickDepthReadback(gpu.device));
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      ensureEdgePickTarget(gpu.device, pick, 800, 600);

      await expect(readEdgePickPixel(gpu.device, fakeCanvas(), pick, 10, 10)).resolves.toEqual({
        ids: {
          instancePickId: 3,
          elementPickId: 9,
          facePickId: 12,
          nodePickId: 20,
          ndcDepth: 0.375,
        },
        edgePickId: 2,
      });
      expect(gpu.mapAsyncCount).toBe(1);
      expect(gpu.submissionCount).toBe(1);
      expect(gpu.bufferCopies).toEqual([
        { sourceOffset: 8, destinationOffset: READBACK_BYTE_STRIDE * 5, size: 4 },
      ]);

      await readEdgePickPixel(gpu.device, fakeCanvas(), pick, 20, 20);
      expect(gpu.mapAsyncCount).toBe(2);
      expect(gpu.buffers.filter((buffer) => buffer.size === READBACK_BYTE_STRIDE * 6)).toHaveLength(
        1,
      );
    } finally {
      restore();
    }
  });
});
