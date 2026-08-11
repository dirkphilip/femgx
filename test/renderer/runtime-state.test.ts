import { describe, expect, it } from "vitest";
import { computeBounds, type Part } from "../../src/geometry/part";
import { identity, translation } from "../../src/math/mat4";
import { createSceneRuntime } from "../../src/scene-runtime/runtime";
import { createScene } from "../../src/scene/scene";
import { buildDrawOrder, buildInstanceLayout } from "../../src/renderer/runtime-state";

function part(id: number): Part {
  const geometry = {
    positions: new Float32Array([0, 0, 0]),
    indices: new Uint32Array(),
    primitive: "triangles" as const,
  };
  return { id, geometry, bounds: computeBounds(geometry) };
}

describe("renderer runtime state", () => {
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
    const runtime = createSceneRuntime(scene);
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
    const runtime = createSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    expect(Array.from(buildDrawOrder(layout, runtime, 1))).toEqual([0, 1, 2]);
    runtime.setInstanceVisible(1, false);
    expect(Array.from(buildDrawOrder(layout, runtime, 1))).toEqual([0, 2]);
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
    const runtime = createSceneRuntime(scene);
    runtime.setPartVisible(2, false);
    const layout = buildInstanceLayout(runtime);
    expect(Array.from(buildDrawOrder(layout, runtime, 2))).toHaveLength(0);
    expect(layout.slotPartLocal[1]).toBe(0);
    expect(layout.visibleCount).toBe(1);
  });
});
