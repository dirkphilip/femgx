import type { Camera } from "../../src/camera/camera";
import { createInteractionState } from "../../src/interaction/interaction";
import { interactionTargetFromHit, setTargetHovered } from "../../src/interaction/targets";
import { buildFaceSubsetIndices } from "../../src/renderer/selection/face-subset";
import { readGpuCostSnapshot, type WebGpuRenderer } from "../../src/renderer/gpu-renderer";
import type { PackedSceneRuntime } from "../../src/scene-runtime/runtime";
import type { WebGpuBenchmarkCase } from "./model";
import type { BenchmarkPercentiles, HoverBenchmarkReport } from "./types";
import {
  assertNoElementEmphasisDraw,
  assertOpaqueSurfaceDraw,
  highlightWriteBytesSince,
} from "./assertions";

const STEADY_SAMPLES = 7;
const SUPPORTED_CASES = new Set([
  "instanced-2.10m",
  "unique-2m-local",
  "fe-tet4-solid-132k",
  "fe-tet4-solid-25k-local",
  "fe-tet4-solid-257k-local",
]);

interface HoverMeasureOptions {
  readonly renderer: WebGpuRenderer;
  readonly device: GPUDevice;
  readonly benchmarkCase: WebGpuBenchmarkCase;
  readonly runtime: PackedSceneRuntime;
  readonly camera: Camera;
  readonly pickPoint: readonly [number, number];
}

/** Measures a real picked-element hover transition and its rendered frames. */
export async function measureHoverBenchmark(
  options: HoverMeasureOptions,
): Promise<HoverBenchmarkReport | undefined> {
  if (!SUPPORTED_CASES.has(options.benchmarkCase.id)) return undefined;
  const { renderer, device, benchmarkCase, runtime, camera, pickPoint } = options;
  const pickStart = performance.now();
  const hit = await renderer.pick(pickPoint[0], pickPoint[1]);
  const pickMs = performance.now() - pickStart;
  if (hit === undefined) throw new Error(`${benchmarkCase.id} hover point missed the model`);
  const target = interactionTargetFromHit(hit, "element");
  if (target?.kind !== "element") {
    throw new Error(`${benchmarkCase.id} hover point did not resolve an element`);
  }
  const slot = runtime.getInstanceSlot(target.partOccurrenceId);
  if (slot === undefined) throw new Error(`${benchmarkCase.id} hover occurrence is missing`);
  const stateStart = performance.now();
  const hovered = setTargetHovered(createInteractionState(), target);
  const interactionStateMs = performance.now() - stateStart;
  renderer.render(runtime, camera, benchmarkCase.scene.parts);
  await device.queue.onSubmittedWorkDone();
  const beforeSync = readGpuCostSnapshot(renderer);
  const syncStart = performance.now();
  renderer.updateElements(runtime, hovered, [slot]);
  const interactionSyncMs = performance.now() - syncStart;
  const interactionHighlightWriteBytes = highlightWriteBytesSince(
    beforeSync,
    readGpuCostSnapshot(renderer),
    `${benchmarkCase.id} hover`,
  );
  const firstHoveredFrameMs = await renderFrame(options);
  const interactionGpuCost = readGpuCostSnapshot(renderer);
  assertOpaqueSurfaceDraw(
    interactionGpuCost,
    `${benchmarkCase.id} hover`,
    uniqueSurfaceIndices(benchmarkCase),
    runtime.instanceCount,
  );
  const steady: number[] = [];
  for (let index = 0; index < STEADY_SAMPLES; index += 1) steady.push(await renderFrame(options));
  const clearStart = performance.now();
  renderer.updateElements(runtime, createInteractionState(), [slot]);
  await renderFrame(options);
  assertNoElementEmphasisDraw(readGpuCostSnapshot(renderer), `${benchmarkCase.id} hover clear`);
  return {
    targetKind: "element",
    selectedOccurrenceCount: 1,
    pickMs,
    interactionStateMs,
    interactionSyncMs,
    interactionHighlightWriteBytes,
    firstHoveredFrameMs,
    steadyHoveredFrameMs: percentiles(steady),
    clearHoverMs: performance.now() - clearStart,
    interactionGpuCost,
  };
}

function uniqueSurfaceIndices(benchmarkCase: WebGpuBenchmarkCase): number {
  let count = 0;
  for (const part of benchmarkCase.scene.parts.values()) {
    for (const geometry of part.geometries) {
      if (geometry.primitive !== "triangles") continue;
      count +=
        geometry.faceSubset === undefined
          ? geometry.indices.length
          : buildFaceSubsetIndices(geometry).length;
    }
  }
  return count;
}

async function renderFrame(options: HoverMeasureOptions): Promise<number> {
  const start = performance.now();
  options.renderer.render(options.runtime, options.camera, options.benchmarkCase.scene.parts);
  await options.device.queue.onSubmittedWorkDone();
  return performance.now() - start;
}

function percentiles(values: readonly number[]): BenchmarkPercentiles {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number): number => sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
  return { p50: at(0.5), p95: at(0.95) };
}
