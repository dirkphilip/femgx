import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { GpuBundle } from "../recovery";
import type { DrawCallLists, InstanceLayout } from "../runtime-state";
import {
  cloneInstanceStorage,
  destroyDetachedInstanceStorage,
  destroyPartResources,
  type DrawResources,
  type InstanceStorage,
  uploadGeometryPart,
} from "../resources/draw-resources";
import { destroyDetachedVisibilitySkinCache, rebuildVisibilitySurface } from "../visibility/skins";
import type { VisibilitySkinCache } from "../visibility/types";
import { reviseAttachmentCalls, type AttachmentCallLists } from "./calls";
import type { HiddenInteractionTuple } from "./interaction";
import { syncAttachmentInteraction } from "./interaction";
import type { AttachmentFlagState } from "./reconciliation";
import type { SelectionState } from "../selection-state";

/** Mutable attachment state shared with a transaction-local part-revision stage. */
export interface PartRevisionAttachmentHost extends AttachmentCallLists {
  interactionState: InteractionState;
  interactionBeforeLastInstanceUpdate: InteractionState | undefined;
  readonly attachedParts: Map<PartId, Part>;
  readonly runtime: PackedSceneRuntime | undefined;
  layout: InstanceLayout | undefined;
  readonly selection: SelectionState;
  readonly slotByInstanceId: ReadonlyMap<string, number>;
  appliedHiddenIds: HiddenInteractionTuple;
  usesExteriorFaceSubsets: boolean;
  styleFlags(): AttachmentFlagState;
}

/** All allocations and CPU mirrors prepared before a definition revision commits. */
export interface PreparedPartRevision {
  readonly draw: DrawResources;
  readonly layout: InstanceLayout;
  readonly parts: Map<PartId, Part>;
  readonly flags: AttachmentFlagState;
  readonly interaction: InteractionState;
  readonly appliedHiddenIds: HiddenInteractionTuple;
  readonly usesExteriorFaceSubsets: boolean;
  readonly calls: DrawCallLists;
  readonly previousStorages: ReadonlyMap<PartId, InstanceStorage | undefined>;
  readonly previousSkins: ReadonlyMap<PartId, VisibilitySkinCache | undefined>;
}

/** Clones all fallible revised resources and interaction state before a live swap. */
export function prepareStagedPartRevision(options: {
  readonly attachment: PartRevisionAttachmentHost;
  readonly parts: Map<PartId, Part>;
  readonly partIds: ReadonlySet<PartId>;
  readonly interaction: InteractionState;
  readonly bundle: GpuBundle;
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly flags: AttachmentFlagState;
}): PreparedPartRevision {
  const draw = stageDrawResources(options.bundle.draw, options.partIds);
  const previousStorages = rememberedStorages(options.bundle.draw, options.partIds);
  const previousSkins = rememberedSkins(options.bundle.draw, options.partIds);
  try {
    return stagePartRevision({ ...options, draw, previousStorages, previousSkins });
  } catch (error) {
    discardStagedPartResources(draw, previousStorages, previousSkins, options.partIds);
    throw error;
  }
}

/** Copies the slot maps whose revision-local changes must never affect the live attachment. */
export function clonePartRevisionLayout(layout: InstanceLayout): InstanceLayout {
  return {
    ...layout,
    partVisibleCounts: new Map(layout.partVisibleCounts),
    partEdgeCounts: new Map(layout.partEdgeCounts),
    partNodeCounts: new Map(layout.partNodeCounts),
    partTransparentCounts: new Map(layout.partTransparentCounts),
    partSelectionCounts: new Map(layout.partSelectionCounts),
    partSelectedNodeCounts: new Map(layout.partSelectedNodeCounts),
    partSelectionDrawCalls: new Map(layout.partSelectionDrawCalls),
    partSurfaceDrawCalls: new Map(layout.partSurfaceDrawCalls),
  };
}

function stagePartRevision(options: {
  readonly attachment: PartRevisionAttachmentHost;
  readonly parts: Map<PartId, Part>;
  readonly partIds: ReadonlySet<PartId>;
  readonly interaction: InteractionState;
  readonly bundle: GpuBundle;
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly flags: AttachmentFlagState;
  readonly draw: DrawResources;
  readonly previousStorages: ReadonlyMap<PartId, InstanceStorage | undefined>;
  readonly previousSkins: ReadonlyMap<PartId, VisibilitySkinCache | undefined>;
}): PreparedPartRevision {
  cloneRevisionStorages(options.bundle.draw, options.draw, options.partIds);
  stagePartGeometry(
    options.draw,
    options.parts,
    options.partIds,
    options.attachment.usesExteriorFaceSubsets,
  );
  const state = stagedInteractionState(options);
  const result = syncAttachmentInteraction({
    state,
    runtime: options.runtime,
    layout: options.layout,
    interaction: options.interaction,
    parts: options.parts,
    bundle: { ...options.bundle, draw: options.draw },
    attached: false,
    fullSync: false,
    changedSlots: partRevisionSlots(options.runtime, options.partIds),
    forceParts: options.partIds,
  });
  rebuildStagedVisibility(options, result.visibilityParts);
  return {
    ...options,
    interaction: state.interaction,
    appliedHiddenIds: state.appliedHiddenIds,
    usesExteriorFaceSubsets: state.usesExteriorFaceSubsets,
    calls: reviseAttachmentCalls(
      options.layout,
      options.attachment,
      options.partIds,
      options.draw.cost,
    ),
  };
}

function stagePartGeometry(
  draw: DrawResources,
  parts: ReadonlyMap<PartId, Part>,
  partIds: ReadonlySet<PartId>,
  preferSubset: boolean,
): void {
  for (const partId of partIds) {
    const part = parts.get(partId);
    if (part === undefined) continue;
    for (const geometry of part.geometries) uploadGeometryPart(draw, part, geometry, preferSubset);
  }
}

function cloneRevisionStorages(
  draw: DrawResources,
  staged: DrawResources,
  partIds: ReadonlySet<PartId>,
): void {
  for (const partId of partIds) {
    const storage = draw.storages.get(partId);
    if (storage !== undefined) staged.storages.set(partId, cloneInstanceStorage(staged, storage));
  }
}

function stagedInteractionState(options: {
  readonly attachment: PartRevisionAttachmentHost;
  readonly interaction: InteractionState;
  readonly flags: AttachmentFlagState;
}) {
  return {
    interaction: options.interaction,
    beforeLastInstanceUpdate: undefined,
    appliedHiddenIds: options.attachment.appliedHiddenIds,
    usesExteriorFaceSubsets: options.attachment.usesExteriorFaceSubsets,
    transparentFlags: options.flags.transparentFlags,
    edgeFlags: options.flags.edgeFlags,
    edgeEmphasisFlags: options.flags.edgeEmphasisFlags,
    slotByInstanceId: options.attachment.slotByInstanceId,
    selection: {
      selectedNodeFlags: options.flags.selectedNodeFlags,
      nodeFlags: options.flags.nodeFlags,
    },
  };
}

function rebuildStagedVisibility(
  options: {
    readonly runtime: PackedSceneRuntime;
    readonly layout: InstanceLayout;
    readonly parts: ReadonlyMap<PartId, Part>;
    readonly interaction: InteractionState;
    readonly draw: DrawResources;
  },
  partIds: Iterable<PartId> | undefined,
): void {
  for (const partId of partIds ?? []) {
    const part = options.parts.get(partId);
    if (part !== undefined) rebuildVisibilitySurface({ ...options, part });
  }
}

function stageDrawResources(draw: DrawResources, partIds: ReadonlySet<PartId>): DrawResources {
  const staged = {
    ...draw,
    parts: new Map(draw.parts),
    primitiveParts: new Map(draw.primitiveParts),
    nodeParts: new Map(draw.nodeParts),
    storages: new Map(draw.storages),
    visibilitySkins: new Map(draw.visibilitySkins),
    admissionCache: new Map(draw.admissionCache),
  };
  for (const partId of partIds) {
    staged.parts.delete(partId);
    staged.primitiveParts.delete(partId);
    staged.nodeParts.delete(partId);
    staged.visibilitySkins.delete(partId);
    staged.admissionCache.delete(partId);
  }
  return staged;
}

function discardStagedPartResources(
  draw: DrawResources,
  previousStorages: ReadonlyMap<PartId, InstanceStorage | undefined>,
  previousSkins: ReadonlyMap<PartId, VisibilitySkinCache | undefined>,
  partIds: ReadonlySet<PartId>,
): void {
  for (const partId of partIds) {
    destroyPartResources(draw, partId);
    const storage = draw.storages.get(partId);
    if (storage !== undefined && storage !== previousStorages.get(partId)) {
      destroyDetachedInstanceStorage(draw, storage);
    }
    const skin = draw.visibilitySkins.get(partId);
    if (skin !== undefined && skin !== previousSkins.get(partId)) {
      destroyDetachedVisibilitySkinCache(draw, skin);
    }
  }
}

function rememberedStorages(
  draw: DrawResources,
  partIds: ReadonlySet<PartId>,
): ReadonlyMap<PartId, InstanceStorage | undefined> {
  return rememberedResources(draw.storages, partIds);
}

function rememberedSkins(
  draw: DrawResources,
  partIds: ReadonlySet<PartId>,
): ReadonlyMap<PartId, VisibilitySkinCache | undefined> {
  return rememberedResources(draw.visibilitySkins, partIds);
}

function rememberedResources<T>(
  resources: ReadonlyMap<PartId, T>,
  partIds: ReadonlySet<PartId>,
): ReadonlyMap<PartId, T | undefined> {
  const remembered = new Map<PartId, T | undefined>();
  for (const partId of partIds) remembered.set(partId, resources.get(partId));
  return remembered;
}

function partRevisionSlots(
  runtime: PackedSceneRuntime,
  partIds: ReadonlySet<PartId>,
): readonly number[] {
  const slots: number[] = [];
  for (const partId of partIds) slots.push(...runtime.getPartInstanceSlots(partId));
  return slots;
}
