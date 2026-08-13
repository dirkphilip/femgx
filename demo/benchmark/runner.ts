import {
  createCamera,
  fitCamera,
  projectPoint,
  transformPoint,
  type Camera,
} from "../../src/index";
import { createWebGpuRenderer, type WebGpuRenderer } from "../../src/renderer/gpu-renderer";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { sceneWorldBounds } from "../../src/viewport/scene-bounds";
import {
  hasInteractiveSample,
  measureInteractiveSamples,
  type InteractiveSamples,
} from "./interactive";
import {
  benchmarkCaseSpecs,
  createBenchmarkCase,
  estimateBenchmarkMemory,
  type BenchmarkMemoryEstimate,
  type WebGpuBenchmarkCase,
  type WebGpuBenchmarkElementFamily,
  type WebGpuBenchmarkKind,
} from "./model";

const WIDTH = 800;
const HEIGHT = 600;
const WARMUP_SAMPLES = 2;
const TIMED_SAMPLES = 7;
const MEMORY_ESTIMATE_SCOPE =
  "renderer-owned buffers and fixed render targets; excludes CPU scene, transient staging, and driver allocations";

interface Percentiles {
  readonly p50: number;
  readonly p95: number;
}

interface BenchmarkTimings {
  readonly uploadAttachmentEstimateMs: Percentiles;
  readonly uploadAndFirstFrameMs: Percentiles;
  readonly visibleFrameMs: Percentiles;
  readonly pickSnapshotEstimateMs: Percentiles;
  readonly pickSnapshotAndReadbackMs: Percentiles;
  readonly pickReadbackMs: Percentiles;
}

export interface WebGpuBenchmarkCaseResult {
  readonly id: string;
  readonly name: string;
  readonly kind: WebGpuBenchmarkKind;
  readonly elementFamily: WebGpuBenchmarkElementFamily;
  readonly structuredFamily?: WebGpuBenchmarkCase["structuredFamily"];
  readonly partCount: number;
  readonly drawBatchCount: number;
  readonly bodyCount: number;
  readonly uniqueElementCount: number;
  readonly submittedElementOccurrences: number;
  readonly nodeCount: number;
  readonly faceCount: number;
  readonly uniqueVertices: number;
  readonly uniqueTriangles: number;
  readonly submittedTriangles: number;
  readonly visibleTriangles: number;
  readonly modelBuildMs: number;
  readonly runtimeCompileMs: number;
  readonly instanceCount: number;
  readonly timings: BenchmarkTimings;
  readonly interactive?: InteractiveSamples;
  readonly estimatedMemory: BenchmarkMemoryEstimate;
}

export interface WebGpuBenchmarkReport {
  readonly schemaVersion: 2;
  readonly generatedAt: string;
  readonly browser: string;
  readonly adapter: {
    readonly vendor: string;
    readonly architecture: string;
    readonly device: string;
    readonly description: string;
    readonly isFallbackAdapter: boolean;
  };
  readonly enabledFeatures: readonly string[];
  readonly resolution: { readonly width: number; readonly height: number; readonly dpr: number };
  readonly memoryEstimateScope: string;
  readonly warmupSamples: number;
  readonly timedSamples: number;
  readonly cases: readonly WebGpuBenchmarkCaseResult[];
}

interface SampleSet {
  readonly upload: number[];
  readonly firstFrame: number[];
  readonly visible: number[];
  readonly pickSnapshot: number[];
  readonly pickCombined: number[];
  readonly pickReadback: number[];
}

/** Runs the opt-in, hardware-dependent WebGPU capacity benchmark. */
export async function runWebGpuBenchmark(
  canvas: HTMLCanvasElement,
  options: { readonly includeLarge: boolean },
): Promise<WebGpuBenchmarkReport> {
  if (devicePixelRatio !== 1)
    throw new Error(`WebGPU benchmark requires DPR 1, got ${devicePixelRatio}`);
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (adapter === null) throw new Error("No WebGPU adapter is available for the benchmark");
  const device = await adapter.requestDevice();
  const enabledFeatures = [...device.features].sort();
  canvas.style.width = `${WIDTH}px`;
  canvas.style.height = `${HEIGHT}px`;
  const results: WebGpuBenchmarkCaseResult[] = [];
  try {
    for (const spec of benchmarkCaseSpecs(options.includeLarge)) {
      const modelBuildStart = performance.now();
      const benchmarkCase = createBenchmarkCase(spec);
      results.push(
        await measureCase(canvas, device, benchmarkCase, performance.now() - modelBuildStart),
      );
    }
  } finally {
    device.destroy();
  }
  const info = adapter.info;
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    adapter: {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
      isFallbackAdapter: info.isFallbackAdapter,
    },
    enabledFeatures,
    resolution: { width: WIDTH, height: HEIGHT, dpr: devicePixelRatio },
    memoryEstimateScope: MEMORY_ESTIMATE_SCOPE,
    warmupSamples: WARMUP_SAMPLES,
    timedSamples: TIMED_SAMPLES,
    cases: results,
  };
}

async function measureCase(
  canvas: HTMLCanvasElement,
  device: GPUDevice,
  benchmarkCase: WebGpuBenchmarkCase,
  modelBuildMs: number,
): Promise<WebGpuBenchmarkCaseResult> {
  const runtimeCompileStart = performance.now();
  const runtime = createPackedSceneRuntime(benchmarkCase.scene);
  const runtimeCompileMs = performance.now() - runtimeCompileStart;
  const bounds = sceneWorldBounds(benchmarkCase.scene, runtime);
  const camera = fitCamera(createCamera(), bounds, WIDTH, HEIGHT);
  const uniqueTriangles = countUniqueTriangles(benchmarkCase);
  const pickPoint = benchmarkPickPoint(canvas, benchmarkCase, runtime, camera);
  const samples = emptySamples();
  for (let index = 0; index < WARMUP_SAMPLES + TIMED_SAMPLES; index++) {
    const sample = await measureIteration({
      canvas,
      device,
      benchmarkCase,
      runtime,
      camera,
      pickPoint,
    });
    if (index >= WARMUP_SAMPLES) pushSample(samples, sample);
  }
  const interactive = hasInteractiveSample(benchmarkCase)
    ? await measureInteractiveSamples({
        canvas,
        device,
        benchmarkCase,
        runtime,
        camera,
        width: WIDTH,
        height: HEIGHT,
      })
    : undefined;
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
    timings: summarize(samples),
    ...(interactive === undefined ? {} : { interactive }),
    estimatedMemory: estimateBenchmarkMemory(
      benchmarkCase.scene,
      runtime.instanceCount,
      WIDTH,
      HEIGHT,
    ),
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
  for (const part of benchmarkCase.scene.parts.values()) {
    count += part.geometry.indices.length / 3;
  }
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
  readonly canvas: HTMLCanvasElement;
  readonly device: GPUDevice;
  readonly benchmarkCase: WebGpuBenchmarkCase;
  readonly runtime: ReturnType<typeof createPackedSceneRuntime>;
  readonly camera: Camera;
  readonly pickPoint: readonly [number, number];
}

async function measureIteration(
  options: IterationOptions,
): Promise<Record<keyof SampleSet, number>> {
  const { canvas, device, benchmarkCase, runtime, camera, pickPoint } = options;
  const renderer = await createWebGpuRenderer({ canvas, device });
  renderer.resize(WIDTH, HEIGHT);
  try {
    const firstFrame = await timeGpu(device, () => {
      renderer.render(runtime, camera, benchmarkCase.scene.parts);
    });
    const visible = await timeGpu(device, () => {
      renderer.render(runtime, camera, benchmarkCase.scene.parts);
    });
    await timePick(renderer, pickPoint[0], pickPoint[1]);
    const invalidatingCamera = { ...camera };
    renderer.render(runtime, invalidatingCamera, benchmarkCase.scene.parts);
    await device.queue.onSubmittedWorkDone();
    const pickCombined = await timePick(renderer, pickPoint[0], pickPoint[1]);
    const pickReadback = await timePick(renderer, pickPoint[0], pickPoint[1]);
    return {
      upload: Math.max(0, firstFrame - visible),
      firstFrame,
      visible,
      pickSnapshot: Math.max(0, pickCombined - pickReadback),
      pickCombined,
      pickReadback,
    };
  } finally {
    renderer.destroy();
  }
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

function summarize(samples: SampleSet): BenchmarkTimings {
  return {
    uploadAttachmentEstimateMs: percentiles(samples.upload),
    uploadAndFirstFrameMs: percentiles(samples.firstFrame),
    visibleFrameMs: percentiles(samples.visible),
    pickSnapshotEstimateMs: percentiles(samples.pickSnapshot),
    pickSnapshotAndReadbackMs: percentiles(samples.pickCombined),
    pickReadbackMs: percentiles(samples.pickReadback),
  };
}

function percentiles(values: readonly number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number): number => sorted[Math.ceil(fraction * sorted.length) - 1] ?? 0;
  return { p50: at(0.5), p95: at(0.95) };
}
