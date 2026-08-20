import { describe, expect, it } from "vitest";
import { createPart } from "@/geometry/part";
import { createInteractionState } from "@/interaction/interaction";
import { setTargetsSelected } from "@/interaction/targets";
import { identityMatrix } from "@/math/mat4";
import { buildInstanceLayout } from "@/renderer/runtime-state";
import { buildSelectedNodeOrder } from "@/renderer/selection/selected-node-order";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { createSceneBuilder } from "@/scene/scene";

describe("selected node order", () => {
  it("keeps one selected node compact without replaying its occurrence", () => {
    const fixture = selectionFixture(1, 1_002_001);
    const order = selectedOrder(fixture, [{ partOccurrenceId: "1/0", nodeId: 17 }]);

    expect(order.denseOccurrences).toEqual(new Uint32Array());
    expect(order.sparseOccurrences).toEqual(new Uint32Array([0]));
    expect(order.sparseNodeIds).toEqual(new Uint32Array([17]));
  });

  it("shares occurrence-scoped sparse membership across repeated placements", () => {
    const fixture = selectionFixture(2, 16);
    const order = selectedOrder(fixture, [
      { partOccurrenceId: "1/1", nodeId: 4 },
      { partOccurrenceId: "1/0", nodeId: 2 },
      { partOccurrenceId: "1/1", nodeId: 1 },
    ]);

    expect(order.denseOccurrences).toEqual(new Uint32Array());
    expect(order.sparseOccurrences).toEqual(new Uint32Array([0, 1, 1]));
    expect(order.sparseNodeIds).toEqual(new Uint32Array([2, 1, 4]));
  });

  it("uses the lower-byte full replay only for near-complete membership", () => {
    const fixture = selectionFixture(1, 16);
    const sparse = selectedOrder(
      fixture,
      Array.from({ length: 13 }, (_, nodeId) => ({ partOccurrenceId: "1/0", nodeId })),
    );
    const dense = selectedOrder(
      fixture,
      Array.from({ length: 14 }, (_, nodeId) => ({ partOccurrenceId: "1/0", nodeId })),
    );

    expect(sparse.sparseNodeIds).toHaveLength(13);
    expect(sparse.denseOccurrences).toHaveLength(0);
    expect(dense.sparseNodeIds).toHaveLength(0);
    expect(dense.denseOccurrences).toEqual(new Uint32Array([0]));
  });

  it("omits hidden and point-only occurrences", () => {
    const fixture = selectionFixture(1, 8);
    fixture.runtime.setInstanceVisible(0, false);
    expect(selectedOrder(fixture, [{ partOccurrenceId: "1/0", nodeId: 0 }])).toEqual({
      denseOccurrences: new Uint32Array(),
      sparseOccurrences: new Uint32Array(),
      sparseNodeIds: new Uint32Array(),
    });
  });
});

function selectionFixture(placements: number, nodeCount: number) {
  const nodePositions = new Float32Array(nodeCount * 3);
  const part = createPart(1, {
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      },
    ],
    nodePositions,
  });
  const scene = createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "root",
      placements: Array.from({ length: placements }, () => ({
        kind: "part" as const,
        partId: 1,
        transform: identityMatrix(),
      })),
    })
    .setRootAssembly(1)
    .build();
  const runtime = createPackedSceneRuntime(scene);
  return { runtime, layout: buildInstanceLayout(runtime), parts: scene.parts };
}

function selectedOrder(
  fixture: ReturnType<typeof selectionFixture>,
  targets: readonly { readonly partOccurrenceId: string; readonly nodeId: number }[],
) {
  const interaction = setTargetsSelected(
    createInteractionState(),
    targets.map((target) => ({ kind: "node" as const, ...target })),
    true,
  );
  return buildSelectedNodeOrder({ ...fixture, partId: 1, interaction });
}
