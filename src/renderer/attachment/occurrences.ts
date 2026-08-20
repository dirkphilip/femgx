import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { RuntimeOccurrenceDelta } from "../../scene-runtime/occurrence-update";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import { collectInstanceUpdates } from "../instance-updates";
import {
  destroyInstancePartResources,
  destroyPartResources,
  patchInstances,
  type DrawResources,
} from "../resources/draw-resources";
import { instanceAt, type InstanceLayout } from "../runtime-state";
import type { AttachmentOrderParts, AttachmentState } from "./reconciliation";

/** Retires exact removed definitions and reports whether attached resources changed. */
export function releasePartDefinitions(options: {
  readonly runtime: PackedSceneRuntime | undefined;
  readonly layout: InstanceLayout | undefined;
  readonly attachedParts: Map<PartId, Part>;
  readonly sourceParts: Map<PartId, Part>;
  readonly partIds: ReadonlySet<PartId>;
  readonly draw: DrawResources;
}): boolean {
  let removed = false;
  for (const partId of options.partIds) assertPartRetirable(options.runtime, partId);
  if (options.layout !== undefined) {
    removePartOrderEntries(options.layout.partOrder, options.partIds);
  }
  for (const partId of options.partIds) {
    options.sourceParts.delete(partId);
    if (!options.attachedParts.has(partId)) continue;
    releasePartState({ ...options, partId });
    destroyPartResources(options.draw, partId);
    options.attachedParts.delete(partId);
    removed = true;
  }
  return removed;
}

function assertPartRetirable(runtime: PackedSceneRuntime | undefined, partId: PartId): void {
  const runtimeSlots = runtime?.getPartInstanceSlots(partId);
  if (runtimeSlots !== undefined && runtimeSlots.length > 0) {
    throw new Error(`Cannot retire part ${partId} while occurrences remain attached`);
  }
}

function releasePartState(options: {
  readonly layout: InstanceLayout | undefined;
  readonly partId: PartId;
  readonly draw: DrawResources;
}): void {
  const { layout } = options;
  if (layout !== undefined) {
    layout.partSlots.delete(options.partId);
    layout.partLocalSlots.delete(options.partId);
    for (const counts of partCountMaps(layout)) counts.delete(options.partId);
  }
  destroyInstancePartResources(options.draw, options.partId);
}

function removePartOrderEntries(order: PartId[], removed: ReadonlySet<PartId>): void {
  let target = 0;
  for (let source = 0; source < order.length; source += 1) {
    const partId = order[source];
    if (partId !== undefined && !removed.has(partId)) order[target++] = partId;
  }
  order.length = target;
}

function partCountMaps(layout: InstanceLayout): readonly Map<PartId, number>[] {
  return [
    layout.partVisibleCounts,
    layout.partEdgeCounts,
    layout.partNodeCounts,
    layout.partTransparentCounts,
    layout.partSelectionCounts,
    layout.partSelectedNodeCounts,
  ];
}

/** Applies exact occurrence membership and record changes to a retained attachment. */
export function applyOccurrenceAttachment(options: {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly delta: RuntimeOccurrenceDelta;
  readonly interaction: InteractionState;
  readonly state: AttachmentState;
  readonly draw: DrawResources;
}): AttachmentOrderParts {
  const orderChanges = previousOptionalOrders(options.delta, options.state);
  reserveGlobalSlots(options.layout, options.runtime.instanceCount);
  removePreviousLocals(options.layout, options.delta);
  assignCurrentLocals(options.runtime, options.layout, options.delta);
  updatePartMembership(
    options.runtime,
    options.layout,
    options.delta.affectedPartIds,
    options.delta.removedPartIds,
  );
  updateSnapshot(options.runtime, options.delta, options.state);
  const changedSlots = options.delta.slots
    .filter(({ afterPartId }) => afterPartId !== undefined)
    .map(({ slot }) => slot);
  options.draw.cost.cpu("instance-scan", changedSlots.length);
  const collected = collectInstanceUpdates(
    options.runtime,
    options.layout,
    options.interaction,
    options.state.flags,
    changedSlots,
  );
  addAll(orderChanges.edge, collected.edgeChanged);
  addAll(orderChanges.node, collected.nodeChanged);
  addAll(orderChanges.transparent, collected.transparentChanged);
  for (const [partId, partUpdates] of collected.updates) {
    patchInstances(options.draw, partId, partUpdates);
  }
  return orderChanges;
}

function previousOptionalOrders(
  delta: RuntimeOccurrenceDelta,
  state: AttachmentState,
): { edge: Set<PartId>; node: Set<PartId>; transparent: Set<PartId> } {
  const edge = new Set<PartId>();
  const node = new Set<PartId>();
  const transparent = new Set<PartId>();
  for (const { slot, beforePartId } of delta.slots) {
    if (beforePartId === undefined) continue;
    if (state.flags.edgeFlags[slot] === true || state.flags.edgeEmphasisFlags[slot] === true) {
      edge.add(beforePartId);
    }
    if (state.flags.nodeFlags[slot] === true || state.flags.selectedNodeFlags[slot] === true) {
      node.add(beforePartId);
    }
    if (state.flags.transparentFlags[slot] === true) transparent.add(beforePartId);
  }
  return { edge, node, transparent };
}

function addAll(target: Set<PartId>, source: ReadonlySet<PartId>): void {
  for (const partId of source) target.add(partId);
}

function reserveGlobalSlots(layout: InstanceLayout, required: number): void {
  if (required > layout.slotPartLocal.length) {
    let capacity = Math.max(1, layout.slotPartLocal.length);
    while (capacity < required) capacity *= 2;
    const slots = new Int32Array(capacity).fill(-1);
    slots.set(layout.slotPartLocal);
    layout.slotPartLocal = slots;
  }
  layout.instanceCount = required;
}

function removePreviousLocals(layout: InstanceLayout, delta: RuntimeOccurrenceDelta): void {
  for (const change of delta.slots) {
    if (change.beforePartId === undefined) continue;
    const local = layout.slotPartLocal[change.slot] ?? -1;
    const byLocal = layout.partLocalSlots.get(change.beforePartId);
    if (local >= 0 && byLocal !== undefined) byLocal[local] = -1;
    layout.slotPartLocal[change.slot] = -1;
  }
}

function assignCurrentLocals(
  runtime: PackedSceneRuntime,
  layout: InstanceLayout,
  delta: RuntimeOccurrenceDelta,
): void {
  const required = new Map<PartId, number>();
  for (const { afterPartId } of delta.slots) {
    if (afterPartId !== undefined) required.set(afterPartId, (required.get(afterPartId) ?? 0) + 1);
  }
  const newParts = new Set<PartId>();
  for (const partId of required.keys()) {
    if (!layout.partLocalSlots.has(partId)) newParts.add(partId);
  }
  mergePartOrder(layout.partOrder, newParts);
  const allocators = new Map<PartId, PartLocalAllocator>();
  for (const [partId, count] of required) {
    allocators.set(partId, preparePartLocalAllocator(layout, partId, count));
  }
  for (const change of delta.slots) {
    if (change.afterPartId === undefined) continue;
    const allocator = allocators.get(change.afterPartId);
    if (allocator === undefined)
      throw new Error(`Missing part-local allocator for ${change.afterPartId}`);
    const local = allocator.free[allocator.next++];
    if (local === undefined)
      throw new Error(`Exhausted part-local slots for ${change.afterPartId}`);
    layout.slotPartLocal[change.slot] = local;
    allocator.slots[local] = change.slot;
    if (!runtime.isInstanceActive(change.slot))
      throw new Error(`Inactive changed slot ${change.slot}`);
  }
}

interface PartLocalAllocator {
  readonly slots: Int32Array;
  readonly free: readonly number[];
  next: number;
}

function preparePartLocalAllocator(
  layout: InstanceLayout,
  partId: PartId,
  required: number,
): PartLocalAllocator {
  let slots = layout.partLocalSlots.get(partId);
  if (slots === undefined) {
    slots = new Int32Array();
    initializePartCounts(layout, partId);
  }
  const free: number[] = [];
  for (let local = 0; local < slots.length && free.length < required; local += 1) {
    if (slots[local] === -1) free.push(local);
  }
  const missing = required - free.length;
  if (missing > 0) {
    const previousLength = slots.length;
    let capacity = Math.max(1, previousLength);
    while (capacity < previousLength + missing) capacity *= 2;
    const next = new Int32Array(capacity).fill(-1);
    next.set(slots);
    slots = next;
    for (let local = previousLength; free.length < required; local += 1) free.push(local);
  }
  layout.partLocalSlots.set(partId, slots);
  return { slots, free, next: 0 };
}

function updatePartMembership(
  runtime: PackedSceneRuntime,
  layout: InstanceLayout,
  partIds: ReadonlySet<PartId>,
  removedPartIds: ReadonlySet<PartId>,
): void {
  for (const partId of partIds) {
    if (removedPartIds.has(partId)) continue;
    const slots = runtime.getPartInstanceSlots(partId);
    slots.sort();
    layout.partSlots.set(partId, slots);
  }
}

function mergePartOrder(order: PartId[], added: ReadonlySet<PartId>): void {
  if (added.size === 0) return;
  const previous = order.slice();
  const additions = [...added].sort((left, right) => left - right);
  order.length = previous.length + additions.length;
  let left = 0;
  let right = 0;
  let target = 0;
  while (left < previous.length && right < additions.length) {
    const existing = previous[left];
    const addition = additions[right];
    if (existing === undefined || addition === undefined) throw new Error("Part order is sparse");
    if (existing < addition) {
      order[target++] = existing;
      left += 1;
    } else {
      order[target++] = addition;
      right += 1;
    }
  }
  while (left < previous.length) {
    const partId = previous[left++];
    if (partId === undefined) throw new Error("Part order is sparse");
    order[target++] = partId;
  }
  while (right < additions.length) {
    const partId = additions[right++];
    if (partId === undefined) throw new Error("Added part order is sparse");
    order[target++] = partId;
  }
}

function updateSnapshot(
  runtime: PackedSceneRuntime,
  delta: RuntimeOccurrenceDelta,
  state: AttachmentState,
): void {
  state.instances.length = runtime.instanceCount;
  for (const change of delta.slots) {
    const previous = state.instances[change.slot];
    if (previous !== undefined) state.slotByInstanceId.delete(previous.partOccurrenceId);
    resetFlags(state, change.slot);
    const instanceId = runtime.getInstanceId(change.slot);
    const partId = runtime.getPartId(change.slot);
    if (instanceId === undefined || partId === undefined) {
      state.instances[change.slot] = undefined;
      continue;
    }
    state.instances[change.slot] = instanceAt(runtime, change.slot, partId);
    state.slotByInstanceId.set(instanceId, change.slot);
  }
}

function resetFlags(state: AttachmentState, slot: number): void {
  for (const flags of [
    state.flags.edgeFlags,
    state.flags.edgeEmphasisFlags,
    state.flags.nodeFlags,
    state.flags.transparentFlags,
    state.flags.selectedNodeFlags,
  ]) {
    if (flags.length <= slot) flags.length = slot + 1;
    flags[slot] = false;
  }
}

function initializePartCounts(layout: InstanceLayout, partId: PartId): void {
  for (const counts of [
    layout.partVisibleCounts,
    layout.partEdgeCounts,
    layout.partNodeCounts,
    layout.partTransparentCounts,
    layout.partSelectionCounts,
    layout.partSelectedNodeCounts,
  ])
    counts.set(partId, 0);
}
