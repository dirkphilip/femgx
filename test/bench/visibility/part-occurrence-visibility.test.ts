import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import type { PartId } from "@/geometry/part";
import { RendererAttachment } from "@/renderer/attachment";
import type { WebGpuRenderer } from "@/renderer/gpu-renderer";
import { createGpuBundle, destroyGpuBundle } from "@/renderer/recovery";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { SceneNavigationBoundsCache } from "@/viewport/scene-bounds";
import { ViewportSceneController } from "@/viewport/scene-controller";
import { ViewportVisibilityController } from "@/viewport/visibility-controller";
import { fakeGpuDevice, installGpuGlobals } from "../../renderer/fake-gpu";
import { buildTinyManyPieceScene } from "../fixtures";
import { percentile } from "../measure";

const OCCURRENCE_COUNT = 100_000;
const performanceBudget = process.env["FEMGX_PERFORMANCE_BUDGET"] === "1" ? it : it.skip;

describe("large viewport visibility transitions", () => {
  performanceBudget(
    "keeps definition and explicit occurrence updates within their p95 budgets",
    () => {
      const fixture = visibilityFixture();
      const partP95 = measureTransition(
        () => {
          fixture.controller.setPartVisible(1, false);
        },
        () => {
          fixture.controller.setPartVisible(1, true);
        },
      );
      const occurrenceP95 = measureTransition(
        () => {
          fixture.controller.setPartOccurrences(fixture.occurrenceIds, false);
        },
        () => {
          fixture.controller.setPartOccurrences(fixture.occurrenceIds, true);
        },
      );

      if (process.env["PERF_REPORT"] === "1") {
        console.log({ partP95, occurrenceP95 });
      }

      expect(partP95).toBeLessThanOrEqual(16.7);
      expect(occurrenceP95).toBeLessThanOrEqual(50);
      fixture.resetCounts();
      fixture.controller.setPartVisible(1, false);
      expect(fixture.counts()).toEqual({ syncs: 1, invalidations: 1 });
      fixture.controller.setPartVisible(1, true);
      fixture.resetCounts();
      fixture.controller.setPartOccurrences(fixture.occurrenceIds, false);
      expect(fixture.counts()).toEqual({ syncs: 1, invalidations: 1 });
    },
    120_000,
  );

  it("syncs a whole hidden part without instance-record writes or slot scans", async () => {
    const restoreGpuGlobals = installGpuGlobals();
    const scene = buildTinyManyPieceScene("shared-part", OCCURRENCE_COUNT);
    const runtime = createPackedSceneRuntime(scene);
    const gpu = fakeGpuDevice();
    const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
    const attachment = new RendererAttachment();
    try {
      attachment.prepareParts(scene.parts, bundle);
      attachment.attach(runtime, bundle);
      bundle.draw.cost.reset();
      const delta = runtime.setPartVisible(1, false);
      attachment.updateVisibility(runtime, delta.affectedPartIds, bundle);
      const cost = bundle.draw.cost.snapshot();

      expect(cost.writes.instance).toEqual({ calls: 0, bytes: 0 });
      expect(cost.cpu["instance-scan"]).toBe(0);
      expect(cost.cpu["part-scan"]).toBe(1);
      expect(attachment.calls).toEqual([]);
    } finally {
      destroyGpuBundle(bundle);
      restoreGpuGlobals();
    }
  }, 120_000);
});

function visibilityFixture(): {
  readonly controller: ViewportVisibilityController;
  readonly occurrenceIds: readonly string[];
  readonly counts: () => { readonly syncs: number; readonly invalidations: number };
  readonly resetCounts: () => void;
} {
  const scene = buildTinyManyPieceScene("shared-part", OCCURRENCE_COUNT);
  let syncs = 0;
  let invalidations = 0;
  const renderer = {
    updateVisibility(_runtime: unknown, affectedPartIds: readonly PartId[]): void {
      expect(affectedPartIds).toEqual([1]);
      syncs += 1;
    },
  } as unknown as WebGpuRenderer;
  const sceneController = new ViewportSceneController({ scene, interaction: undefined, renderer });
  return {
    controller: new ViewportVisibilityController({
      sceneController,
      renderer,
      isBatching: () => false,
      invalidate: () => {
        invalidations += 1;
      },
      navigationBoundsCache: new SceneNavigationBoundsCache(),
    }),
    occurrenceIds: [...sceneController.runtime.instanceInstanceIds],
    counts: () => ({ syncs, invalidations }),
    resetCounts: () => {
      syncs = 0;
      invalidations = 0;
    },
  };
}

function measureTransition(hide: () => void, show: () => void): number {
  for (let index = 0; index < 2; index += 1) {
    hide();
    show();
  }
  const samples: number[] = [];
  for (let sample = 0; sample < 7; sample += 1) {
    const started = performance.now();
    hide();
    samples.push(performance.now() - started);
    show();
  }
  return percentile(samples, 0.95);
}
