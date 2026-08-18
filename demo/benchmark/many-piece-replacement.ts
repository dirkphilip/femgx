import type { Camera } from "../../src/camera/camera";
import { readGpuCostSnapshot, type WebGpuRenderer } from "../../src/renderer/gpu-renderer";
import { INSTANCE_STRIDE } from "../../src/renderer/resources/instance-storage";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { createScene, type Scene } from "../../src/scene/scene";
import type { WebGpuBenchmarkCase } from "./model";
import type {
  BenchmarkGpuCostSnapshot,
  BenchmarkPercentiles,
  ManyPieceReplacementPhase,
} from "./types";

const STEADY_SAMPLES = 7;

interface ReplacementOptions {
  readonly renderer: WebGpuRenderer;
  readonly device: GPUDevice;
  readonly benchmarkCase: WebGpuBenchmarkCase;
  readonly runtime: ReturnType<typeof createPackedSceneRuntime>;
  readonly camera: Camera;
}

/** Measures immutable scene construction through queue-drained replacement frames. */
export async function measureManyPieceReplacement(
  options: ReplacementOptions,
): Promise<readonly ManyPieceReplacementPhase[]> {
  const phases: ManyPieceReplacementPhase[] = [];
  for (const id of ["one", "half", "all"] as const) {
    phases.push(await measureReplacement(options, id));
  }
  return phases;
}

async function measureReplacement(
  options: ReplacementOptions,
  id: ManyPieceReplacementPhase["id"],
): Promise<ManyPieceReplacementPhase> {
  const changedOccurrenceCount =
    id === "one"
      ? 1
      : id === "half"
        ? Math.ceil(options.runtime.instanceCount / 2)
        : options.runtime.instanceCount;
  const buildStart = performance.now();
  const scene = replacementScene(options.benchmarkCase.scene, changedOccurrenceCount);
  const sceneBuildIncludingValidationMs = performance.now() - buildStart;
  const compileStart = performance.now();
  const runtime = createPackedSceneRuntime(scene);
  const runtimeCompileMs = performance.now() - compileStart;
  assertChangedTransforms(options, runtime, changedOccurrenceCount);
  await render(options, options.runtime, options.benchmarkCase.scene);
  const firstStart = performance.now();
  options.renderer.render(runtime, options.camera, scene.parts);
  const rendererFirstFrameCpuMs = performance.now() - firstStart;
  await options.device.queue.onSubmittedWorkDone();
  const queueDrainedFirstFrameMs = performance.now() - firstStart;
  const gpuCost = readGpuCostSnapshot(options.renderer);
  const instanceWriteBytes = assertInstanceWrites(
    options,
    id,
    gpuCost,
    changedOccurrenceCount,
    "apply",
  );
  assertOpaqueSubmission(options, gpuCost);
  const steady: number[] = [];
  for (let sample = 0; sample < STEADY_SAMPLES; sample += 1) {
    steady.push(await render(options, runtime, scene));
  }
  const restoreStart = performance.now();
  await render(options, options.runtime, options.benchmarkCase.scene);
  const restoreMs = performance.now() - restoreStart;
  const restoreCost = readGpuCostSnapshot(options.renderer);
  const restoreInstanceWriteBytes = assertInstanceWrites(
    options,
    id,
    restoreCost,
    changedOccurrenceCount,
    "restore",
  );
  assertOpaqueSubmission(options, restoreCost);
  return {
    id,
    changedOccurrenceCount,
    sceneBuildIncludingValidationMs,
    runtimeCompileMs,
    rendererFirstFrameCpuMs,
    queueDrainedFirstFrameMs,
    instanceWriteBytes,
    steadyFrameMs: percentiles(steady),
    restoreMs,
    restoreInstanceWriteBytes,
    gpuCost,
  };
}

function assertInstanceWrites(
  options: ReplacementOptions,
  id: ManyPieceReplacementPhase["id"],
  cost: BenchmarkGpuCostSnapshot,
  changedCount: number,
  phase: "apply" | "restore",
): number {
  const writes = cost.writes["instance"];
  const expected = changedCount * INSTANCE_STRIDE;
  if ((writes?.calls ?? 0) <= 0 || writes?.bytes !== expected) {
    throw new Error(
      `${options.benchmarkCase.id} ${id} replacement ${phase} wrote ${writes?.bytes ?? 0} instance bytes; expected ${expected}`,
    );
  }
  return writes.bytes;
}

function replacementScene(source: Scene, changedCount: number): Scene {
  const root = source.assemblies.get(source.rootAssemblyId);
  if (root === undefined || source.assemblies.size !== 1) {
    throw new Error("Many-piece replacement requires one root assembly");
  }
  const placements = root.placements.map((placement, index) => {
    if (index >= changedCount) return placement;
    const transform = new Float32Array(placement.transform);
    transform[14] = (transform[14] ?? 0) + 0.25;
    return { ...placement, transform };
  });
  let builder = createScene();
  for (const part of source.parts.values()) builder = builder.addPart(part);
  return builder
    .addAssembly({ id: root.id, name: "many-piece-replacement", placements })
    .withRoot(root.id)
    .build();
}

function assertChangedTransforms(
  options: ReplacementOptions,
  runtime: ReturnType<typeof createPackedSceneRuntime>,
  changedCount: number,
): void {
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const before = options.runtime.instanceWorldTransforms[slot * 16 + 14] ?? 0;
    const after = runtime.instanceWorldTransforms[slot * 16 + 14] ?? 0;
    const expected = slot < changedCount ? before + 0.25 : before;
    if (after !== expected)
      throw new Error(`Replacement transform ${slot} is ${after}, not ${expected}`);
  }
}

function assertOpaqueSubmission(options: ReplacementOptions, cost: BenchmarkGpuCostSnapshot): void {
  const actual = cost.draws["opaque"];
  const expected =
    options.benchmarkCase.id === "placements-10k"
      ? { calls: 1, indices: 384, instances: 10_000 }
      : { calls: 1_000, indices: 2_904_000, instances: 1_000 };
  if (
    actual?.calls !== expected.calls ||
    actual.indices !== expected.indices ||
    actual.instances !== expected.instances
  ) {
    throw new Error(`${options.benchmarkCase.id} replacement omitted opaque work`);
  }
}

async function render(
  options: ReplacementOptions,
  runtime: ReturnType<typeof createPackedSceneRuntime>,
  scene: Scene,
): Promise<number> {
  const start = performance.now();
  options.renderer.render(runtime, options.camera, scene.parts);
  await options.device.queue.onSubmittedWorkDone();
  return performance.now() - start;
}

function percentiles(values: readonly number[]): BenchmarkPercentiles {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number): number => sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
  return { p50: at(0.5), p95: at(0.95) };
}
