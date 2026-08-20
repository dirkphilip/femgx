import { orbitCamera, type Camera } from "../../../src/camera/camera";
import { partSemanticGraph } from "../../../src/geometry/semantic/part-semantic-graph";
import { createInteractionState, setPartOverride } from "../../../src/interaction/interaction";
import { setElementsVisible } from "../../../src/interaction/elements";
import { readInteractionState, type InteractionState } from "../../../src/interaction/state";
import { setTargetsSelected } from "../../../src/interaction/targets";
import {
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
} from "../../../src/renderer/resources/element-resources";
import {
  readGpuCostSnapshot,
  readMaterializedEdgePartIds,
  type WebGpuRenderer,
} from "../../../src/renderer/gpu-renderer";
import { buildInstanceLayout } from "../../../src/renderer/runtime-state";
import {
  collectDenseElementSelections,
  collectDenseHiddenElements,
  type DenseElementSelections,
} from "../../../src/renderer/selection/element-selection";
import type { ElementRef } from "../../../src/scene/types";
import type { InteractionTarget } from "../../../src/interaction/target-types";
import type { PackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import { estimateBenchmarkMemory } from "../memory";
import { authoredElementTargets } from "../selection";
import { percentiles } from "../statistics";
import type {
  SelectionHideWorkflowFrames,
  SelectionHideWorkflowPhase,
  SelectionHideWorkflowReport,
} from "../types";
import type { WebGpuBenchmarkCase } from "../model";

const SUPPORTED_CASE = "fe-tet4-solid-132k";
const STEADY_SAMPLES = 7;

interface WorkflowOptions {
  readonly renderer: WebGpuRenderer;
  readonly device: GPUDevice;
  readonly benchmarkCase: WebGpuBenchmarkCase;
  readonly runtime: PackedSceneRuntime;
  readonly camera: Camera;
}

/** Measures the bounded large-Tet4 select-half, hide-half, and restore workflow. */
export async function measureSelectionHideWorkflow(
  options: WorkflowOptions,
): Promise<SelectionHideWorkflowReport | undefined> {
  if (options.benchmarkCase.id !== SUPPORTED_CASE) return undefined;
  const { benchmarkCase, runtime, renderer } = options;
  const slots = drawSlots(runtime);
  const presentationStart = performance.now();
  const presentation = presentationInteraction(benchmarkCase);
  const presentationStateMs = performance.now() - presentationStart;
  const presentationSyncStart = performance.now();
  renderer.updateInstances(runtime, presentation, slots);
  renderer.updateElements(runtime, presentation, slots);
  const presentationSyncMs = performance.now() - presentationSyncStart;
  await renderFrame(options, options.camera);
  const presentationGpuCost = readGpuCostSnapshot(renderer);

  const totalElementCount = authoredElementCount(benchmarkCase, runtime);
  const selectedTargets = authoredElementTargets(
    benchmarkCase,
    runtime,
    Math.ceil(totalElementCount / 2),
  );
  const selected = timedSelection(presentation, selectedTargets);
  const selection = await measurePhase(options, selected.state, selected.stateMs, slots);
  const hidden = timedHide(selected.state, selectedTargets);
  const hide = await measurePhase(options, hidden.state, hidden.stateMs, slots);

  const restoreStateStart = performance.now();
  const visible = setElementsVisible(hidden.state, elementRefs(selectedTargets), true);
  const restored = setTargetsSelected(visible, selectedTargets, false);
  const restoreStateMs = performance.now() - restoreStateStart;
  const restoreSyncStart = performance.now();
  renderer.updateElements(runtime, restored, slots);
  const restoreSyncMs = performance.now() - restoreSyncStart;
  await renderFrame(options, options.camera);
  const restoredData = readInteractionState(restored);
  const firstTarget = selectedTargets[0];
  if (firstTarget?.kind !== "element") throw new Error("Selection-hide targets are not elements");
  const restoredVisibleElementCount =
    totalElementCount -
    (restoredData.hiddenElementIds.get(firstTarget.partOccurrenceId)?.size ?? 0);
  return {
    nodes: true,
    authoredEdges: true,
    presentationGpuCost,
    selectedElementCount: selectedTargets.length,
    selectedOccurrenceCount: slots.length,
    presentationStateMs,
    presentationSyncMs,
    selection,
    hide,
    restoreStateMs,
    restoreSyncMs,
    restoredVisibleElementCount,
  };
}

function presentationInteraction(benchmarkCase: WebGpuBenchmarkCase): InteractionState {
  let state = createInteractionState();
  for (const partId of benchmarkCase.scene.parts.keys()) {
    state = setPartOverride(state, partId, { edge: true, nodes: true });
  }
  return state;
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

function timedHide(
  state: InteractionState,
  targets: readonly InteractionTarget[],
): { readonly state: InteractionState; readonly stateMs: number } {
  const start = performance.now();
  const hidden = setElementsVisible(state, elementRefs(targets), false);
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
    gpuMemoryDeltaBytes: memory.gpuMemoryDeltaBytes,
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
  readonly gpuMemoryDeltaBytes: number;
} {
  const highlightRetainedBytes = denseHighlightBytes(options, state);
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
    highlightRetainedBytes,
    topologyRetainedBytes: Math.max(0, overlay.retainedBufferBytes - empty.retainedBufferBytes),
    gpuMemoryDeltaBytes:
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
    bytes += slotBytes * 2;
    bytes += denseWordBytes(selections, partId) + denseWordBytes(hidden, partId);
  }
  return bytes;
}

function denseWordBytes(selections: DenseElementSelections, partId: number): number {
  let bytes = 0;
  for (const occurrence of selections.get(partId)?.occurrences ?? []) {
    bytes += occurrence.words.byteLength;
  }
  return bytes;
}

async function measureFrames(
  options: WorkflowOptions,
  camera: Camera,
): Promise<SelectionHideWorkflowFrames> {
  const firstFrameMs = await renderFrame(options, camera);
  const steady: number[] = [];
  for (let index = 0; index < STEADY_SAMPLES; index += 1) {
    steady.push(await renderFrame(options, camera));
  }
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

function* elementRefs(targets: readonly InteractionTarget[]): Iterable<ElementRef> {
  for (const target of targets) {
    if (target.kind === "element") {
      yield { partOccurrenceId: target.partOccurrenceId, elementId: target.elementId };
    }
  }
}
