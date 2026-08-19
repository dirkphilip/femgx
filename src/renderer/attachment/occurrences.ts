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

/** Releases renderer-local placement state after a part has no live occurrences. */
export function releasePartAttachment(options: {
  readonly runtime: PackedSceneRuntime | undefined;
  readonly layout: InstanceLayout | undefined;
  readonly partId: PartId;
  readonly draw: DrawResources;
}): void {
  const runtimeSlots = options.runtime?.getPartInstanceSlots(options.partId);
  if (runtimeSlots !== undefined && runtimeSlots.length > 0) {
    throw new Error(`Cannot retire part ${options.partId} while occurrences remain attached`);
  }
  const { layout } = options;
  if (layout !== undefined) {
    layout.partSlots.delete(options.partId);
    layout.partLocalSlots.delete(options.partId);
    const orderIndex = layout.partOrder.indexOf(options.partId);
    if (orderIndex >= 0) layout.partOrder.splice(orderIndex, 1);
    for (const counts of partCountMaps(layout)) counts.delete(options.partId);
  }
  destroyInstancePartResources(options.draw, options.partId);
}

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
  for (const partId of options.partIds) {
    options.sourceParts.delete(partId);
    if (!options.attachedParts.has(partId)) continue;
    releasePartAttachment({ ...options, partId });
    destroyPartResources(options.draw, partId);
    options.attachedParts.delete(partId);
    removed = true;
  }
  return removed;
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
  updatePartMembership(options.runtime, options.layout, options.delta.affectedPartIds);
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
  for (const change of delta.slots) {
    if (change.afterPartId === undefined) continue;
    const local = allocatePartLocal(layout, change.afterPartId);
    layout.slotPartLocal[change.slot] = local;
    const byLocal = layout.partLocalSlots.get(change.afterPartId);
    if (byLocal === undefined)
      throw new Error(`Missing part-local slots for ${change.afterPartId}`);
    byLocal[local] = change.slot;
    if (!runtime.isInstanceActive(change.slot))
      throw new Error(`Inactive changed slot ${change.slot}`);
  }
}

function allocatePartLocal(layout: InstanceLayout, partId: PartId): number {
  let slots = layout.partLocalSlots.get(partId);
  if (slots === undefined) {
    slots = new Int32Array(1).fill(-1);
    layout.partLocalSlots.set(partId, slots);
    initializePartCounts(layout, partId);
    insertPartOrder(layout.partOrder, partId);
  }
  const free = slots.indexOf(-1);
  if (free >= 0) return free;
  const next = new Int32Array(Math.max(1, slots.length * 2)).fill(-1);
  next.set(slots);
  layout.partLocalSlots.set(partId, next);
  return slots.length;
}

function updatePartMembership(
  runtime: PackedSceneRuntime,
  layout: InstanceLayout,
  partIds: ReadonlySet<PartId>,
): void {
  for (const partId of partIds) {
    const slots = runtime.getPartInstanceSlots(partId);
    slots.sort();
    layout.partSlots.set(partId, slots);
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

function insertPartOrder(order: PartId[], partId: PartId): void {
  let index = 0;
  while (index < order.length && (order[index] ?? 0) < partId) index += 1;
  if (order[index] !== partId) order.splice(index, 0, partId);
}
