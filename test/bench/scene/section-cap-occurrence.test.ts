import { describe, expect, it } from "vitest";
import { createElement } from "@/elements/element";
import { createElementModel } from "@/elements/model";
import { ElementShape } from "@/elements/shapes";
import { createPartFromElementModel } from "@/geometry/element-model-part";
import { createInteractionState } from "@/interaction/interaction";
import { identityMatrix, translationMatrix } from "@/math/mat4";
import { stageDrawResources } from "@/renderer/attachment/part-revision-stage";
import { createGpuBundle, destroyGpuBundle } from "@/renderer/recovery";
import { SectionCapController } from "@/renderer/section-cap-controller";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { createSceneBuilder } from "@/scene/scene";
import { fakeGpuDevice, installGpuGlobals } from "../../renderer/fake-gpu";
import { measureMs } from "../measure";

const OCCURRENCE_COUNTS = [1, 1_000, 100_000] as const;

describe("section-cap occurrence scaling", () => {
  it.each(OCCURRENCE_COUNTS)(
    "prepares changed=1 among %i dense intersecting caps",
    async (occurrenceCount) => {
      const restore = installGpuGlobals();
      const bundle = await createGpuBundle(fakeGpuDevice().device, "bgra8unorm", "depth24plus");
      try {
        const scene = denseCapScene(occurrenceCount);
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
        runtime.updateInstance(0, {
          instanceId: runtime.getInstanceId(0) ?? "",
          partId: 1,
          owningNode: runtime.instanceOwningNode[0] ?? 0,
          partVisible: true,
          overrideVisible: true,
          worldTransform: translationMatrix(0, 0, 0.25),
        });
        const delta = occurrenceDelta();
        let counters: unknown;
        const measured = measureMs(() => {
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
          counters = prepared.counters;
          controller.discardOccurrenceRevision(prepared, staged.draw);
        });
        expect(controller.currentFrame?.parts.size).toBe(occurrenceCount);
        console.log(`${occurrenceCount} caps, changed=1: ${measured.toFixed(3)} ms`);
        expect(counters).toEqual({ slotLookups: 2, capIdsVisited: 2, resourceLookups: 1 });
        expect(measured).toBeLessThanOrEqual(50);
      } finally {
        destroyGpuBundle(bundle);
        restore();
      }
    },
    30_000,
  );
});

function denseCapScene(occurrenceCount: number) {
  const nodes = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
  const part = createPartFromElementModel(
    1,
    createElementModel(nodes, [createElement(7, ElementShape.Tet4, [0, 1, 2, 3])]),
  );
  return createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      placements: Array.from({ length: occurrenceCount }, (_, index) => ({
        kind: "part" as const,
        placementId: `part-${index}`,
        partId: 1,
        transform: identityMatrix(),
      })),
    })
    .setRootAssembly(1)
    .build();
}

function occurrenceDelta() {
  return {
    slots: [{ slot: 0, beforePartId: 1, afterPartId: 1 }],
    affectedPartIds: new Set([1]),
    removedOccurrenceSlots: [],
    addedPartIds: new Set<number>(),
    removedPartIds: new Set<number>(),
  };
}
