import { describe, expect, it } from "vitest";
import { createPart } from "@/geometry/part";
import { createInteractionState } from "@/interaction/interaction";
import { setTargetsSelected } from "@/interaction/targets";
import { identityMatrix } from "@/math/mat4";
import { RendererAttachment } from "@/renderer/attachment";
import { createGpuBundle, destroyGpuBundle } from "@/renderer/recovery";
import { HIGHLIGHT_HEADER } from "@/renderer/selection/highlight-layout";
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

  it.each([
    { label: "compact", nodeCount: 512, nodeIds: [1], mode: "compact" as const },
    {
      label: "dense",
      nodeCount: 16,
      nodeIds: Array.from({ length: 14 }, (_, nodeId) => nodeId),
      mode: "dense" as const,
    },
  ])(
    "keeps %s selected membership synchronized through add, remove, and replacement",
    async ({ nodeCount, nodeIds, mode }) => {
      await withFixture(
        [placement("item", 1), placement("keep", 1)],
        ["1/item", "1/added"],
        (fixture) => {
          expectSelectedMembership(fixture, 1, [0], nodeIds, mode);
          applySceneUpdate(fixture, (update) => {
            update.addPlacement(1, placement("added", 1));
          });
          expectSelectedMembership(fixture, 1, [2, 0], nodeIds, mode);
          applySceneUpdate(fixture, (update) => {
            update.removePlacement(1, "added");
          });
          expectSelectedMembership(fixture, 1, [0], nodeIds, mode);
          applySceneUpdate(fixture, (update) => {
            update.replacePlacement(1, placement("item", 2));
          });
          expectSelectedMembership(fixture, 1, [], nodeIds, mode);
          expectSelectedMembership(fixture, 2, [0], nodeIds, mode);
        },
        nodeCount,
        nodeIds,
      );
    },
  );
});

function placement(placementId: string, partId: number) {
  return { kind: "part" as const, placementId, partId, transform: identityMatrix() };
}

async function withFixture(
  placements: readonly ReturnType<typeof placement>[],
  selectedOccurrences: readonly string[],
  run: (fixture: Fixture) => void | Promise<void>,
  nodeCount = 3,
  nodeIds = [1],
): Promise<void> {
  const restore = installGpuGlobals();
  const gpu = fakeGpuDevice();
  const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
  const scene = createSceneBuilder()
    .addPart(nodePart(1, nodeCount))
    .addPart(nodePart(2, nodeCount))
    .addAssembly({ id: 1, name: "root", placements: [...placements] })
    .setRootAssembly(1)
    .build();
  const runtime = createPackedSceneRuntime(scene);
  const interaction = setTargetsSelected(
    createInteractionState(),
    selectedOccurrences.flatMap((partOccurrenceId) =>
      nodeIds.map((nodeId) => ({ kind: "node" as const, partOccurrenceId, nodeId })),
    ),
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

function nodePart(id: number, nodeCount: number) {
  return createPart(id, {
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      },
    ],
    nodePositions: new Float32Array(nodeCount * 3),
  });
}

type Fixture = {
  scene: ReturnType<ReturnType<typeof createSceneBuilder>["build"]>;
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

function applySceneUpdate(
  fixture: Fixture,
  update: (scene: Parameters<Parameters<typeof prepareSceneTransition>[1]>[0]) => void,
): void {
  const prepared = prepareSceneTransition(fixture.scene, update);
  applyTransition(fixture, prepared);
  if (prepared === undefined) throw new Error("Expected a scene transition");
  fixture.scene = prepared.scene;
}

function compactOrder(fixture: Fixture, partId: number): number[] {
  const order = fixture.bundle.draw.storages.get(partId)?.sidecars.nodeSelectionCompact;
  return order === undefined ? [] : Array.from(order.data.subarray(0, order.length));
}

function expectSelectedMembership(
  fixture: Fixture,
  partId: number,
  slots: readonly number[],
  nodeIds: readonly number[],
  mode: "compact" | "dense",
): void {
  const storage = fixture.bundle.draw.storages.get(partId);
  if (mode === "dense") {
    if (slots.length === 0) {
      expect(storage?.sidecars.nodeSelection).toBeUndefined();
      expect(storage?.highlight.denseNodeSelection).toBeUndefined();
      return;
    }
    expect(storage?.sidecars.nodeSelection?.data.subarray(0, slots.length)).toEqual(
      new Uint32Array(slots),
    );
    expect(storage?.sidecars.nodeSelectionCompact).toBeUndefined();
    expect(
      storage?.highlight.denseNodeSelection?.occurrences.map(({ slot, selectedCount }) => ({
        slot,
        selectedCount,
      })),
    ).toEqual(
      [...slots]
        .sort((left, right) => left - right)
        .map((slot) => ({
          slot,
          selectedCount: nodeIds.length,
        })),
    );
    return;
  }
  expect(compactOrder(fixture, partId)).toEqual(
    slots.flatMap((slot) => nodeIds.flatMap((nodeId) => [slot, nodeId])),
  );
  expect(storage?.highlight.denseNodeSelection).toBeUndefined();
  expect(selectedNodeRecords(storage?.highlight.data)).toEqual(
    [...slots]
      .sort((left, right) => left - right)
      .flatMap((slot) => nodeIds.map((nodeId) => [slot, nodeId + 1, 1])),
  );
}

function selectedNodeRecords(data: Uint8Array<ArrayBuffer> | undefined): number[][] {
  if (data === undefined) return [];
  const words = new Uint32Array(data.buffer);
  const count = words[0] ?? 0;
  const records: number[][] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = HIGHLIGHT_HEADER / Uint32Array.BYTES_PER_ELEMENT + index * 12;
    const nodePickId = words[offset + 3] ?? 0;
    if (nodePickId !== 0) records.push([words[offset] ?? 0, nodePickId, words[offset + 10] ?? 0]);
  }
  return records.sort(
    (left, right) => (left[0] ?? 0) - (right[0] ?? 0) || (left[1] ?? 0) - (right[1] ?? 0),
  );
}
