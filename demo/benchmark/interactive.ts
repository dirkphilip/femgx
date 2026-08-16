import { orbitCamera, type Camera } from "../../src/camera/camera";
import { createInteractionState, setPartOverride } from "../../src/interaction/interaction";
import type { WebGpuRenderer } from "../../src/renderer/gpu-renderer";
import type { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { calculateRenderLoopStats } from "../workbench/viewport/render-loop";
import type { WebGpuBenchmarkCase } from "./model";

const WARMUP_MS = 500;
const SAMPLE_MS = 2_000;
const YAW_RADIANS = 0.35;
const PITCH_RADIANS = 0.08;
const LONG_FRAME_MS = 16.7;
const VERY_LONG_FRAME_MS = 33.3;

const INTERACTIVE_CASE_IDS = new Set([
  "instanced-2.10m",
  "unique-1m",
  "many-parts-100",
  "fe-tet4-solid-132k",
]);

const OVERLAY_CASE_IDS = new Set(["instanced-2.10m"]);

export interface InteractiveCameraSnapshot {
  readonly position: readonly number[];
  readonly target: readonly number[];
}

export interface InteractiveSample {
  readonly durationMs: number;
  readonly frameCount: number;
  readonly fps: number;
  readonly p50FrameIntervalMs: number;
  readonly p95FrameIntervalMs: number;
  readonly maxFrameIntervalMs: number;
  readonly intervalsOver16_7Ms: number;
  readonly intervalsOver16_7Percent: number;
  readonly intervalsOver33_3Ms: number;
  readonly intervalsOver33_3Percent: number;
  readonly finalCamera: InteractiveCameraSnapshot;
}

export interface InteractiveSamples {
  readonly fixedCamera: InteractiveSample;
  readonly movingCamera: InteractiveSample;
}

/** Moving-camera samples that isolate optional dense presentation overlays. */
export interface OverlayInteractiveSamples {
  readonly surface: InteractiveSample;
  readonly nodes: InteractiveSample;
  readonly edges: InteractiveSample;
  readonly edgesAndNodes: InteractiveSample;
}

interface InteractiveMeasureOptions {
  readonly renderer: WebGpuRenderer;
  readonly benchmarkCase: WebGpuBenchmarkCase;
  readonly runtime: ReturnType<typeof createPackedSceneRuntime>;
  readonly camera: Camera;
}

/** Returns true for the bounded representative cases that receive RAF samples. */
export function hasInteractiveSample(benchmarkCase: WebGpuBenchmarkCase): boolean {
  return INTERACTIVE_CASE_IDS.has(benchmarkCase.id);
}

/** Returns true for the bounded case that receives the full overlay matrix. */
export function hasOverlayInteractiveSample(benchmarkCase: WebGpuBenchmarkCase): boolean {
  return OVERLAY_CASE_IDS.has(benchmarkCase.id);
}

/** Measures fixed and deterministic-orbit RAF behavior without queue synchronization. */
export async function measureInteractiveSamples(
  options: InteractiveMeasureOptions,
): Promise<InteractiveSamples> {
  const { renderer, benchmarkCase, runtime, camera } = options;
  const fixedCamera = await measureSample(renderer, benchmarkCase, runtime, camera, false);
  const movingCamera = await measureSample(renderer, benchmarkCase, runtime, camera, true);
  return { fixedCamera, movingCamera };
}

/** Measures moving-camera FPS for surface, node, edge, and combined presentation. */
export async function measureOverlayInteractiveSamples(
  options: InteractiveMeasureOptions,
): Promise<OverlayInteractiveSamples> {
  const { renderer, benchmarkCase, runtime, camera } = options;
  const slots = Array.from({ length: runtime.instanceCount }, (_, slot) => slot);
  const measure = async (edges: boolean, nodes: boolean): Promise<InteractiveSample> => {
    let interaction = createInteractionState();
    for (const partId of benchmarkCase.scene.parts.keys()) {
      interaction = setPartOverride(interaction, partId, { edge: edges, nodes });
    }
    renderer.updateInstances(runtime, interaction, slots);
    renderer.updateElements(runtime, interaction, slots);
    return measureSample(renderer, benchmarkCase, runtime, camera, true);
  };
  try {
    const surface = await measure(false, false);
    const nodes = await measure(false, true);
    const edges = await measure(true, false);
    const edgesAndNodes = await measure(true, true);
    return { surface, nodes, edges, edgesAndNodes };
  } finally {
    const interaction = createInteractionState();
    renderer.updateInstances(runtime, interaction, slots);
    renderer.updateElements(runtime, interaction, slots);
  }
}

async function measureSample(
  renderer: WebGpuRenderer,
  benchmarkCase: WebGpuBenchmarkCase,
  runtime: ReturnType<typeof createPackedSceneRuntime>,
  camera: Camera,
  moveCamera: boolean,
): Promise<InteractiveSample> {
  const frameTimes: number[] = [];
  let sampleStart = 0;
  let sampleEnd = 0;
  let finalCamera = camera;
  await new Promise<void>((resolve) => {
    const enabledAt = performance.now();
    sampleStart = enabledAt + WARMUP_MS;
    const deadline = sampleStart + SAMPLE_MS;
    const renderFrame = (): void => {
      const now = performance.now();
      if (now >= deadline) {
        sampleEnd = now;
        resolve();
        return;
      }
      const elapsed = Math.max(0, now - sampleStart);
      finalCamera = moveCamera ? movingCamera(camera, elapsed) : camera;
      renderer.render(runtime, finalCamera, benchmarkCase.scene.parts);
      if (now >= sampleStart) frameTimes.push(now);
      requestAnimationFrame(renderFrame);
    };
    requestAnimationFrame(renderFrame);
  });
  return summarizeInteractiveSample(frameTimes, sampleStart, sampleEnd, finalCamera);
}

function movingCamera(camera: Camera, elapsedMs: number): Camera {
  const progress = Math.min(1, elapsedMs / SAMPLE_MS);
  return orbitCamera(camera, progress * YAW_RADIANS, progress * PITCH_RADIANS, camera.target);
}

/** Summarizes bounded frame timestamps and threshold counts for one sample. */
export function summarizeInteractiveSample(
  frameTimes: readonly number[],
  sampleStart: number,
  sampleEnd: number,
  finalCamera: Camera,
): InteractiveSample {
  const durationMs = Math.max(0, sampleEnd - sampleStart);
  const stats = calculateRenderLoopStats(frameTimes, sampleStart, sampleEnd);
  const intervals = frameIntervals(frameTimes);
  return {
    durationMs,
    frameCount: frameTimes.length,
    fps: durationMs === 0 ? 0 : (frameTimes.length * 1_000) / durationMs,
    p50FrameIntervalMs: stats.p50FrameIntervalMs ?? 0,
    p95FrameIntervalMs: stats.p95FrameIntervalMs ?? 0,
    maxFrameIntervalMs: stats.longestFrameIntervalMs ?? 0,
    intervalsOver16_7Ms: countLongIntervals(intervals, LONG_FRAME_MS),
    intervalsOver16_7Percent: percentageOver(intervals, LONG_FRAME_MS),
    intervalsOver33_3Ms: countLongIntervals(intervals, VERY_LONG_FRAME_MS),
    intervalsOver33_3Percent: percentageOver(intervals, VERY_LONG_FRAME_MS),
    finalCamera: snapshotCamera(finalCamera),
  };
}

function snapshotCamera(camera: Camera): InteractiveCameraSnapshot {
  return { position: [...camera.position], target: [...camera.target] };
}

function frameIntervals(frameTimes: readonly number[]): number[] {
  const intervals: number[] = [];
  for (let index = 1; index < frameTimes.length; index += 1) {
    const current = frameTimes[index];
    const previous = frameTimes[index - 1];
    if (current !== undefined && previous !== undefined) intervals.push(current - previous);
  }
  return intervals;
}

function countLongIntervals(intervals: readonly number[], threshold: number): number {
  return intervals.filter((interval) => interval > threshold).length;
}

function percentageOver(intervals: readonly number[], threshold: number): number {
  if (intervals.length === 0) return 0;
  return (countLongIntervals(intervals, threshold) * 100) / intervals.length;
}
