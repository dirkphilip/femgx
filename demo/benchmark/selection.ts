import { orbitCamera, projectPoint, type Camera } from "../../src/camera/camera";
import { transformPoint } from "../../src/math/mat4";
import { createInteractionState } from "../../src/interaction/interaction";
import { setTargetsSelected } from "../../src/interaction/targets";
import type { BoxSelectionRect } from "../../src/interaction/box-selection";
import type { InteractionTarget } from "../../src/interaction/target-types";
import type { Part, PartId } from "../../src/geometry/part";
import { packedSemanticStorage } from "../../src/geometry/packed/packed-semantic";
import { ELEMENT_RECORD_STRIDE } from "../../src/renderer/resources/element-resources";
import { readGpuCostSnapshot, type WebGpuRenderer } from "../../src/renderer/gpu-renderer";
import { buildInstanceLayout } from "../../src/renderer/runtime-state";
import { collectDenseElementSelections } from "../../src/renderer/selection/element-selection";
import type { PackedSceneRuntime } from "../../src/scene-runtime/runtime";
import type { PartOccurrenceId } from "../../src/scene/types";
import type { WebGpuBenchmarkCase } from "./model";
import type {
  BenchmarkPercentiles,
  SelectionBenchmarkPhase,
  SelectionBenchmarkReport,
  SelectionCameraTransition,
} from "./types";
import {
  assertElementEmphasisDraw,
  assertNoElementEmphasisDraw,
  highlightWriteBytesSince,
} from "./assertions";

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
  readonly holdElementSelectionForCapture?: (
    phase: "all-but-one" | "all-authored",
  ) => Promise<void>;
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
  if (
    options.benchmarkCase.id === "instanced-2.10m" ||
    options.benchmarkCase.id === "unique-2m-local"
  ) {
    const count = authoredElementCount(options.benchmarkCase, options.runtime);
    for (const [id, targetCount] of [
      ["one-authored", 1],
      ["half-authored", Math.ceil(count / 2)],
      ["all-authored", count],
    ] as const) {
      phases.push(await measureAuthoredScenario(options, id, targetCount));
    }
  } else if (options.benchmarkCase.id === "unique-1m") {
    const count = authoredElementCount(options.benchmarkCase, options.runtime);
    phases.push(await measureAuthoredScenario(options, "all-authored", count));
  } else if (options.benchmarkCase.id === "fe-tet4-solid-132k") {
    const count = authoredElementCount(options.benchmarkCase, options.runtime);
    phases.push(await measureAuthoredScenario(options, "all-but-one", count - 1));
    phases.push(await measureAuthoredScenario(options, "all-authored", count));
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
    targetConstructionMs: 0,
  });
}

async function measureAuthoredScenario(
  options: SelectionMeasureOptions,
  id: "one-authored" | "half-authored" | "all-but-one" | "all-authored",
  targetCount: number,
): Promise<SelectionBenchmarkPhase> {
  const { renderer, device, benchmarkCase, runtime, camera } = options;
  renderer.render(runtime, camera, benchmarkCase.scene.parts);
  await device.queue.onSubmittedWorkDone();
  const constructionStart = performance.now();
  const targets = authoredElementTargets(benchmarkCase, runtime, targetCount);
  const targetConstructionMs = performance.now() - constructionStart;
  return measureSelectedTargets(options, id, targets, {
    invalidSnapshotMs: 0,
    cachedReadbackMs: 0,
    targetConstructionMs,
  });
}

/** Builds the complete occurrence-scoped authored-element selection for the Tet4 guardrail. */
export function authoredElementTargets(
  benchmarkCase: WebGpuBenchmarkCase,
  runtime: PackedSceneRuntime,
  count = authoredElementCount(benchmarkCase, runtime),
): readonly InteractionTarget[] {
  const context = authoredElementContext(benchmarkCase, runtime);
  const { partOccurrenceId, part } = context;
  const packed = packedSemanticStorage(part);
  const elementCount = packed?.elementIds.length ?? part.elements?.length ?? 0;
  if (count < 0 || count > elementCount) {
    throw new Error(`${benchmarkCase.id} requested ${count} of ${elementCount} elements`);
  }
  const targets = new Array<InteractionTarget>(count);
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const elementId = packed?.elementIds[ordinal] ?? part.elements?.[ordinal]?.id;
    if (elementId === undefined) throw new Error(`${benchmarkCase.id} element ${ordinal} missing`);
    targets[ordinal] = { kind: "element", partOccurrenceId, elementId };
  }
  return targets;
}

function authoredElementCount(
  benchmarkCase: WebGpuBenchmarkCase,
  runtime: PackedSceneRuntime,
): number {
  const { part } = authoredElementContext(benchmarkCase, runtime);
  return packedSemanticStorage(part)?.elementIds.length ?? part.elements?.length ?? 0;
}

function authoredElementContext(
  benchmarkCase: WebGpuBenchmarkCase,
  runtime: PackedSceneRuntime,
): { readonly partOccurrenceId: PartOccurrenceId; readonly part: Part } {
  const slot = runtime.getDrawList()[0];
  const partId = slot === undefined ? undefined : runtime.getPartId(slot);
  const partOccurrenceId = slot === undefined ? undefined : runtime.getInstanceId(slot);
  const part = partId === undefined ? undefined : benchmarkCase.scene.parts.get(partId);
  if (part === undefined || partOccurrenceId === undefined) {
    throw new Error(`${benchmarkCase.id} has no drawable authored-element occurrence`);
  }
  return { partOccurrenceId, part };
}

async function measureSelectedTargets(
  options: SelectionMeasureOptions,
  id: SelectionBenchmarkPhase["id"],
  targets: readonly InteractionTarget[],
  readback: Pick<
    SelectionBenchmarkPhase,
    "invalidSnapshotMs" | "cachedReadbackMs" | "targetConstructionMs"
  >,
): Promise<SelectionBenchmarkPhase> {
  const { renderer, device, benchmarkCase, runtime, camera } = options;
  const parts = benchmarkCase.scene.parts;
  const stateStart = performance.now();
  const selected = setTargetsSelected(createInteractionState(), targets, true);
  const interactionStateMs = performance.now() - stateStart;
  renderer.render(runtime, camera, parts);
  await device.queue.onSubmittedWorkDone();
  const beforeSync = readGpuCostSnapshot(renderer);
  const syncStart = performance.now();
  const changedSlots = occurrenceSlots(runtime, targets);
  renderer.updateElements(runtime, selected, changedSlots);
  const interactionSyncMs = performance.now() - syncStart;
  const interactionHighlightWriteBytes = highlightWriteBytesSince(
    beforeSync,
    readGpuCostSnapshot(renderer),
    `${benchmarkCase.id} ${id} selection`,
  );
  const firstSelectedFrameMs = await renderFrame(renderer, runtime, camera, parts, device);
  if (
    options.holdElementSelectionForCapture !== undefined &&
    (id === "all-but-one" || id === "all-authored")
  ) {
    await options.holdElementSelectionForCapture(id);
  }
  const cameraTransition = await measureCameraTransition(renderer, runtime, camera, parts, device);
  const interactionGpuCost = readGpuCostSnapshot(renderer);
  const selectionLabel = `${benchmarkCase.id} ${id} selection`;
  if (benchmarkCase.id === "unique-1m" && id === "all-authored") {
    assertNoElementEmphasisDraw(interactionGpuCost, selectionLabel);
  } else {
    assertElementEmphasisDraw(
      interactionGpuCost,
      selectionLabel,
      expectedAuthoredIndices(benchmarkCase, id, targets.length),
    );
  }
  const dense = denseSelectionFacts(runtime, parts, selected);
  if (requiresDenseSelection(id)) {
    if (dense.selectedCount !== targets.length || dense.occurrenceCount !== changedSlots.length) {
      throw new Error(`${benchmarkCase.id} ${id} omitted dense selected-element membership`);
    }
  }
  const steadyFrames: number[] = [];
  for (let index = 0; index < STEADY_SAMPLES; index += 1) {
    steadyFrames.push(await renderFrame(renderer, runtime, camera, parts, device));
  }
  const clearStart = performance.now();
  renderer.updateElements(runtime, createInteractionState(), changedSlots);
  await renderFrame(renderer, runtime, camera, parts, device);
  assertNoElementEmphasisDraw(readGpuCostSnapshot(renderer), `${benchmarkCase.id} ${id} clear`);
  const clearSelectionMs = performance.now() - clearStart;
  return {
    id,
    returnedTargetCount: targets.length,
    selectedOccurrenceCount: changedSlots.length,
    targetConstructionMs: readback.targetConstructionMs,
    invalidSnapshotMs: readback.invalidSnapshotMs,
    cachedReadbackMs: readback.cachedReadbackMs,
    interactionStateMs,
    interactionSyncMs,
    interactionHighlightWriteBytes,
    firstSelectedFrameMs,
    cameraTransition,
    steadySelectedFrameMs: percentiles(steadyFrames),
    clearSelectionMs,
    interactionGpuCost,
    denseSelectionBytes: dense.bytes,
    selectedElementRecordBytes: targets.length * ELEMENT_RECORD_STRIDE,
  };
}

async function measureCameraTransition(
  renderer: WebGpuRenderer,
  runtime: PackedSceneRuntime,
  camera: Camera,
  parts: ReadonlyMap<PartId, Part>,
  device: GPUDevice,
): Promise<SelectionCameraTransition> {
  const firstCamera = orbitCamera(camera, 0.02, 0.006, camera.target);
  const firstFrameMs = await renderFrame(renderer, runtime, firstCamera, parts, device);
  const firstFrameCpu = readGpuCostSnapshot(renderer).cpu;
  const steadyFrames: number[] = [];
  for (let index = 1; index <= STEADY_SAMPLES; index += 1) {
    const movedCamera = orbitCamera(camera, 0.02 + index * 0.02, 0.006, camera.target);
    steadyFrames.push(await renderFrame(renderer, runtime, movedCamera, parts, device));
  }
  return {
    firstFrameMs,
    steadyFrameMs: percentiles(steadyFrames),
    firstFrameCpu: {
      "instance-scan": firstFrameCpu["instance-scan"],
      "order-rebuild": firstFrameCpu["order-rebuild"],
      "call-rebuild": firstFrameCpu["call-rebuild"],
    },
  };
}

function denseSelectionFacts(
  runtime: PackedSceneRuntime,
  parts: ReadonlyMap<PartId, Part>,
  interaction: ReturnType<typeof createInteractionState>,
): { readonly bytes: number; readonly selectedCount: number; readonly occurrenceCount: number } {
  const layout = buildInstanceLayout(runtime);
  const selections = collectDenseElementSelections(runtime, layout, parts, interaction);
  let bytes = 0;
  let selectedCount = 0;
  let occurrenceCount = 0;
  for (const [partId, selection] of selections) {
    bytes += (layout.partSlots.get(partId)?.length ?? 0) * Uint32Array.BYTES_PER_ELEMENT;
    occurrenceCount += selection.occurrences.length;
    for (const occurrence of selection.occurrences) {
      bytes += occurrence.words.byteLength;
      selectedCount += occurrence.selectedCount;
    }
  }
  return { bytes, selectedCount, occurrenceCount };
}

function requiresDenseSelection(id: SelectionBenchmarkPhase["id"]): boolean {
  return id === "half-authored" || id === "all-but-one" || id === "all-authored";
}

function expectedAuthoredIndices(
  benchmarkCase: WebGpuBenchmarkCase,
  id: SelectionBenchmarkPhase["id"],
  targetCount: number,
): number | undefined {
  if (
    !id.endsWith("-authored") ||
    (benchmarkCase.id !== "instanced-2.10m" && benchmarkCase.id !== "unique-2m-local")
  ) {
    return undefined;
  }
  const ranged = targetCount * (benchmarkCase.elementFamily === "quad" ? 6 : 3);
  let full = 0;
  for (const part of benchmarkCase.scene.parts.values()) {
    for (const geometry of part.geometries) full += geometry.indices.length;
  }
  return ranged * 2 < full ? ranged : full;
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
    const slot = runtime.getInstanceSlot(target.partOccurrenceId);
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
