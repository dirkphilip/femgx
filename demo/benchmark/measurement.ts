import { createCamera, projectPoint, type Camera } from "../../src/camera/camera";
import { percentiles } from "./statistics";
import { fitCamera } from "../../src/camera/fit";
import { transformPoint } from "../../src/math/mat4";
import type { Geometry } from "../../src/geometry/part";
import {
  geometrySemanticGraph,
  type PartSemanticGraph,
} from "../../src/geometry/semantic/part-semantic-graph";
import {
  createWebGpuRendererInternal,
  drainGpuTimestampSamples,
  readMaterializedEdgePartIds,
  readGpuCostSnapshot,
  readGpuTimestampSnapshot,
  type WebGpuRenderer,
} from "../../src/renderer/gpu-renderer";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import type { PackedSceneRuntime } from "../../src/scene-runtime/runtime";
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
import { measureSelectionBenchmark } from "./workflows/selection";
import { measureNodeSelectionBenchmark } from "./node-selection";
import { measureHoverBenchmark } from "./hover";
import { measureVisibilityBenchmark } from "./visibility";
import { measureSelectionHideWorkflow } from "./workflows/selection-hide-workflow";
import { measureManyPieceBenchmark } from "./many-piece";
import { captureHiddenInterior, measureCombinedOverlayBenchmark } from "./combined-overlay";
import type {
  BenchmarkTimings,
  NodeSelectionBenchmarkReport,
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
    readonly nodeSelectionOnly?: boolean;
    readonly holdNodeSelectionForCapture?: () => Promise<void>;
    readonly holdElementSelectionForCapture?: (
      phase: "all-but-one" | "all-authored",
    ) => Promise<void>;
    readonly holdCombinedOverlayForCapture?: () => Promise<void>;
    readonly holdHiddenInteriorForCapture?: () => Promise<void>;
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
  let nodeSelection: NodeSelectionBenchmarkReport | undefined;
  let hover: WebGpuBenchmarkCaseResult["hover"];
  let visibility: WebGpuBenchmarkCaseResult["visibility"];
  let selectionHideWorkflow: WebGpuBenchmarkCaseResult["selectionHideWorkflow"];
  let manyPiece: WebGpuBenchmarkCaseResult["manyPiece"];
  let combinedOverlay: WebGpuBenchmarkCaseResult["combinedOverlay"];
  let rendererCreateMs: number;
  let gpuCost: WebGpuBenchmarkCaseResult["gpuCost"] | undefined;
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
    const rendererCreateStart = performance.now();
    renderer = await createWebGpuRendererInternal(
      { canvas, device },
      options.timestampQueriesRequested ?? false,
    );
    renderer.resize(WIDTH, HEIGHT);
    installOrientationBenchmarkState(renderer, benchmarkCase);
    rendererCreateMs = performance.now() - rendererCreateStart;
    coldSample = (
      await measureIteration({
        renderer,
        device,
        benchmarkCase,
        runtime,
        camera,
        pickPoint,
        phase: "first upload",
      })
    ).sample;
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
      gpuCost = sample.gpuCost;
      if (index >= WARMUP_SAMPLES) pushSample(samples, sample.sample);
    }
    if (gpuCost === undefined) throw new Error("Benchmark produced no visible frame cost");
    materializedEdgePartIds = readMaterializedEdgePartIds(renderer);
    if (options.nodeSelectionOnly === true) {
      phase = "authored node-selection sample";
      nodeSelection = await measureNodeSelectionBenchmark({
        renderer,
        device,
        benchmarkCase,
        runtime,
        camera,
        ...(options.holdNodeSelectionForCapture === undefined
          ? {}
          : { holdFinalSelection: options.holdNodeSelectionForCapture }),
      });
    } else {
      phase = "interactive sample";
      interactive = hasInteractiveSample(benchmarkCase)
        ? await measureInteractiveSamples({ renderer, benchmarkCase, runtime, camera })
        : undefined;
      phase = "combined node and edge-presentation overlay sample";
      combinedOverlay = await measureCombinedOverlayBenchmark({
        renderer,
        device,
        benchmarkCase,
        runtime,
        camera,
        pickPoint,
        ...(options.holdCombinedOverlayForCapture === undefined
          ? {}
          : { holdSelectionForCapture: options.holdCombinedOverlayForCapture }),
      });
      phase = "overlay interactive sample";
      overlayInteractive = hasOverlayInteractiveSample(benchmarkCase)
        ? await measureOverlayInteractiveSamples({ renderer, benchmarkCase, runtime, camera })
        : undefined;
      materializedEdgePartIds = readMaterializedEdgePartIds(renderer);
      phase = "element box-selection sample";
      selection = await measureSelectionBenchmark({
        renderer,
        device,
        benchmarkCase,
        runtime,
        camera,
        ...(options.holdElementSelectionForCapture === undefined
          ? {}
          : { holdElementSelectionForCapture: options.holdElementSelectionForCapture }),
      });
      phase = "authored node-selection sample";
      nodeSelection = await measureNodeSelectionBenchmark({
        renderer,
        device,
        benchmarkCase,
        runtime,
        camera,
        ...(options.holdNodeSelectionForCapture === undefined
          ? {}
          : { holdFinalSelection: options.holdNodeSelectionForCapture }),
      });
      phase = "element hover sample";
      hover = await measureHoverBenchmark({
        renderer,
        device,
        benchmarkCase,
        runtime,
        camera,
        pickPoint,
      });
      phase = "visibility sample";
      visibility = await measureVisibilityBenchmark({
        renderer,
        device,
        benchmarkCase,
        runtime,
        camera,
      });
      phase = "selection-hide workflow sample";
      selectionHideWorkflow = await measureSelectionHideWorkflow({
        renderer,
        device,
        benchmarkCase,
        runtime,
        camera,
      });
      if (options.holdHiddenInteriorForCapture !== undefined) {
        phase = "half-hidden interior capture";
        await captureHiddenInterior({
          renderer,
          device,
          benchmarkCase,
          runtime,
          camera,
          hold: options.holdHiddenInteriorForCapture,
        });
      }
      phase = "many-piece interaction sample";
      manyPiece = await measureManyPieceBenchmark({
        renderer,
        device,
        benchmarkCase,
        runtime,
        camera,
      });
    }
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
    rendererCreateMs,
    instanceCount: runtime.instanceCount,
    timings: summarize(coldSample, samples),
    ...(interactive === undefined ? {} : { interactive }),
    ...(overlayInteractive === undefined ? {} : { overlayInteractive }),
    ...(selection === undefined ? {} : { selection }),
    ...(nodeSelection === undefined ? {} : { nodeSelection }),
    ...(hover === undefined ? {} : { hover }),
    ...(visibility === undefined ? {} : { visibility }),
    ...(selectionHideWorkflow === undefined ? {} : { selectionHideWorkflow }),
    ...(manyPiece === undefined ? {} : { manyPiece }),
    ...(combinedOverlay === undefined ? {} : { combinedOverlay }),
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
  renderer.setOrientationGlyphs(state);
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
  for (const part of benchmarkCase.scene.parts.values()) count += part.elements?.count ?? 0;
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
        const semantic = geometrySemanticGraph(geometry);
        if (semantic !== undefined) {
          addGraphSubsetElementIds(submittedElementIds, semantic.graph, semantic.geometryOrdinal);
          continue;
        }
        for (const face of geometry.faceSubset) submittedElementIds.add(face.elementId);
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

function addGraphSubsetElementIds(
  target: Set<number>,
  graph: PartSemanticGraph,
  geometryOrdinal: number,
): void {
  const first = graph.faceSubsetOffsets[geometryOrdinal] ?? 0;
  const last = graph.faceSubsetOffsets[geometryOrdinal + 1] ?? first;
  for (let row = first; row < last; row += 1) {
    const faceOrdinal = graph.faceSubsetOrdinals[row] ?? 0;
    const ownerOrdinal = graph.faceOwnerElementOrdinals[faceOrdinal];
    const elementId = ownerOrdinal === undefined ? undefined : graph.elementIds[ownerOrdinal];
    if (elementId !== undefined) target.add(elementId);
  }
}

function countBodies(benchmarkCase: WebGpuBenchmarkCase): number {
  let count = 0;
  for (const part of benchmarkCase.scene.parts.values()) count += part.bodies?.count ?? 0;
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
        total + (geometry.primitive === "triangles" ? (geometry.faces?.count ?? 0) : 0),
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
  const semantic = geometrySemanticGraph(geometry);
  if (semantic !== undefined) {
    const { graph, geometryOrdinal } = semantic;
    let count = 0;
    const first = graph.faceSubsetOffsets[geometryOrdinal] ?? 0;
    const last = graph.faceSubsetOffsets[geometryOrdinal + 1] ?? first;
    for (let row = first; row < last; row += 1) {
      const faceOrdinal = graph.faceSubsetOrdinals[row] ?? 0;
      count += graph.facePrimitiveCounts[faceOrdinal] ?? 0;
    }
    return count;
  }
  const primitiveCountByFace = new Map<string, number>();
  for (const face of geometry.faces ?? []) {
    primitiveCountByFace.set(`${face.elementId}:${face.faceIndex}`, face.primitiveCount);
  }
  let count = 0;
  for (const face of geometry.faceSubset) {
    count += primitiveCountByFace.get(`${face.elementId}:${face.faceIndex}`) ?? 0;
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

interface IterationResult {
  readonly sample: Record<keyof SampleSet, number>;
  readonly gpuCost: WebGpuBenchmarkCaseResult["gpuCost"];
}

/** Measures one iteration and captures visible-frame GPU cost before trailing pick passes. */
export async function measureIteration(options: IterationOptions): Promise<IterationResult> {
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
  const visibleCost = readGpuCostSnapshot(renderer);
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
    sample: {
      upload: Math.max(0, firstFrame.queueMs - visible.queueMs),
      firstFrame: firstFrame.queueMs,
      firstFrameCpu: firstFrame.cpuMs,
      visible: visible.queueMs,
      visibleCpu: visible.cpuMs,
      pickSnapshot: Math.max(0, pickCombined - pickReadback),
      pickCombined,
      pickReadback,
    },
    gpuCost: visibleCost,
  };
}

interface BenchmarkFrameOptions {
  readonly renderer: WebGpuRenderer;
  readonly device: GPUDevice;
  readonly runtime: PackedSceneRuntime;
  readonly camera: Camera;
  readonly benchmarkCase: WebGpuBenchmarkCase;
}

/** Renders one benchmark frame and waits for its queue work to complete. */
export async function renderBenchmarkFrame(options: BenchmarkFrameOptions): Promise<number> {
  const start = performance.now();
  options.renderer.render(options.runtime, options.camera, options.benchmarkCase.scene.parts);
  await options.device.queue.onSubmittedWorkDone();
  return performance.now() - start;
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
