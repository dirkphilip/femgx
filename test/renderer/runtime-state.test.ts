import { describe, expect, it } from "vitest";
import { createPart, MAX_PART_ID, type Part } from "../../src/geometry/part";
import { identity, translation } from "../../src/math/mat4";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { createScene } from "../../src/scene/scene";
import {
  buildDrawOrder,
  buildNodeOrder,
  buildNodeSelectionOrder,
  buildSelectionOrder,
  buildInstanceLayout,
  buildTransparentOrder,
} from "../../src/renderer/runtime-state";
import {
  createInteractionState,
  setInstanceSelected,
  setPartSelected,
} from "../../src/interaction/interaction";
import { setNodeSelected } from "../../src/interaction/nodes";

function part(id: number): Part {
  const geometry = {
    positions: new Float32Array([0, 0, 0]),
    indices: new Uint32Array(),
    primitive: "triangles" as const,
  };
  return createPart(id, geometry);
}

describe("renderer runtime state", () => {
  it("keeps the largest part id addressable through GPU draw derivation", () => {
    const scene = createScene()
      .addPart(part(MAX_PART_ID))
      .addAssembly({
        id: 1,
        name: "root",
        placements: [{ kind: "part", partId: MAX_PART_ID, transform: identity() }],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    expect(layout.partOrder).toEqual([MAX_PART_ID]);
    expect(buildDrawOrder(layout, runtime, MAX_PART_ID)).toEqual(new Uint32Array([0]));
  });

  it("maps stable slots to part-local slots and counts visible instances", () => {
    const scene = createScene()
      .addPart(part(1))
      .addPart(part(2))
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: translation(0, 0, 0) },
          { kind: "part", partId: 2, transform: translation(0, 0, 0) },
          { kind: "part", partId: 1, transform: translation(0, 0, 0) },
        ],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    expect(layout.instanceCount).toBe(3);
    expect(layout.partOrder).toEqual([1, 2]);
    expect(Array.from(layout.slotPartLocal)).toEqual([0, 0, 1]);
    expect(Array.from(layout.partSlots.get(1) ?? [])).toEqual([0, 2]);
    expect(Array.from(layout.partSlots.get(2) ?? [])).toEqual([1]);
    expect(layout.partVisibleCounts.get(1)).toBe(2);
    expect(layout.partVisibleCounts.get(2)).toBe(1);
    expect(layout.visibleCount).toBe(3);
  });

  it("derives compacted draw order from the visibility bits", () => {
    const scene = createScene()
      .addPart(part(1))
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: identity() },
          { kind: "part", partId: 1, transform: identity() },
          { kind: "part", partId: 1, transform: identity() },
        ],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    expect(Array.from(buildDrawOrder(layout, runtime, 1))).toEqual([0, 1, 2]);
    runtime.setInstanceVisible(1, false);
    expect(Array.from(buildDrawOrder(layout, runtime, 1))).toEqual([0, 2]);
  });

  it("keeps transparent classification in a separate visible order", () => {
    const scene = createScene()
      .addPart(part(1))
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: identity() },
          { kind: "part", partId: 1, transform: identity() },
        ],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    expect(Array.from(buildDrawOrder(layout, runtime, 1))).toEqual([0, 1]);
    expect(Array.from(buildTransparentOrder(layout, runtime, 1, [false, true]))).toEqual([1]);
  });

  it("compacts selected instances and selected-node instances independently", () => {
    const triangle = part(1);
    const scene = createScene()
      .addPart(triangle)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: identity() },
          { kind: "part", partId: 1, transform: identity() },
          { kind: "part", partId: 1, transform: identity() },
        ],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    let interaction = setPartSelected(createInteractionState(), 1, true);
    interaction = setNodeSelected(interaction, { instanceId: "1/1", nodeId: 2 }, true);
    interaction = setInstanceSelected(interaction, "1/2", true);
    runtime.setInstanceVisible(1, false);
    const parts = new Map([[1, triangle]]);

    expect(Array.from(buildSelectionOrder(layout, runtime, 1, interaction))).toEqual([0, 2]);
    expect(
      Array.from(buildNodeSelectionOrder(layout, runtime, 1, [false, true, false], parts)),
    ).toEqual([]);
    runtime.setInstanceVisible(1, true);
    expect(
      Array.from(buildNodeSelectionOrder(layout, runtime, 1, [false, true, false], parts)),
    ).toEqual([1]);
  });

  it("builds node orders from visible node-styled instances and skips points", () => {
    const triangle = part(1);
    const point = createPart(2, {
      positions: new Float32Array([0, 0, 0]),
      indices: new Uint32Array([0]),
      primitive: "points",
      nodePickIds: new Uint32Array([1]),
      nodePositions: new Float32Array([0, 0, 0]),
    });
    const scene = createScene()
      .addPart(triangle)
      .addPart(point)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: identity() },
          { kind: "part", partId: 1, transform: identity() },
          { kind: "part", partId: 2, transform: identity() },
        ],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    const parts = new Map([
      [triangle.id, triangle],
      [point.id, point],
    ]);
    expect(Array.from(buildNodeOrder(layout, runtime, 1, [true, false, true], parts))).toEqual([0]);
    expect(buildNodeOrder(layout, runtime, 2, [true, false, true], parts)).toEqual(
      new Uint32Array(),
    );
    const selectedPoint = setNodeSelected(
      createInteractionState(),
      {
        instanceId: "1/2",
        nodeId: 0,
      },
      true,
    );
    expect(Array.from(buildSelectionOrder(layout, runtime, 2, selectedPoint))).toEqual([0]);
    expect(buildNodeSelectionOrder(layout, runtime, 2, [false, false, true], parts)).toEqual(
      new Uint32Array(),
    );
    runtime.setInstanceVisible(0, false);
    expect(buildNodeOrder(layout, runtime, 1, [true, false, true], parts)).toEqual(
      new Uint32Array(),
    );
  });

  it("keeps hidden slots addressable and omits parts without visible slots", () => {
    const scene = createScene()
      .addPart(part(1))
      .addPart(part(2))
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: identity() },
          { kind: "part", partId: 2, transform: identity() },
        ],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    runtime.setPartVisible(2, false);
    const layout = buildInstanceLayout(runtime);
    expect(Array.from(buildDrawOrder(layout, runtime, 2))).toHaveLength(0);
    expect(layout.slotPartLocal[1]).toBe(0);
    expect(layout.visibleCount).toBe(1);
  });
});
