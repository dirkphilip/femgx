import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { createElementModel } from "../../src/elements/model";
import { ElementShape } from "../../src/elements/shapes";
import { createPartFromElementModel } from "../../src/geometry/element-model-part";
import { createInteractionState } from "../../src/interaction/interaction";
import { setElementVisible } from "../../src/interaction/elements";
import { setElementSelected } from "../../src/interaction/interaction";
import { identityMatrix } from "../../src/math/mat4";
import { createGpuBundle, destroyGpuBundle } from "../../src/renderer/recovery";
import { uploadPart } from "../../src/renderer/resources/draw-resources";
import { SectionCapController } from "../../src/renderer/section-cap-controller";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { createSceneBuilder } from "../../src/scene/scene";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

describe("section-cap part retirement", () => {
  it("moves selected caps between presentation passes without rebuilding geometry", async () => {
    const restore = installGpuGlobals();
    const gpu = fakeGpuDevice();
    const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
    try {
      const scene = sectionScene();
      const runtime = createPackedSceneRuntime(scene);
      const controller = new SectionCapController();
      const visible = createInteractionState({ highlighted: {}, selected: { opacity: 0.5 } });
      controller.sync(sectionOptions(runtime, scene, visible, bundle.draw));
      const frame = controller.currentFrame;
      const occurrenceId = runtime.getInstanceId(0);
      if (frame === undefined || occurrenceId === undefined)
        throw new Error("section cap is missing");
      const buffers = gpu.buffers.length;
      const selected = setElementSelected(
        visible,
        { partOccurrenceId: occurrenceId, elementId: 7 },
        true,
      );

      controller.syncStyles(runtime, scene.parts, selected, bundle.draw);

      expect(controller.currentFrame?.parts).toBe(frame.parts);
      expect(controller.currentFrame?.calls).toHaveLength(1);
      expect(controller.currentFrame?.transparentCalls).toHaveLength(1);
      expect(gpu.buffers).toHaveLength(buffers);
    } finally {
      destroyGpuBundle(bundle);
      restore();
    }
  });

  it("omits hidden elements from an active section and restores their exact cap", async () => {
    const restore = installGpuGlobals();
    const gpu = fakeGpuDevice();
    const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
    try {
      const scene = sectionScene();
      const runtime = createPackedSceneRuntime(scene);
      const controller = new SectionCapController();
      const visible = createInteractionState();
      controller.sync(sectionOptions(runtime, scene, visible, bundle.draw));
      expect(controller.currentFrame?.parts).toHaveLength(2);

      const occurrenceId = runtime.getInstanceId(0);
      if (occurrenceId === undefined) throw new Error("section occurrence is missing");
      const hidden = setElementVisible(
        visible,
        { partOccurrenceId: occurrenceId, elementId: 7 },
        false,
      );
      controller.invalidate();
      controller.sync(sectionOptions(runtime, scene, hidden, bundle.draw));
      expect([...(controller.currentFrame?.sourcePartIds.values() ?? [])]).toEqual([2]);

      controller.invalidate();
      controller.sync(sectionOptions(runtime, scene, visible, bundle.draw));
      expect(controller.currentFrame?.parts).toHaveLength(2);
    } finally {
      destroyGpuBundle(bundle);
      restore();
    }
  });

  it("destroys only cap fragments sourced from a removed definition", async () => {
    const restore = installGpuGlobals();
    const gpu = fakeGpuDevice();
    const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
    try {
      const scene = sectionScene();
      const runtime = createPackedSceneRuntime(scene);
      const controller = new SectionCapController();
      controller.sync({
        runtime,
        parts: scene.parts,
        plane: { normal: [0, 0, 1], distance: -0.5 },
        interaction: createInteractionState(),
        deformation: undefined,
        resultColors: undefined,
        draw: bundle.draw,
      });
      const frame = controller.currentFrame;
      if (frame === undefined) throw new Error("section-cap frame missing");
      const removedCapId = capIdFor(frame.sourcePartIds, 1);
      const retainedCapId = capIdFor(frame.sourcePartIds, 2);
      const removedPart = frame.parts.get(removedCapId);
      const retainedPart = frame.parts.get(retainedCapId);
      const retainedSourcePart = scene.parts.get(2);
      if (
        removedPart === undefined ||
        retainedPart === undefined ||
        retainedSourcePart === undefined
      ) {
        throw new Error("caps missing");
      }
      const removedResource = uploadPart(bundle.draw, removedPart);
      const retainedResource = uploadPart(bundle.draw, retainedPart);

      controller.updateOccurrences(
        {
          slots: [],
          affectedPartIds: new Set([1]),
          removedOccurrenceSlots: [0],
          addedPartIds: new Set(),
          removedPartIds: new Set([1]),
        },
        new Map([[2, retainedSourcePart]]),
        bundle.draw,
      );

      expect(controller.currentFrame?.sourcePartIds).toEqual(new Map([[retainedCapId, 2]]));
      expect(controller.parts.has(1)).toBe(false);
      expect(controller.parts.has(2)).toBe(true);
      expect(bufferDestroyed(gpu, removedResource.vertexBuffer)).toBe(true);
      expect(bufferDestroyed(gpu, retainedResource.vertexBuffer)).toBe(false);
    } finally {
      destroyGpuBundle(bundle);
      restore();
    }
  });
});

function sectionOptions(
  runtime: ReturnType<typeof createPackedSceneRuntime>,
  scene: ReturnType<typeof sectionScene>,
  interaction: ReturnType<typeof createInteractionState>,
  draw: Awaited<ReturnType<typeof createGpuBundle>>["draw"],
) {
  return {
    runtime,
    parts: scene.parts,
    plane: { normal: [0, 0, 1] as const, distance: -0.5 },
    interaction,
    deformation: undefined,
    resultColors: undefined,
    draw,
  };
}

function sectionScene() {
  const nodes = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
  const element = createElement(7, ElementShape.Tet4, [0, 1, 2, 3]);
  const first = createPartFromElementModel(1, createElementModel(nodes, [element]));
  const second = createPartFromElementModel(2, createElementModel(nodes, [element]));
  return createSceneBuilder()
    .addPart(first)
    .addPart(second)
    .addAssembly({
      id: 1,
      placements: [
        { kind: "part", placementId: "first", partId: 1, transform: identityMatrix() },
        { kind: "part", placementId: "second", partId: 2, transform: identityMatrix() },
      ],
    })
    .setRootAssembly(1)
    .build();
}

function capIdFor(sourcePartIds: ReadonlyMap<number, number>, sourceId: number): number {
  const entry = [...sourcePartIds].find(([, partId]) => partId === sourceId);
  if (entry === undefined) throw new Error(`cap for part ${sourceId} missing`);
  return entry[0];
}

function bufferDestroyed(gpu: ReturnType<typeof fakeGpuDevice>, resource: GPUBuffer): boolean {
  return gpu.buffers.find((buffer) => buffer.resource === resource)?.destroyed ?? false;
}
