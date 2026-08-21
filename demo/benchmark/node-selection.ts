import { orbitCamera, type Camera } from "../../src/camera/camera";
import { percentiles } from "./statistics";
import { renderBenchmarkFrame } from "./measurement";
import type { PartId } from "../../src/geometry/part";
import { createInteractionState } from "../../src/interaction/interaction";
import { readInteractionState, type InteractionState } from "../../src/interaction/state";
import { setTargetsSelected } from "../../src/interaction/targets";
import type { InteractionTarget } from "../../src/interaction/target-types";
import { ELEMENT_RECORD_STRIDE } from "../../src/renderer/resources/element-resources";
import { readGpuCostSnapshot, type WebGpuRenderer } from "../../src/renderer/gpu-renderer";
import { buildInstanceLayout, type InstanceLayout } from "../../src/renderer/runtime-state";
import { buildSelectedNodeOrder } from "../../src/renderer/selection/selected-node-order";
import { HIGHLIGHT_HEADER } from "../../src/renderer/selection/highlight-layout";
import { collectDenseNodeSelections } from "../../src/renderer/selection/node-selection";
import type { PackedSceneRuntime } from "../../src/scene-runtime/runtime";
import type { WebGpuBenchmarkCase } from "./model";
import type { NodeSelectionBenchmarkPhase, NodeSelectionBenchmarkReport } from "./types";

const SUPPORTED_CASES = new Set(["fe-tet4-solid-132k", "unique-2m-local"]);
const STEADY_SAMPLES = 7;
const PHASES = [
  "one",
  "contiguous",
  "fragmented",
  "half",
  "near-all",
  "dense-boundary",
  "all",
] as const satisfies readonly NodeSelectionBenchmarkPhase["id"][];

interface NodeSelectionMeasureOptions {
  readonly renderer: WebGpuRenderer;
  readonly device: GPUDevice;
  readonly benchmarkCase: WebGpuBenchmarkCase;
  readonly runtime: PackedSceneRuntime;
  readonly camera: Camera;
  readonly holdFinalSelection?: () => Promise<void>;
}

interface NodeSelectionContext extends NodeSelectionMeasureOptions {
  readonly layout: InstanceLayout;
  readonly partId: PartId;
  readonly partOccurrenceId: string;
  readonly slot: number;
  readonly nodeCount: number;
}

interface DenseNodeFacts {
  readonly uniqueNodeCount: number;
  readonly selectedOccurrenceCount: number;
  readonly denseNodePayloadBytes: number;
  readonly highlightStorageBytes: number;
}

/** Measures the authored selected-node scaling matrix on the real WebGPU benchmark lane. */
export async function measureNodeSelectionBenchmark(
  options: NodeSelectionMeasureOptions,
): Promise<NodeSelectionBenchmarkReport | undefined> {
  if (!SUPPORTED_CASES.has(options.benchmarkCase.id)) return undefined;
  const context = nodeSelectionContext(options);
  const phases: NodeSelectionBenchmarkPhase[] = [];
  for (const id of PHASES) phases.push(await measureNodeScenario(context, id));
  if (options.holdFinalSelection !== undefined) {
    await presentFinalSelection(context);
    await options.holdFinalSelection();
  }
  return {
    selectedTargetGranularity: "node",
    nodeCenterBytes: context.nodeCount * 3 * Float32Array.BYTES_PER_ELEMENT,
    nodeIdBytes: context.nodeCount * Uint32Array.BYTES_PER_ELEMENT,
    nodeSpriteIndexBytes: 0,
    phases,
  };
}

/** Builds sequential authored-node targets for one benchmark occurrence. */
export function authoredNodeTargets(
  partOccurrenceId: string,
  nodeCount: number,
): readonly InteractionTarget[] {
  if (!Number.isSafeInteger(nodeCount) || nodeCount <= 0) {
    throw new Error(`Authored node target count must be a positive integer, got ${nodeCount}`);
  }
  return Array.from({ length: nodeCount }, (_, nodeId) => ({
    kind: "node" as const,
    partOccurrenceId,
    nodeId,
  }));
}

/** Returns exact dense payload and fresh selection-only highlight storage bytes. */
export function denseNodeSelectionStorage(
  nodeCount: number,
  slotCount: number,
  selectedOccurrenceCount: number,
): { readonly payloadBytes: number; readonly storageBytes: number } {
  for (const [label, value] of [
    ["nodeCount", nodeCount],
    ["slotCount", slotCount],
    ["selectedOccurrenceCount", selectedOccurrenceCount],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative integer, got ${value}`);
    }
  }
  const words = Math.ceil(nodeCount / 32);
  const payloadBytes =
    (slotCount + selectedOccurrenceCount * words) * Uint32Array.BYTES_PER_ELEMENT;
  return {
    payloadBytes,
    storageBytes: HIGHLIGHT_HEADER + ELEMENT_RECORD_STRIDE + payloadBytes,
  };
}

async function measureNodeScenario(
  context: NodeSelectionContext,
  id: NodeSelectionBenchmarkPhase["id"],
): Promise<NodeSelectionBenchmarkPhase> {
  const nodeIds = scenarioNodeIds(context.nodeCount, id);
  const targetCount = nodeIds.length;
  const targets = nodeIds.map((nodeId) => ({
    kind: "node" as const,
    partOccurrenceId: context.partOccurrenceId,
    nodeId,
  }));
  await renderBenchmarkFrame(context);
  const stateStart = performance.now();
  const selected = setTargetsSelected(createInteractionState(), targets, true);
  const interactionStateMs = performance.now() - stateStart;
  const facts = denseNodeFacts(context, selected, targetCount);
  const syncStart = performance.now();
  context.renderer.updateElements(context.runtime, selected, [context.slot]);
  const interactionSyncMs = performance.now() - syncStart;
  const interactionSyncGpuCost = readGpuCostSnapshot(context.renderer);
  const firstSelectedFrame = await measureFrame(context, context.camera);
  const interactionGpuCost = readGpuCostSnapshot(context.renderer);
  const selectedNodeOrder = buildSelectedNodeOrder({
    runtime: context.runtime,
    layout: context.layout,
    partId: context.partId,
    parts: context.benchmarkCase.scene.parts,
    interaction: selected,
  });
  const selectedNodeDraw = selectedNodeDrawWork(context.nodeCount, selectedNodeOrder);
  assertAggregateSelectedWork(interactionGpuCost, selectedNodeDraw);
  const steadyFrames: number[] = [];
  for (let index = 0; index < STEADY_SAMPLES; index += 1) {
    steadyFrames.push(await renderBenchmarkFrame(context));
  }
  const movingFrames: number[] = [];
  for (let index = 1; index <= STEADY_SAMPLES; index += 1) {
    const camera = orbitCamera(context.camera, index * 0.02, 0.006, context.camera.target);
    movingFrames.push(await renderBenchmarkFrame({ ...context, camera }));
  }
  const clearStart = performance.now();
  context.renderer.updateElements(context.runtime, createInteractionState(), [context.slot]);
  await renderBenchmarkFrame(context);
  const clearSelectionMs = performance.now() - clearStart;
  return {
    id,
    targetCount,
    uniqueNodeCount: facts.uniqueNodeCount,
    selectedOccurrenceCount: facts.selectedOccurrenceCount,
    selectedNodeDrawVertices: selectedNodeDraw.vertices,
    selectedNodeDrawInstances: selectedNodeDraw.instances,
    selectedNodeCalls: selectedNodeDraw.calls,
    selectedNodeOrderBytes: selectedNodeDraw.orderBytes,
    selectedNodeOrderUploadBytes: interactionSyncGpuCost.writes["order"].bytes,
    selectedNodeOrderUploadCalls: interactionSyncGpuCost.writes["order"].calls,
    interactionStateMs,
    interactionSyncMs,
    firstSelectedFrameMs: firstSelectedFrame.queueMs,
    firstSelectedFrameCpuMs: firstSelectedFrame.cpuMs,
    steadySelectedFrameMs: percentiles(steadyFrames),
    movingSelectedFrameMs: percentiles(movingFrames),
    clearSelectionMs,
    interactionGpuCost,
    interactionSyncGpuCost,
    denseNodePayloadBytes: facts.denseNodePayloadBytes,
    highlightStorageBytes: facts.highlightStorageBytes,
    selectedNodeRecordBytes: targetCount * ELEMENT_RECORD_STRIDE,
  };
}

function scenarioNodeIds(
  nodeCount: number,
  id: NodeSelectionBenchmarkPhase["id"],
): readonly number[] {
  if (id === "one") return [Math.min(17, nodeCount - 1)];
  if (id === "all") return sequentialNodeIds(nodeCount);
  if (id === "half") return sequentialNodeIds(Math.floor(nodeCount / 2));
  const sparseCount = Math.max(1, Math.floor(nodeCount / 16));
  if (id === "contiguous") return sequentialNodeIds(sparseCount, Math.min(37, nodeCount - 1));
  if (id === "fragmented") {
    const stride = Math.max(1, Math.floor(nodeCount / sparseCount));
    return Array.from({ length: sparseCount }, (_, index) => index * stride);
  }
  const denseBoundary = Math.ceil((nodeCount * 7) / 8);
  return sequentialNodeIds(id === "near-all" ? denseBoundary - 1 : denseBoundary);
}

function sequentialNodeIds(count: number, start = 0): readonly number[] {
  return Array.from({ length: count }, (_, index) => start + index);
}

async function measureFrame(
  context: NodeSelectionContext,
  camera: Camera,
): Promise<{ readonly cpuMs: number; readonly queueMs: number }> {
  const start = performance.now();
  context.renderer.render(context.runtime, camera, context.benchmarkCase.scene.parts);
  const cpuMs = performance.now() - start;
  await context.device.queue.onSubmittedWorkDone();
  return { cpuMs, queueMs: performance.now() - start };
}

function denseNodeFacts(
  context: NodeSelectionContext,
  interaction: InteractionState,
  expectedCount: number,
): DenseNodeFacts {
  const selectedIds = readInteractionState(interaction).selectedNodeIds.get(
    context.partOccurrenceId,
  );
  const uniqueNodeCount = selectedIds?.size ?? 0;
  const selection = collectDenseNodeSelections(
    context.runtime,
    context.layout,
    context.benchmarkCase.scene.parts,
    interaction,
  ).get(context.partId);
  const denseCount =
    selection?.occurrences.reduce((count, occurrence) => count + occurrence.selectedCount, 0) ?? 0;
  if (
    uniqueNodeCount !== expectedCount ||
    (selection !== undefined && denseCount !== expectedCount)
  ) {
    throw new Error(
      `${context.benchmarkCase.id} node selection lost authored targets or dense membership`,
    );
  }
  const slots = context.layout.partSlots.get(context.partId)?.length ?? 0;
  const storage =
    selection === undefined
      ? { payloadBytes: 0, storageBytes: HIGHLIGHT_HEADER + expectedCount * ELEMENT_RECORD_STRIDE }
      : denseNodeSelectionStorage(selection.nodeCount, slots, selection.occurrences.length);
  return {
    uniqueNodeCount,
    selectedOccurrenceCount: Number(uniqueNodeCount > 0),
    denseNodePayloadBytes: storage.payloadBytes,
    highlightStorageBytes: storage.storageBytes,
  };
}

function nodeSelectionContext(options: NodeSelectionMeasureOptions): NodeSelectionContext {
  const slot = options.runtime.getDrawList()[0];
  const partId = slot === undefined ? undefined : options.runtime.getPartId(slot);
  const partOccurrenceId = slot === undefined ? undefined : options.runtime.getInstanceId(slot);
  const part = partId === undefined ? undefined : options.benchmarkCase.scene.parts.get(partId);
  const nodeCount = Math.floor((part?.nodePositions?.length ?? 0) / 3);
  if (
    slot === undefined ||
    partId === undefined ||
    partOccurrenceId === undefined ||
    part === undefined
  ) {
    throw new Error(`${options.benchmarkCase.id} has no drawable authored-node occurrence`);
  }
  if (nodeCount === 0) throw new Error(`${options.benchmarkCase.id} has no authored nodes`);
  return {
    ...options,
    layout: buildInstanceLayout(options.runtime),
    partId,
    partOccurrenceId,
    slot,
    nodeCount,
  };
}

async function presentFinalSelection(context: NodeSelectionContext): Promise<void> {
  const targets = authoredNodeTargets(context.partOccurrenceId, context.nodeCount);
  const selected = setTargetsSelected(createInteractionState(), targets, true);
  context.renderer.updateElements(context.runtime, selected, [context.slot]);
  await renderBenchmarkFrame(context);
}

function selectedNodeDrawWork(
  nodeCount: number,
  order: ReturnType<typeof buildSelectedNodeOrder>,
): {
  readonly vertices: number;
  readonly instances: number;
  readonly calls: number;
  readonly orderBytes: number;
} {
  const dense = order.denseOccurrences.length;
  const sparse = order.sparseNodeIds.length;
  return {
    vertices: 4,
    instances: dense * nodeCount + sparse,
    calls: Number(dense > 0) + Number(sparse > 0),
    orderBytes: dense * Uint32Array.BYTES_PER_ELEMENT + sparse * 2 * Uint32Array.BYTES_PER_ELEMENT,
  };
}

function assertAggregateSelectedWork(
  cost: NodeSelectionBenchmarkPhase["interactionGpuCost"],
  nodeWork: { readonly vertices: number; readonly instances: number; readonly calls: number },
): void {
  for (const pass of ["selection-visible", "selection-hidden"] as const) {
    const draw = cost.draws[pass];
    if (
      draw === undefined ||
      draw.calls !== nodeWork.calls ||
      draw.indices !== nodeWork.vertices ||
      draw.instances !== nodeWork.instances
    ) {
      throw new Error(`${pass} aggregate included unexpected non-node selection work`);
    }
  }
}
