import { describe, expect, it } from "vitest";
import { createPart } from "@/geometry/part";
import type { PackedSceneRuntime } from "@/scene-runtime/runtime";
import { prepareDrawRevision } from "@/renderer/attachment/prepared-draw-revision";
import { stagePartDefinitionResources } from "@/renderer/attachment/part-revision-stage";
import { createGpuBundle, destroyGpuBundle } from "@/renderer/recovery";
import { uploadPart } from "@/renderer/resources/draw-resources";
import {
  initializeInstancePart,
  INSTANCE_STRIDE,
  writeSelectionOrder,
} from "@/renderer/resources/instance-storage";
import type { InstanceLayout } from "@/renderer/runtime-state";
import type { PartRevisionResultState } from "@/renderer/attachment/part-revision-results";
import type { VisibilitySkinCache } from "@/renderer/visibility/types";
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

  it("owns and publishes staged storage, results, visibility, and glyph resources", async () => {
    const restore = installGpuGlobals();
    const gpu = fakeGpuDevice();
    const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
    try {
      initializeInstancePart(
        bundle.draw,
        1,
        new ArrayBuffer(INSTANCE_STRIDE),
        new Uint32Array([0]),
        1,
      );
      const revision = prepareDrawRevision({
        live: bundle.draw,
        affectedPartIds: new Set([1]),
        replacedPartIds: new Set(),
        stageInteraction: true,
        kind: "occurrence",
      });
      writeSelectionOrder(revision.draw, 1, new Uint32Array([0]));
      const stagedSidecar = revision.draw.storages.get(1)?.sidecars.selection;
      const deformation = {
        scale: 1,
        displacements: new Map([[1, new Float32Array([1, 2, 3])]]),
      };
      const colors = new Map([
        [1, { location: "nodal" as const, values: new Float32Array([1, 0, 0, 1]) }],
      ]);
      revision.stageResults(
        {
          deformation,
          colors,
          glyphs: undefined,
          staged: { deformation, colors, glyphs: undefined },
        } satisfies PartRevisionResultState,
        runtimeForRevision(),
        layoutForRevision(),
      );
      const stagedDeformation = revision.draw.deformations.get(1)?.buffer;
      const stagedColors = revision.draw.resultColors.get(1)?.buffer;
      const visibilityBuffer = gpu.device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.STORAGE,
      });
      revision.draw.visibilitySkins.set(1, visibilityCache(visibilityBuffer));
      const normalBuffer = gpu.device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.STORAGE,
      });
      revision.draw.orientationGlyphs.parts.set(1, {
        partId: 1,
        normalBuffer,
        normalData: new Float32Array(),
        normalCapacity: 0,
        groups: new Map(),
      });
      const paramsBuffer = gpu.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM,
      });
      revision.draw.orientationGlyphs.paramsBuffer = paramsBuffer;
      revision.commit();

      expect(bundle.draw.storages.get(1)?.sidecars.selection?.buffer).toBe(stagedSidecar?.buffer);
      expect(bundle.draw.deformations.get(1)?.buffer).toBe(stagedDeformation);
      expect(bundle.draw.resultColors.get(1)?.buffer).toBe(stagedColors);
      expect(bundle.draw.visibilitySkins.get(1)?.residentBytes).toBe(4);
      expect(bundle.draw.orientationGlyphs.parts.get(1)?.normalBuffer).toBe(normalBuffer);
      expect(bundle.draw.orientationGlyphs.paramsBuffer).toBe(paramsBuffer);
    } finally {
      destroyGpuBundle(bundle);
      restore();
    }
  });

  it("makes a failed deferred write terminal instead of allowing discard cleanup", async () => {
    const restore = installGpuGlobals();
    const gpu = fakeGpuDevice();
    const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
    try {
      initializeInstancePart(
        bundle.draw,
        1,
        new ArrayBuffer(INSTANCE_STRIDE),
        new Uint32Array([0]),
        1,
      );
      const revision = prepareDrawRevision({
        live: bundle.draw,
        affectedPartIds: new Set([1]),
        replacedPartIds: new Set(),
        stageInteraction: true,
        kind: "occurrence",
      });
      const liveBuffer = bundle.draw.storages.get(1)?.buffer;
      if (liveBuffer === undefined) throw new Error("Expected live instance storage");
      revision.draw.writePort.writeBuffer(liveBuffer, 0, new Uint32Array([1]));
      const queue = gpu.device.queue as unknown as {
        writeBuffer: (...args: never[]) => void;
      };
      const writeBuffer = queue.writeBuffer;
      queue.writeBuffer = () => {
        throw new Error("injected deferred write failure");
      };
      try {
        expect(() => {
          revision.commit();
        }).toThrow("injected deferred write failure");
      } finally {
        queue.writeBuffer = writeBuffer;
      }
      expect(() => {
        revision.discard();
      }).toThrow("already failed");
      expect(bundle.draw.storages.get(1)?.buffer).toBe(liveBuffer);
    } finally {
      destroyGpuBundle(bundle);
      restore();
    }
  });
});

function runtimeForRevision(): PackedSceneRuntime {
  return { getPartIds: () => new Uint32Array([1]) } as unknown as PackedSceneRuntime;
}

function layoutForRevision(): InstanceLayout {
  return {
    slotPartLocal: new Int32Array([0]),
    partLocalSlots: new Map([[1, new Int32Array([0])]]),
  } as unknown as InstanceLayout;
}

function visibilityCache(indexBuffer: GPUBuffer): VisibilitySkinCache {
  return {
    entries: new Map([
      [
        1,
        [
          {
            skin: {
              signature: { hash: 1, bodyIds: [], elementIds: [], hasHidden: true },
              indexBuffer,
              indexCount: 1,
              byteLength: 4,
            },
            lastUsed: 1,
          },
        ],
      ],
    ]),
    budgetBytes: 4,
    residentBytes: 4,
    clock: 1,
  };
}

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
