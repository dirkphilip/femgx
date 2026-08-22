import type { Part, PartId } from "../geometry/part";
import { readInteractionState, type InteractionState } from "../interaction/state";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import {
  writeNodeOrder,
  writeSelectedNodeCompactOrder,
  writeNodeSelectionOrder,
  writeSelectionOrder,
  clearSelectionReplay,
  type DrawResources,
} from "./resources/draw-resources";
import { buildNodeOrder, type InstanceLayout } from "./runtime-state";
import { buildSelectionOrders } from "./selection/order";
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
import { buildSelectedNodeOrder } from "./selection/selected-node-order";
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
  const nodeChanged =
    options.nodeParts.size > 0 &&
    writeNodeOrders({ ...options, interaction: options.interaction }, options.nodeParts);
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
    readonly interaction: InteractionState;
    readonly visible?: boolean;
  },
  affectedParts?: ReadonlySet<PartId>,
): boolean {
  const parts = affectedParts ?? new Set(options.layout.partOrder);
  let changed = false;
  for (const partId of parts) {
    const partChanged = writeNodeOrdersForPart(options, partId);
    changed ||= partChanged;
  }
  return changed;
}

function writeNodeOrdersForPart(
  options: Parameters<typeof writeNodeOrders>[0],
  partId: PartId,
): boolean {
  options.bundle.draw.cost.cpu("order-rebuild", 1);
  const order =
    options.visible === false
      ? new Uint32Array()
      : buildNodeOrder({
          layout: options.layout,
          runtime: options.runtime,
          partId,
          nodeFlags: options.selection.nodeFlags,
          parts: options.parts,
          includeAll: options.visible === true,
        });
  const previousCount = options.layout.partNodeCounts.get(partId);
  writeNodeOrder(options.bundle.draw, partId, order);
  options.layout.partNodeCounts.set(partId, order.length);
  const selectedNodeOrder =
    options.visible === false
      ? {
          denseOccurrences: new Uint32Array(),
          sparseOccurrences: new Uint32Array(),
          sparseNodeIds: new Uint32Array(),
        }
      : buildSelectedNodeOrder({
          runtime: options.runtime,
          layout: options.layout,
          partId,
          parts: options.parts,
          interaction: options.interaction,
        });
  const selectedNodeCount =
    selectedNodeOrder.denseOccurrences.length + selectedNodeOrder.sparseNodeIds.length;
  const previousSelectedCount = options.layout.partSelectedNodeCounts.get(partId);
  writeNodeSelectionOrder(options.bundle.draw, partId, selectedNodeOrder.denseOccurrences);
  writeSelectedNodeCompactOrder(
    options.bundle.draw,
    partId,
    selectedNodeOrder.sparseOccurrences,
    selectedNodeOrder.sparseNodeIds,
  );
  options.layout.partSelectedNodeCounts.set(partId, selectedNodeCount);
  options.layout.partSelectedNodeDrawCalls.set(
    partId,
    selectedNodeDrawCalls(partId, selectedNodeOrder),
  );
  return previousCount !== order.length || previousSelectedCount !== selectedNodeCount;
}

function selectedNodeDrawCalls(
  partId: PartId,
  selectedNodeOrder: ReturnType<typeof buildSelectedNodeOrder>,
): Array<{
  readonly partId: PartId;
  readonly instanceCount: number;
  readonly selectedNodeMode?: "compact";
}> {
  const calls: Array<{
    readonly partId: PartId;
    readonly instanceCount: number;
    readonly selectedNodeMode?: "compact";
  }> = [];
  if (selectedNodeOrder.denseOccurrences.length > 0)
    calls.push({ partId, instanceCount: selectedNodeOrder.denseOccurrences.length });
  if (selectedNodeOrder.sparseNodeIds.length > 0)
    calls.push({
      partId,
      instanceCount: selectedNodeOrder.sparseNodeIds.length,
      selectedNodeMode: "compact",
    });
  return calls;
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
  const orders = buildSelectionOrders({
    runtime,
    layout,
    partIds: parts,
    interaction,
    parts: partDefinitions,
  });
  for (const partId of parts) {
    clearSelectionReplay(draw, partId);
    const order = orders.get(partId) ?? new Uint32Array();
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
