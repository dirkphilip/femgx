import {
  createCamera,
  fitCamera,
  projectPoint,
  transformPoint,
  type Camera,
} from "../../src/index";
import {
  createWebGpuRenderer,
  readGpuCostSnapshot,
  type WebGpuRenderer,
} from "../../src/renderer/gpu-renderer";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { sceneWorldBounds } from "../../src/viewport/scene-bounds";
import { hasInteractiveSample, measureInteractiveSamples } from "./interactive";
import { estimateBenchmarkMemory, type WebGpuBenchmarkCase } from "./model";
import type { BenchmarkTimings, WebGpuBenchmarkCaseResult } from "./types";

const WIDTH = 800;
const HEIGHT = 600;
const WARMUP_SAMPLES = 2;
const TIMED_SAMPLES = 7;

interface SampleSet {
  readonly upload: number[];
  readonly firstFrame: number[];
  readonly visible: number[];
  readonly pickSnapshot: number[];
  readonly pickCombined: number[];
  readonly pickReadback: number[];
}

/** Measures one benchmark case on the supplied WebGPU device. */
export async function measureBenchmarkCase(
  canvas: HTMLCanvasElement,
  device: GPUDevice,
  benchmarkCase: WebGpuBenchmarkCase,
  modelBuildMs: number,
): Promise<WebGpuBenchmarkCaseResult> {
  const runtimeCompileStart = performance.now();
  let runtimeCompileMs: number;
  let runtime: ReturnType<typeof createPackedSceneRuntime>;
  let camera: Camera;
  let pickPoint: readonly [number, number];
  let phase = "first upload";
  let renderer: WebGpuRenderer | undefined;
  let coldSample: Record<keyof SampleSet, number>;
  let interactive: WebGpuBenchmarkCaseResult["interactive"];
  let gpuCost: WebGpuBenchmarkCaseResult["gpuCost"];
  const samples = emptySamples();
  const uniqueTriangles = countUniqueTriangles(benchmarkCase);
  try {
    phase = "runtime compile";
    runtime = createPackedSceneRuntime(benchmarkCase.scene);
    runtimeCompileMs = performance.now() - runtimeCompileStart;
    const bounds = sceneWorldBounds(benchmarkCase.scene, runtime);
    camera = fitCamera(createCamera(), bounds, WIDTH, HEIGHT);
    phase = "first upload";
    pickPoint = benchmarkPickPoint(canvas, benchmarkCase, runtime, camera);
    renderer = await createWebGpuRenderer({ canvas, device });
    renderer.resize(WIDTH, HEIGHT);
    coldSample = await measureIteration({
      renderer,
      device,
      benchmarkCase,
      runtime,
      camera,
      pickPoint,
      phase: "first upload",
    });
    phase = "frame";
    for (let index = 0; index < WARMUP_SAMPLES + TIMED_SAMPLES; index++) {
      const sample = await measureIteration({
        renderer,
        device,
        benchmarkCase,
        runtime,
        camera,
        pickPoint,
        phase: "frame",
      });
      if (index >= WARMUP_SAMPLES) pushSample(samples, sample);
    }
    gpuCost = readGpuCostSnapshot(renderer);
    phase = "interactive sample";
    interactive = hasInteractiveSample(benchmarkCase)
      ? await measureInteractiveSamples({
          renderer,
          benchmarkCase,
          runtime,
          camera,
        })
      : undefined;
  } catch (error) {
    throw withBenchmarkPhase(phase, error);
  } finally {
    renderer?.destroy();
  }
  return {
    id: benchmarkCase.id,
    name: benchmarkCase.name,
    kind: benchmarkCase.kind,
    elementFamily: benchmarkCase.elementFamily,
    ...(benchmarkCase.structuredFamily === undefined
      ? {}
      : { structuredFamily: benchmarkCase.structuredFamily }),
    partCount: benchmarkCase.scene.parts.size,
    drawBatchCount: benchmarkCase.scene.parts.size,
    bodyCount: countBodies(benchmarkCase),
    uniqueElementCount: countUniqueElements(benchmarkCase),
    submittedElementOccurrences: countSubmittedElementOccurrences(benchmarkCase, runtime),
    nodeCount: countNodes(benchmarkCase),
    faceCount: countFaces(benchmarkCase),
    uniqueVertices: countUniqueVertices(benchmarkCase),
    uniqueTriangles,
    submittedTriangles: submittedTriangleCount(benchmarkCase, runtime, false),
    visibleTriangles: submittedTriangleCount(benchmarkCase, runtime, true),
    modelBuildMs,
    runtimeCompileMs,
    instanceCount: runtime.instanceCount,
    timings: summarize(coldSample, samples),
    ...(interactive === undefined ? {} : { interactive }),
    estimatedMemory: estimateBenchmarkMemory(
      benchmarkCase.scene,
      runtime.instanceCount,
      WIDTH,
      HEIGHT,
    ),
    gpuCost,
  };
}

function countUniqueVertices(benchmarkCase: WebGpuBenchmarkCase): number {
  let count = 0;
  for (const part of benchmarkCase.scene.parts.values())
    count += part.geometry.positions.length / 3;
  return count;
}

function countUniqueTriangles(benchmarkCase: WebGpuBenchmarkCase): number {
  let count = 0;
  for (const part of benchmarkCase.scene.parts.values()) count += part.geometry.indices.length / 3;
  return count;
}

function countUniqueElements(benchmarkCase: WebGpuBenchmarkCase): number {
  let count = 0;
  for (const part of benchmarkCase.scene.parts.values())
    count += part.geometry.elements?.length ?? 0;
  return count;
}

function countSubmittedElementOccurrences(
  benchmarkCase: WebGpuBenchmarkCase,
  runtime: ReturnType<typeof createPackedSceneRuntime>,
): number {
  let count = 0;
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const partId = runtime.instancePartIds[slot];
    count += benchmarkCase.scene.parts.get(partId ?? 0)?.geometry.elements?.length ?? 0;
  }
  return count;
}

function countBodies(benchmarkCase: WebGpuBenchmarkCase): number {
  let count = 0;
  for (const part of benchmarkCase.scene.parts.values()) count += part.geometry.bodies?.length ?? 0;
  return count;
}

function countNodes(benchmarkCase: WebGpuBenchmarkCase): number {
  let count = 0;
  for (const part of benchmarkCase.scene.parts.values()) {
    count += (part.geometry.nodePositions?.length ?? part.geometry.positions.length) / 3;
  }
  return count;
}

function countFaces(benchmarkCase: WebGpuBenchmarkCase): number {
  let count = 0;
  for (const part of benchmarkCase.scene.parts.values()) {
    if (part.geometry.primitive === "triangles") count += part.geometry.faces?.length ?? 0;
  }
  return count;
}

function benchmarkPickPoint(
  canvas: HTMLCanvasElement,
  benchmarkCase: WebGpuBenchmarkCase,
  runtime: ReturnType<typeof createPackedSceneRuntime>,
  camera: Camera,
): readonly [number, number] {
  const instance = runtime.getDrawList()[0];
  const partId = instance === undefined ? undefined : runtime.getPartId(instance);
  const part = partId === undefined ? undefined : benchmarkCase.scene.parts.get(partId);
  const transform = instance === undefined ? undefined : runtime.getTransform(instance);
  if (part === undefined || transform === undefined) {
    throw new Error(`${benchmarkCase.id} has no drawable benchmark instance`);
  }
  const localPickPoint: readonly [number, number, number] = [
    (part.bounds.minX + part.bounds.maxX) / 2,
    (part.bounds.minY + part.bounds.maxY) / 2,
    (part.bounds.minZ + part.bounds.maxZ) / 2,
  ];
  const worldPoint = transformPoint(
    transform,
    localPickPoint[0],
    localPickPoint[1],
    localPickPoint[2],
  );
  const projected = projectPoint(camera, worldPoint);
  if (projected === undefined)
    throw new Error(`${benchmarkCase.id} pick point is behind the camera`);
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) throw new Error("Benchmark canvas has no visible size");
  return [(projected[0] * rect.width) / camera.width, (projected[1] * rect.height) / camera.height];
}

function submittedTriangleCount(
  benchmarkCase: WebGpuBenchmarkCase,
  runtime: ReturnType<typeof createPackedSceneRuntime>,
  visibleOnly: boolean,
): number {
  let count = 0;
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    if (visibleOnly && !runtime.isInstanceVisible(slot)) continue;
    const partId = runtime.instancePartIds[slot];
    const part = partId === undefined ? undefined : benchmarkCase.scene.parts.get(partId);
    if (part !== undefined) count += part.geometry.indices.length / 3;
  }
  return count;
}

interface IterationOptions {
  readonly renderer: WebGpuRenderer;
  readonly device: GPUDevice;
  readonly benchmarkCase: WebGpuBenchmarkCase;
  readonly runtime: ReturnType<typeof createPackedSceneRuntime>;
  readonly camera: Camera;
  readonly pickPoint: readonly [number, number];
  readonly phase: "first upload" | "frame";
}

async function measureIteration(
  options: IterationOptions,
): Promise<Record<keyof SampleSet, number>> {
  const { renderer, device, benchmarkCase, runtime, camera, pickPoint, phase } = options;
  let firstFrame: number;
  try {
    firstFrame = await timeGpu(device, () => {
      renderer.render(runtime, camera, benchmarkCase.scene.parts);
    });
  } catch (error) {
    throw withBenchmarkPhase(phase, error);
  }
  let visible: number;
  try {
    visible = await timeGpu(device, () => {
      renderer.render(runtime, camera, benchmarkCase.scene.parts);
    });
  } catch (error) {
    throw withBenchmarkPhase("frame", error);
  }
  try {
    await timePick(renderer, pickPoint[0], pickPoint[1]);
  } catch (error) {
    throw withBenchmarkPhase("pick snapshot", error);
  }
  try {
    const invalidatingCamera = { ...camera };
    renderer.render(runtime, invalidatingCamera, benchmarkCase.scene.parts);
    await device.queue.onSubmittedWorkDone();
  } catch (error) {
    throw withBenchmarkPhase("frame", error);
  }
  let pickCombined: number;
  try {
    pickCombined = await timePick(renderer, pickPoint[0], pickPoint[1]);
  } catch (error) {
    throw withBenchmarkPhase("pick snapshot", error);
  }
  let pickReadback: number;
  try {
    pickReadback = await timePick(renderer, pickPoint[0], pickPoint[1]);
  } catch (error) {
    throw withBenchmarkPhase("pick readback", error);
  }
  return {
    upload: Math.max(0, firstFrame - visible),
    firstFrame,
    visible,
    pickSnapshot: Math.max(0, pickCombined - pickReadback),
    pickCombined,
    pickReadback,
  };
}

function withBenchmarkPhase(phase: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return Object.assign(new Error(detail, { cause: error }), { benchmarkPhase: phase });
}

async function timeGpu(device: GPUDevice, submit: () => void): Promise<number> {
  const start = performance.now();
  submit();
  await device.queue.onSubmittedWorkDone();
  return performance.now() - start;
}

async function timePick(renderer: WebGpuRenderer, x: number, y: number): Promise<number> {
  const start = performance.now();
  let target: Awaited<ReturnType<WebGpuRenderer["pick"]>>;
  try {
    target = await renderer.pick(x, y);
  } catch (error) {
    const cause = error instanceof Error && "cause" in error ? error.cause : error;
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Benchmark pick readback failed at (${x.toFixed(1)}, ${y.toFixed(1)}): ${detail}`,
      { cause: error },
    );
  }
  if (target === undefined) throw new Error("Benchmark pick coordinate did not hit the model");
  return performance.now() - start;
}

function emptySamples(): SampleSet {
  return {
    upload: [],
    firstFrame: [],
    visible: [],
    pickSnapshot: [],
    pickCombined: [],
    pickReadback: [],
  };
}

function pushSample(target: SampleSet, sample: Record<keyof SampleSet, number>): void {
  for (const key of Object.keys(target) as (keyof SampleSet)[]) target[key].push(sample[key]);
}

function summarize(
  coldSample: Record<keyof SampleSet, number>,
  samples: SampleSet,
): BenchmarkTimings {
  return {
    uploadAttachmentEstimateMs: percentiles([coldSample.upload]),
    uploadAndFirstFrameMs: percentiles([coldSample.firstFrame]),
    visibleFrameMs: percentiles(samples.visible),
    pickSnapshotEstimateMs: percentiles(samples.pickSnapshot),
    pickSnapshotAndReadbackMs: percentiles(samples.pickCombined),
    pickReadbackMs: percentiles(samples.pickReadback),
  };
}

function percentiles(values: readonly number[]): { readonly p50: number; readonly p95: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number): number => sorted[Math.ceil(fraction * sorted.length) - 1] ?? 0;
  return { p50: at(0.5), p95: at(0.95) };
}
