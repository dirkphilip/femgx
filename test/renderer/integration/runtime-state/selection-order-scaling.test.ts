import { describe, expect, it } from "vitest";
import { createPart } from "@/geometry/part";
import { createInteractionState } from "@/interaction/interaction";
import { setTargetsSelected, setTargetSelected } from "@/interaction/targets";
import { identityMatrix } from "@/math/mat4";
import { buildInstanceLayout, buildSelectionOrder } from "@/renderer/runtime-state";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { createSceneBuilder } from "@/scene/scene";

const PLACEMENTS = 4_096;

describe("selection order scaling", () => {
  it("resolves one occurrence directly and retains the broad path for half", () => {
    const part = createPart(1, {
      geometries: [
        {
          primitive: "triangles",
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: new Uint32Array([0, 1, 2]),
        },
      ],
      elements: [
        {
          id: 7,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
        },
      ],
    });
    const scene = createSceneBuilder()
      .addPart(part)
      .addAssembly({
        id: 1,
        name: "selection-order",
        placements: Array.from({ length: PLACEMENTS }, (_, index) => ({
          kind: "part" as const,
          placementId: String(index),
          partId: part.id,
          transform: identityMatrix(),
        })),
      })
      .setRootAssembly(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    const parts = new Map([[part.id, part]]);
    let visibilityReads = 0;
    const isInstanceVisible = runtime.isInstanceVisible.bind(runtime);
    runtime.isInstanceVisible = (slot: number): boolean => {
      visibilityReads += 1;
      return isInstanceVisible(slot);
    };
    const firstId = runtime.getInstanceId(0) ?? "";
    const one = setTargetSelected(
      createInteractionState(),
      { kind: "element", partOccurrenceId: firstId, elementId: 7 },
      true,
    );
    expect(Array.from(buildSelectionOrder(layout, runtime, 1, one, parts))).toEqual([0]);
    expect(visibilityReads).toBe(1);

    visibilityReads = 0;
    const half = setTargetsSelected(
      createInteractionState(),
      Array.from({ length: PLACEMENTS / 2 }, (_, slot) => ({
        kind: "element" as const,
        partOccurrenceId: runtime.getInstanceId(slot) ?? "",
        elementId: 7,
      })),
      true,
    );
    const order = buildSelectionOrder(layout, runtime, 1, half, parts);
    expect(order).toHaveLength(PLACEMENTS / 2);
    expect(order[0]).toBe(0);
    expect(order[order.length - 1]).toBe(PLACEMENTS / 2 - 1);
    expect(visibilityReads).toBe(PLACEMENTS);
  });
});
