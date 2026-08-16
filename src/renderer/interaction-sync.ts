import type { Part, PartId } from "../geometry/part";
import { resolveInstanceStyle, type InteractionState } from "../interaction/interaction";
import { diffMapValues, diffNestedSetMembers, diffSetMembers } from "../interaction/mechanics";
import { readInteractionState, type InteractionStateData } from "../interaction/state";
import type { InteractionTarget } from "../interaction/target-types";
import type { InstanceId } from "../scene/types";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { EmphasisUpdates } from "./resources/element-resources";
import { collectEmphasisUpdates } from "./resources/element-resources";
import { syncElementHighlights } from "./selection/highlight-storage";
import { syncInstanceEmphasisAdmission } from "./selection/instance-emphasis";
import { collectDenseElementSelections } from "./selection/element-selection";
import { defaultStyle } from "./resources/foundation";
import type { GpuBundle } from "./recovery";
import { instanceAt, type InstanceLayout } from "./runtime-state";

const THEME_KEYS = [
  "highlighted",
  "selected",
  "hovered",
  "hoveredFace",
  "hoveredNode",
] as const satisfies readonly (keyof InteractionStateData["theme"])[];

export interface TransparencySyncOptions {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly interaction: InteractionState;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly currentFlags: boolean[];
  readonly slotByInstanceId: ReadonlyMap<InstanceId, number>;
  readonly changedSlots: readonly number[];
  readonly affectedParts: ReadonlySet<PartId>;
  readonly emphasisUpdates: EmphasisUpdates;
}

export interface InteractionEmphasisSyncOptions {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly interaction: InteractionState;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly bundle: GpuBundle;
  readonly currentFlags: boolean[];
  readonly slotByInstanceId: ReadonlyMap<InstanceId, number>;
  readonly changedSlots: readonly number[];
  readonly affectedParts: ReadonlySet<PartId>;
}

export interface InteractionElementSyncOptions {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly interaction: InteractionState;
  readonly previousInteraction: InteractionState;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly bundle: GpuBundle;
  readonly attached: boolean;
  readonly fullSync: boolean;
  readonly changedSlots: readonly number[];
}

/** Parts whose order buffers depend on the changed interaction layers. */
export interface InteractionDirtyParts {
  readonly selectionParts: ReadonlySet<PartId>;
  readonly nodeParts: ReadonlySet<PartId>;
}

/** Adds only slots whose element-level state can affect interaction buffers. */
export function interactionAffectedSlots(
  runtime: PackedSceneRuntime,
  previous: InteractionState,
  next: InteractionState,
  changedSlots: readonly number[],
  fullSync: boolean,
): number[] {
  if (fullSync) return Array.from({ length: runtime.instanceCount }, (_, slot) => slot);
  const affected = new Set(changedSlots);
  const previousData = readInteractionState(previous);
  const nextData = readInteractionState(next);
  const addInstance = (instanceId: InstanceId): void => {
    const slot = runtime.getInstanceSlot(instanceId);
    if (slot !== undefined) affected.add(slot);
  };
  diffNestedSetMembers(previousData.selectedBodyIds, nextData.selectedBodyIds, addInstance);
  diffNestedSetMembers(previousData.highlightedBodyIds, nextData.highlightedBodyIds, addInstance);
  diffNestedSetMembers(previousData.hiddenBodyIds, nextData.hiddenBodyIds, addInstance);
  diffNestedSetMembers(previousData.selectedBlockIds, nextData.selectedBlockIds, addInstance);
  diffNestedSetMembers(previousData.highlightedBlockIds, nextData.highlightedBlockIds, addInstance);
  diffNestedSetMembers(previousData.hiddenBlockIds, nextData.hiddenBlockIds, addInstance);
  diffNestedSetMembers(previousData.selectedElementIds, nextData.selectedElementIds, addInstance);
  diffNestedSetMembers(
    previousData.highlightedElementIds,
    nextData.highlightedElementIds,
    addInstance,
  );
  diffNestedSetMembers(previousData.hiddenElementIds, nextData.hiddenElementIds, addInstance);
  diffNestedSetMembers(previousData.selectedNodeIds, nextData.selectedNodeIds, addInstance);
  diffNestedSetMembers(previousData.highlightedNodeIds, nextData.highlightedNodeIds, addInstance);
  diffMapValues(previousData.bodyOverrides, nextData.bodyOverrides, addInstance);
  diffMapValues(previousData.blockOverrides, nextData.blockOverrides, addInstance);
  diffMapValues(previousData.elementOverrides, nextData.elementOverrides, addInstance);
  diffMapValues(previousData.selectedFaces, nextData.selectedFaces, addInstance);
  diffMapValues(previousData.highlightedFaces, nextData.highlightedFaces, addInstance);
  diffMapValues(previousData.selectedEdges, nextData.selectedEdges, addInstance);
  diffMapValues(previousData.highlightedEdges, nextData.highlightedEdges, addInstance);
  addHoveredInstance(previousData.hoveredTarget, addInstance);
  addHoveredInstance(nextData.hoveredTarget, addInstance);
  if (!themesEqual(previousData.theme, nextData.theme)) {
    for (let slot = 0; slot < runtime.instanceCount; slot += 1) affected.add(slot);
  }
  return Array.from(affected).sort((a, b) => a - b);
}

/** Finds the smallest order-buffer scopes for an interaction transition. */
export function interactionDirtyParts(
  runtime: PackedSceneRuntime,
  layout: InstanceLayout,
  previous: InteractionState,
  next: InteractionState,
  fullSync: boolean,
): InteractionDirtyParts {
  if (fullSync) {
    const allParts = new Set(layout.partOrder);
    return { selectionParts: allParts, nodeParts: allParts };
  }
  const selectionParts = new Set<PartId>();
  const nodeParts = new Set<PartId>();
  const previousData = readInteractionState(previous);
  const nextData = readInteractionState(next);
  const addPart = (partId: PartId, destination: Set<PartId>): void => {
    destination.add(partId);
  };
  const addInstance = (instanceId: InstanceId, destination: Set<PartId>): void => {
    const slot = runtime.getInstanceSlot(instanceId);
    const partId = slot === undefined ? undefined : runtime.instancePartIds[slot];
    if (partId !== undefined) destination.add(partId);
  };
  diffSetMembers(previousData.selectedPartIds, nextData.selectedPartIds, (partId) => {
    addPart(partId, selectionParts);
  });
  diffMapValues(previousData.partOverrides, nextData.partOverrides, (partId) => {
    addPart(partId, nodeParts);
  });
  diffMapValues(previousData.instanceOverrides, nextData.instanceOverrides, (instanceId) => {
    addInstance(instanceId, nodeParts);
  });
  diffSetMembers(previousData.selectedInstanceIds, nextData.selectedInstanceIds, (instanceId) => {
    addInstance(instanceId, selectionParts);
  });
  diffNestedSetMembers(previousData.selectedBodyIds, nextData.selectedBodyIds, (instanceId) => {
    addInstance(instanceId, selectionParts);
  });
  diffNestedSetMembers(
    previousData.selectedElementIds,
    nextData.selectedElementIds,
    (instanceId) => {
      addInstance(instanceId, selectionParts);
    },
  );
  diffNestedSetMembers(previousData.selectedBlockIds, nextData.selectedBlockIds, (instanceId) => {
    addInstance(instanceId, selectionParts);
  });
  diffMapValues(previousData.selectedFaces, nextData.selectedFaces, (instanceId) => {
    addInstance(instanceId, selectionParts);
  });
  diffNestedSetMembers(previousData.selectedNodeIds, nextData.selectedNodeIds, (instanceId) => {
    addInstance(instanceId, selectionParts);
    addInstance(instanceId, nodeParts);
  });
  return { selectionParts, nodeParts };
}

/** Updates transparency classification only for slots affected by an interaction transition. */
export function refreshTransparencyFlags(options: TransparencySyncOptions): ReadonlySet<PartId> {
  const emphasisTransparent = new Set<number>();
  for (const [partId, emphasis] of options.emphasisUpdates) {
    if (!options.affectedParts.has(partId)) continue;
    const slots = options.layout.partSlots.get(partId);
    if (slots === undefined) continue;
    for (const update of emphasis) {
      const slot = slots[update.slot];
      if (slot !== undefined && isTransparent(update.style.color.a * update.style.opacity)) {
        emphasisTransparent.add(slot);
      }
    }
  }
  const changed = new Set<PartId>();
  for (const slot of options.changedSlots) {
    if (slot < 0 || slot >= options.runtime.instanceCount) continue;
    const partId = options.runtime.instancePartIds[slot];
    if (partId === undefined) continue;
    const style = resolveInstanceStyle(
      instanceAt(options.runtime, slot, partId),
      defaultStyle,
      options.interaction,
    );
    const next = isTransparent(style.color.a * style.opacity) || emphasisTransparent.has(slot);
    if (next !== options.currentFlags[slot]) changed.add(partId);
    options.currentFlags[slot] = next;
  }
  return changed;
}

/** Derives emphasis once and shares it between highlight and transparency sync. */
export function syncInteractionEmphasis(
  options: InteractionEmphasisSyncOptions,
): ReadonlySet<PartId> {
  const denseSelections = collectDenseElementSelections(
    options.runtime,
    options.layout,
    options.parts,
    options.interaction,
  );
  const emphasisUpdates = collectEmphasisUpdates(
    options.runtime,
    options.layout,
    options.slotByInstanceId,
    {
      parts: options.parts,
      interaction: options.interaction,
      denseSelections,
      edgeKeysByPart: renderedEdgeKeys(options.bundle.draw),
    },
  );
  syncElementHighlights(
    {
      device: options.bundle.device,
      draw: options.bundle.draw,
      runtime: options.runtime,
      layout: options.layout,
      slotByInstanceId: options.slotByInstanceId,
      parts: options.parts,
      denseSelections,
    },
    options.interaction,
    options.affectedParts,
    emphasisUpdates,
  );
  syncInstanceEmphasisAdmission(
    {
      device: options.bundle.device,
      cost: options.bundle.draw.cost,
      storages: options.bundle.draw.storages,
    },
    emphasisUpdates,
    options.affectedParts,
    denseSelections,
  );
  return refreshTransparencyFlags({
    runtime: options.runtime,
    layout: options.layout,
    interaction: options.interaction,
    parts: options.parts,
    currentFlags: options.currentFlags,
    slotByInstanceId: options.slotByInstanceId,
    changedSlots: options.changedSlots,
    affectedParts: options.affectedParts,
    emphasisUpdates,
  });
}

function renderedEdgeKeys(draw: GpuBundle["draw"]): ReadonlyMap<PartId, readonly string[]> {
  const keys = new Map<PartId, readonly string[]>();
  for (const [partId, resources] of draw.primitiveParts) {
    const triangles = resources.get("triangles");
    const edgeKeys = triangles?.edgePick?.edgeKeys ?? triangles?.edge?.edgeKeys;
    if (edgeKeys !== undefined) keys.set(partId, edgeKeys);
  }
  return keys;
}

/** Returns the reusable parts touched by a set of global runtime slots. */
export function partsForSlots(
  runtime: PackedSceneRuntime,
  layout: InstanceLayout,
  slots: readonly number[],
  fullSync: boolean,
): ReadonlySet<PartId> {
  if (fullSync) return new Set(layout.partOrder);
  const parts = new Set<PartId>();
  for (const slot of slots) {
    if (slot < 0 || slot >= runtime.instanceCount) continue;
    const partId = runtime.instancePartIds[slot];
    if (partId !== undefined) parts.add(partId);
  }
  return parts;
}

function isTransparent(alpha: number): boolean {
  return alpha < 1;
}

function addHoveredInstance(
  target: InteractionTarget | undefined,
  addInstance: (instanceId: InstanceId) => void,
): void {
  if (target !== undefined && target.kind !== "part") addInstance(target.instanceId);
}

function themesEqual(
  previous: InteractionStateData["theme"],
  next: InteractionStateData["theme"],
): boolean {
  return THEME_KEYS.every((key) => primitiveStylesEqual(previous[key], next[key]));
}

function primitiveStylesEqual(
  previous: InteractionStateData["theme"][keyof InteractionStateData["theme"]],
  next: InteractionStateData["theme"][keyof InteractionStateData["theme"]],
): boolean {
  return (
    previous.emissive === next.emissive &&
    previous.opacity === next.opacity &&
    previous.color?.r === next.color?.r &&
    previous.color?.g === next.color?.g &&
    previous.color?.b === next.color?.b &&
    previous.color?.a === next.color?.a
  );
}
