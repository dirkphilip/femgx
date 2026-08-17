import type { Part, PartId } from "../../geometry/part";
import { type InteractionState } from "../../interaction/interaction";
import { readInteractionState, type InteractionStateData } from "../../interaction/state";
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
import { rebuildEdgeOrders, rebuildTransparentOrders } from "../attachment-orders";
import { rebuildAttachmentCalls } from "../attachment-calls";

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
}): { readonly changed: boolean; readonly calls: DrawCallLists | undefined } {
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
  return { changed: options.attached || visibilityChanged, calls };
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
    dirtyParts: interactionDirtyParts(
      options.runtime,
      options.layout,
      options.previousInteraction,
      options.interaction,
      options.fullSync,
    ),
  };
}

function updateHiddenState(state: AttachmentInteractionState, data: InteractionStateData): boolean {
  const previous = state.appliedHiddenIds;
  const next: HiddenInteractionTuple = [data.hiddenBodyIds, data.hiddenElementIds];
  state.appliedHiddenIds = next;
  state.usesExteriorFaceSubsets = !hasHiddenInteractionIds(next);
  return previous[0] !== next[0] || previous[1] !== next[1];
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
  });
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
  return { transparentChanged, selectionChanged, edgeChanged };
}
