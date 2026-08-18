import type { Part, PartId } from "../../geometry/part";
import { createInteractionState, type InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { PreviousInstanceLayout, InstanceLayout } from "../runtime-state";
import type { PartOccurrence } from "../../scene/types";
import { buildDrawOrder, buildInstanceSnapshot, type DrawCallLists } from "../runtime-state";
import type { GpuBundle } from "../recovery";
import type { SelectionState } from "../selection-state";
import { collectInstanceUpdates } from "../instance-updates";
import {
  destroyInstancePartResources,
  destroyInstanceResources,
  patchInstances,
  type DrawResources,
} from "../resources/draw-resources";
import { rebuildEdgeOrders, rebuildTransparentOrders } from "./orders";
import { syncVisibleSelectionOrders, writeNodeOrders } from "../selection-state";
import { rebuildAttachmentCalls } from "./calls";
import { rebuildVisibilitySurface } from "../visibility/skins";
import { writeDrawOrder } from "../resources/instance-storage";

/** Returns current slots whose instance record changed across a runtime revision. */
export function attachmentChangedSlots(
  previous: PackedSceneRuntime,
  runtime: PackedSceneRuntime,
): number[] {
  const changed: number[] = [];
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const instanceId = runtime.getInstanceId(slot);
    const previousSlot =
      instanceId === undefined ? undefined : previous.getInstanceSlot(instanceId);
    if (previousSlot === undefined || instanceChanged(previous, previousSlot, runtime, slot)) {
      changed.push(slot);
    }
  }
  return changed;
}

/** Returns parts whose current order or placement membership changed. */
export function attachmentAffectedParts(
  previous: PreviousInstanceLayout,
  runtime: PackedSceneRuntime,
  layout: InstanceLayout,
): Set<PartId> {
  const affected = new Set<PartId>();
  for (let slot = 0; slot < previous.runtime.instanceCount; slot += 1) {
    const instanceId = previous.runtime.getInstanceId(slot);
    const partId = previous.runtime.instancePartIds[slot];
    if (instanceId === undefined || partId === undefined) continue;
    const currentSlot = runtime.getInstanceSlot(instanceId);
    if (currentSlot === undefined || runtime.instancePartIds[currentSlot] !== partId) {
      affected.add(partId);
    }
  }
  for (const partId of layout.partOrder) {
    const slots = layout.partSlots.get(partId);
    const previousSlots = previous.layout.partSlots.get(partId);
    if (slots === undefined) continue;
    if (previousSlots === undefined || previousSlots.length !== slots.length) {
      affected.add(partId);
      continue;
    }
    for (let index = 0; index < slots.length; index += 1) {
      const currentId = runtime.getInstanceId(slots[index] ?? -1);
      const previousId = previous.runtime.getInstanceId(previousSlots[index] ?? -1);
      if (currentId !== previousId) {
        affected.add(partId);
        break;
      }
    }
  }
  return affected;
}

/** Remaps per-occurrence style mirrors without changing their stable values. */
export function remapAttachmentFlags(
  previousRuntime: PackedSceneRuntime,
  runtime: PackedSceneRuntime,
  state: AttachmentFlagState,
): void {
  const previousSlotByCurrent = new Int32Array(runtime.instanceCount).fill(-1);
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const instanceId = runtime.getInstanceId(slot);
    const previousSlot =
      instanceId === undefined ? undefined : previousRuntime.getInstanceSlot(instanceId);
    if (previousSlot !== undefined) previousSlotByCurrent[slot] = previousSlot;
  }
  remapFlags(state.edgeFlags, previousSlotByCurrent);
  remapFlags(state.edgeEmphasisFlags, previousSlotByCurrent);
  remapFlags(state.nodeFlags, previousSlotByCurrent);
  remapFlags(state.transparentFlags, previousSlotByCurrent);
  remapFlags(state.selectedNodeFlags, previousSlotByCurrent);
}

function remapFlags(target: boolean[], previousSlotByCurrent: Int32Array): void {
  const previous = target.slice();
  target.length = previousSlotByCurrent.length;
  for (let slot = 0; slot < previousSlotByCurrent.length; slot += 1) {
    target[slot] = previous[previousSlotByCurrent[slot] ?? -1] === true;
  }
}

export interface AttachmentFlagState {
  edgeFlags: boolean[];
  edgeEmphasisFlags: boolean[];
  nodeFlags: boolean[];
  transparentFlags: boolean[];
  selectedNodeFlags: boolean[];
}

export interface AttachmentState {
  flags: AttachmentFlagState;
  instances: PartOccurrence[];
  slotByInstanceId: Map<string, number>;
}

/** Creates all placement records and orders for the first runtime attachment. */
export function applyFullAttachment(options: {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly state: AttachmentState;
  readonly draw: DrawResources;
}): DrawCallLists {
  destroyInstanceResources(options.draw);
  const snapshot = buildInstanceSnapshot(options.runtime);
  options.state.instances = snapshot.instances;
  options.state.slotByInstanceId = snapshot.slotByInstanceId;
  resetFlags(options.state.flags, options.runtime.instanceCount);
  const allSlots = Array.from({ length: options.runtime.instanceCount }, (_, slot) => slot);
  options.draw.cost.cpu("instance-scan", allSlots.length);
  const updates = collectInstanceUpdates(
    options.runtime,
    options.layout,
    createInteractionState(),
    options.state.flags,
    allSlots,
  ).updates;
  for (const [partId, partUpdates] of updates) patchInstances(options.draw, partId, partUpdates);
  for (const partId of options.layout.partOrder) {
    writeDrawOrder(options.draw, partId, buildDrawOrder(options.layout, options.runtime, partId));
  }
  rebuildTransparentOrders(
    options.runtime,
    options.layout,
    new Set(options.layout.partOrder),
    options.state.flags.transparentFlags,
    options.draw,
  );
  return rebuildAttachmentCalls(options.layout, options.draw.cost);
}

/** Applies only changed placement records to the current part storages. */
export function applyIncrementalAttachment(options: {
  readonly previous: PreviousInstanceLayout;
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly interaction: InteractionState;
  readonly state: AttachmentState;
  readonly draw: DrawResources;
}): ReadonlySet<PartId> {
  const changedSlots = attachmentChangedSlots(options.previous.runtime, options.runtime);
  const affectedParts = attachmentAffectedParts(options.previous, options.runtime, options.layout);
  remapAttachmentFlags(options.previous.runtime, options.runtime, options.state.flags);
  const snapshot = buildInstanceSnapshot(options.runtime);
  options.state.instances = snapshot.instances;
  options.state.slotByInstanceId = snapshot.slotByInstanceId;
  options.draw.cost.cpu("instance-scan", changedSlots.length);
  const updates = collectInstanceUpdates(
    options.runtime,
    options.layout,
    options.interaction,
    options.state.flags,
    changedSlots,
  ).updates;
  for (const [partId, partUpdates] of updates) patchInstances(options.draw, partId, partUpdates);
  for (const partId of options.previous.layout.partOrder) {
    if (!options.layout.partSlots.has(partId)) {
      destroyInstancePartResources(options.draw, partId);
    }
  }
  return affectedParts;
}

function resetFlags(flags: AttachmentFlagState, count: number): void {
  for (const values of [
    flags.edgeFlags,
    flags.edgeEmphasisFlags,
    flags.nodeFlags,
    flags.transparentFlags,
    flags.selectedNodeFlags,
  ]) {
    values.length = count;
    values.fill(false);
  }
}

/** Rebuilds only the order lists for parts whose placement membership changed. */
export function rebuildAttachmentOrders(options: {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly parts: ReadonlySet<PartId>;
  readonly flags: AttachmentFlagState;
  readonly interaction: InteractionState;
  readonly partDefinitions: ReadonlyMap<PartId, Part>;
  readonly selection: SelectionState;
  readonly bundle: GpuBundle;
}): DrawCallLists {
  const activeParts = new Set(
    [...options.parts].filter((partId) => options.layout.partSlots.has(partId)),
  );
  rebuildSurfaceOrders(options, activeParts);
  rebuildEdgeOrders({
    runtime: options.runtime,
    layout: options.layout,
    parts: activeParts,
    flags: options.flags.edgeFlags,
    emphasisFlags: options.flags.edgeEmphasisFlags,
    draw: options.bundle.draw,
  });
  rebuildTransparentOrders(
    options.runtime,
    options.layout,
    activeParts,
    options.flags.transparentFlags,
    options.bundle.draw,
  );
  writeNodeOrders(
    {
      runtime: options.runtime,
      layout: options.layout,
      parts: options.partDefinitions,
      selection: options.selection,
      bundle: options.bundle,
    },
    activeParts,
  );
  syncVisibleSelectionOrders(options.runtime, options.layout, options.interaction, options.bundle, {
    parts: activeParts,
    partDefinitions: options.partDefinitions,
  });
  options.layout.visibleCount = options.runtime.visibleCount;
  return rebuildAttachmentCalls(options.layout, options.bundle.draw.cost);
}

function rebuildSurfaceOrders(
  options: Parameters<typeof rebuildAttachmentOrders>[0],
  activeParts: ReadonlySet<PartId>,
): void {
  for (const partId of activeParts) {
    options.bundle.draw.cost.cpu("order-rebuild", 1);
    const part = options.partDefinitions.get(partId);
    if (part === undefined) {
      options.layout.partSurfaceDrawCalls.delete(partId);
      options.layout.partVisibleCounts.set(partId, 0);
      continue;
    }
    rebuildVisibilitySurface({
      runtime: options.runtime,
      layout: options.layout,
      part,
      interaction: options.interaction,
      draw: options.bundle.draw,
    });
  }
}

function instanceChanged(
  previous: PackedSceneRuntime,
  previousSlot: number,
  runtime: PackedSceneRuntime,
  slot: number,
): boolean {
  if (previous.instancePartIds[previousSlot] !== runtime.instancePartIds[slot]) return true;
  const previousOffset = previousSlot * 16;
  const offset = slot * 16;
  for (let index = 0; index < 16; index += 1) {
    if (
      previous.instanceWorldTransforms[previousOffset + index] !==
      runtime.instanceWorldTransforms[offset + index]
    ) {
      return true;
    }
  }
  return false;
}
