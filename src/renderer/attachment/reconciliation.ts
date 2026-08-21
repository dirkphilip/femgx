import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { PreviousInstanceLayout, InstanceLayout } from "../runtime-state";
import type { PartOccurrence } from "../../scene/types";
import { buildInstanceSnapshot, type DrawCallLists } from "../runtime-state";
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
import { rebuildAttachmentCalls, reviseAttachmentCalls, type AttachmentCallLists } from "./calls";
import { rebuildVisibilitySurface } from "../visibility/skins";
import {
  createInstanceRecordTarget,
  initializeInstancePart,
  INSTANCE_STRIDE,
  writeInstanceRecord,
  type InstanceRecordValues,
} from "../resources/instance-storage";
import { defaultStyle } from "../resources/foundation";

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
  instances: Array<PartOccurrence | undefined>;
  slotByInstanceId: Map<string, number>;
}

export interface AttachmentOrderParts {
  readonly edge: ReadonlySet<PartId>;
  readonly node: ReadonlySet<PartId>;
  readonly transparent: ReadonlySet<PartId>;
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
  options.draw.cost.cpu("instance-scan", options.runtime.instanceCount);
  for (const partId of options.layout.partOrder) initializePart(options, partId);
  return rebuildAttachmentCalls(options.layout, options.draw.cost);
}

function initializePart(options: Parameters<typeof applyFullAttachment>[0], partId: PartId): void {
  const slots = options.layout.partLocalSlots.get(partId);
  if (slots === undefined || slots.length === 0) return;
  const data = new ArrayBuffer(slots.length * INSTANCE_STRIDE);
  const order = new Uint32Array(slots.length);
  const target = createInstanceRecordTarget(data);
  const values: InstanceRecordValues = { style: defaultStyle, pickId: 0, selected: false };
  let orderLength = 0;
  for (let local = 0; local < slots.length; local += 1) {
    const slot = slots[local];
    if (slot === undefined || slot < 0) continue;
    values.pickId = slot + 1;
    writeInstanceRecord(target, local, options.runtime.instanceWorldTransforms, slot * 16, values);
    if (options.runtime.isInstanceVisible(slot)) order[orderLength++] = local;
  }
  initializeInstancePart(options.draw, partId, data, order, orderLength);
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
  readonly optionalParts?: AttachmentOrderParts;
  readonly previousCalls: AttachmentCallLists;
}): DrawCallLists {
  const activeParts = new Set(
    [...options.parts].filter((partId) => options.layout.partSlots.has(partId)),
  );
  rebuildSurfaceOrders(options, activeParts);
  rebuildEdgeOrders({
    runtime: options.runtime,
    layout: options.layout,
    parts: activeOptionalParts(activeParts, options.optionalParts?.edge),
    flags: options.flags.edgeFlags,
    emphasisFlags: options.flags.edgeEmphasisFlags,
    draw: options.bundle.draw,
  });
  rebuildTransparentOrders(
    options.runtime,
    options.layout,
    activeOptionalParts(activeParts, options.optionalParts?.transparent),
    options.flags.transparentFlags,
    options.bundle.draw,
  );
  writeNodeOrders(
    {
      runtime: options.runtime,
      layout: options.layout,
      parts: options.partDefinitions,
      selection: options.selection,
      interaction: options.interaction,
      bundle: options.bundle,
    },
    activeOptionalParts(activeParts, options.optionalParts?.node),
  );
  syncVisibleSelectionOrders(options.runtime, options.layout, options.interaction, options.bundle, {
    parts: activeParts,
    partDefinitions: options.partDefinitions,
  });
  options.layout.visibleCount = options.runtime.visibleCount;
  return reviseAttachmentCalls(
    options.layout,
    options.previousCalls,
    options.parts,
    options.bundle.draw.cost,
  );
}

function activeOptionalParts(
  active: ReadonlySet<PartId>,
  requested: ReadonlySet<PartId> | undefined,
): ReadonlySet<PartId> {
  return requested === undefined
    ? active
    : new Set([...requested].filter((partId) => active.has(partId)));
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
