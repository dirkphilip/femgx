import { describe, expect, it } from "vitest";
import { createPart } from "@/geometry/part";
import { identityMatrix } from "@/math/mat4";
import {
  acquireElementPickScratch,
  createElementPickScratch,
  decodeElementRegion,
  releaseElementPickScratch,
  resolveElementRegion,
} from "@/renderer/picking/element-region";
import { encodePickId } from "@/renderer/picking/pick-format";

describe("typed element-region picks", () => {
  it("reuses renderer-owned capacity without sharing an overlapping query", () => {
    const reusable = createElementPickScratch();
    const first = acquireElementPickScratch(reusable);
    const overlapping = acquireElementPickScratch(reusable);

    expect(first).toBe(reusable);
    expect(overlapping).not.toBe(reusable);

    releaseElementPickScratch(first);
    releaseElementPickScratch(overlapping);
    const next = acquireElementPickScratch(reusable);
    expect(next).toBe(reusable);
    releaseElementPickScratch(next);
  });

  it("deduplicates tiled dense pairs into sorted sparse public ids without descriptors", () => {
    const part = createPart(1, {
      geometries: [
        {
          positions: new Float32Array(12),
          indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
          primitive: "triangles",
        },
      ],
      elements: [
        {
          id: 7,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
        },
        {
          id: 100_000,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
        },
      ],
    });
    const scratch = createElementPickScratch();
    const first = tile([2, 1], [100_001, 8]);
    const second = tile([2, 1, 2], [8, 100_001, 100_001]);

    decodeElementRegion({ bytes: first, width: 2, height: 1, bytesPerRow: 256, scratch });
    decodeElementRegion({ bytes: second, width: 3, height: 1, bytesPerRow: 256, scratch });

    expect(
      resolveElementRegion(scratch, {
        instances: [
          { partOccurrenceId: "z/occurrence", partId: 1, worldTransform: identityMatrix() },
          { partOccurrenceId: "a/occurrence", partId: 1, worldTransform: identityMatrix() },
        ],
        parts: new Map([[1, part]]),
      }),
    ).toEqual({
      kind: "element",
      count: 4,
      partOccurrenceIds: ["a/occurrence", "z/occurrence"],
      offsets: new Uint32Array([0, 2, 4]),
      elementIds: new Uint32Array([7, 100_000, 7, 100_000]),
    });
  });
});

function tile(instances: readonly number[], elements: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(512);
  for (let index = 0; index < instances.length; index += 1) {
    bytes.set(encodePickId(instances[index] ?? 0), index * 4);
    bytes.set(encodePickId(elements[index] ?? 0), 256 + index * 4);
  }
  return bytes;
}
