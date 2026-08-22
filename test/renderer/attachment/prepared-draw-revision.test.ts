import { describe, expect, it } from "vitest";
import { createPart } from "@/geometry/part";
import { prepareDrawRevision } from "@/renderer/attachment/prepared-draw-revision";
import { stagePartDefinitionResources } from "@/renderer/attachment/part-revision-stage";
import { createGpuBundle, destroyGpuBundle } from "@/renderer/recovery";
import { uploadPart } from "@/renderer/resources/draw-resources";
import { fakeGpuDevice, installGpuGlobals } from "../fake-gpu";

describe("prepared draw revision owner", () => {
  it("discards replacement geometry without touching the borrowed live resource", async () => {
    const restore = installGpuGlobals();
    const gpu = fakeGpuDevice();
    const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
    try {
      const original = createTrianglePart(1, 0);
      const replacement = createTrianglePart(1, 1);
      const liveResource = uploadPart(bundle.draw, original);
      const revision = prepareDrawRevision({
        live: bundle.draw,
        affectedPartIds: new Set([1]),
        replacedPartIds: new Set([1]),
        stageInteraction: false,
        kind: "part",
      });
      stagePartDefinitionResources(revision.draw, new Map([[1, replacement]]), new Set([1]), false);
      const stagedResource = revision.draw.parts.get(1);
      revision.discard();

      expect(bundle.draw.parts.get(1)).toBe(liveResource);
      expect(stagedResource).toBeDefined();
      expect(bufferDestroyed(gpu, stagedResource?.vertexBuffer)).toBe(true);
      expect(bufferDestroyed(gpu, liveResource.vertexBuffer)).toBe(false);
      expect(() => {
        revision.discard();
      }).toThrow("already discarded");
      expect(() => {
        revision.commit();
      }).toThrow("already discarded");
    } finally {
      destroyGpuBundle(bundle);
      restore();
    }
  });

  it("publishes replacement resources once and rejects inverse lifecycle operations", async () => {
    const restore = installGpuGlobals();
    const gpu = fakeGpuDevice();
    const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
    try {
      const original = createTrianglePart(1, 0);
      const replacement = createTrianglePart(1, 2);
      const liveResource = uploadPart(bundle.draw, original);
      const revision = prepareDrawRevision({
        live: bundle.draw,
        affectedPartIds: new Set([1]),
        replacedPartIds: new Set([1]),
        stageInteraction: false,
        kind: "part",
      });
      stagePartDefinitionResources(revision.draw, new Map([[1, replacement]]), new Set([1]), false);
      const stagedResource = revision.draw.parts.get(1);
      revision.commit();

      expect(bundle.draw.parts.get(1)).toBe(stagedResource);
      expect(bufferDestroyed(gpu, liveResource.vertexBuffer)).toBe(true);
      expect(() => {
        revision.commit();
      }).toThrow("already committed");
      expect(() => {
        revision.discard();
      }).toThrow("already committed");
    } finally {
      destroyGpuBundle(bundle);
      restore();
    }
  });
});

function createTrianglePart(id: number, offset: number) {
  return createPart(id, {
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array([offset, 0, 0, offset + 1, 0, 0, offset, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      },
    ],
  });
}

function bufferDestroyed(
  gpu: ReturnType<typeof fakeGpuDevice>,
  buffer: GPUBuffer | undefined,
): boolean {
  return (
    buffer !== undefined &&
    (gpu.buffers.find((entry) => entry.resource === buffer)?.destroyed ?? false)
  );
}
