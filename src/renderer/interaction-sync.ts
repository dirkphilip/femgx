import type { Part, PartId } from "../geometry/part";
import { type InteractionState } from "../interaction/interaction";
import { diffMapValues, diffNestedSetMembers, diffSetMembers } from "../interaction/mechanics";
import {
  readInteractionState,
  readInteractionVisibility,
  type InteractionStateData,
} from "../interaction/state";
import type { InteractionTarget } from "../interaction/target-types";
import type { PartOccurrenceId } from "../scene/types";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { EmphasisUpdates } from "./resources/element-resources";
import { collectEmphasisUpdates } from "./resources/element-resources";
import { syncElementHighlights } from "./selection/highlight-storage";
import { syncInstanceEmphasisAdmission } from "./selection/instance-emphasis";
import type { DenseElementSelections } from "./selection/element-selection";
import type { DenseNodeSelections } from "./selection/node-selection";
import { defaultStyle } from "./resources/foundation";
import type { GpuBundle } from "./recovery";
import { type InstanceLayout } from "./runtime-state";
import { forEachInstanceUnderAssemblyTargets } from "../scene-runtime/interaction-hierarchy";
import { resolveRuntimeInstanceStyle } from "./selection/runtime-instance-style";
import { themesEqual } from "./selection/interaction-theme";

export interface TransparencySyncOptions {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly interaction: InteractionState;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly currentFlags: boolean[];
  readonly slotByInstanceId: ReadonlyMap<PartOccurrenceId, number>;
  readonly changedSlots: readonly number[];
  readonly affectedParts: ReadonlySet<PartId>;
  readonly emphasisUpdates: EmphasisUpdates;
  readonly denseSelections?: DenseElementSelections;
  readonly denseNodeSelections?: DenseNodeSelections;
}

export interface InteractionEmphasisSyncOptions {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly interaction: InteractionState;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly bundle: GpuBundle;
  readonly currentFlags: boolean[];
  readonly slotByInstanceId: ReadonlyMap<PartOccurrenceId, number>;
  readonly changedSlots: readonly number[];
  readonly affectedParts: ReadonlySet<PartId>;
  readonly denseSelections: DenseElementSelections;
  readonly denseVisibility: DenseElementSelections;
  readonly denseNodeSelections: DenseNodeSelections;
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

interface DirtyPartCollectionOptions {
  readonly runtime: PackedSceneRuntime;
  readonly previousData: InteractionStateData;
  readonly nextData: InteractionStateData;
  readonly selectionParts: Set<PartId>;
  readonly nodeParts: Set<PartId>;
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
  const addInstance = (instanceId: PartOccurrenceId): void => {
    const slot = runtime.getInstanceSlot(instanceId);
    if (slot !== undefined) affected.add(slot);
  };
  diffNestedSetMembers(previousData.selectedBodyIds, nextData.selectedBodyIds, addInstance);
  diffNestedSetMembers(previousData.highlightedBodyIds, nextData.highlightedBodyIds, addInstance);
  diffNestedSetMembers(
    readInteractionVisibility(previous).hiddenBodyIds,
    readInteractionVisibility(next).hiddenBodyIds,
    addInstance,
  );
  diffNestedSetMembers(previousData.selectedElementIds, nextData.selectedElementIds, addInstance);
  diffNestedSetMembers(
    previousData.highlightedElementIds,
    nextData.highlightedElementIds,
    addInstance,
  );
  diffNestedSetMembers(
    readInteractionVisibility(previous).hiddenElementIds,
    readInteractionVisibility(next).hiddenElementIds,
    addInstance,
  );
  diffNestedSetMembers(previousData.selectedNodeIds, nextData.selectedNodeIds, addInstance);
  diffNestedSetMembers(previousData.highlightedNodeIds, nextData.highlightedNodeIds, addInstance);
  diffMapValues(previousData.bodyOverrides, nextData.bodyOverrides, addInstance);
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
  collectDirtyParts({ runtime, previousData, nextData, selectionParts, nodeParts });
  return { selectionParts, nodeParts };
}

function collectDirtyParts(options: DirtyPartCollectionOptions): void {
  const { runtime, previousData, nextData, selectionParts, nodeParts } = options;
  const addPart = (partId: PartId, destination: Set<PartId>): void => {
    destination.add(partId);
  };
  const addInstance = (instanceId: PartOccurrenceId, destination: Set<PartId>): void => {
    const slot = runtime.getInstanceSlot(instanceId);
    const partId = slot === undefined ? undefined : runtime.instancePartIds[slot];
    if (partId !== undefined) destination.add(partId);
  };
  diffSetMembers(previousData.selectedPartIds, nextData.selectedPartIds, (partId) => {
    addPart(partId, selectionParts);
  });
  addAssemblyParts({
    runtime,
    previousAssemblyIds: previousData.selectedAssemblyIds,
    previousOccurrenceIds: previousData.selectedAssemblyOccurrenceIds,
    nextAssemblyIds: nextData.selectedAssemblyIds,
    nextOccurrenceIds: nextData.selectedAssemblyOccurrenceIds,
    parts: selectionParts,
  });
  diffMapValues(previousData.partOverrides, nextData.partOverrides, (partId) => {
    addPart(partId, nodeParts);
  });
  diffMapValues(
    previousData.partOccurrenceOverrides,
    nextData.partOccurrenceOverrides,
    (instanceId) => {
      addInstance(instanceId, nodeParts);
    },
  );
  diffSetMembers(
    previousData.selectedPartOccurrenceIds,
    nextData.selectedPartOccurrenceIds,
    (instanceId) => {
      addInstance(instanceId, selectionParts);
    },
  );
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
  diffMapValues(previousData.selectedFaces, nextData.selectedFaces, (instanceId) => {
    addInstance(instanceId, selectionParts);
  });
  diffNestedSetMembers(previousData.selectedNodeIds, nextData.selectedNodeIds, (instanceId) => {
    addInstance(instanceId, selectionParts);
    addInstance(instanceId, nodeParts);
  });
}

/** Updates transparency classification only for slots affected by an interaction transition. */
export function refreshTransparencyFlags(options: TransparencySyncOptions): ReadonlySet<PartId> {
  const emphasisTransparent = new Set<number>();
  for (const [partId, emphasis] of options.emphasisUpdates) {
    if (!options.affectedParts.has(partId)) continue;
    const slots = options.layout.partLocalSlots.get(partId);
    if (slots === undefined) continue;
    for (const update of emphasis) {
      const slot = slots[update.slot];
      if (
        slot !== undefined &&
        slot >= 0 &&
        isTransparent(update.style.color.a * update.style.opacity)
      ) {
        emphasisTransparent.add(slot);
      }
    }
  }
  if (selectionThemeIsTransparent(options.interaction)) {
    addDenseTransparencySlots(options, emphasisTransparent);
  }
  const changed = new Set<PartId>();
  for (const slot of options.changedSlots) {
    if (slot < 0 || slot >= options.runtime.instanceCount) continue;
    const partId = options.runtime.instancePartIds[slot];
    if (partId === undefined) continue;
    const style = resolveRuntimeInstanceStyle(
      options.runtime,
      slot,
      defaultStyle,
      options.interaction,
    );
    const next = isTransparent(style.color.a * style.opacity) || emphasisTransparent.has(slot);
    if (next !== options.currentFlags[slot]) changed.add(partId);
    options.currentFlags[slot] = next;
  }
  return changed;
}

function addAssemblyParts(options: {
  readonly runtime: PackedSceneRuntime;
  readonly previousAssemblyIds: ReadonlySet<number>;
  readonly previousOccurrenceIds: ReadonlySet<string>;
  readonly nextAssemblyIds: ReadonlySet<number>;
  readonly nextOccurrenceIds: ReadonlySet<string>;
  readonly parts: Set<PartId>;
}): void {
  const {
    runtime,
    previousAssemblyIds,
    previousOccurrenceIds,
    nextAssemblyIds,
    nextOccurrenceIds,
    parts,
  } = options;
  const add = (assemblyIds: ReadonlySet<number>, occurrenceIds: ReadonlySet<string>): void => {
    forEachInstanceUnderAssemblyTargets(runtime, assemblyIds, occurrenceIds, (slot) => {
      const partId = runtime.instancePartIds[slot];
      if (partId !== undefined) parts.add(partId);
    });
  };
  add(previousAssemblyIds, previousOccurrenceIds);
  add(nextAssemblyIds, nextOccurrenceIds);
}

function selectionThemeIsTransparent(interaction: InteractionState): boolean {
  const theme = readInteractionState(interaction).theme.selected;
  return (theme.color?.a ?? 1) < 1 || (theme.opacity ?? 1) < 1;
}

function addDenseTransparencySlots(
  options: TransparencySyncOptions,
  destination: Set<number>,
): void {
  const addSelections = (
    selections: DenseElementSelections | DenseNodeSelections | undefined,
  ): void => {
    for (const [partId, selection] of selections ?? []) {
      if (!options.affectedParts.has(partId)) continue;
      const slots = options.layout.partLocalSlots.get(partId);
      if (slots === undefined) continue;
      for (const occurrence of selection.occurrences) {
        const slot = slots[occurrence.slot];
        if (slot !== undefined && slot >= 0) destination.add(slot);
      }
    }
  };
  addSelections(options.denseSelections);
  addSelections(options.denseNodeSelections);
}

/** Derives emphasis once and shares it between highlight and transparency sync. */
export function syncInteractionEmphasis(
  options: InteractionEmphasisSyncOptions,
): ReadonlySet<PartId> {
  const emphasisUpdates = collectEmphasisUpdates(
    options.runtime,
    options.layout,
    options.slotByInstanceId,
    {
      parts: options.parts,
      interaction: options.interaction,
      denseSelections: options.denseSelections,
      denseHidden: options.denseVisibility,
      denseNodeSelections: options.denseNodeSelections,
      edgeKeysByPart: renderedEdgeKeys(options.bundle.draw, options.affectedParts),
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
      denseSelections: options.denseSelections,
      denseVisibility: options.denseVisibility,
      denseNodeSelections: options.denseNodeSelections,
    },
    options.interaction,
    options.affectedParts,
    emphasisUpdates,
  );
  syncInstanceEmphasisAdmission(
    {
      writePort: options.bundle.draw.writePort,
      cost: options.bundle.draw.cost,
      storages: options.bundle.draw.storages,
    },
    emphasisUpdates,
    options.affectedParts,
    {
      elements: options.denseSelections,
      nodes: options.denseNodeSelections,
      hidden: options.denseVisibility,
    },
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
    denseSelections: options.denseSelections,
    denseNodeSelections: options.denseNodeSelections,
  });
}

function renderedEdgeKeys(
  draw: GpuBundle["draw"],
  affectedParts: ReadonlySet<PartId>,
): ReadonlyMap<PartId, readonly string[]> {
  const keys = new Map<PartId, readonly string[]>();
  for (const partId of affectedParts) {
    const resources = draw.primitiveParts.get(partId);
    if (resources === undefined) continue;
    const triangles = resources.get("triangles");
    const edgeKeys = triangles?.edgePick?.edgeKeys ?? triangles?.edge?.edgeKeys;
    if (edgeKeys !== undefined) keys.set(partId, edgeKeys);
  }
  return keys;
}

/** Returns whether any body or element visibility set has members. */
export function hasHiddenInteractionIds(
  hidden: readonly (ReadonlyMap<string, ReadonlySet<number>> | undefined)[],
): boolean {
  return hidden.some((byInstance) => [...(byInstance?.values() ?? [])].some((ids) => ids.size > 0));
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
  addInstance: (instanceId: PartOccurrenceId) => void,
): void {
  if (
    target !== undefined &&
    target.kind !== "part" &&
    target.kind !== "assembly" &&
    target.kind !== "assemblyOccurrence"
  ) {
    addInstance(target.partOccurrenceId);
  }
}
