import { createCamera, projectPoint, type Camera } from "../../src/camera/camera";
import { fitCamera } from "../../src/camera/fit";
import { transformPoint } from "../../src/math/mat4";
import type { Geometry } from "../../src/geometry/part";
import { packedSemanticStorageForGeometry } from "../../src/geometry/packed/packed-semantic";
import {
  createWebGpuRendererInternal,
  drainGpuTimestampSamples,
  readMaterializedEdgePartIds,
  readGpuCostSnapshot,
  readGpuTimestampSnapshot,
  setRendererOrientationGlyphs,
  type WebGpuRenderer,
} from "../../src/renderer/gpu-renderer";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { resolveElementalOrientationRecords } from "../../src/results/orientation-records";
import type { OrientationGlyphState } from "../../src/renderer/orientation-glyphs/orientation-glyph";
import { sceneWorldBounds } from "../../src/viewport/scene-bounds";
import {
  hasInteractiveSample,
  hasOverlayInteractiveSample,
  measureInteractiveSamples,
  measureOverlayInteractiveSamples,
} from "./interactive";
import { estimateBenchmarkMemory, type WebGpuBenchmarkCase } from "./model";
import { measureSelectionBenchmark } from "./selection";
import type {
  BenchmarkTimings,
  SelectionBenchmarkReport,
  WebGpuBenchmarkCaseResult,
} from "./types";

const WIDTH = 800;
const HEIGHT = 600;
const WARMUP_SAMPLES = 2;
const TIMED_SAMPLES = 7;

interface SampleSet {
  readonly upload: number[];
  readonly firstFrame: number[];
  readonly firstFrameCpu: number[];
  readonly visible: number[];
  readonly visibleCpu: number[];
  readonly pickSnapshot: number[];
  readonly pickCombined: number[];
  readonly pickReadback: number[];
}

const SAMPLE_KEYS = [
  "upload",
  "firstFrame",
  "firstFrameCpu",
  "visible",
  "visibleCpu",
  "pickSnapshot",
  "pickCombined",
  "pickReadback",
] as const satisfies readonly (keyof SampleSet)[];

/** Measures one benchmark case on the supplied WebGPU device. */
export async function measureBenchmarkCase(
  canvas: HTMLCanvasElement,
  device: GPUDevice,
  benchmarkCase: WebGpuBenchmarkCase,
  modelBuildMs: number,
  options: {
    readonly timestampQueriesRequested?: boolean;
    readonly denseBuild?: WebGpuBenchmarkCaseResult["denseBuild"];
  } = {},
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
  let overlayInteractive: WebGpuBenchmarkCaseResult["overlayInteractive"];
  let selection: SelectionBenchmarkReport | undefined;
  let gpuCost: WebGpuBenchmarkCaseResult["gpuCost"];
  let gpuTimestamps: WebGpuBenchmarkCaseResult["gpuTimestamps"];
  let materializedEdgePartIds: ReadonlySet<number>;
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
    renderer = await createWebGpuRendererInternal(
      { canvas, device },
      options.timestampQueriesRequested ?? false,
    );
    renderer.resize(WIDTH, HEIGHT);
    installOrientationBenchmarkState(renderer, benchmarkCase);
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
    phase = "overlay interactive sample";
    overlayInteractive = hasOverlayInteractiveSample(benchmarkCase)
      ? await measureOverlayInteractiveSamples({
          renderer,
          benchmarkCase,
          runtime,
          camera,
        })
      : undefined;
    materializedEdgePartIds = readMaterializedEdgePartIds(renderer);
    phase = "element box-selection sample";
    selection = await measureSelectionBenchmark({
      renderer,
      device,
      benchmarkCase,
      runtime,
      camera,
    });
    phase = "timestamp readback";
    await drainGpuTimestampSamples(renderer);
    gpuTimestamps = readGpuTimestampSnapshot(renderer);
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
    ...(options.denseBuild === undefined ? {} : { denseBuild: options.denseBuild }),
    runtimeCompileMs,
    instanceCount: runtime.instanceCount,
    timings: summarize(coldSample, samples),
    ...(interactive === undefined ? {} : { interactive }),
    ...(overlayInteractive === undefined ? {} : { overlayInteractive }),
    ...(selection === undefined ? {} : { selection }),
    estimatedMemory: estimateBenchmarkMemory(
      benchmarkCase.scene,
      runtime.instanceCount,
      WIDTH,
      HEIGHT,
      { materializedEdgePartIds },
    ),
    gpuCost,
    gpuTimestamps,
    presentation: {
      nodeSizeCssPixels: 6,
      nodeSizeDevicePixels: 6 * devicePixelRatio,
      devicePixelRatio,
      resolvedMsaaSampleCount: gpuCost.targets?.sampleCount ?? 4,
      projectionProxy: "camera-space point-size",
      cpuProxy: "node draw calls and instances",
    },
  };
}

function installOrientationBenchmarkState(
  renderer: WebGpuRenderer,
  benchmarkCase: WebGpuBenchmarkCase,
): void {
  const field = benchmarkCase.orientationField;
  if (field === undefined) return;
  const parts = new Map(
    [...benchmarkCase.scene.parts].map(([partId, part]) => [
      partId,
      resolveElementalOrientationRecords(part, field),
    ]),
  );
  const state: OrientationGlyphState = {
    parts,
    mode: "axis",
    transform: "direction",
    lengthScale: 1,
    widthPixels: 2,
  };
  setRendererOrientationGlyphs(renderer, state);
}

function countUniqueVertices(benchmarkCase: WebGpuBenchmarkCase): number {
  let count = 0;
  for (const part of benchmarkCase.scene.parts.values())
    for (const geometry of part.geometries) count += geometry.positions.length / 3;
  return count;
}

function countUniqueTriangles(benchmarkCase: WebGpuBenchmarkCase): number {
  let count = 0;
  for (const part of benchmarkCase.scene.parts.values())
    for (const geometry of part.geometries) count += geometry.indices.length / 3;
  return count;
}

function countUniqueElements(benchmarkCase: WebGpuBenchmarkCase): number {
  let count = 0;
  for (const part of benchmarkCase.scene.parts.values()) count += part.elements?.length ?? 0;
  return count;
}

function countSubmittedElementOccurrences(
  benchmarkCase: WebGpuBenchmarkCase,
  runtime: ReturnType<typeof createPackedSceneRuntime>,
): number {
  let count = 0;
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const partId = runtime.instancePartIds[slot];
    const part = partId === undefined ? undefined : benchmarkCase.scene.parts.get(partId);
    if (part === undefined) continue;
    const submittedElementIds = new Set<number>();
    for (const geometry of part.geometries) {
      if (geometry.primitive === "triangles" && geometry.faceSubset !== undefined) {
        const packed = packedSemanticStorageForGeometry(geometry);
        if (packed?.faceSubsetOrdinals !== undefined) {
          addPackedSubsetElementIds(submittedElementIds, packed);
          continue;
        }
        for (const face of geometry.faceSubset.faceIds) submittedElementIds.add(face.elementId);
        continue;
      }
      for (const element of part.elements ?? []) {
        if (
          element.primitiveRanges.some(
            (range) => range.primitive === geometry.primitive && range.primitiveCount > 0,
          )
        ) {
          submittedElementIds.add(element.id);
        }
      }
    }
    count += submittedElementIds.size;
  }
  return count;
}

function addPackedSubsetElementIds(
  target: Set<number>,
  packed: NonNullable<ReturnType<typeof packedSemanticStorageForGeometry>>,
): void {
  for (const faceOrdinal of packed.faceSubsetOrdinals ?? []) {
    const ownerOrdinal = packed.faceOwnerElementOrdinals[faceOrdinal];
    const elementId = ownerOrdinal === undefined ? undefined : packed.elementIds[ownerOrdinal];
    if (elementId !== undefined) target.add(elementId);
  }
}

function countBodies(benchmarkCase: WebGpuBenchmarkCase): number {
  let count = 0;
  for (const part of benchmarkCase.scene.parts.values()) count += part.bodies?.length ?? 0;
  return count;
}

function countNodes(benchmarkCase: WebGpuBenchmarkCase): number {
  let count = 0;
  for (const part of benchmarkCase.scene.parts.values()) {
    count +=
      (part.nodePositions?.length ??
        part.geometries.reduce((total, geometry) => total + geometry.positions.length, 0)) / 3;
  }
  return count;
}

function countFaces(benchmarkCase: WebGpuBenchmarkCase): number {
  let count = 0;
  for (const part of benchmarkCase.scene.parts.values()) {
    count += part.geometries.reduce(
      (total, geometry) =>
        total + (geometry.primitive === "triangles" ? (geometry.faces?.length ?? 0) : 0),
      0,
    );
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

/** Counts the triangle occurrences represented by the visible surface draw order. */
export function submittedTriangleCount(
  benchmarkCase: WebGpuBenchmarkCase,
  runtime: ReturnType<typeof createPackedSceneRuntime>,
  visibleOnly: boolean,
): number {
  let count = 0;
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    if (visibleOnly && !runtime.isInstanceVisible(slot)) continue;
    const partId = runtime.instancePartIds[slot];
    const part = partId === undefined ? undefined : benchmarkCase.scene.parts.get(partId);
    if (part !== undefined) {
      count += part.geometries.reduce(
        (total, geometry) => total + submittedTrianglesForGeometry(geometry),
        0,
      );
    }
  }
  return count;
}

function submittedTrianglesForGeometry(geometry: Geometry): number {
  if (geometry.primitive !== "triangles") return 0;
  if (geometry.faceSubset === undefined) return geometry.indices.length / 3;
  const packed = packedSemanticStorageForGeometry(geometry);
  if (packed?.faceSubsetOrdinals !== undefined) {
    let count = 0;
    for (const faceOrdinal of packed.faceSubsetOrdinals) {
      count += packed.facePrimitiveCounts[faceOrdinal] ?? 0;
    }
    return count;
  }
  const primitiveCountByFace = new Map(
    (geometry.faces ?? []).map(
      (face) => [`${face.elementId}:${face.faceIndex}`, face.primitiveCount] as const,
    ),
  );
  return geometry.faceSubset.faceIds.reduce(
    (total, face) => total + (primitiveCountByFace.get(`${face.elementId}:${face.faceIndex}`) ?? 0),
    0,
  );
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
  let firstFrame: FrameTiming;
  try {
    firstFrame = await timeQueueDrained(device, () => {
      renderer.render(runtime, camera, benchmarkCase.scene.parts);
    });
  } catch (error) {
    throw withBenchmarkPhase(phase, error);
  }
  let visible: FrameTiming;
  try {
    visible = await timeQueueDrained(device, () => {
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
    upload: Math.max(0, firstFrame.queueMs - visible.queueMs),
    firstFrame: firstFrame.queueMs,
    firstFrameCpu: firstFrame.cpuMs,
    visible: visible.queueMs,
    visibleCpu: visible.cpuMs,
    pickSnapshot: Math.max(0, pickCombined - pickReadback),
    pickCombined,
    pickReadback,
  };
}

function withBenchmarkPhase(phase: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return Object.assign(new Error(detail, { cause: error }), { benchmarkPhase: phase });
}

interface FrameTiming {
  readonly queueMs: number;
  readonly cpuMs: number;
}

/** Measures submission-to-completion wall time and CPU encode time separately. */
async function timeQueueDrained(device: GPUDevice, submit: () => void): Promise<FrameTiming> {
  const start = performance.now();
  submit();
  const cpuMs = performance.now() - start;
  await device.queue.onSubmittedWorkDone();
  return { queueMs: performance.now() - start, cpuMs };
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
    firstFrameCpu: [],
    visible: [],
    visibleCpu: [],
    pickSnapshot: [],
    pickCombined: [],
    pickReadback: [],
  };
}

function pushSample(target: SampleSet, sample: Record<keyof SampleSet, number>): void {
  for (const key of SAMPLE_KEYS) target[key].push(sample[key]);
}

function summarize(
  coldSample: Record<keyof SampleSet, number>,
  samples: SampleSet,
): BenchmarkTimings {
  return {
    uploadAttachmentEstimateMs: percentiles([coldSample.upload]),
    uploadAndFirstFrameMs: percentiles([coldSample.firstFrame]),
    uploadAndFirstFrameCpuMs: percentiles([coldSample.firstFrameCpu]),
    visibleFrameMs: percentiles(samples.visible),
    visibleFrameCpuMs: percentiles(samples.visibleCpu),
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
