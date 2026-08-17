import { projectPoint, type Camera } from "../../src/camera/camera";
import { transformPoint } from "../../src/math/mat4";
import { createInteractionState } from "../../src/interaction/interaction";
import { setTargetsSelected } from "../../src/interaction/targets";
import type { BoxSelectionRect } from "../../src/interaction/box-selection";
import type { InteractionTarget } from "../../src/interaction/target-types";
import type { Part, PartId } from "../../src/geometry/part";
import { packedSemanticStorage } from "../../src/geometry/packed/packed-semantic";
import { ELEMENT_RECORD_STRIDE } from "../../src/renderer/resources/element-resources";
import { readGpuCostSnapshot, type WebGpuRenderer } from "../../src/renderer/gpu-renderer";
import type { PackedSceneRuntime } from "../../src/scene-runtime/runtime";
import type { WebGpuBenchmarkCase } from "./model";
import type {
  BenchmarkPercentiles,
  SelectionBenchmarkPhase,
  SelectionBenchmarkReport,
} from "./types";

const WIDTH = 800;
const HEIGHT = 600;
const STEADY_SAMPLES = 7;
const SUPPORTED_CASES = new Set([
  "instanced-2.10m",
  "unique-250k",
  "unique-1m",
  "unique-2m-local",
  "fe-tet4-solid-132k",
]);

interface SelectionMeasureOptions {
  readonly renderer: WebGpuRenderer;
  readonly device: GPUDevice;
  readonly benchmarkCase: WebGpuBenchmarkCase;
  readonly runtime: PackedSceneRuntime;
  readonly camera: Camera;
}

/** Measures completed element box-selection phases on the opt-in GPU lane. */
export async function measureSelectionBenchmark(
  options: SelectionMeasureOptions,
): Promise<SelectionBenchmarkReport | undefined> {
  if (!SUPPORTED_CASES.has(options.benchmarkCase.id)) return undefined;
  const center = benchmarkCenter(options.benchmarkCase, options.runtime, options.camera);
  const phases: SelectionBenchmarkPhase[] = [];
  for (const scenario of selectionScenarios(center)) {
    phases.push(await measureScenario(options, scenario.id, scenario.rect));
  }
  if (options.benchmarkCase.id === "fe-tet4-solid-132k") {
    const authored = authoredElementTargets(options.benchmarkCase, options.runtime);
    phases.push(await measureAuthoredScenario(options, "all-but-one", authored.slice(0, -1)));
    phases.push(await measureAuthoredScenario(options, "all-authored", authored));
  }
  return { selectedTargetGranularity: "element", phases };
}

interface SelectionScenario {
  readonly id: SelectionBenchmarkPhase["id"];
  readonly rect: BoxSelectionRect;
}

async function measureScenario(
  options: SelectionMeasureOptions,
  id: SelectionScenario["id"],
  rect: BoxSelectionRect,
): Promise<SelectionBenchmarkPhase> {
  const { renderer, device, benchmarkCase, runtime, camera } = options;
  const parts = benchmarkCase.scene.parts;
  const invalidCamera = { ...camera };
  renderer.render(runtime, invalidCamera, parts);
  await device.queue.onSubmittedWorkDone();
  const invalidStart = performance.now();
  const invalidTargets = await renderer.pickRegion(rect, "element");
  const invalidSnapshotMs = performance.now() - invalidStart;
  if (invalidTargets.length === 0) {
    throw new Error(`${benchmarkCase.id} ${id} box returned no element targets`);
  }
  const cachedStart = performance.now();
  const cachedTargets = await renderer.pickRegion(rect, "element");
  const cachedReadbackMs = performance.now() - cachedStart;
  if (cachedTargets.length !== invalidTargets.length) {
    throw new Error(`${benchmarkCase.id} ${id} cached box result changed target count`);
  }
  return measureSelectedTargets(options, id, cachedTargets, {
    invalidSnapshotMs,
    cachedReadbackMs,
  });
}

async function measureAuthoredScenario(
  options: SelectionMeasureOptions,
  id: "all-but-one" | "all-authored",
  targets: readonly InteractionTarget[],
): Promise<SelectionBenchmarkPhase> {
  const { renderer, device, benchmarkCase, runtime, camera } = options;
  renderer.render(runtime, camera, benchmarkCase.scene.parts);
  await device.queue.onSubmittedWorkDone();
  return measureSelectedTargets(options, id, targets, {
    invalidSnapshotMs: 0,
    cachedReadbackMs: 0,
  });
}

/** Builds the complete occurrence-scoped authored-element selection for the Tet4 guardrail. */
export function authoredElementTargets(
  benchmarkCase: WebGpuBenchmarkCase,
  runtime: PackedSceneRuntime,
): readonly InteractionTarget[] {
  const slot = runtime.getDrawList()[0];
  const partId = slot === undefined ? undefined : runtime.getPartId(slot);
  const instanceId = slot === undefined ? undefined : runtime.getInstanceId(slot);
  const part = partId === undefined ? undefined : benchmarkCase.scene.parts.get(partId);
  if (part === undefined || instanceId === undefined) {
    throw new Error(`${benchmarkCase.id} has no drawable authored-element occurrence`);
  }
  const packed = packedSemanticStorage(part);
  if (packed !== undefined) {
    return Array.from(packed.elementIds, (elementId) => ({
      kind: "element" as const,
      instanceId,
      elementId,
    }));
  }
  return (part.elements ?? []).map((element) => ({
    kind: "element",
    instanceId,
    elementId: element.id,
  }));
}

async function measureSelectedTargets(
  options: SelectionMeasureOptions,
  id: SelectionBenchmarkPhase["id"],
  targets: readonly InteractionTarget[],
  readback: Pick<SelectionBenchmarkPhase, "invalidSnapshotMs" | "cachedReadbackMs">,
): Promise<SelectionBenchmarkPhase> {
  const { renderer, device, benchmarkCase, runtime, camera } = options;
  const parts = benchmarkCase.scene.parts;
  const stateStart = performance.now();
  const selected = setTargetsSelected(createInteractionState(), targets, true);
  const interactionStateMs = performance.now() - stateStart;
  const changedSlots = occurrenceSlots(runtime, targets);
  renderer.render(runtime, camera, parts);
  await device.queue.onSubmittedWorkDone();
  const syncStart = performance.now();
  renderer.updateElements(runtime, selected, changedSlots);
  const interactionSyncMs = performance.now() - syncStart;
  const firstSelectedFrameMs = await renderFrame(renderer, runtime, camera, parts, device);
  const interactionGpuCost = readGpuCostSnapshot(renderer);
  const steadyFrames: number[] = [];
  for (let index = 0; index < STEADY_SAMPLES; index += 1) {
    steadyFrames.push(await renderFrame(renderer, runtime, camera, parts, device));
  }
  const clearStart = performance.now();
  renderer.updateElements(runtime, createInteractionState(), changedSlots);
  await renderFrame(renderer, runtime, camera, parts, device);
  const clearSelectionMs = performance.now() - clearStart;
  return {
    id,
    returnedTargetCount: targets.length,
    selectedOccurrenceCount: changedSlots.length,
    invalidSnapshotMs: readback.invalidSnapshotMs,
    cachedReadbackMs: readback.cachedReadbackMs,
    interactionStateMs,
    interactionSyncMs,
    firstSelectedFrameMs,
    steadySelectedFrameMs: percentiles(steadyFrames),
    clearSelectionMs,
    interactionGpuCost,
    denseSelectionBytes: denseSelectionBytes(runtime, parts, targets),
    selectedElementRecordBytes: targets.length * ELEMENT_RECORD_STRIDE,
  };
}

function denseSelectionBytes(
  runtime: PackedSceneRuntime,
  parts: ReadonlyMap<PartId, Part>,
  targets: readonly InteractionTarget[],
): number {
  const elementsByPart = new Map<PartId, Map<number, Set<number>>>();
  for (const target of targets) {
    if (target.kind !== "element") continue;
    const slot = runtime.getInstanceSlot(target.instanceId);
    const partId = slot === undefined ? undefined : runtime.instancePartIds[slot];
    if (slot === undefined || partId === undefined) continue;
    let elementsBySlot = elementsByPart.get(partId);
    if (elementsBySlot === undefined) {
      elementsBySlot = new Map();
      elementsByPart.set(partId, elementsBySlot);
    }
    let elements = elementsBySlot.get(slot);
    if (elements === undefined) {
      elements = new Set();
      elementsBySlot.set(slot, elements);
    }
    elements.add(target.elementId);
  }
  let bytes = 0;
  for (const [partId, elementsBySlot] of elementsByPart) {
    const elementCount = parts.get(partId)?.elements?.length ?? 0;
    const denseBytes = 4 + Math.ceil(elementCount / 32) * 4;
    for (const elements of elementsBySlot.values()) {
      if (denseBytes < elements.size * ELEMENT_RECORD_STRIDE) bytes += denseBytes;
    }
  }
  return bytes;
}

async function renderFrame(
  renderer: WebGpuRenderer,
  runtime: PackedSceneRuntime,
  camera: Camera,
  parts: ReadonlyMap<PartId, Part>,
  device: GPUDevice,
): Promise<number> {
  const start = performance.now();
  renderer.render(runtime, camera, parts);
  await device.queue.onSubmittedWorkDone();
  return performance.now() - start;
}

function occurrenceSlots(
  runtime: PackedSceneRuntime,
  targets: readonly InteractionTarget[],
): number[] {
  const slots = new Set<number>();
  for (const target of targets) {
    if (target.kind !== "element") continue;
    const slot = runtime.getInstanceSlot(target.instanceId);
    if (slot !== undefined) slots.add(slot);
  }
  return [...slots].sort((left, right) => left - right);
}

function benchmarkCenter(
  benchmarkCase: WebGpuBenchmarkCase,
  runtime: PackedSceneRuntime,
  camera: Camera,
): readonly [number, number] {
  const slot = runtime.getDrawList()[0];
  const partId = slot === undefined ? undefined : runtime.getPartId(slot);
  const part = partId === undefined ? undefined : benchmarkCase.scene.parts.get(partId);
  const transform = slot === undefined ? undefined : runtime.getTransform(slot);
  if (part === undefined || transform === undefined) {
    throw new Error(`${benchmarkCase.id} has no drawable benchmark instance`);
  }
  const point = transformPoint(
    transform,
    (part.bounds.minX + part.bounds.maxX) / 2,
    (part.bounds.minY + part.bounds.maxY) / 2,
    (part.bounds.minZ + part.bounds.maxZ) / 2,
  );
  const projected = projectPoint(camera, point);
  if (projected === undefined) throw new Error(`${benchmarkCase.id} center is behind the camera`);
  return [(projected[0] * WIDTH) / camera.width, (projected[1] * HEIGHT) / camera.height];
}

function selectionScenarios(center: readonly [number, number]): SelectionScenario[] {
  return [
    { id: "narrow", rect: centeredRect(center, 80, 80) },
    { id: "one-shell", rect: centeredRect(center, 40, 40) },
    { id: "broad", rect: fullRect() },
  ];
}

function centeredRect(
  center: readonly [number, number],
  width: number,
  height: number,
): BoxSelectionRect {
  const left = Math.max(0, Math.min(WIDTH, center[0] - width / 2));
  const top = Math.max(0, Math.min(HEIGHT, center[1] - height / 2));
  const right = Math.min(WIDTH, left + width);
  const bottom = Math.min(HEIGHT, top + height);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function fullRect(): BoxSelectionRect {
  return { left: 0, top: 0, right: WIDTH, bottom: HEIGHT, width: WIDTH, height: HEIGHT };
}

function percentiles(values: readonly number[]): BenchmarkPercentiles {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number): number => sorted[Math.ceil(fraction * sorted.length) - 1] ?? 0;
  return { p50: at(0.5), p95: at(0.95) };
}
