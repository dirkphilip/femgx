import { orbitCamera, type Camera } from "@/camera/camera";
import { partSemanticGraph } from "@/geometry/semantic/part-semantic-graph";
import { createInteractionState } from "@/interaction/interaction";
import {
  readInteractionState,
  readInteractionVisibility,
  withInteractionVisibility,
  type InteractionState,
} from "@/interaction/state";
import { hideSelectedElements } from "@/interaction/selection-queries";
import { setTargetsSelected } from "@/interaction/targets";
import type { InteractionTarget } from "@/interaction/target-types";
import {
  readGpuCostSnapshot,
  readMaterializedEdgePartIds,
  type WebGpuRenderer,
} from "@/renderer/gpu-renderer";
import {
  collectDenseElementSelections,
  collectDenseHiddenElements,
  type DenseElementSelections,
} from "@/renderer/selection/element-selection";
import { buildInstanceLayout } from "@/renderer/runtime-state";
import { ELEMENT_RECORD_STRIDE, HIGHLIGHT_HEADER } from "@/renderer/resources/element-resources";
import type { PackedSceneRuntime } from "@/scene-runtime/runtime";
import { estimateBenchmarkMemory } from "../memory";
import type { WebGpuBenchmarkCase } from "../model";
import { authoredElementTargets } from "./selection";
import { percentiles } from "../statistics";
import type {
  BenchmarkGpuCostSnapshot,
  SelectionHideWorkflowFrames,
  SelectionHideWorkflowPhase,
  SelectionHideWorkflowReport,
  SelectionHideWorkflowVariant,
} from "../types";

const STEADY_SAMPLES = 7;
const SUPPORTED_CASES = new Set(["fe-tet4-solid-132k"]);

interface WorkflowOptions {
  readonly renderer: WebGpuRenderer;
  readonly device: GPUDevice;
  readonly benchmarkCase: WebGpuBenchmarkCase;
  readonly runtime: PackedSceneRuntime;
  readonly camera: Camera;
}

interface VariantOptions extends WorkflowOptions {
  readonly slots: readonly number[];
  readonly selectedTargets: readonly InteractionTarget[];
  readonly totalElementCount: number;
  readonly id: SelectionHideWorkflowVariant["id"];
  readonly unsectionedOpaqueIndices?: number;
}

/** Measures the large solid select-half, hide-half, and restore workflow with overlays shown. */
export async function measureSelectionHideWorkflow(
  options: WorkflowOptions,
): Promise<SelectionHideWorkflowReport | undefined> {
  if (!SUPPORTED_CASES.has(options.benchmarkCase.id)) return undefined;
  const totalElementCount = authoredElementCount(options.benchmarkCase, options.runtime);
  const selectedTargets = authoredElementTargets(
    options.benchmarkCase,
    options.runtime,
    Math.ceil(totalElementCount / 2),
  );
  if (selectedTargets.length !== Math.ceil(totalElementCount / 2)) {
    throw new Error(`${options.benchmarkCase.id} did not produce a half-element target set`);
  }
  const slots = drawSlots(options.runtime);
  const unsectioned = await measureVariant({
    ...options,
    slots,
    selectedTargets,
    totalElementCount,
    id: "unsectioned",
  });
  const variants = [
    unsectioned,
    await measureVariant({
      ...options,
      slots,
      selectedTargets,
      totalElementCount,
      id: "active-section",
      unsectionedOpaqueIndices: opaqueIndexCount(
        unsectioned.presentationGpuCost,
        options.benchmarkCase.id,
      ),
    }),
  ];
  options.renderer.setSectionPlane(undefined);
  options.renderer.setEdgesVisible(false);
  options.renderer.setNodesVisible(false);
  return {
    nodes: true,
    authoredEdges: true,
    selectedElementCount: selectedTargets.length,
    selectedOccurrenceCount: slots.length,
    variants,
  };
}

async function measureVariant(options: VariantOptions): Promise<SelectionHideWorkflowVariant> {
  const { slots, selectedTargets, totalElementCount, id, unsectionedOpaqueIndices } = options;
  const { benchmarkCase, renderer, runtime } = options;
  const presentationStart = performance.now();
  const presentation = presentationInteraction();
  const presentationStateMs = performance.now() - presentationStart;
  if (id === "active-section") renderer.setSectionPlane(sectionPlane(benchmarkCase, runtime));
  renderer.setEdgesVisible(true);
  renderer.setNodesVisible(true);
  const presentationSyncStart = performance.now();
  renderer.updateInstances(runtime, presentation, slots);
  renderer.updateElements(runtime, presentation, slots);
  const presentationSyncMs = performance.now() - presentationSyncStart;
  await renderFrame(options, options.camera);
  const presentationGpuCost = readGpuCostSnapshot(renderer);
  assertPresentation(presentationGpuCost, benchmarkCase.id, id, true, unsectionedOpaqueIndices);

  const selected = timedSelection(presentation, selectedTargets);
  const selection = await measurePhase(options, selected.state, selected.stateMs, slots);
  const hidden = timedHide(selected.state);
  const hide = await measurePhase(options, hidden.state, hidden.stateMs, slots);
  assertHiddenState(hidden.state, selectedTargets, benchmarkCase.id);

  const restoreStateStart = performance.now();
  const visible = withInteractionVisibility(hidden.state, {
    hiddenBodyIds: readInteractionVisibility(hidden.state).hiddenBodyIds,
    hiddenElementIds: new Map(),
  });
  const restored = setTargetsSelected(visible, selectedTargets, false);
  const restoreStateMs = performance.now() - restoreStateStart;
  const restoreSyncStart = performance.now();
  renderer.updateInstances(runtime, restored, slots);
  renderer.updateElements(runtime, restored, slots);
  const restoreSyncMs = performance.now() - restoreSyncStart;
  await renderFrame(options, options.camera);
  const restoredGpuCost = readGpuCostSnapshot(renderer);
  assertPresentation(restoredGpuCost, benchmarkCase.id, id, false, unsectionedOpaqueIndices);
  assertRestoredPresentation(restoredGpuCost, presentationGpuCost, benchmarkCase.id, id);
  const restoredVisibleElementCount = visibleElementCount(
    restored,
    selectedTargets,
    benchmarkCase,
    runtime,
  );
  if (restoredVisibleElementCount !== totalElementCount) {
    throw new Error(`${benchmarkCase.id} ${id} restore left elements hidden`);
  }
  return {
    id,
    presentationGpuCost,
    presentationStateMs,
    presentationSyncMs,
    selection,
    hide,
    restoreStateMs,
    restoreSyncMs,
    restoredVisibleElementCount,
  };
}

function presentationInteraction(): InteractionState {
  return createInteractionState();
}

function sectionPlane(
  benchmarkCase: WebGpuBenchmarkCase,
  runtime: PackedSceneRuntime,
): { readonly normal: readonly [number, number, number]; readonly distance: number } {
  const slot = runtime.getDrawList()[0];
  const partId = slot === undefined ? undefined : runtime.getPartId(slot);
  const part = partId === undefined ? undefined : benchmarkCase.scene.parts.get(partId);
  const nodes = part?.nodePositions;
  if (nodes === undefined || nodes.length === 0 || runtime.instanceCount !== 1) {
    throw new Error(
      `${benchmarkCase.id} requires one node-authored placed part for section workflow`,
    );
  }
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let offset = 2; offset < nodes.length; offset += 3) {
    const z = nodes[offset];
    if (z === undefined) continue;
    minimum = Math.min(minimum, z);
    maximum = Math.max(maximum, z);
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum) {
    throw new Error(`${benchmarkCase.id} has no sectionable Z extent`);
  }
  const midpoint = (minimum + maximum) / 2;
  const nonTangentOffset = Math.min(0.25, (maximum - minimum) / 4);
  return { normal: [0, 0, 1], distance: -(midpoint + nonTangentOffset) };
}

function authoredElementCount(
  benchmarkCase: WebGpuBenchmarkCase,
  runtime: PackedSceneRuntime,
): number {
  const slot = runtime.getDrawList()[0];
  const partId = slot === undefined ? undefined : runtime.getPartId(slot);
  const part = partId === undefined ? undefined : benchmarkCase.scene.parts.get(partId);
  const count =
    part === undefined
      ? 0
      : (partSemanticGraph(part)?.elementIds.length ?? part.elements?.count ?? 0);
  if (count <= 0) throw new Error(`${benchmarkCase.id} has no authored elements`);
  return count;
}

function drawSlots(runtime: PackedSceneRuntime): readonly number[] {
  const slots = runtime.getDrawList();
  if (slots.length === 0) throw new Error("Selection-hide workflow has no drawable occurrence");
  return Array.from(slots);
}

function timedSelection(
  state: InteractionState,
  targets: readonly InteractionTarget[],
): { readonly state: InteractionState; readonly stateMs: number } {
  const start = performance.now();
  const selected = setTargetsSelected(state, targets, true);
  return { state: selected, stateMs: performance.now() - start };
}

function timedHide(state: InteractionState): {
  readonly state: InteractionState;
  readonly stateMs: number;
} {
  const start = performance.now();
  const hidden = hideSelectedElements(state);
  return { state: hidden, stateMs: performance.now() - start };
}

async function measurePhase(
  options: WorkflowOptions,
  state: InteractionState,
  interactionStateMs: number,
  slots: readonly number[],
): Promise<SelectionHideWorkflowPhase> {
  const before = readGpuCostSnapshot(options.renderer);
  const syncStart = performance.now();
  options.renderer.updateInstances(options.runtime, state, slots);
  options.renderer.updateElements(options.runtime, state, slots);
  const interactionSyncMs = performance.now() - syncStart;
  const after = readGpuCostSnapshot(options.renderer);
  const frames = await measureFrames(options, options.camera);
  const memory = workflowMemory(options, state, before, after);
  return {
    interactionStateMs,
    interactionSyncMs,
    frames,
    highlightRetainedBytes: memory.highlightRetainedBytes,
    topologyRetainedBytes: memory.topologyRetainedBytes,
    rendererMemoryDeltaBytes: memory.rendererMemoryDeltaBytes,
  };
}

function workflowMemory(
  options: WorkflowOptions,
  state: InteractionState,
  before: ReturnType<typeof readGpuCostSnapshot>,
  after: ReturnType<typeof readGpuCostSnapshot>,
): {
  readonly highlightRetainedBytes: number;
  readonly topologyRetainedBytes: number;
  readonly rendererMemoryDeltaBytes: number;
} {
  const empty = estimateBenchmarkMemory(
    options.benchmarkCase.scene,
    options.runtime.instanceCount,
    800,
    600,
  );
  const overlay = estimateBenchmarkMemory(
    options.benchmarkCase.scene,
    options.runtime.instanceCount,
    800,
    600,
    { materializedEdgePartIds: readMaterializedEdgePartIds(options.renderer) },
  );
  return {
    highlightRetainedBytes: denseHighlightBytes(options, state),
    topologyRetainedBytes: Math.max(0, overlay.retainedBufferBytes - empty.retainedBufferBytes),
    rendererMemoryDeltaBytes:
      after.memory.allocatedBytes -
      after.memory.releasedBytes -
      before.memory.allocatedBytes +
      before.memory.releasedBytes,
  };
}

function denseHighlightBytes(options: WorkflowOptions, state: InteractionState): number {
  const layout = buildInstanceLayout(options.runtime);
  const selections = collectDenseElementSelections(
    options.runtime,
    layout,
    options.benchmarkCase.scene.parts,
    state,
  );
  const hidden = collectDenseHiddenElements(
    options.runtime,
    layout,
    options.benchmarkCase.scene.parts,
    state,
  );
  let bytes = HIGHLIGHT_HEADER + ELEMENT_RECORD_STRIDE;
  for (const partId of new Set([...selections.keys(), ...hidden.keys()])) {
    const slotBytes = (layout.partSlots.get(partId)?.length ?? 0) * Uint32Array.BYTES_PER_ELEMENT;
    bytes += slotBytes * 2 + denseWordBytes(selections, partId) + denseWordBytes(hidden, partId);
  }
  return bytes;
}

function denseWordBytes(selections: DenseElementSelections, partId: number): number {
  let bytes = 0;
  for (const occurrence of selections.get(partId)?.occurrences ?? [])
    bytes += occurrence.words.byteLength;
  return bytes;
}

async function measureFrames(
  options: WorkflowOptions,
  camera: Camera,
): Promise<SelectionHideWorkflowFrames> {
  const firstFrameMs = await renderFrame(options, camera);
  const steady: number[] = [];
  for (let index = 0; index < STEADY_SAMPLES; index += 1)
    steady.push(await renderFrame(options, camera));
  const movingFirstFrameMs = await renderFrame(
    options,
    orbitCamera(camera, 0.02, 0.006, camera.target),
  );
  const movingSteady: number[] = [];
  for (let index = 1; index <= STEADY_SAMPLES; index += 1) {
    movingSteady.push(
      await renderFrame(options, orbitCamera(camera, 0.02 + index * 0.02, 0.006, camera.target)),
    );
  }
  return {
    firstFrameMs,
    steadyFrameMs: percentiles(steady),
    movingFirstFrameMs,
    movingSteadyFrameMs: percentiles(movingSteady),
  };
}

async function renderFrame(options: WorkflowOptions, camera: Camera): Promise<number> {
  const start = performance.now();
  options.renderer.render(options.runtime, camera, options.benchmarkCase.scene.parts);
  await options.device.queue.onSubmittedWorkDone();
  return performance.now() - start;
}

function assertPresentation(
  cost: ReturnType<typeof readGpuCostSnapshot>,
  caseId: string,
  id: SelectionHideWorkflowVariant["id"],
  expectCapAllocation: boolean,
  unsectionedOpaqueIndices: number | undefined,
): void {
  if (cost.draws.edges.instances === 0 || cost.draws.nodes.instances === 0) {
    throw new Error(`${caseId} ${id} omitted its requested edge or node presentation`);
  }
  if (
    id === "active-section" &&
    (unsectionedOpaqueIndices === undefined ||
      opaqueIndexCount(cost, caseId) <= unsectionedOpaqueIndices)
  ) {
    throw new Error(`${caseId} active section did not submit a cap draw`);
  }
  if (
    id === "active-section" &&
    expectCapAllocation &&
    cost.memory.allocatedBytes - cost.memory.releasedBytes <= 0
  ) {
    throw new Error(`${caseId} active section did not allocate bounded cap resources`);
  }
}

function assertRestoredPresentation(
  restored: ReturnType<typeof readGpuCostSnapshot>,
  presentation: ReturnType<typeof readGpuCostSnapshot>,
  caseId: string,
  id: SelectionHideWorkflowVariant["id"],
): void {
  const restoredOpaque = opaqueIndexCount(restored, caseId);
  const presentationOpaque = opaqueIndexCount(presentation, caseId);
  if (
    restoredOpaque !== presentationOpaque ||
    restored.draws.opaque.calls !== presentation.draws.opaque.calls
  ) {
    throw new Error(`${caseId} ${id} restore did not restore the original opaque cap submission`);
  }
}

function opaqueIndexCount(
  cost: Pick<ReturnType<typeof readGpuCostSnapshot>, "draws"> | BenchmarkGpuCostSnapshot,
  caseId: string,
): number {
  const opaque = cost.draws["opaque"];
  if (opaque.indices === 0) throw new Error(`${caseId} omitted opaque surface accounting`);
  return opaque.indices;
}

function assertHiddenState(
  state: InteractionState,
  targets: readonly InteractionTarget[],
  caseId: string,
): void {
  const first = targets[0];
  if (first?.kind !== "element") throw new Error("Selection-hide targets are not elements");
  const data = readInteractionState(state);
  if (
    data.selectedElementIds.get(first.partOccurrenceId)?.size !== targets.length ||
    readInteractionVisibility(state).hiddenElementIds.get(first.partOccurrenceId)?.size !==
      targets.length
  ) {
    throw new Error(`${caseId} hide did not preserve the selected half exactly`);
  }
}

function visibleElementCount(
  state: InteractionState,
  targets: readonly InteractionTarget[],
  benchmarkCase: WebGpuBenchmarkCase,
  runtime: PackedSceneRuntime,
): number {
  const first = targets[0];
  if (first?.kind !== "element") return 0;
  const total = authoredElementCount(benchmarkCase, runtime);
  return (
    total -
    (readInteractionVisibility(state).hiddenElementIds.get(first.partOccurrenceId)?.size ?? 0)
  );
}
