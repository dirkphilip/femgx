import type { Part, PartId } from "../../geometry/part";
import { type InteractionState } from "../../interaction/interaction";
import { readInteractionVisibility } from "../../interaction/state";
import { diffNestedSetMembers } from "../../interaction/mechanics";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { PartOccurrenceId } from "../../scene/types";
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
import {
  collectDenseElementSelections,
  collectDenseHiddenElements,
  invalidateDenseElementSelectionCaches,
} from "../selection/element-selection";
import {
  collectDenseNodeSelections,
  invalidateDenseNodeSelectionCache,
} from "../selection/node-selection";
import { rebuildEdgeOrders, rebuildTransparentOrders } from "./orders";
import { rebuildAttachmentCalls } from "./calls";
import { rebuildVisibilitySurface } from "../visibility/skins";

export type HiddenInteractionIds = ReadonlyMap<string, ReadonlySet<number>> | undefined;
export type HiddenInteractionTuple = readonly [HiddenInteractionIds, HiddenInteractionIds];

export interface AttachmentInteractionState {
  interaction: InteractionState;
  beforeLastInstanceUpdate: InteractionState | undefined;
  appliedHiddenIds: HiddenInteractionTuple;
  usesExteriorFaceSubsets: boolean;
  transparentFlags: boolean[];
  edgeFlags: boolean[];
  edgeEmphasisFlags: boolean[];
  edgesVisible: boolean;
  nodesVisible: boolean;
  slotByInstanceId: ReadonlyMap<PartOccurrenceId, number>;
  selection: SelectionState;
}

/** Refreshes exact emphasis buffers after an in-place occurrence mutation. */
export function syncOccurrenceInteractionEmphasis(options: {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly interaction: InteractionState;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly bundle: GpuBundle;
  readonly transparentFlags: boolean[];
  readonly slotByInstanceId: ReadonlyMap<PartOccurrenceId, number>;
  readonly changedSlots: readonly number[];
  readonly affectedParts: ReadonlySet<PartId>;
}): void {
  invalidateDenseElementSelectionCaches(options.runtime, options.layout);
  invalidateDenseNodeSelectionCache(options.runtime, options.layout);
  const { denseSelections, denseNodeSelections, denseVisibility } = denseMemberships(options);
  syncInteractionEmphasis({
    runtime: options.runtime,
    layout: options.layout,
    interaction: options.interaction,
    parts: options.parts,
    bundle: options.bundle,
    currentFlags: options.transparentFlags,
    slotByInstanceId: options.slotByInstanceId,
    changedSlots: options.changedSlots,
    affectedParts: options.affectedParts,
    denseSelections,
    denseVisibility,
    denseNodeSelections,
  });
}

/** Rebuilds visibility skins for the exact parts changed by interaction. */
export function rebuildInteractionVisibilitySurfaces(options: {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly parts: ReadonlySet<PartId>;
  readonly attachedParts: ReadonlyMap<PartId, Part>;
  readonly interaction: InteractionState;
  readonly bundle: GpuBundle;
}): DrawCallLists {
  for (const partId of options.parts) {
    const part = options.attachedParts.get(partId);
    if (part === undefined) continue;
    rebuildVisibilitySurface({
      runtime: options.runtime,
      layout: options.layout,
      part,
      interaction: options.interaction,
      draw: options.bundle.draw,
    });
  }
  return rebuildAttachmentCalls(options.layout, options.bundle.draw.cost);
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
  readonly forceParts?: ReadonlySet<PartId>;
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
  const visibilityChanged = updateHiddenState(state, options.interaction);
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
    nodesVisible: state.nodesVisible,
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
  readonly forceParts?: ReadonlySet<PartId>;
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
  const forced = options.forceParts ?? new Set<PartId>();
  return {
    slots,
    affectedParts: withForcedParts(
      partsForSlots(options.runtime, options.layout, slots, options.fullSync),
      forced,
    ),
    visibilityParts: withForcedParts(visibilityAffectedParts(options), forced),
    dirtyParts: forceDirtyParts(
      interactionDirtyParts(
        options.runtime,
        options.layout,
        options.previousInteraction,
        options.interaction,
        options.fullSync,
      ),
      forced,
    ),
  };
}

function withForcedParts(
  current: ReadonlySet<PartId>,
  forced: ReadonlySet<PartId>,
): ReadonlySet<PartId> {
  return forced.size === 0 ? current : new Set([...current, ...forced]);
}

function forceDirtyParts(
  current: ReturnType<typeof interactionDirtyParts>,
  forced: ReadonlySet<PartId>,
): ReturnType<typeof interactionDirtyParts> {
  if (forced.size === 0) return current;
  return {
    selectionParts: new Set([...current.selectionParts, ...forced]),
    nodeParts: new Set([...current.nodeParts, ...forced]),
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
  const previous = readInteractionVisibility(options.previousInteraction);
  const next = readInteractionVisibility(options.interaction);
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

function updateHiddenState(
  state: AttachmentInteractionState,
  interaction: InteractionState,
): boolean {
  const previous = state.appliedHiddenIds;
  const visibility = readInteractionVisibility(interaction);
  const next: HiddenInteractionTuple = [visibility.hiddenBodyIds, visibility.hiddenElementIds];
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
  readonly nodesVisible: boolean;
  readonly fullSync: boolean;
  readonly state: AttachmentInteractionState;
}): {
  transparentChanged: ReadonlySet<PartId>;
  selectionChanged: boolean;
  edgeChanged: ReadonlySet<PartId>;
} {
  const { denseSelections, denseNodeSelections, denseVisibility } = denseMemberships(options);
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
    denseVisibility,
    denseNodeSelections,
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
    nodesVisible: options.nodesVisible,
    changedInstanceIds: options.fullSync ? undefined : options.changedSlots,
    denseSelections,
    denseNodeSelections,
  });
  const edgeChanged = syncEdgeBuffers(options);
  return { transparentChanged, selectionChanged, edgeChanged };
}

function denseMemberships(
  options: Pick<Parameters<typeof syncBuffers>[0], "runtime" | "layout" | "parts" | "interaction">,
) {
  const args = [options.runtime, options.layout, options.parts, options.interaction] as const;
  return {
    denseSelections: collectDenseElementSelections(...args),
    denseNodeSelections: collectDenseNodeSelections(...args),
    denseVisibility: collectDenseHiddenElements(...args),
  };
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
      visible: options.state.edgesVisible,
      draw: options.bundle.draw,
    });
  }
  return edgeChanged;
}
