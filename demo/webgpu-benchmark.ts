import {
  createCamera,
  createWebGpuRenderer,
  fitCamera,
  type Camera,
  type WebGpuRenderer,
} from "../src/index";
import { createPackedSceneRuntime } from "../src/scene-runtime/runtime";
import {
  benchmarkCaseSpecs,
  createBenchmarkCase,
  estimateBenchmarkMemory,
  type BenchmarkMemoryEstimate,
  type WebGpuBenchmarkCase,
} from "./webgpu-benchmark-model";

const WIDTH = 800;
const HEIGHT = 600;
const WARMUP_SAMPLES = 2;
const TIMED_SAMPLES = 7;

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
  readonly kind: WebGpuBenchmarkCase["kind"];
  readonly uniqueTriangles: number;
  readonly submittedTriangles: number;
  readonly visibleTriangles: number;
  readonly instanceCount: number;
  readonly timings: BenchmarkTimings;
  readonly estimatedMemory: BenchmarkMemoryEstimate;
}

export interface WebGpuBenchmarkReport {
  readonly schemaVersion: 1;
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
      const benchmarkCase = createBenchmarkCase(spec);
      results.push(await measureCase(canvas, device, benchmarkCase));
    }
  } finally {
    device.destroy();
  }
  const info = adapter.info;
  return {
    schemaVersion: 1,
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
    warmupSamples: WARMUP_SAMPLES,
    timedSamples: TIMED_SAMPLES,
    cases: results,
  };
}

async function measureCase(
  canvas: HTMLCanvasElement,
  device: GPUDevice,
  benchmarkCase: WebGpuBenchmarkCase,
): Promise<WebGpuBenchmarkCaseResult> {
  const runtime = createPackedSceneRuntime(benchmarkCase.scene);
  const part = benchmarkCase.scene.parts.values().next().value;
  if (part === undefined) throw new Error(`${benchmarkCase.id} has no part`);
  const uniqueTriangles = part.geometry.indices.length / 3;
  const camera = fitCamera(createCamera(), part.bounds, WIDTH, HEIGHT);
  const samples = emptySamples();
  for (let index = 0; index < WARMUP_SAMPLES + TIMED_SAMPLES; index++) {
    const sample = await measureIteration(canvas, device, benchmarkCase, runtime, camera);
    if (index >= WARMUP_SAMPLES) pushSample(samples, sample);
  }
  return {
    id: benchmarkCase.id,
    kind: benchmarkCase.kind,
    uniqueTriangles,
    submittedTriangles: uniqueTriangles * runtime.instanceCount,
    visibleTriangles: uniqueTriangles * runtime.visibleCount,
    instanceCount: runtime.instanceCount,
    timings: summarize(samples),
    estimatedMemory: estimateBenchmarkMemory(
      benchmarkCase.gridCells,
      runtime.instanceCount,
      WIDTH,
      HEIGHT,
    ),
  };
}

async function measureIteration(
  canvas: HTMLCanvasElement,
  device: GPUDevice,
  benchmarkCase: WebGpuBenchmarkCase,
  runtime: ReturnType<typeof createPackedSceneRuntime>,
  camera: Camera,
): Promise<Record<keyof SampleSet, number>> {
  const renderer = await createWebGpuRenderer({ canvas, device });
  renderer.resize(WIDTH, HEIGHT);
  try {
    const firstFrame = await timeGpu(device, () => {
      renderer.render(runtime, camera, benchmarkCase.scene.parts);
    });
    const visible = await timeGpu(device, () => {
      renderer.render(runtime, camera, benchmarkCase.scene.parts);
    });
    await timePick(renderer, WIDTH / 2, HEIGHT / 2);
    const invalidatingCamera = { ...camera };
    renderer.render(runtime, invalidatingCamera, benchmarkCase.scene.parts);
    await device.queue.onSubmittedWorkDone();
    const pickCombined = await timePick(renderer, WIDTH / 2, HEIGHT / 2);
    const pickReadback = await timePick(renderer, WIDTH / 2, HEIGHT / 2);
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
  const target = await renderer.pick(x, y);
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
