import type { Part, PartId } from "../geometry/part";
import { readInteractionState, type InteractionState } from "../interaction/state";
import type { InstanceId } from "../scene/types";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import {
  writeNodeOrder,
  writeNodeSelectionOrder,
  writeSelectionOrder,
  type DrawResources,
} from "./gpu-draw";
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
  readonly slotByInstanceId: ReadonlyMap<InstanceId, number>;
  readonly selection: SelectionState;
  readonly bundle: GpuBundle;
}): boolean {
  options.selection.selectedNodeFlags.fill(false);
  const data = readInteractionState(options.interaction);
  for (const [instanceId, nodeIds] of data.selectedNodeIds) {
    const slot = options.slotByInstanceId.get(instanceId);
    if (slot !== undefined && nodeIds.size > 0) options.selection.selectedNodeFlags[slot] = true;
  }
  const changed = syncSelectedInstanceOrders(
    options.runtime,
    options.layout,
    options.interaction,
    options.bundle.draw,
  );
  writeNodeOrders(options);
  return changed;
}

/** Rewrites node orders after the current part map or runtime visibility changes. */
export function writeNodeOrders(options: {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly selection: SelectionState;
  readonly bundle: GpuBundle;
}): void {
  const nodeFlags = options.selection.nodeFlags.map(
    (enabled, slot) => enabled || options.selection.selectedNodeFlags[slot] === true,
  );
  for (const partId of options.layout.partOrder) {
    const order = buildNodeOrder(options.layout, options.runtime, partId, nodeFlags, options.parts);
    writeNodeOrder(options.bundle.draw, partId, order);
    options.layout.partNodeCounts.set(partId, order.length);
    const selectedNodeOrder = buildNodeSelectionOrder(
      options.layout,
      options.runtime,
      partId,
      options.selection.selectedNodeFlags,
      options.parts,
    );
    writeNodeSelectionOrder(options.bundle.draw, partId, selectedNodeOrder);
    options.layout.partSelectedNodeCounts.set(partId, selectedNodeOrder.length);
  }
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
