import type { Part, PartId } from "../geometry/part";
import { readInteractionState, type InteractionState } from "../interaction/state";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import {
  writeNodeOrder,
  writeNodeSelectionOrder,
  writeSelectionOrder,
  type DrawResources,
} from "./resources/gpu-draw";
import {
  buildNodeOrder,
  buildNodeSelectionOrder,
  buildSelectionOrder,
  type InstanceLayout,
} from "./runtime-state";
import type { GpuBundle } from "./gpu-recovery";

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
}): boolean {
  const interactionData = readInteractionState(options.interaction);
  if (options.changedInstanceIds === undefined) {
    options.selection.selectedNodeFlags.fill(false);
    for (let slot = 0; slot < options.runtime.instanceCount; slot += 1) {
      updateSelectedNodeFlag(
        interactionData,
        options.runtime,
        options.selection.selectedNodeFlags,
        slot,
      );
    }
  } else {
    for (const slot of options.changedInstanceIds) {
      updateSelectedNodeFlag(
        interactionData,
        options.runtime,
        options.selection.selectedNodeFlags,
        slot,
      );
    }
  }
  const selectionChanged =
    options.selectionParts.size > 0 &&
    syncSelectedInstanceOrders(
      options.runtime,
      options.layout,
      options.interaction,
      options.bundle.draw,
      options.selectionParts,
    );
  const nodeChanged =
    options.nodeParts.size > 0 && writeNodeOrders({ ...options, affectedParts: options.nodeParts });
  return nodeChanged || selectionChanged;
}

function updateSelectedNodeFlag(
  data: ReturnType<typeof readInteractionState>,
  runtime: PackedSceneRuntime,
  selectedNodeFlags: boolean[],
  slot: number,
): void {
  if (slot < 0 || slot >= runtime.instanceCount) return;
  const instanceId = runtime.getInstanceId(slot);
  selectedNodeFlags[slot] =
    instanceId !== undefined && (data.selectedNodeIds.get(instanceId)?.size ?? 0) > 0;
}

/** Rewrites node orders after the current part map or runtime visibility changes. */
export function writeNodeOrders(options: {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly selection: SelectionState;
  readonly bundle: GpuBundle;
  readonly affectedParts?: ReadonlySet<PartId>;
}): boolean {
  const parts = options.affectedParts ?? new Set(options.layout.partOrder);
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

function syncSelectedInstanceOrders(
  runtime: PackedSceneRuntime,
  layout: InstanceLayout,
  interaction: InteractionState,
  draw: DrawResources,
  parts: ReadonlySet<PartId> = new Set(layout.partOrder),
): boolean {
  let changed = false;
  for (const partId of parts) {
    const order = buildSelectionOrder(layout, runtime, partId, interaction);
    const storage = draw.storages.get(partId);
    if (storage === undefined || storage.selectionOrderLength !== order.length) changed = true;
    else {
      for (let index = 0; index < order.length; index += 1) {
        if (storage.selectionOrderData[index] !== order[index]) {
          changed = true;
          break;
        }
      }
    }
    writeSelectionOrder(draw, partId, order);
    layout.partSelectionCounts.set(partId, order.length);
  }
  return changed;
}

/** Rebuilds selected-instance orders for only the parts whose visibility changed. */
export function syncVisibleSelectionOrders(
  runtime: PackedSceneRuntime,
  layout: InstanceLayout,
  interaction: InteractionState,
  bundle: GpuBundle,
  parts: ReadonlySet<PartId>,
): void {
  syncSelectedInstanceOrders(runtime, layout, interaction, bundle.draw, parts);
}
