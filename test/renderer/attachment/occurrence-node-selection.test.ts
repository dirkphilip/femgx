import { describe, expect, it } from "vitest";
import { createPart } from "@/geometry/part";
import { createInteractionState } from "@/interaction/interaction";
import { setTargetsSelected } from "@/interaction/targets";
import { identityMatrix } from "@/math/mat4";
import { RendererAttachment } from "@/renderer/attachment";
import { createGpuBundle, destroyGpuBundle } from "@/renderer/recovery";
import {
  applyOccurrenceMutations,
  prepareOccurrenceMutations,
} from "@/scene-runtime/occurrence-update";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { createSceneBuilder } from "@/scene/scene";
import { prepareSceneTransition } from "@/scene/update";
import { fakeGpuDevice, installGpuGlobals } from "../fake-gpu";

describe("selected-node occurrence updates", () => {
  it("rebuilds the affected part after a selected occurrence is added", async () => {
    await withFixture([placement("keep", 1)], ["1/keep", "1/added"], (fixture) => {
      const prepared = prepareSceneTransition(fixture.scene, (update) => {
        update.addPlacement(1, placement("added", 1));
      });
      applyTransition(fixture, prepared);

      expect(compactOrder(fixture, 1)).toEqual([1, 1, 0, 1]);
    });
  });

  it("removes stale selected-node membership while preserving survivors", async () => {
    await withFixture(
      [placement("keep", 1), placement("remove", 1)],
      ["1/keep", "1/remove"],
      (fixture) => {
        const prepared = prepareSceneTransition(fixture.scene, (update) => {
          update.removePlacement(1, "remove");
        });
        applyTransition(fixture, prepared);

        expect(compactOrder(fixture, 1)).toEqual([0, 1]);
      },
    );
  });

  it("rebuilds the new part when a selected occurrence keeps its identity", async () => {
    await withFixture([placement("item", 1), placement("keep", 1)], ["1/item"], (fixture) => {
      const prepared = prepareSceneTransition(fixture.scene, (update) => {
        update.replacePlacement(1, placement("item", 2));
      });
      applyTransition(fixture, prepared);

      expect(compactOrder(fixture, 1)).toEqual([]);
      expect(compactOrder(fixture, 2)).toEqual([0, 1]);
    });
  });
});

function placement(placementId: string, partId: number) {
  return { kind: "part" as const, placementId, partId, transform: identityMatrix() };
}

async function withFixture(
  placements: readonly ReturnType<typeof placement>[],
  selectedOccurrences: readonly string[],
  run: (fixture: Fixture) => void | Promise<void>,
): Promise<void> {
  const restore = installGpuGlobals();
  const gpu = fakeGpuDevice();
  const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
  const scene = createSceneBuilder()
    .addPart(nodePart(1))
    .addPart(nodePart(2))
    .addAssembly({ id: 1, name: "root", placements: [...placements] })
    .setRootAssembly(1)
    .build();
  const runtime = createPackedSceneRuntime(scene);
  const interaction = setTargetsSelected(
    createInteractionState(),
    selectedOccurrences.map((partOccurrenceId) => ({
      kind: "node" as const,
      partOccurrenceId,
      nodeId: 1,
    })),
    true,
  );
  const attachment = new RendererAttachment();
  try {
    attachment.prepareParts(scene.parts, bundle);
    attachment.attach(runtime, bundle);
    attachment.updateElements(runtime, interaction, bundle, scene.parts);
    await run({ scene, runtime, interaction, attachment, bundle });
  } finally {
    destroyGpuBundle(bundle);
    restore();
  }
}

function nodePart(id: number) {
  return createPart(id, {
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      },
    ],
    nodePositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  });
}

type Fixture = {
  readonly scene: ReturnType<ReturnType<typeof createSceneBuilder>["build"]>;
  readonly runtime: ReturnType<typeof createPackedSceneRuntime>;
  readonly interaction: ReturnType<typeof createInteractionState>;
  readonly attachment: RendererAttachment;
  readonly bundle: Awaited<ReturnType<typeof createGpuBundle>>;
};

function applyTransition(fixture: Fixture, prepared: ReturnType<typeof prepareSceneTransition>) {
  if (prepared === undefined) throw new Error("Expected a scene transition");
  const update = prepareOccurrenceMutations(fixture.runtime, prepared.scene, prepared.changes);
  if (update === undefined) throw new Error("Expected occurrence mutations");
  const delta = applyOccurrenceMutations(fixture.runtime, update);
  fixture.attachment.updateOccurrences(
    fixture.runtime,
    fixture.interaction,
    delta,
    new Map(prepared.scene.parts),
    fixture.bundle,
  );
}

function compactOrder(fixture: Fixture, partId: number): number[] {
  const order = fixture.bundle.draw.storages.get(partId)?.sidecars.nodeSelectionCompact;
  return order === undefined ? [] : Array.from(order.data.subarray(0, order.length));
}
