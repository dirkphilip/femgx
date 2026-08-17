import { expect, it, describe } from "vitest";
import {
  createPart,
  identity,
  createPackedSceneRuntime,
  createScene,
  buildDrawOrder,
  buildNodeOrder,
  buildNodeSelectionOrder,
  buildSelectionOrder,
  buildInstanceLayout,
  createInteractionState,
  setNodeSelected,
  setTargetsSelected,
  buildSelectionDrawCalls,
  part,
  rangedSelectionPart,
  fragmentedSelectionPart,
} from "./support";

describe("renderer runtime state", () => {
  it("falls back when ranges retain at least half of the full index work", () => {
    const scene = createScene()
      .addPart(rangedSelectionPart)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [{ kind: "part", partId: rangedSelectionPart.id, transform: identity() }],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    const interaction = setTargetsSelected(
      createInteractionState(),
      [
        { kind: "element", instanceId: "1/0", elementId: 101 },
        { kind: "element", instanceId: "1/0", elementId: 103 },
      ],
      true,
    );
    const order = buildSelectionOrder(layout, runtime, rangedSelectionPart.id, interaction);

    expect(
      buildSelectionDrawCalls({
        layout,
        runtime,
        partId: rangedSelectionPart.id,
        interaction,
        part: rangedSelectionPart,
        order,
      }),
    ).toBeUndefined();
  });

  it("merges a large out-of-order contiguous selection into one bounded range", () => {
    const scene = createScene()
      .addPart(fragmentedSelectionPart)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [{ kind: "part", partId: fragmentedSelectionPart.id, transform: identity() }],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    const targets = Array.from({ length: 1000 }, (_, index) => ({
      kind: "element" as const,
      instanceId: "1/0",
      elementId: index + 1,
    })).reverse();
    const interaction = setTargetsSelected(createInteractionState(), targets, true);
    const order = buildSelectionOrder(layout, runtime, fragmentedSelectionPart.id, interaction);

    expect(
      buildSelectionDrawCalls({
        layout,
        runtime,
        partId: fragmentedSelectionPart.id,
        interaction,
        part: fragmentedSelectionPart,
        order,
      }),
    ).toEqual([
      {
        partId: fragmentedSelectionPart.id,
        instanceCount: 1,
        firstInstance: 0,
        selectionRanges: [{ primitive: "triangles", firstIndex: 0, indexCount: 1000 * 3 }],
      },
    ]);
  });

  it("builds node orders from visible node-styled instances and skips points", () => {
    const triangle = part(1);
    const point = createPart(2, {
      geometries: [
        {
          positions: new Float32Array([0, 0, 0]),
          indices: new Uint32Array([0]),
          primitive: "points",
          nodePickIds: new Uint32Array([1]),
        },
      ],
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
    expect(
      Array.from(
        buildNodeOrder({ layout, runtime, partId: 1, nodeFlags: [true, false, true], parts }),
      ),
    ).toEqual([0]);
    expect(
      buildNodeOrder({ layout, runtime, partId: 2, nodeFlags: [true, false, true], parts }),
    ).toEqual(new Uint32Array());
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
    expect(
      buildNodeOrder({ layout, runtime, partId: 1, nodeFlags: [true, false, true], parts }),
    ).toEqual(new Uint32Array());
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
