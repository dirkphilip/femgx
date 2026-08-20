import { describe, expect, it } from "vitest";
import { reviseAttachmentCalls } from "@/renderer/attachment/calls";
import { GpuCostAccumulator } from "@/renderer/diagnostics/cost";
import { buildDrawCalls, buildInstanceLayout } from "@/renderer/runtime-state";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { createSceneBuilder } from "@/scene/scene";
import { identityMatrix } from "@/math/mat4";
import { emptyPart } from "../../support/scene-fixtures";

describe("incremental attachment calls", () => {
  it("replaces one changed part while retaining ordered call objects", () => {
    const builder = createSceneBuilder();
    for (let partId = 1; partId <= 5; partId += 1) builder.addPart(emptyPart(partId));
    const scene = builder
      .addAssembly({
        id: 1,
        name: "root",
        placements: Array.from({ length: 5 }, (_, index) => ({
          kind: "part" as const,
          partId: index + 1,
          transform: identityMatrix(),
        })),
      })
      .setRootAssembly(1)
      .build();
    const layout = buildInstanceLayout(createPackedSceneRuntime(scene));
    const original = buildDrawCalls(layout);
    const retained = original.calls.filter(({ partId }) => partId !== 3);

    layout.partVisibleCounts.set(3, 0);
    const removed = reviseAttachmentCalls(layout, original, new Set([3]), new GpuCostAccumulator());
    expect(removed.calls.map(({ partId }) => partId)).toEqual([1, 2, 4, 5]);
    expect(removed.calls).toEqual(retained);
    for (let index = 0; index < retained.length; index += 1) {
      expect(removed.calls[index]).toBe(retained[index]);
    }

    layout.partVisibleCounts.set(3, 1);
    const restored = reviseAttachmentCalls(layout, removed, new Set([3]), new GpuCostAccumulator());
    expect(restored.calls.map(({ partId }) => partId)).toEqual([1, 2, 3, 4, 5]);
    expect(restored.calls[0]).toBe(retained[0]);
    expect(restored.calls[3]).toBe(retained[2]);
  });
});
