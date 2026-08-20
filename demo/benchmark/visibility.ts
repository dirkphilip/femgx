import type { Camera } from "../../src/camera/camera";
import { percentiles } from "./statistics";
import { readGpuCostSnapshot, type WebGpuRenderer } from "../../src/renderer/gpu-renderer";
import type { PackedSceneRuntime } from "../../src/scene-runtime/runtime";
import type { WebGpuBenchmarkCase } from "./model";
import type { VisibilityBenchmarkPhase, VisibilityBenchmarkReport } from "./types";

const STEADY_SAMPLES = 7;
const SUPPORTED_CASES = new Set([
  "instanced-2.10m",
  "unique-2m-local",
  "many-parts-1000",
  "placements-10k",
]);

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
  const visibleBefore = assertOpaqueSubmission(options, readGpuCostSnapshot(renderer));
  const hiddenCount =
    id === "one" ? 1 : id === "half" ? Math.ceil(runtime.instanceCount / 2) : runtime.instanceCount;
  const slots = Array.from({ length: hiddenCount }, (_, slot) => slot);
  const expectedVisibleSubmittedIndices = visibleBefore - submittedIndicesForSlots(options, slots);
  const mutationStart = performance.now();
  for (const slot of slots) runtime.setInstanceVisible(slot, false);
  const runtimeMutationMs = performance.now() - mutationStart;
  const syncStart = performance.now();
  renderer.updateVisibility(runtime, slots);
  const rendererSyncMs = performance.now() - syncStart;
  const firstHiddenFrameMs = await renderFrame(options);
  const hiddenGpuCost = readGpuCostSnapshot(renderer);
  const visibleSurfaceSubmittedIndices = assertOpaqueSubmission(options, hiddenGpuCost);
  const remainingVisibleTriangles = expectedVisibleSubmittedIndices / 3;
  if (visibleSurfaceSubmittedIndices !== expectedVisibleSubmittedIndices) {
    throw new Error(
      `${benchmarkCase.id} ${id} visibility submitted ${visibleSurfaceSubmittedIndices} indices; expected ${expectedVisibleSubmittedIndices} below ${visibleBefore}`,
    );
  }
  const steady: number[] = [];
  for (let index = 0; index < STEADY_SAMPLES; index += 1) steady.push(await renderFrame(options));
  const restoreStart = performance.now();
  for (const slot of slots) runtime.setInstanceVisible(slot, true);
  renderer.updateVisibility(runtime, slots);
  await renderFrame(options);
  const restoreMs = performance.now() - restoreStart;
  const restoredSurfaceSubmittedIndices = assertOpaqueSubmission(
    options,
    readGpuCostSnapshot(renderer),
  );
  if (restoredSurfaceSubmittedIndices !== visibleBefore) {
    throw new Error(
      `${benchmarkCase.id} ${id} visibility restored ${restoredSurfaceSubmittedIndices} of ${visibleBefore} indices`,
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

function submittedIndicesForSlots(
  options: VisibilityMeasureOptions,
  slots: readonly number[],
): number {
  let submitted = 0;
  for (const slot of slots) {
    if (!options.runtime.isInstanceVisible(slot)) continue;
    const partId = options.runtime.getPartId(slot);
    const part = partId === undefined ? undefined : options.benchmarkCase.scene.parts.get(partId);
    for (const geometry of part?.geometries ?? []) {
      if (geometry.primitive === "triangles") submitted += geometry.indices.length;
    }
  }
  return submitted;
}

function assertOpaqueSubmission(
  options: VisibilityMeasureOptions,
  cost: VisibilityBenchmarkPhase["hiddenGpuCost"],
): number {
  const expected = expectedOpaqueSubmission(options);
  const actual = cost.draws["opaque"];
  if (
    actual?.calls !== expected.calls ||
    actual.indices !== expected.indices ||
    actual.instances !== expected.instances
  ) {
    throw new Error(
      `${options.benchmarkCase.id} visibility draw mismatch: ${JSON.stringify({ actual, expected })}`,
    );
  }
  return expected.submittedIndices;
}

function expectedOpaqueSubmission(options: VisibilityMeasureOptions): {
  readonly calls: number;
  readonly indices: number;
  readonly instances: number;
  readonly submittedIndices: number;
} {
  const visibleByPart = new Map<number, number>();
  for (let slot = 0; slot < options.runtime.instanceCount; slot += 1) {
    if (!options.runtime.isInstanceVisible(slot)) continue;
    const partId = options.runtime.getPartId(slot);
    if (partId !== undefined) visibleByPart.set(partId, (visibleByPart.get(partId) ?? 0) + 1);
  }
  let indices = 0;
  let instances = 0;
  let submittedIndices = 0;
  for (const [partId, count] of visibleByPart) {
    const part = options.benchmarkCase.scene.parts.get(partId);
    const partIndices =
      part?.geometries.reduce(
        (sum, geometry) => sum + (geometry.primitive === "triangles" ? geometry.indices.length : 0),
        0,
      ) ?? 0;
    indices += partIndices;
    instances += count;
    submittedIndices += partIndices * count;
  }
  return { calls: visibleByPart.size, indices, instances, submittedIndices };
}

async function renderFrame(options: VisibilityMeasureOptions): Promise<number> {
  const start = performance.now();
  options.renderer.render(options.runtime, options.camera, options.benchmarkCase.scene.parts);
  await options.device.queue.onSubmittedWorkDone();
  return performance.now() - start;
}
