import type { Part, PartId } from "../../geometry/part";
import { type InteractionState } from "../../interaction/interaction";
import { readInteractionState, type InteractionStateData } from "../../interaction/state";
import { diffNestedSetMembers } from "../../interaction/mechanics";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { InstanceId } from "../../scene/types";
import type { GpuBundle } from "../recovery";
import type { DrawCallLists, InstanceLayout } from "../runtime-state";
import {
  interactionAffectedSlots,
  interactionDirtyParts,
  hasHiddenInteractionIds,
  partsForSlots,
  syncInteractionEmphasis,
} from "../interaction-sync";
import { syncEdgeEmphasisFlags } from "../edges/emphasis-sync";
import { syncSelectionState, type SelectionState } from "../selection-state";
import { collectDenseElementSelections } from "../selection/element-selection";
import { rebuildEdgeOrders, rebuildTransparentOrders } from "./orders";
import { rebuildAttachmentCalls } from "./calls";

type HiddenInteractionIds = ReadonlyMap<string, ReadonlySet<number>> | undefined;
type HiddenInteractionTuple = readonly [HiddenInteractionIds, HiddenInteractionIds];

export interface AttachmentInteractionState {
  interaction: InteractionState;
  beforeLastInstanceUpdate: InteractionState | undefined;
  appliedHiddenIds: HiddenInteractionTuple;
  usesExteriorFaceSubsets: boolean;
  transparentFlags: boolean[];
  edgeFlags: boolean[];
  edgeEmphasisFlags: boolean[];
  slotByInstanceId: ReadonlyMap<InstanceId, number>;
  selection: SelectionState;
}

/** Synchronizes element, selection, emphasis, and hidden-visibility state. */
export function syncAttachmentInteraction(options: {
  readonly state: AttachmentInteractionState;
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly interaction: InteractionState;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly bundle: GpuBundle;
  readonly attached: boolean;
  readonly fullSync: boolean;
  readonly changedSlots: readonly number[];
}): {
  readonly changed: boolean;
  readonly calls: DrawCallLists | undefined;
  readonly visibilityParts?: ReadonlySet<PartId>;
} {
  const state = options.state;
  const previousInteraction = state.beforeLastInstanceUpdate ?? state.interaction;
  const scope = interactionScope({ ...options, previousInteraction });
  const interactionSlots = scope.slots;
  options.bundle.draw.cost.cpu("instance-scan", interactionSlots.length);
  const interactionData = readInteractionState(options.interaction);
  const visibilityChanged = updateHiddenState(state, interactionData);
  const { transparentChanged, selectionChanged, edgeChanged } = syncBuffers({
    runtime: options.runtime,
    layout: options.layout,
    interaction: options.interaction,
    parts: options.parts,
    bundle: options.bundle,
    changedSlots: interactionSlots,
    affectedParts: scope.affectedParts,
    selectionParts: scope.dirtyParts.selectionParts,
    nodeParts: scope.dirtyParts.nodeParts,
    fullSync: options.fullSync,
    state,
  });
  if (transparentChanged.size > 0) {
    rebuildTransparentOrders(
      options.runtime,
      options.layout,
      transparentChanged,
      state.transparentFlags,
      options.bundle.draw,
    );
  }
  const calls =
    transparentChanged.size > 0 || selectionChanged || edgeChanged.size > 0
      ? rebuildAttachmentCalls(options.layout, options.bundle.draw.cost)
      : undefined;
  state.interaction = options.interaction;
  state.beforeLastInstanceUpdate = undefined;
  return {
    changed: options.attached || visibilityChanged,
    calls,
    ...(visibilityChanged && scope.visibilityParts.size > 0
      ? { visibilityParts: scope.visibilityParts }
      : {}),
  };
}

function interactionScope(options: {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly interaction: InteractionState;
  readonly previousInteraction: InteractionState;
  readonly fullSync: boolean;
  readonly changedSlots: readonly number[];
}): {
  readonly slots: readonly number[];
  readonly affectedParts: ReadonlySet<PartId>;
  readonly visibilityParts: ReadonlySet<PartId>;
  readonly dirtyParts: ReturnType<typeof interactionDirtyParts>;
} {
  const slots = interactionAffectedSlots(
    options.runtime,
    options.previousInteraction,
    options.interaction,
    options.changedSlots,
    options.fullSync,
  );
  return {
    slots,
    affectedParts: partsForSlots(options.runtime, options.layout, slots, options.fullSync),
    visibilityParts: visibilityAffectedParts(options),
    dirtyParts: interactionDirtyParts(
      options.runtime,
      options.layout,
      options.previousInteraction,
      options.interaction,
      options.fullSync,
    ),
  };
}

function visibilityAffectedParts(options: {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly previousInteraction: InteractionState;
  readonly interaction: InteractionState;
  readonly fullSync: boolean;
  readonly changedSlots: readonly number[];
}): ReadonlySet<PartId> {
  if (options.fullSync) return new Set(options.layout.partOrder);
  const slots = new Set(options.changedSlots);
  const previous = readInteractionState(options.previousInteraction);
  const next = readInteractionState(options.interaction);
  const addInstance = (instanceId: string): void => {
    const slot = options.runtime.getInstanceSlot(instanceId);
    if (slot !== undefined) slots.add(slot);
  };
  diffNestedSetMembers(previous.hiddenBodyIds, next.hiddenBodyIds, addInstance);
  diffNestedSetMembers(previous.hiddenElementIds, next.hiddenElementIds, addInstance);
  const hiddenChanged =
    previous.hiddenBodyIds !== next.hiddenBodyIds ||
    previous.hiddenElementIds !== next.hiddenElementIds;
  return hiddenChanged
    ? partsForSlots(options.runtime, options.layout, [...slots], false)
    : new Set();
}

function updateHiddenState(state: AttachmentInteractionState, data: InteractionStateData): boolean {
  const previous = state.appliedHiddenIds;
  const next: HiddenInteractionTuple = [data.hiddenBodyIds, data.hiddenElementIds];
  state.appliedHiddenIds = next;
  state.usesExteriorFaceSubsets = !hasHiddenInteractionIds(next);
  return !hiddenIdsEqual(previous[0], next[0]) || !hiddenIdsEqual(previous[1], next[1]);
}

function hiddenIdsEqual(previous: HiddenInteractionIds, next: HiddenInteractionIds): boolean {
  if (previous === next) return true;
  if (previous === undefined || next === undefined) {
    return (previous?.size ?? 0) === 0 && (next?.size ?? 0) === 0;
  }
  if (previous.size !== next.size) return false;
  for (const [instanceId, previousIds] of previous) {
    const nextIds = next.get(instanceId);
    if (nextIds === undefined || nextIds.size !== previousIds.size) return false;
    for (const id of previousIds) if (!nextIds.has(id)) return false;
  }
  return true;
}

function syncBuffers(options: {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly interaction: InteractionState;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly bundle: GpuBundle;
  readonly changedSlots: readonly number[];
  readonly affectedParts: ReadonlySet<PartId>;
  readonly selectionParts: ReadonlySet<PartId>;
  readonly nodeParts: ReadonlySet<PartId>;
  readonly fullSync: boolean;
  readonly state: AttachmentInteractionState;
}): {
  transparentChanged: ReadonlySet<PartId>;
  selectionChanged: boolean;
  edgeChanged: ReadonlySet<PartId>;
} {
  const denseSelections = collectDenseElementSelections(
    options.runtime,
    options.layout,
    options.parts,
    options.interaction,
  );
  const transparentChanged = syncInteractionEmphasis({
    runtime: options.runtime,
    layout: options.layout,
    interaction: options.interaction,
    parts: options.parts,
    bundle: options.bundle,
    currentFlags: options.state.transparentFlags,
    slotByInstanceId: options.state.slotByInstanceId,
    changedSlots: options.changedSlots,
    affectedParts: options.affectedParts,
    denseSelections,
  });
  const selectionChanged = syncSelectionState({
    runtime: options.runtime,
    layout: options.layout,
    interaction: options.interaction,
    parts: options.parts,
    selection: options.state.selection,
    bundle: options.bundle,
    selectionParts: options.selectionParts,
    nodeParts: options.nodeParts,
    changedInstanceIds: options.fullSync ? undefined : options.changedSlots,
    denseSelections,
  });
  const edgeChanged = syncEdgeBuffers(options);
  return { transparentChanged, selectionChanged, edgeChanged };
}

function syncEdgeBuffers(options: {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly affectedParts: ReadonlySet<PartId>;
  readonly state: AttachmentInteractionState;
  readonly bundle: GpuBundle;
}): ReadonlySet<PartId> {
  const edgeChanged = syncEdgeEmphasisFlags(
    options.layout,
    options.bundle,
    options.affectedParts,
    options.state.edgeEmphasisFlags,
  );
  if (edgeChanged.size > 0) {
    rebuildEdgeOrders({
      runtime: options.runtime,
      layout: options.layout,
      parts: edgeChanged,
      flags: options.state.edgeFlags,
      emphasisFlags: options.state.edgeEmphasisFlags,
      draw: options.bundle.draw,
    });
  }
  return edgeChanged;
}
