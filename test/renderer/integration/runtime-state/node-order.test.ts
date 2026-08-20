import { expect, it, describe } from "vitest";
import {
  createPart,
  identityMatrix,
  createPackedSceneRuntime,
  createSceneBuilder,
  buildDrawOrder,
  buildNodeOrder,
  buildNodeSelectionOrder,
  buildSelectionOrder,
  buildInstanceLayout,
  createInteractionState,
  setNodeSelected,
  setTargetsSelected,
  buildSelectionDrawCallsForTest,
  part,
  fragmentedSelectionPart,
} from "./support";

describe("renderer runtime state", () => {
  it("merges a large out-of-order contiguous selection into one bounded range", () => {
    const scene = createSceneBuilder()
      .addPart(fragmentedSelectionPart)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [{ kind: "part", partId: fragmentedSelectionPart.id, transform: identityMatrix() }],
      })
      .setRootAssembly(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    const targets = Array.from({ length: 1000 }, (_, index) => ({
      kind: "element" as const,
      partOccurrenceId: "1/0",
      elementId: index + 1,
    })).reverse();
    const interaction = setTargetsSelected(createInteractionState(), targets, true);
    const order = buildSelectionOrder(
      layout,
      runtime,
      fragmentedSelectionPart.id,
      interaction,
      new Map([[fragmentedSelectionPart.id, fragmentedSelectionPart]]),
    );

    expect(
      buildSelectionDrawCallsForTest({
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
    const scene = createSceneBuilder()
      .addPart(triangle)
      .addPart(point)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: identityMatrix() },
          { kind: "part", partId: 1, transform: identityMatrix() },
          { kind: "part", partId: 2, transform: identityMatrix() },
        ],
      })
      .setRootAssembly(1)
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
        partOccurrenceId: "1/2",
        nodeId: 0,
      },
      true,
    );
    expect(Array.from(buildSelectionOrder(layout, runtime, 2, selectedPoint, parts))).toEqual([0]);
    expect(buildNodeSelectionOrder(layout, runtime, 2, [false, false, true], parts)).toEqual(
      new Uint32Array(),
    );
    runtime.setInstanceVisible(0, false);
    expect(
      buildNodeOrder({ layout, runtime, partId: 1, nodeFlags: [true, false, true], parts }),
    ).toEqual(new Uint32Array());
  });

  it("keeps hidden slots addressable and omits parts without visible slots", () => {
    const scene = createSceneBuilder()
      .addPart(part(1))
      .addPart(part(2))
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: identityMatrix() },
          { kind: "part", partId: 2, transform: identityMatrix() },
        ],
      })
      .setRootAssembly(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    runtime.setPartVisible(2, false);
    const layout = buildInstanceLayout(runtime);
    expect(Array.from(buildDrawOrder(layout, runtime, 2))).toHaveLength(0);
    expect(layout.slotPartLocal[1]).toBe(0);
    expect(layout.visibleCount).toBe(1);
  });
});
