import type { Part, PartId } from "../geometry/part";
import { readInteractionState, type InteractionState } from "../interaction/state";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import {
  writeNodeOrder,
  writeNodeSelectionOrder,
  writeSelectionOrder,
  type DrawResources,
} from "./resources/draw-resources";
import {
  buildNodeOrder,
  buildNodeSelectionOrder,
  buildSelectionOrder,
  type InstanceLayout,
} from "./runtime-state";
import { buildSelectionDrawCalls } from "./selection/draw-ranges";
import {
  collectDenseElementSelections,
  type DenseElementSelections,
} from "./selection/element-selection";
import {
  denseNodeOccurrenceAtSlot,
  hasValidNodeSelection,
  partNodeCount,
  type DenseNodeSelections,
} from "./selection/node-selection";
import type { GpuBundle } from "./recovery";

/** Mutable selection-only mirrors owned by the renderer attachment. */
export interface SelectionState {
  readonly selectedNodeFlags: boolean[];
  readonly nodeFlags: readonly boolean[];
}

/** Recomputes selected-instance and selected-node orders after interaction changes. */
export function syncSelectionState(options: {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly interaction: InteractionState;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly selection: SelectionState;
  readonly bundle: GpuBundle;
  readonly selectionParts: ReadonlySet<PartId>;
  readonly nodeParts: ReadonlySet<PartId>;
  readonly changedInstanceIds: readonly number[] | undefined;
  readonly denseSelections: DenseElementSelections;
  readonly denseNodeSelections: DenseNodeSelections;
}): boolean {
  const interactionData = readInteractionState(options.interaction);
  const nodeFlagContext: SelectedNodeFlagContext = {
    data: interactionData,
    runtime: options.runtime,
    selectedNodeFlags: options.selection.selectedNodeFlags,
    parts: options.parts,
    layout: options.layout,
    denseNodeSelections: options.denseNodeSelections,
  };
  if (options.changedInstanceIds === undefined) {
    options.selection.selectedNodeFlags.fill(false);
    for (let slot = 0; slot < options.runtime.instanceCount; slot += 1) {
      updateSelectedNodeFlag(nodeFlagContext, slot);
    }
  } else {
    for (const slot of options.changedInstanceIds) {
      updateSelectedNodeFlag(nodeFlagContext, slot);
    }
  }
  const selectionChanged =
    options.selectionParts.size > 0 &&
    syncSelectedInstanceOrders({
      runtime: options.runtime,
      layout: options.layout,
      interaction: options.interaction,
      draw: options.bundle.draw,
      parts: options.selectionParts,
      partDefinitions: options.parts,
      denseSelections: options.denseSelections,
    });
  const nodeChanged = options.nodeParts.size > 0 && writeNodeOrders(options, options.nodeParts);
  return nodeChanged || selectionChanged;
}

interface SelectedNodeFlagContext {
  readonly data: ReturnType<typeof readInteractionState>;
  readonly runtime: PackedSceneRuntime;
  readonly selectedNodeFlags: boolean[];
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly layout: InstanceLayout;
  readonly denseNodeSelections: DenseNodeSelections;
}

function updateSelectedNodeFlag(context: SelectedNodeFlagContext, slot: number): void {
  const { data, runtime, selectedNodeFlags, parts, layout, denseNodeSelections } = context;
  if (slot < 0 || slot >= runtime.instanceCount) return;
  const instanceId = runtime.getInstanceId(slot);
  const partId = runtime.instancePartIds[slot];
  const local = layout.slotPartLocal[slot];
  const dense =
    partId === undefined || local === undefined || local < 0
      ? undefined
      : denseNodeOccurrenceAtSlot(denseNodeSelections.get(partId), local);
  const part = partId === undefined ? undefined : parts.get(partId);
  const nodeCount = part === undefined ? 0 : partNodeCount(part);
  selectedNodeFlags[slot] =
    dense !== undefined ||
    (instanceId !== undefined &&
      hasValidNodeSelection(data.selectedNodeIds.get(instanceId), nodeCount));
}

/** Rewrites node orders after the current part map or runtime visibility changes. */
export function writeNodeOrders(
  options: {
    readonly runtime: PackedSceneRuntime;
    readonly layout: InstanceLayout;
    readonly parts: ReadonlyMap<PartId, Part>;
    readonly selection: SelectionState;
    readonly bundle: GpuBundle;
  },
  affectedParts?: ReadonlySet<PartId>,
): boolean {
  const parts = affectedParts ?? new Set(options.layout.partOrder);
  let changed = false;
  for (const partId of parts) {
    options.bundle.draw.cost.cpu("order-rebuild", 1);
    const order = buildNodeOrder({
      layout: options.layout,
      runtime: options.runtime,
      partId,
      nodeFlags: options.selection.nodeFlags,
      parts: options.parts,
      selectedNodeFlags: options.selection.selectedNodeFlags,
    });
    if (options.layout.partNodeCounts.get(partId) !== order.length) changed = true;
    writeNodeOrder(options.bundle.draw, partId, order);
    options.layout.partNodeCounts.set(partId, order.length);
    const selectedNodeOrder = buildNodeSelectionOrder(
      options.layout,
      options.runtime,
      partId,
      options.selection.selectedNodeFlags,
      options.parts,
    );
    if (options.layout.partSelectedNodeCounts.get(partId) !== selectedNodeOrder.length) {
      changed = true;
    }
    writeNodeSelectionOrder(options.bundle.draw, partId, selectedNodeOrder);
    options.layout.partSelectedNodeCounts.set(partId, selectedNodeOrder.length);
  }
  return changed;
}

function syncSelectedInstanceOrders(options: {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly interaction: InteractionState;
  readonly draw: DrawResources;
  readonly parts: ReadonlySet<PartId>;
  readonly partDefinitions: ReadonlyMap<PartId, Part>;
  readonly denseSelections: DenseElementSelections;
}): boolean {
  const { runtime, layout, interaction, draw, parts, partDefinitions } = options;
  for (const partId of parts) {
    const order = buildSelectionOrder(layout, runtime, partId, interaction, partDefinitions);
    writeSelectionOrder(draw, partId, order);
    layout.partSelectionCounts.set(partId, order.length);
    const part = partDefinitions.get(partId);
    const rangedCalls =
      part === undefined
        ? undefined
        : buildSelectionDrawCalls({
            layout,
            runtime,
            partId,
            interaction,
            part,
            order,
            denseSelections: options.denseSelections,
          });
    if (rangedCalls === undefined) {
      layout.partSelectionDrawCalls.delete(partId);
    } else {
      layout.partSelectionDrawCalls.set(partId, rangedCalls);
    }
  }
  return parts.size > 0;
}

/** Rebuilds selected-instance orders for only the parts whose visibility changed. */
export function syncVisibleSelectionOrders(
  runtime: PackedSceneRuntime,
  layout: InstanceLayout,
  interaction: InteractionState,
  bundle: GpuBundle,
  options: {
    readonly parts: ReadonlySet<PartId>;
    readonly partDefinitions: ReadonlyMap<PartId, Part>;
  },
): void {
  const denseSelections = collectDenseElementSelections(
    runtime,
    layout,
    options.partDefinitions,
    interaction,
  );
  syncSelectedInstanceOrders({
    runtime,
    layout,
    interaction,
    draw: bundle.draw,
    parts: options.parts,
    partDefinitions: options.partDefinitions,
    denseSelections,
  });
}
