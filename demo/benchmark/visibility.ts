import type { Camera } from "../../src/camera/camera";
import { readGpuCostSnapshot, type WebGpuRenderer } from "../../src/renderer/gpu-renderer";
import type { PackedSceneRuntime } from "../../src/scene-runtime/runtime";
import type { WebGpuBenchmarkCase } from "./model";
import type {
  BenchmarkPercentiles,
  VisibilityBenchmarkPhase,
  VisibilityBenchmarkReport,
} from "./types";

const STEADY_SAMPLES = 7;
const SUPPORTED_CASES = new Set(["instanced-2.10m", "unique-2m-local"]);

interface VisibilityMeasureOptions {
  readonly renderer: WebGpuRenderer;
  readonly device: GPUDevice;
  readonly benchmarkCase: WebGpuBenchmarkCase;
  readonly runtime: PackedSceneRuntime;
  readonly camera: Camera;
}

/** Measures occurrence visibility mutation, renderer sync, hidden frames, and restoration. */
export async function measureVisibilityBenchmark(
  options: VisibilityMeasureOptions,
): Promise<VisibilityBenchmarkReport | undefined> {
  if (!SUPPORTED_CASES.has(options.benchmarkCase.id)) return undefined;
  const count = options.runtime.instanceCount;
  const scenarios: readonly VisibilityBenchmarkPhase["id"][] =
    count === 1 ? ["all"] : ["one", "half", "all"];
  const phases: VisibilityBenchmarkPhase[] = [];
  for (const id of scenarios) phases.push(await measureScenario(options, id));
  return { phases };
}

async function measureScenario(
  options: VisibilityMeasureOptions,
  id: VisibilityBenchmarkPhase["id"],
): Promise<VisibilityBenchmarkPhase> {
  const { renderer, benchmarkCase, runtime } = options;
  await renderFrame(options);
  const visibleBefore = submittedOpaqueIndices(readGpuCostSnapshot(renderer));
  const hiddenCount =
    id === "one" ? 1 : id === "half" ? Math.ceil(runtime.instanceCount / 2) : runtime.instanceCount;
  const slots = Array.from({ length: hiddenCount }, (_, slot) => slot);
  const mutationStart = performance.now();
  for (const slot of slots) runtime.setInstanceVisible(slot, false);
  const runtimeMutationMs = performance.now() - mutationStart;
  const syncStart = performance.now();
  renderer.updateVisibility(runtime, slots);
  const rendererSyncMs = performance.now() - syncStart;
  const firstHiddenFrameMs = await renderFrame(options);
  const hiddenGpuCost = readGpuCostSnapshot(renderer);
  const steady: number[] = [];
  for (let index = 0; index < STEADY_SAMPLES; index += 1) steady.push(await renderFrame(options));
  const restoreStart = performance.now();
  for (const slot of slots) runtime.setInstanceVisible(slot, true);
  renderer.updateVisibility(runtime, slots);
  await renderFrame(options);
  const restoreMs = performance.now() - restoreStart;
  const restoredSurfaceSubmittedIndices = submittedOpaqueIndices(readGpuCostSnapshot(renderer));
  if (restoredSurfaceSubmittedIndices !== visibleBefore) {
    throw new Error(
      `${benchmarkCase.id} ${id} visibility restored ${restoredSurfaceSubmittedIndices} of ${visibleBefore} indices`,
    );
  }
  const remainingVisibleTriangles =
    uniqueTriangleCount(benchmarkCase) * (runtime.instanceCount - hiddenCount);
  const visibleSurfaceSubmittedIndices = submittedOpaqueIndices(hiddenGpuCost);
  if (
    visibleSurfaceSubmittedIndices !== remainingVisibleTriangles * 3 ||
    visibleSurfaceSubmittedIndices >= visibleBefore
  ) {
    throw new Error(
      `${benchmarkCase.id} ${id} visibility submitted ${visibleSurfaceSubmittedIndices} indices; expected ${remainingVisibleTriangles * 3} below ${visibleBefore}`,
    );
  }
  return {
    id,
    hiddenOccurrenceCount: hiddenCount,
    remainingVisibleTriangles,
    visibleSurfaceSubmittedIndices,
    runtimeMutationMs,
    rendererSyncMs,
    firstHiddenFrameMs,
    steadyHiddenFrameMs: percentiles(steady),
    restoreMs,
    restoredSurfaceSubmittedIndices,
    hiddenGpuCost,
  };
}

function submittedOpaqueIndices(cost: VisibilityBenchmarkPhase["hiddenGpuCost"]): number {
  const opaque = cost.draws["opaque"];
  return (opaque?.indices ?? 0) * (opaque?.instances ?? 0);
}

function uniqueTriangleCount(benchmarkCase: WebGpuBenchmarkCase): number {
  let count = 0;
  for (const part of benchmarkCase.scene.parts.values()) {
    for (const geometry of part.geometries) {
      if (geometry.primitive === "triangles") count += geometry.indices.length / 3;
    }
  }
  return count;
}

async function renderFrame(options: VisibilityMeasureOptions): Promise<number> {
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
