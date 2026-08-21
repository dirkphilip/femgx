import type { Part, PartId } from "../../geometry/part";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { GpuBundle } from "../recovery";
import type { DrawCallLists, InstanceLayout } from "../runtime-state";
import { cloneAttachmentFlags, copyAttachmentFlags } from "./reconciliation";
import { changedPartDefinitions, reconcilePartResources } from "../resources/part-resources";
import { destroyPartResources, type DrawResources } from "../resources/draw-resources";
import { invalidateBindGroups, type InstanceStorage } from "../resources/instance-storage";
import { rebuildVisibilitySurface } from "../visibility/skins";
import type { AttachmentInteractionState } from "./interaction";
import { rebuildAttachmentCalls } from "./calls";
import type { PartRevisionResultState } from "./part-revision-results";
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
  revision: {
    readonly interaction: InteractionState;
    readonly bundle: GpuBundle;
    readonly results: PartRevisionResultState | undefined;
  },
): void {
  prepareAddedAttachmentParts(parts, partIds);
  const runtime = attachment.runtime;
  const layout = attachment.layout;
  if (runtime === undefined || layout === undefined) {
    replaceAttachedParts(attachment.attachedParts, parts, partIds);
    attachment.interactionState = revision.interaction;
    attachment.interactionBeforeLastInstanceUpdate = undefined;
    return;
  }
  const prepared = preparePartRevision({
    attachment,
    parts,
    partIds,
    ...revision,
  });
  commitPartRevision(attachment, prepared, partIds, revision.bundle);
}

function preparePartRevision(options: {
  readonly attachment: PartRevisionAttachmentHost;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly partIds: ReadonlySet<PartId>;
  readonly interaction: InteractionState;
  readonly bundle: GpuBundle;
  readonly results: PartRevisionResultState | undefined;
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
    results: options.results,
  });
}

function commitPartRevision(
  attachment: PartRevisionAttachmentHost,
  prepared: PreparedPartRevision,
  partIds: ReadonlySet<PartId>,
  bundle: GpuBundle,
): void {
  const runtime = attachment.runtime;
  if (runtime === undefined) throw new Error("Part revision runtime is unavailable");
  for (const partId of partIds) commitPartResources(bundle.draw, prepared, partId);
  commitPartResults(bundle.draw, prepared, partIds);
  commitStagedWrites(bundle.draw, prepared, partIds);
  replaceAttachedParts(attachment.attachedParts, prepared.parts, partIds);
  copyAttachmentFlags(attachment.styleFlags(), prepared.flags);
  attachment.layout = prepared.layout;
  applyInteractionState(attachment, prepared.interactionState);
  Object.assign(attachment, prepared.calls);
}

function applyInteractionState(
  attachment: PartRevisionAttachmentHost,
  state: AttachmentInteractionState,
): void {
  attachment.interactionState = state.interaction;
  attachment.interactionBeforeLastInstanceUpdate = state.beforeLastInstanceUpdate;
  attachment.appliedHiddenIds = state.appliedHiddenIds;
  attachment.usesExteriorFaceSubsets = state.usesExteriorFaceSubsets;
}

function commitPartResults(
  draw: DrawResources,
  prepared: PreparedPartRevision,
  partIds: ReadonlySet<PartId>,
): void {
  for (const partId of partIds) {
    transferPartResource(draw.deformations, prepared.draw.deformations, partId);
    transferPartResource(draw.resultColors, prepared.draw.resultColors, partId);
    transferPartResource(
      draw.orientationGlyphs.parts,
      prepared.draw.orientationGlyphs.parts,
      partId,
    );
  }
  if (draw.orientationGlyphs.paramsBuffer !== prepared.draw.orientationGlyphs.paramsBuffer) {
    draw.orientationGlyphs.paramsBuffer?.destroy();
    draw.orientationGlyphs.paramsBuffer = prepared.draw.orientationGlyphs.paramsBuffer;
  }
  new Uint8Array(draw.orientationGlyphs.paramsData).set(
    new Uint8Array(prepared.draw.orientationGlyphs.paramsData),
  );
  draw.orientationGlyphs.state = prepared.draw.orientationGlyphs.state;
}

function commitPartResources(
  draw: DrawResources,
  prepared: PreparedPartRevision,
  partId: PartId,
): void {
  destroyPartResources(draw, partId);
  transferStagedPartResources(draw, prepared.draw, partId);
  commitStagedStorage(draw, prepared.draw, partId);
}

function transferStagedPartResources(
  draw: DrawResources,
  staged: DrawResources,
  partId: PartId,
): void {
  transferPartResource(draw.parts, staged.parts, partId);
  transferPartResource(draw.primitiveParts, staged.primitiveParts, partId);
  transferPartResource(draw.nodeParts, staged.nodeParts, partId);
  transferPartResource(draw.visibilitySkins, staged.visibilitySkins, partId);
  transferPartResource(draw.admissionCache, staged.admissionCache, partId);
}

function commitStagedStorage(draw: DrawResources, staged: DrawResources, partId: PartId): void {
  const live = draw.storages.get(partId);
  const prepared = staged.storages.get(partId);
  if (live === undefined || prepared === undefined) return;
  replacePreparedSidecars(live, prepared);
  replacePreparedHighlight(live, prepared);
  live.emphasisSlots = new Set(prepared.emphasisSlots);
  live.edgeEmphasisSlots = new Set(prepared.edgeEmphasisSlots);
  invalidateBindGroups(live, draw.cost);
  new Uint8Array(live.data).set(new Uint8Array(prepared.data));
  live.orderData.set(prepared.orderData);
  live.orderLength = prepared.orderLength;
}

function replacePreparedSidecars(live: InstanceStorage, prepared: InstanceStorage): void {
  for (const kind of ["transparent", "selection", "nodeSelection", "edge", "node"] as const) {
    const previous = live.sidecars[kind];
    const next = prepared.sidecars[kind];
    if (previous !== next) previous?.buffer.destroy();
    live.sidecars[kind] = next;
  }
}

function replacePreparedHighlight(live: InstanceStorage, prepared: InstanceStorage): void {
  if (live.highlight !== prepared.highlight && live.highlightOwned) live.highlight.buffer.destroy();
  live.highlight = prepared.highlight;
  live.highlightOwned = prepared.highlightOwned;
}

function commitStagedWrites(
  draw: DrawResources,
  prepared: PreparedPartRevision,
  partIds: ReadonlySet<PartId>,
): void {
  const liveBuffers = committedStorageBuffers(draw, partIds);
  for (const write of prepared.writes) {
    if (!liveBuffers.has(write.buffer)) continue;
    draw.device.queue.writeBuffer(write.buffer, write.offset, write.data);
  }
}

function committedStorageBuffers(
  draw: DrawResources,
  partIds: ReadonlySet<PartId>,
): Set<GPUBuffer> {
  const buffers = new Set<GPUBuffer>();
  for (const partId of partIds) {
    const storage = draw.storages.get(partId);
    if (storage === undefined) continue;
    buffers.add(storage.buffer);
    buffers.add(storage.orderBuffer);
    for (const sidecar of sidecars(storage)) {
      if (sidecar !== undefined) buffers.add(sidecar.buffer);
    }
    if (storage.highlightOwned) buffers.add(storage.highlight.buffer);
  }
  return buffers;
}

function sidecars(storage: InstanceStorage) {
  return [
    storage.sidecars.transparent,
    storage.sidecars.selection,
    storage.sidecars.nodeSelection,
    storage.sidecars.edge,
    storage.sidecars.node,
  ];
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
