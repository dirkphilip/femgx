import type { Camera } from "../../src/camera/camera";
import { createInteractionState, setPartOverride } from "../../src/interaction/interaction";
import {
  interactionTargetFromHit,
  setTargetHovered,
  setTargetsSelected,
} from "../../src/interaction/targets";
import {
  readGpuCostSnapshot,
  readMaterializedEdgePartIds,
  type WebGpuRenderer,
} from "../../src/renderer/gpu-renderer";
import type { PackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { measureInteractiveSamples } from "./interactive";
import {
  assertNoElementEmphasisDraw,
  assertOpaqueSurfaceDraw,
  highlightWriteBytesSince,
} from "./assertions";
import { denseEdgeTypedMemory, estimateBenchmarkMemory } from "./memory";
import type { WebGpuBenchmarkCase } from "./model";
import { authoredElementTargets } from "./selection";
import type { CombinedOverlayBenchmarkReport, HoverBenchmarkReport } from "./types";

const WIDTH = 800;
const HEIGHT = 600;
const STEADY_SAMPLES = 7;
const SUPPORTED_CASES = new Set(["instanced-2.10m", "unique-2m-local"]);

interface CombinedOverlayOptions {
  readonly renderer: WebGpuRenderer;
  readonly device: GPUDevice;
  readonly benchmarkCase: WebGpuBenchmarkCase;
  readonly runtime: PackedSceneRuntime;
  readonly camera: Camera;
  readonly pickPoint: readonly [number, number];
  readonly holdSelectionForCapture?: () => Promise<void>;
}

/** Measures cold and interactive edge plus node presentation together. */
export async function measureCombinedOverlayBenchmark(
  options: CombinedOverlayOptions,
): Promise<CombinedOverlayBenchmarkReport | undefined> {
  if (!SUPPORTED_CASES.has(options.benchmarkCase.id)) return undefined;
  const { renderer, benchmarkCase, runtime } = options;
  const slots = Array.from({ length: runtime.instanceCount }, (_, slot) => slot);
  const nodesOnly = overlayInteraction(benchmarkCase, false);
  const nodeSyncStart = performance.now();
  renderer.updateInstances(runtime, nodesOnly, slots);
  renderer.updateElements(runtime, nodesOnly, slots);
  const coldNodeInteractionSyncMs = performance.now() - nodeSyncStart;
  const coldNodeFrame = await timedFrame(options);
  const coldNodeGpuCost = readGpuCostSnapshot(renderer);
  assertNodeWork(options, coldNodeGpuCost);
  const interaction = overlayInteraction(benchmarkCase, true);
  const edgeSyncStart = performance.now();
  renderer.updateInstances(runtime, interaction, slots);
  renderer.updateElements(runtime, interaction, slots);
  const coldEdgeInteractionSyncMs = performance.now() - edgeSyncStart;
  const coldEdgeFrame = await timedFrame(options);
  const coldEdgeGpuCost = readGpuCostSnapshot(renderer);
  const edgePartIds = readMaterializedEdgePartIds(renderer);
  assertOverlayWork(options, coldEdgeGpuCost, edgePartIds);
  const emptyMemory = estimateBenchmarkMemory(
    benchmarkCase.scene,
    runtime.instanceCount,
    WIDTH,
    HEIGHT,
  );
  const overlayMemory = estimateBenchmarkMemory(
    benchmarkCase.scene,
    runtime.instanceCount,
    WIDTH,
    HEIGHT,
    {
      materializedEdgePartIds: edgePartIds,
    },
  );
  const hover = await measureOverlayHover(options, interaction);
  const largeSelection = await measureOverlaySelection(options, interaction);
  const interactive = await measureInteractiveSamples(options);
  const edgeMemory = denseEdgeTypedMemory(benchmarkCase);
  renderer.updateInstances(runtime, createInteractionState(), slots);
  renderer.updateElements(runtime, createInteractionState(), slots);
  await renderFrame(options);
  return {
    nodes: true,
    presentationEdges: true,
    coldNodeInteractionSyncMs,
    coldNodeFirstFrameMs: coldNodeFrame.queueMs,
    coldNodeFirstFrameCpuMs: coldNodeFrame.cpuMs,
    coldNodeGpuCost,
    coldEdgeInteractionSyncMs,
    coldEdgeFirstFrameMs: coldEdgeFrame.queueMs,
    coldEdgeFirstFrameCpuMs: coldEdgeFrame.cpuMs,
    coldEdgeGpuCost,
    estimatedRetainedEdgeBufferUpperBoundBytes:
      overlayMemory.retainedBufferBytes - emptyMemory.retainedBufferBytes,
    ...(edgeMemory ?? {}),
    materializedEdgePartCount: edgePartIds.size,
    fixedCamera: interactive.fixedCamera,
    movingCamera: interactive.movingCamera,
    hover,
    largeSelection,
  };
}

function overlayInteraction(benchmarkCase: WebGpuBenchmarkCase, edges: boolean) {
  let interaction = createInteractionState();
  for (const partId of benchmarkCase.scene.parts.keys()) {
    interaction = setPartOverride(interaction, partId, { edge: edges, nodes: true });
  }
  return interaction;
}

async function measureOverlayHover(
  options: CombinedOverlayOptions,
  interaction: ReturnType<typeof createInteractionState>,
): Promise<HoverBenchmarkReport> {
  const { renderer, runtime, benchmarkCase, pickPoint } = options;
  const pickStart = performance.now();
  const hit = await renderer.pick(pickPoint[0], pickPoint[1]);
  const pickMs = performance.now() - pickStart;
  const target = hit === undefined ? undefined : interactionTargetFromHit(hit, "element");
  if (target?.kind !== "element") throw new Error(`${benchmarkCase.id} overlay hover missed`);
  const slot = runtime.getInstanceSlot(target.partOccurrenceId);
  if (slot === undefined)
    throw new Error(`${benchmarkCase.id} overlay hover occurrence is missing`);
  const stateStart = performance.now();
  const hovered = setTargetHovered(interaction, target);
  const interactionStateMs = performance.now() - stateStart;
  const beforeSync = readGpuCostSnapshot(renderer);
  const syncStart = performance.now();
  renderer.updateElements(runtime, hovered, [slot]);
  const interactionSyncMs = performance.now() - syncStart;
  const interactionHighlightWriteBytes = highlightWriteBytesSince(
    beforeSync,
    readGpuCostSnapshot(renderer),
    `${benchmarkCase.id} overlay hover`,
  );
  const firstHoveredFrameMs = await renderFrame(options);
  const interactionGpuCost = readGpuCostSnapshot(renderer);
  assertOverlayWork(options, interactionGpuCost, readMaterializedEdgePartIds(renderer));
  assertOpaqueSurfaceDraw(
    interactionGpuCost,
    `${benchmarkCase.id} overlay hover`,
    benchmarkCase.gridCells * benchmarkCase.gridCells * 6,
    runtime.instanceCount,
  );
  const steady: number[] = [];
  for (let index = 0; index < STEADY_SAMPLES; index += 1) steady.push(await renderFrame(options));
  const clearStart = performance.now();
  renderer.updateElements(runtime, interaction, [slot]);
  await renderFrame(options);
  assertNoElementEmphasisDraw(
    readGpuCostSnapshot(renderer),
    `${benchmarkCase.id} overlay hover clear`,
  );
  return {
    targetKind: "element",
    selectedOccurrenceCount: 1,
    pickMs,
    interactionStateMs,
    interactionSyncMs,
    interactionHighlightWriteBytes,
    firstHoveredFrameMs,
    steadyHoveredFrameMs: percentiles(steady),
    clearHoverMs: performance.now() - clearStart,
    interactionGpuCost,
  };
}

async function measureOverlaySelection(
  options: CombinedOverlayOptions,
  interaction: ReturnType<typeof createInteractionState>,
) {
  const constructionStart = performance.now();
  const targets = authoredElementTargets(options.benchmarkCase, options.runtime);
  const targetConstructionMs = performance.now() - constructionStart;
  const stateStart = performance.now();
  const selected = setTargetsSelected(interaction, targets, true);
  const interactionStateMs = performance.now() - stateStart;
  const target = targets[0];
  const slot =
    target?.kind === "element"
      ? options.runtime.getInstanceSlot(target.partOccurrenceId)
      : undefined;
  if (slot === undefined) throw new Error(`${options.benchmarkCase.id} overlay selection is empty`);
  const beforeSync = readGpuCostSnapshot(options.renderer);
  const syncStart = performance.now();
  options.renderer.updateElements(options.runtime, selected, [slot]);
  const interactionSyncMs = performance.now() - syncStart;
  const interactionHighlightWriteBytes = highlightWriteBytesSince(
    beforeSync,
    readGpuCostSnapshot(options.renderer),
    `${options.benchmarkCase.id} overlay selection`,
  );
  const firstSelectedFrameMs = await renderFrame(options);
  const gpuCost = readGpuCostSnapshot(options.renderer);
  assertOverlayWork(options, gpuCost, readMaterializedEdgePartIds(options.renderer));
  assertOpaqueSurfaceDraw(
    gpuCost,
    `${options.benchmarkCase.id} overlay selection`,
    options.benchmarkCase.gridCells * options.benchmarkCase.gridCells * 6,
    options.runtime.instanceCount,
  );
  assertNoElementEmphasisDraw(gpuCost, `${options.benchmarkCase.id} overlay selection`);
  await options.holdSelectionForCapture?.();
  options.renderer.updateElements(options.runtime, interaction, [slot]);
  await renderFrame(options);
  assertNoElementEmphasisDraw(
    readGpuCostSnapshot(options.renderer),
    `${options.benchmarkCase.id} overlay selection clear`,
  );
  return {
    targetCount: targets.length,
    targetConstructionMs,
    interactionStateMs,
    interactionSyncMs,
    interactionHighlightWriteBytes,
    firstSelectedFrameMs,
    gpuCost,
  };
}

function assertOverlayWork(
  options: CombinedOverlayOptions,
  cost: CombinedOverlayBenchmarkReport["coldEdgeGpuCost"],
  edgePartIds: ReadonlySet<number>,
): void {
  const cells = options.benchmarkCase.gridCells;
  const edgeCount =
    options.benchmarkCase.elementFamily === "quad"
      ? 2 * cells * (cells + 1)
      : 3 * cells * cells + 2 * cells;
  const expectedEdgeIndices = edgeCount * 2;
  const expectedNodeIndices = (cells + 1) * (cells + 1) * 6;
  const expected = { calls: 1, instances: options.runtime.instanceCount };
  const edges = cost.draws["edges"];
  const nodes = cost.draws["nodes"];
  if (
    edges?.calls !== expected.calls ||
    edges.indices !== expectedEdgeIndices ||
    edges.instances !== expected.instances ||
    nodes?.calls !== expected.calls ||
    nodes.indices !== expectedNodeIndices ||
    nodes.instances !== expected.instances ||
    edgePartIds.size !== options.benchmarkCase.scene.parts.size
  ) {
    throw new Error(
      `${options.benchmarkCase.id} combined overlay omitted structural draw work: ${JSON.stringify({
        edges,
        nodes,
        expectedEdgeIndices,
        expectedNodeIndices,
        expected,
        materializedEdgePartCount: edgePartIds.size,
      })}`,
    );
  }
}

function assertNodeWork(
  options: CombinedOverlayOptions,
  cost: CombinedOverlayBenchmarkReport["coldNodeGpuCost"],
): void {
  const cells = options.benchmarkCase.gridCells;
  const nodes = cost.draws["nodes"];
  if (
    nodes?.calls !== 1 ||
    nodes.indices !== (cells + 1) * (cells + 1) * 6 ||
    nodes.instances !== options.runtime.instanceCount ||
    (cost.draws["edges"]?.calls ?? 0) !== 0
  ) {
    throw new Error(`${options.benchmarkCase.id} node overlay omitted structural draw work`);
  }
}

async function renderFrame(options: CombinedOverlayOptions): Promise<number> {
  return (await timedFrame(options)).queueMs;
}

async function timedFrame(
  options: CombinedOverlayOptions,
): Promise<{ readonly queueMs: number; readonly cpuMs: number }> {
  const start = performance.now();
  options.renderer.render(options.runtime, options.camera, options.benchmarkCase.scene.parts);
  const cpuMs = performance.now() - start;
  await options.device.queue.onSubmittedWorkDone();
  return { queueMs: performance.now() - start, cpuMs };
}

function percentiles(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number): number => sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
  return { p50: at(0.5), p95: at(0.95) };
}
