import { describe, expect, it } from "vitest";
import { createPart } from "@/geometry/part";
import { translationMatrix } from "@/math/mat4";
import { RendererAttachment } from "@/renderer/attachment";
import { createInteractionState } from "@/interaction/interaction";
import { createGpuBundle, destroyGpuBundle } from "@/renderer/recovery";
import {
  encodeInstanceRecord,
  INSTANCE_STRIDE,
  type InstanceStorage,
} from "@/renderer/resources/instance-storage";
import { uploadPart } from "@/renderer/resources/draw-resources";
import { prepareAttachmentOccurrenceUpdate } from "@/renderer/attachment/occurrence-transaction";
import { defaultStyle } from "@/renderer/resources/foundation";
import {
  applyOccurrenceMutations,
  prepareOccurrenceMutations,
} from "@/scene-runtime/occurrence-update";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { createSceneBuilder } from "@/scene/scene";
import { prepareSceneTransition } from "@/scene/update";
import { fakeGpuDevice, installGpuGlobals } from "../fake-gpu";

describe("cold renderer attachment", () => {
  it("writes exact records and visible order again after a cleared attachment", async () => {
    const restore = installGpuGlobals();
    const gpu = fakeGpuDevice();
    const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
    try {
      const scene = buildScene();
      const runtime = createPackedSceneRuntime(scene);
      runtime.setInstanceVisible(1, false);
      const attachment = new RendererAttachment();
      attachment.prepareParts(scene.parts, bundle);
      attachment.attach(runtime, bundle);

      const first = bundle.draw.storages.get(1);
      expect(first).toBeDefined();
      assertStorage(first, runtime);
      const writesAfterFirst = gpu.writes.length;

      attachment.clear(bundle);
      attachment.attach(runtime, bundle);
      const second = bundle.draw.storages.get(1);
      expect(second).toBeDefined();
      expect(second).not.toBe(first);
      expect(gpu.writes).toHaveLength(writesAfterFirst + 2);
      assertStorage(second, runtime);
    } finally {
      destroyGpuBundle(bundle);
      restore();
    }
  });

  it("retires only removed-part geometry and instance storage", async () => {
    const restore = installGpuGlobals();
    const gpu = fakeGpuDevice();
    const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
    try {
      const scene = buildTwoPartScene();
      const runtime = createPackedSceneRuntime(scene);
      const attachment = new RendererAttachment();
      attachment.prepareParts(scene.parts, bundle);
      attachment.attach(runtime, bundle);
      const removedPart = scene.parts.get(1);
      const retainedPart = scene.parts.get(2);
      if (removedPart === undefined || retainedPart === undefined) throw new Error("parts missing");
      const removedGeometry = uploadPart(bundle.draw, removedPart);
      const retainedGeometry = uploadPart(bundle.draw, retainedPart);
      const removedStorage = bundle.draw.storages.get(1);
      const retainedStorage = bundle.draw.storages.get(2);
      if (removedStorage === undefined || retainedStorage === undefined) {
        throw new Error("instance storage missing");
      }
      const prepared = prepareSceneTransition(scene, (update) => {
        update.removePart(1, { placements: "remove" });
      });
      if (prepared === undefined) throw new Error("transition missing");
      const occurrenceUpdate = prepareOccurrenceMutations(
        runtime,
        prepared.scene,
        prepared.changes,
      );
      if (occurrenceUpdate === undefined) throw new Error("occurrence update missing");
      const writesBefore = gpu.writes.length;

      const delta = applyOccurrenceMutations(runtime, occurrenceUpdate);
      const partDefinitions = new Map(scene.parts);
      const preparedAttachment = prepareAttachmentOccurrenceUpdate({
        attachment,
        runtime,
        interaction: createInteractionState(),
        delta,
        sourceParts: partDefinitions,
        parts: prepared.scene.parts,
        bundle,
        edgesVisible: attachment.edgesVisible,
        nodesVisible: attachment.nodesVisible,
      });
      preparedAttachment.commit();

      expect(bundle.draw.parts.has(1)).toBe(false);
      expect(partDefinitions.has(1)).toBe(false);
      expect(bundle.draw.parts.get(2)).toBe(retainedGeometry);
      expect(bundle.draw.storages.has(1)).toBe(false);
      expect(bundle.draw.storages.get(2)).toBe(retainedStorage);
      expect(attachment.calls.map(({ partId }) => partId)).toEqual([2]);
      expect(bufferDestroyed(gpu, removedGeometry.vertexBuffer)).toBe(true);
      expect(bufferDestroyed(gpu, retainedGeometry.vertexBuffer)).toBe(false);
      expect(bufferDestroyed(gpu, removedStorage.buffer)).toBe(true);
      expect(bufferDestroyed(gpu, retainedStorage.buffer)).toBe(false);
      expect(
        gpu.writes.slice(writesBefore).some(({ buffer }) => buffer === retainedStorage.buffer),
      ).toBe(false);
    } finally {
      destroyGpuBundle(bundle);
      restore();
    }
  });

  it("admits only new-part resources and leaves retained buffers write-free", async () => {
    const restore = installGpuGlobals();
    const gpu = fakeGpuDevice();
    const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
    try {
      const scene = buildScene();
      const runtime = createPackedSceneRuntime(scene);
      const attachment = new RendererAttachment();
      attachment.prepareParts(scene.parts, bundle);
      attachment.attach(runtime, bundle);
      const retainedPart = scene.parts.get(1);
      if (retainedPart === undefined) throw new Error("retained part missing");
      const retainedGeometry = uploadPart(bundle.draw, retainedPart);
      const retainedStorage = bundle.draw.storages.get(1);
      if (retainedStorage === undefined) throw new Error("retained storage missing");
      const addedPart = createPart(2, {
        geometries: [
          {
            primitive: "triangles",
            positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
            indices: new Uint32Array([0, 1, 2]),
          },
        ],
      });
      const prepared = prepareSceneTransition(scene, (update) => {
        update.addPart(addedPart);
        update.addPlacement(1, {
          kind: "part",
          placementId: "added-part",
          partId: 2,
          transform: translationMatrix(4, 0, 0),
        });
      });
      if (prepared === undefined) throw new Error("transition missing");
      const occurrenceUpdate = prepareOccurrenceMutations(
        runtime,
        prepared.scene,
        prepared.changes,
      );
      if (occurrenceUpdate === undefined) throw new Error("occurrence update missing");
      attachment.prepareAddedParts(prepared.scene.parts, occurrenceUpdate.addedPartIds);
      const writesBefore = gpu.writes.length;

      const delta = applyOccurrenceMutations(runtime, occurrenceUpdate);
      const sourceParts = new Map(scene.parts);
      const preparedAttachment = prepareAttachmentOccurrenceUpdate({
        attachment,
        runtime,
        interaction: createInteractionState(),
        delta,
        sourceParts,
        parts: prepared.scene.parts,
        bundle,
        edgesVisible: attachment.edgesVisible,
        nodesVisible: attachment.nodesVisible,
      });
      preparedAttachment.commit();
      const addedGeometry = uploadPart(bundle.draw, addedPart);

      expect(uploadPart(bundle.draw, addedPart)).toBe(addedGeometry);
      expect(bundle.draw.parts.get(1)).toBe(retainedGeometry);
      expect(bundle.draw.storages.get(1)).toBe(retainedStorage);
      expect(bundle.draw.storages.get(2)).toBeDefined();
      expect(attachment.calls.map(({ partId }) => partId)).toEqual([1, 2]);
      expect(
        gpu.writes.slice(writesBefore).some(({ buffer }) => buffer === retainedStorage.buffer),
      ).toBe(false);
    } finally {
      destroyGpuBundle(bundle);
      restore();
    }
  });
});

function bufferDestroyed(gpu: ReturnType<typeof fakeGpuDevice>, resource: GPUBuffer): boolean {
  return gpu.buffers.find((buffer) => buffer.resource === resource)?.destroyed ?? false;
}

function assertStorage(
  storage: InstanceStorage | undefined,
  runtime: ReturnType<typeof createPackedSceneRuntime>,
): void {
  if (storage === undefined) throw new Error("Instance storage is missing");
  expect(storage.capacity).toBe(3);
  expect(storage.orderLength).toBe(2);
  expect(Array.from(storage.orderData.subarray(0, 2))).toEqual([0, 2]);
  for (let slot = 0; slot < 3; slot += 1) {
    const expected = encodeInstanceRecord(
      runtime.instanceWorldTransforms.subarray(slot * 16, slot * 16 + 16),
      defaultStyle,
      slot + 1,
    );
    expect(new Uint8Array(storage.data, slot * INSTANCE_STRIDE, INSTANCE_STRIDE)).toEqual(
      new Uint8Array(expected),
    );
  }
}

function buildScene() {
  const part = createPart(1, {
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      },
    ],
  });
  return createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "cold-attachment",
      placements: [0, 1, 2].map((slot) => ({
        kind: "part" as const,
        placementId: String(slot),
        partId: 1,
        transform: translationMatrix(slot, slot * 2, slot * 3),
      })),
    })
    .setRootAssembly(1)
    .build();
}

function buildTwoPartScene() {
  const geometry = {
    primitive: "triangles" as const,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  };
  return createSceneBuilder()
    .addPart(createPart(1, { geometries: [geometry] }))
    .addPart(createPart(2, { geometries: [geometry] }))
    .addAssembly({
      id: 1,
      placements: [
        { kind: "part", placementId: "removed", partId: 1, transform: translationMatrix(0, 0, 0) },
        { kind: "part", placementId: "retained", partId: 2, transform: translationMatrix(1, 0, 0) },
      ],
    })
    .setRootAssembly(1)
    .build();
}
