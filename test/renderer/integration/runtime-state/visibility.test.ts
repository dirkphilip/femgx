import { expect, it, describe } from "vitest";
import {
  MAX_PART_ID,
  identityMatrix,
  translationMatrix,
  createPackedSceneRuntime,
  createSceneBuilder,
  buildDrawOrder,
  buildInstanceLayout,
  part,
} from "./support";

describe("renderer runtime state", () => {
  it("keeps the largest part id addressable through GPU draw derivation", () => {
    const scene = createSceneBuilder()
      .addPart(part(MAX_PART_ID))
      .addAssembly({
        id: 1,
        name: "root",
        placements: [{ kind: "part", partId: MAX_PART_ID, transform: identityMatrix() }],
      })
      .setRootAssembly(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    expect(layout.partOrder).toEqual([MAX_PART_ID]);
    expect(buildDrawOrder(layout, runtime, MAX_PART_ID)).toEqual(new Uint32Array([0]));
  });

  it("maps stable slots to part-local slots and counts visible instances", () => {
    const scene = createSceneBuilder()
      .addPart(part(1))
      .addPart(part(2))
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: translationMatrix(0, 0, 0) },
          { kind: "part", partId: 2, transform: translationMatrix(0, 0, 0) },
          { kind: "part", partId: 1, transform: translationMatrix(0, 0, 0) },
        ],
      })
      .setRootAssembly(1)
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

  it("retains part-local slots for surviving placements across a part rebind", () => {
    const first = createSceneBuilder()
      .addPart(part(1))
      .addPart(part(2))
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", placementId: "move", partId: 1, transform: identityMatrix() },
          { kind: "part", placementId: "keep", partId: 1, transform: translationMatrix(1, 0, 0) },
          { kind: "part", placementId: "other", partId: 2, transform: translationMatrix(2, 0, 0) },
        ],
      })
      .setRootAssembly(1)
      .build();
    const firstRuntime = createPackedSceneRuntime(first);
    const firstLayout = buildInstanceLayout(firstRuntime);
    const second = createSceneBuilder()
      .addPart(part(1))
      .addPart(part(2))
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", placementId: "move", partId: 2, transform: identityMatrix() },
          { kind: "part", placementId: "keep", partId: 1, transform: translationMatrix(1, 0, 0) },
          { kind: "part", placementId: "other", partId: 2, transform: translationMatrix(2, 0, 0) },
        ],
      })
      .setRootAssembly(1)
      .build();
    const secondRuntime = createPackedSceneRuntime(second);
    const secondLayout = buildInstanceLayout(secondRuntime, {
      runtime: firstRuntime,
      layout: firstLayout,
    });

    expect(Array.from(secondLayout.slotPartLocal)).toEqual([1, 1, 0]);
    expect(Array.from(secondLayout.partSlots.get(1) ?? [])).toEqual([1]);
    expect(Array.from(secondLayout.partSlots.get(2) ?? [])).toEqual([0, 2]);
  });

  it("retains surviving locals and fills the smallest hole after placement reordering", () => {
    const scene = (placementIds: readonly string[]) =>
      createSceneBuilder()
        .addPart(part(1))
        .addAssembly({
          id: 1,
          name: "root",
          placements: placementIds.map((placementId) => ({
            kind: "part" as const,
            placementId,
            partId: 1,
            transform: identityMatrix(),
          })),
        })
        .setRootAssembly(1)
        .build();
    const firstRuntime = createPackedSceneRuntime(scene(["a", "b", "c", "d"]));
    const firstLayout = buildInstanceLayout(firstRuntime);
    const secondRuntime = createPackedSceneRuntime(scene(["d", "new", "b"]));
    const secondLayout = buildInstanceLayout(secondRuntime, {
      runtime: firstRuntime,
      layout: firstLayout,
    });

    expect(Array.from(secondLayout.slotPartLocal)).toEqual([3, 0, 1]);
    expect(Array.from(secondLayout.partLocalSlots.get(1) ?? [])).toEqual([1, 2, -1, 0]);
  });

  it("derives compacted draw order from the visibility bits", () => {
    const scene = createSceneBuilder()
      .addPart(part(1))
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: identityMatrix() },
          { kind: "part", partId: 1, transform: identityMatrix() },
          { kind: "part", partId: 1, transform: identityMatrix() },
        ],
      })
      .setRootAssembly(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    expect(Array.from(buildDrawOrder(layout, runtime, 1))).toEqual([0, 1, 2]);
    runtime.setInstanceVisible(1, false);
    expect(Array.from(buildDrawOrder(layout, runtime, 1))).toEqual([0, 2]);
  });
});
