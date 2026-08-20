import type { Part, PartId } from "../../geometry/part";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { GpuBundle } from "../recovery";
import type { DrawCallLists, InstanceLayout } from "../runtime-state";
import { cloneAttachmentFlags, copyAttachmentFlags } from "./reconciliation";
import { changedPartDefinitions, reconcilePartResources } from "../resources/part-resources";
import {
  destroyDetachedInstanceStorage,
  destroyPartResources,
  type DrawResources,
} from "../resources/draw-resources";
import { destroyDetachedVisibilitySkinCache, rebuildVisibilitySurface } from "../visibility/skins";
import { rebuildAttachmentCalls } from "./calls";
import { releasePartDefinitions } from "./occurrences";
import {
  clonePartRevisionLayout,
  prepareStagedPartRevision,
  type PartRevisionAttachmentHost,
  type PreparedPartRevision,
} from "./part-revision-stage";

interface PartAttachmentOptions {
  attachedParts: Map<PartId, Part>;
  readonly runtime: PackedSceneRuntime | undefined;
  readonly layout: InstanceLayout | undefined;
  readonly interaction: InteractionState;
  readonly bundle: GpuBundle;
}

/** Builds lazy semantic metadata for exact added definitions before live mutation. */
export function prepareAddedAttachmentParts(
  parts: ReadonlyMap<PartId, Part>,
  partIds: ReadonlySet<PartId>,
): void {
  for (const partId of partIds) {
    const part = parts.get(partId);
    if (part === undefined) throw new Error(`Added part ${partId} is not registered`);
    getPartSemanticIndex(part);
  }
}

/** Admits exact added definitions without scanning or replacing retained resources. */
export function addAttachmentParts(
  attachedParts: Map<PartId, Part>,
  parts: ReadonlyMap<PartId, Part>,
  partIds: ReadonlySet<PartId>,
): void {
  for (const partId of partIds) {
    const part = parts.get(partId);
    if (part === undefined) throw new Error(`Added part ${partId} is not registered`);
    attachedParts.set(partId, part);
  }
}

/** Applies one definition revision through the existing attached-resource owner. */
export function replaceAttachedPartDefinitions(
  attachment: PartRevisionAttachmentHost,
  parts: ReadonlyMap<PartId, Part>,
  partIds: ReadonlySet<PartId>,
  interaction: InteractionState,
  bundle: GpuBundle,
): void {
  prepareAddedAttachmentParts(parts, partIds);
  const runtime = attachment.runtime;
  const layout = attachment.layout;
  if (runtime === undefined || layout === undefined) {
    replaceAttachedParts(attachment.attachedParts, parts, partIds);
    attachment.interactionState = interaction;
    attachment.interactionBeforeLastInstanceUpdate = undefined;
    return;
  }
  const prepared = preparePartRevision({ attachment, parts, partIds, interaction, bundle });
  commitPartRevision(attachment, prepared, partIds, bundle.draw);
}

function preparePartRevision(options: {
  readonly attachment: PartRevisionAttachmentHost;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly partIds: ReadonlySet<PartId>;
  readonly interaction: InteractionState;
  readonly bundle: GpuBundle;
}): PreparedPartRevision {
  const { attachment, partIds } = options;
  const runtime = attachment.runtime;
  const attachedLayout = attachment.layout;
  if (runtime === undefined || attachedLayout === undefined) {
    throw new Error("Part revisions require an attached renderer runtime");
  }
  const layout = clonePartRevisionLayout(attachedLayout);
  const flags = cloneAttachmentFlags(attachment.styleFlags());
  const parts = new Map(attachment.attachedParts);
  replaceAttachedParts(parts, options.parts, partIds);
  return prepareStagedPartRevision({
    attachment,
    parts,
    partIds,
    interaction: options.interaction,
    bundle: options.bundle,
    runtime,
    layout,
    flags,
  });
}

function commitPartRevision(
  attachment: PartRevisionAttachmentHost,
  prepared: PreparedPartRevision,
  partIds: ReadonlySet<PartId>,
  draw: DrawResources,
): void {
  for (const partId of partIds) commitPartResources(draw, prepared, partId);
  replaceAttachedParts(attachment.attachedParts, prepared.parts, partIds);
  copyAttachmentFlags(attachment.styleFlags(), prepared.flags);
  attachment.layout = prepared.layout;
  attachment.interactionState = prepared.interaction;
  attachment.interactionBeforeLastInstanceUpdate = undefined;
  attachment.appliedHiddenIds = prepared.appliedHiddenIds;
  attachment.usesExteriorFaceSubsets = prepared.usesExteriorFaceSubsets;
  Object.assign(attachment, prepared.calls);
}

function commitPartResources(
  draw: DrawResources,
  prepared: PreparedPartRevision,
  partId: PartId,
): void {
  const previousStorage = prepared.previousStorages.get(partId);
  const previousSkin = prepared.previousSkins.get(partId);
  draw.visibilitySkins.delete(partId);
  destroyPartResources(draw, partId);
  transferStagedPartResources(draw, prepared.draw, partId);
  const nextStorage = prepared.draw.storages.get(partId);
  if (nextStorage === undefined) draw.storages.delete(partId);
  else draw.storages.set(partId, nextStorage);
  const nextSkin = prepared.draw.visibilitySkins.get(partId);
  if (nextSkin === undefined) draw.visibilitySkins.delete(partId);
  else draw.visibilitySkins.set(partId, nextSkin);
  if (previousStorage !== undefined) destroyDetachedInstanceStorage(draw, previousStorage);
  if (previousSkin !== undefined) destroyDetachedVisibilitySkinCache(draw, previousSkin);
}

function transferStagedPartResources(
  draw: DrawResources,
  staged: DrawResources,
  partId: PartId,
): void {
  transferPartResource(draw.parts, staged.parts, partId);
  transferPartResource(draw.primitiveParts, staged.primitiveParts, partId);
  transferPartResource(draw.nodeParts, staged.nodeParts, partId);
  transferPartResource(draw.admissionCache, staged.admissionCache, partId);
}

function transferPartResource<T>(
  target: Map<PartId, T>,
  source: ReadonlyMap<PartId, T>,
  partId: PartId,
): void {
  const resource = source.get(partId);
  if (resource === undefined) target.delete(partId);
  else target.set(partId, resource);
}

function replaceAttachedParts(
  target: Map<PartId, Part>,
  parts: ReadonlyMap<PartId, Part>,
  partIds: ReadonlySet<PartId>,
): void {
  for (const partId of partIds) {
    const part = parts.get(partId);
    if (part === undefined) throw new Error(`Replaced part ${partId} is not registered`);
    target.set(partId, part);
  }
}

/** Reconciles immutable definition resources for a general runtime replacement. */
export function prepareAttachmentParts(
  options: PartAttachmentOptions,
  parts: ReadonlyMap<PartId, Part>,
): { readonly parts: Map<PartId, Part>; readonly calls: DrawCallLists | undefined } {
  const changed = changedPartDefinitions(options.attachedParts, parts);
  changed?.forEach((partId) => {
    options.layout?.partSelectionDrawCalls.delete(partId);
    options.layout?.partSurfaceDrawCalls.delete(partId);
  });
  const next = new Map(reconcilePartResources(options.attachedParts, parts, options.bundle.draw));
  if (changed !== undefined && options.runtime !== undefined && options.layout !== undefined) {
    for (const partId of changed) rebuildPartVisibility(options, next.get(partId));
  }
  for (const partId of changed ?? []) {
    const part = parts.get(partId);
    if (part !== undefined) getPartSemanticIndex(part);
  }
  const calls =
    changed !== undefined && options.runtime !== undefined && options.layout !== undefined
      ? rebuildAttachmentCalls(options.layout, options.bundle.draw.cost)
      : undefined;
  return { parts: next, calls };
}

/** Retires exact removed definitions without scanning the retained registry. */
export function removeAttachmentParts(
  options: PartAttachmentOptions,
  sourceParts: Map<PartId, Part>,
  partIds: ReadonlySet<PartId>,
  rebuildCalls = true,
): DrawCallLists | undefined {
  const removed = releasePartDefinitions({
    ...options,
    sourceParts,
    partIds,
    draw: options.bundle.draw,
  });
  return removed && rebuildCalls
    ? rebuildAttachmentCalls(options.layout, options.bundle.draw.cost)
    : undefined;
}

function rebuildPartVisibility(options: PartAttachmentOptions, part: Part | undefined): void {
  if (part === undefined || options.runtime === undefined || options.layout === undefined) return;
  rebuildVisibilitySurface({
    runtime: options.runtime,
    layout: options.layout,
    part,
    interaction: options.interaction,
    draw: options.bundle.draw,
  });
}
