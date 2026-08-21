import { describe, expect, it } from "vitest";
import { createElement } from "@/elements/element";
import { createElementModel } from "@/elements/model";
import { ElementShape } from "@/elements/shapes";
import { createPartFromElementModel } from "@/geometry/element-model-part";
import { createInteractionState } from "@/interaction/interaction";
import { identityMatrix, translationMatrix } from "@/math/mat4";
import { stageDrawResources } from "@/renderer/attachment/part-revision-stage";
import { createGpuBundle, destroyGpuBundle } from "@/renderer/recovery";
import { uploadPart } from "@/renderer/resources/draw-resources";
import { SectionCapController } from "@/renderer/section-cap-controller";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { createSceneBuilder } from "@/scene/scene";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

describe("section-cap occurrence revisions", () => {
  it("rebuilds one changed occurrence and retains another occurrence of the same part", async () => {
    const restore = installGpuGlobals();
    const gpu = fakeGpuDevice();
    const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
    try {
      const scene = repeatedPartScene();
      const runtime = createPackedSceneRuntime(scene);
      const controller = new SectionCapController();
      const interaction = createInteractionState();
      const plane = { normal: [0, 0, 1] as const, distance: -0.5 };
      controller.sync({
        runtime,
        parts: scene.parts,
        plane,
        interaction,
        deformation: undefined,
        resultColors: undefined,
        draw: bundle.draw,
      });
      const before = controller.currentFrame;
      if (before === undefined) throw new Error("section-cap frame missing");
      const changedCapId = capIdForSlot(before.sourceSlots, 0);
      const retainedCapId = capIdForSlot(before.sourceSlots, 1);
      const changedPart = before.parts.get(changedCapId);
      const retainedPart = before.parts.get(retainedCapId);
      if (changedPart === undefined || retainedPart === undefined) throw new Error("caps missing");
      const changedResource = uploadPart(bundle.draw, changedPart);
      const retainedResource = uploadPart(bundle.draw, retainedPart);
      const transaction = runtime.beginHierarchyTransaction();
      runtime.updateInstance(0, {
        instanceId: runtime.getInstanceId(0) ?? "",
        partId: 1,
        owningNode: runtime.instanceOwningNode[0] ?? 0,
        partVisible: true,
        overrideVisible: true,
        worldTransform: translationMatrix(0, 0, 0.25),
      });
      const delta = occurrenceDelta();
      const staged = stageDrawResources(bundle.draw, delta.affectedPartIds, true, false);
      const prepared = controller.prepareOccurrenceRevision({
        runtime,
        parts: scene.parts,
        plane,
        interaction,
        deformation: undefined,
        resultColors: undefined,
        draw: staged.draw,
        delta,
      });

      expect(controller.currentFrame).toBe(before);
      expect(bufferDestroyed(gpu, changedResource.vertexBuffer)).toBe(false);
      controller.commitOccurrenceRevision(prepared, staged.draw, bundle.draw);
      transaction.commit();

      expect(controller.currentFrame?.parts.get(retainedCapId)).toBe(retainedPart);
      expect(bufferDestroyed(gpu, retainedResource.vertexBuffer)).toBe(false);
      expect(bufferDestroyed(gpu, changedResource.vertexBuffer)).toBe(true);
    } finally {
      destroyGpuBundle(bundle);
      restore();
    }
  });

  it("leaves the live cap frame usable when changed-cap allocation fails", async () => {
    const restore = installGpuGlobals();
    let failAt = Number.POSITIVE_INFINITY;
    const gpu = fakeGpuDevice({
      onCreateBuffer: (creation) => {
        if (creation === failAt) throw new Error("injected cap allocation failure");
      },
    });
    const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
    try {
      const scene = repeatedPartScene();
      const runtime = createPackedSceneRuntime(scene);
      const controller = new SectionCapController();
      const interaction = createInteractionState();
      const plane = { normal: [0, 0, 1] as const, distance: -0.5 };
      controller.sync({
        runtime,
        parts: scene.parts,
        plane,
        interaction,
        deformation: undefined,
        resultColors: undefined,
        draw: bundle.draw,
      });
      const before = controller.currentFrame;
      if (before === undefined) throw new Error("section-cap frame missing");
      const capId = capIdForSlot(before.sourceSlots, 0);
      const cap = before.parts.get(capId);
      if (cap === undefined) throw new Error("changed cap missing");
      const liveResource = uploadPart(bundle.draw, cap);
      const buffersBefore = gpu.buffers.length;
      const transaction = runtime.beginHierarchyTransaction();
      runtime.updateInstance(0, {
        instanceId: runtime.getInstanceId(0) ?? "",
        partId: 1,
        owningNode: runtime.instanceOwningNode[0] ?? 0,
        partVisible: true,
        overrideVisible: true,
        worldTransform: translationMatrix(0, 0, 0.25),
      });
      const delta = occurrenceDelta();
      const staged = stageDrawResources(bundle.draw, delta.affectedPartIds, true, false);
      failAt = buffersBefore + 1;

      expect(() =>
        controller.prepareOccurrenceRevision({
          runtime,
          parts: scene.parts,
          plane,
          interaction,
          deformation: undefined,
          resultColors: undefined,
          draw: staged.draw,
          delta,
        }),
      ).toThrow("injected cap allocation failure");
      transaction.rollback();

      expect(controller.currentFrame).toBe(before);
      expect(controller.currentFrame?.parts.get(capId)).toBe(cap);
      expect(bufferDestroyed(gpu, liveResource.vertexBuffer)).toBe(false);
      expect(gpu.buffers.slice(buffersBefore).every((buffer) => buffer.destroyed)).toBe(true);
    } finally {
      destroyGpuBundle(bundle);
      restore();
    }
  });
});

function occurrenceDelta() {
  return {
    slots: [{ slot: 0, beforePartId: 1, afterPartId: 1 }],
    affectedPartIds: new Set([1]),
    removedOccurrenceSlots: [],
    addedPartIds: new Set<number>(),
    removedPartIds: new Set<number>(),
  };
}

function repeatedPartScene() {
  const nodes = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
  const element = createElement(7, ElementShape.Tet4, [0, 1, 2, 3]);
  const part = createPartFromElementModel(1, createElementModel(nodes, [element]));
  return createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      placements: [
        { kind: "part", placementId: "first", partId: 1, transform: identityMatrix() },
        { kind: "part", placementId: "second", partId: 1, transform: identityMatrix() },
      ],
    })
    .setRootAssembly(1)
    .build();
}

function capIdForSlot(sourceSlots: ReadonlyMap<number, number>, slot: number): number {
  const entry = [...sourceSlots].find(([, sourceSlot]) => sourceSlot === slot);
  if (entry === undefined) throw new Error(`cap for slot ${slot} missing`);
  return entry[0];
}

function bufferDestroyed(gpu: ReturnType<typeof fakeGpuDevice>, resource: GPUBuffer): boolean {
  return gpu.buffers.find((buffer) => buffer.resource === resource)?.destroyed ?? false;
}
