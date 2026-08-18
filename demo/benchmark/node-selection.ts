import type { Camera } from "../../src/camera/camera";
import type { PartId } from "../../src/geometry/part";
import { createInteractionState } from "../../src/interaction/interaction";
import { readInteractionState, type InteractionState } from "../../src/interaction/state";
import { setTargetsSelected } from "../../src/interaction/targets";
import type { InteractionTarget } from "../../src/interaction/target-types";
import { ELEMENT_RECORD_STRIDE } from "../../src/renderer/resources/element-resources";
import { readGpuCostSnapshot, type WebGpuRenderer } from "../../src/renderer/gpu-renderer";
import { buildInstanceLayout, type InstanceLayout } from "../../src/renderer/runtime-state";
import { HIGHLIGHT_HEADER } from "../../src/renderer/selection/highlight-layout";
import {
  collectDenseNodeSelections,
  type DenseNodeSelection,
} from "../../src/renderer/selection/node-selection";
import type { PackedSceneRuntime } from "../../src/scene-runtime/runtime";
import type { WebGpuBenchmarkCase } from "./model";
import type {
  BenchmarkPercentiles,
  NodeSelectionBenchmarkPhase,
  NodeSelectionBenchmarkReport,
} from "./types";

const SUPPORTED_CASE = "fe-tet4-solid-132k";
const STEADY_SAMPLES = 7;

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
  readonly selection: DenseNodeSelection;
  readonly uniqueNodeCount: number;
  readonly denseNodePayloadBytes: number;
  readonly highlightStorageBytes: number;
}

/** Measures authored half/all node-selection display on the real WebGPU benchmark lane. */
export async function measureNodeSelectionBenchmark(
  options: NodeSelectionMeasureOptions,
): Promise<NodeSelectionBenchmarkReport | undefined> {
  if (options.benchmarkCase.id !== SUPPORTED_CASE) return undefined;
  const context = nodeSelectionContext(options);
  const phases = [
    await measureNodeScenario(context, "half", Math.floor(context.nodeCount / 2)),
    await measureNodeScenario(context, "all", context.nodeCount),
  ];
  if (options.holdFinalSelection !== undefined) {
    await presentFinalSelection(context);
    await options.holdFinalSelection();
  }
  return { selectedTargetGranularity: "node", phases };
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
  targetCount: number,
): Promise<NodeSelectionBenchmarkPhase> {
  const targets = authoredNodeTargets(context.partOccurrenceId, targetCount);
  await renderFrame(context);
  const stateStart = performance.now();
  const selected = setTargetsSelected(createInteractionState(), targets, true);
  const interactionStateMs = performance.now() - stateStart;
  const facts = denseNodeFacts(context, selected, targetCount);
  const syncStart = performance.now();
  context.renderer.updateElements(context.runtime, selected, [context.slot]);
  const interactionSyncMs = performance.now() - syncStart;
  const firstSelectedFrameMs = await renderFrame(context);
  const interactionGpuCost = readGpuCostSnapshot(context.renderer);
  const selectedNodeDraw = selectedNodeDrawWork(
    context.nodeCount,
    facts.selection.occurrences.length,
  );
  assertAggregateSelectedWork(interactionGpuCost, selectedNodeDraw);
  const steadyFrames: number[] = [];
  for (let index = 0; index < STEADY_SAMPLES; index += 1) {
    steadyFrames.push(await renderFrame(context));
  }
  const clearStart = performance.now();
  context.renderer.updateElements(context.runtime, createInteractionState(), [context.slot]);
  await renderFrame(context);
  const clearSelectionMs = performance.now() - clearStart;
  return {
    id,
    targetCount,
    uniqueNodeCount: facts.uniqueNodeCount,
    selectedOccurrenceCount: facts.selection.occurrences.length,
    selectedNodeDrawIndices: selectedNodeDraw.indices,
    selectedNodeDrawInstances: selectedNodeDraw.instances,
    interactionStateMs,
    interactionSyncMs,
    firstSelectedFrameMs,
    steadySelectedFrameMs: percentiles(steadyFrames),
    clearSelectionMs,
    interactionGpuCost,
    denseNodePayloadBytes: facts.denseNodePayloadBytes,
    highlightStorageBytes: facts.highlightStorageBytes,
    selectedNodeRecordBytes: targetCount * ELEMENT_RECORD_STRIDE,
  };
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
  const denseCount = selection?.occurrences.reduce(
    (count, occurrence) => count + occurrence.selectedCount,
    0,
  );
  if (
    uniqueNodeCount !== expectedCount ||
    selection === undefined ||
    denseCount !== expectedCount
  ) {
    throw new Error(
      `${context.benchmarkCase.id} node selection lost authored targets or dense membership`,
    );
  }
  const slots = context.layout.partSlots.get(context.partId)?.length ?? 0;
  const storage = denseNodeSelectionStorage(
    selection.nodeCount,
    slots,
    selection.occurrences.length,
  );
  return {
    selection,
    uniqueNodeCount,
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
  await renderFrame(context);
}

async function renderFrame(context: NodeSelectionMeasureOptions): Promise<number> {
  const start = performance.now();
  context.renderer.render(context.runtime, context.camera, context.benchmarkCase.scene.parts);
  await context.device.queue.onSubmittedWorkDone();
  return performance.now() - start;
}

function selectedNodeDrawWork(
  nodeCount: number,
  occurrenceCount: number,
): { readonly indices: number; readonly instances: number } {
  return { indices: nodeCount * 6 * occurrenceCount, instances: occurrenceCount };
}

function assertAggregateSelectedWork(
  cost: NodeSelectionBenchmarkPhase["interactionGpuCost"],
  nodeWork: { readonly indices: number; readonly instances: number },
): void {
  for (const pass of ["selection-visible", "selection-hidden"] as const) {
    const draw = cost.draws[pass];
    if (
      draw === undefined ||
      draw.calls === 0 ||
      draw.indices < nodeWork.indices ||
      draw.instances < nodeWork.instances
    ) {
      throw new Error(`${pass} aggregate omitted submitted selected-node work`);
    }
  }
}

function percentiles(values: readonly number[]): BenchmarkPercentiles {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number): number => sorted[Math.ceil(fraction * sorted.length) - 1] ?? 0;
  return { p50: at(0.5), p95: at(0.95) };
}
