import type { Part, PartId } from "../../geometry/part";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { GpuBundle } from "../recovery";
import type { DrawCallLists, InstanceLayout } from "../runtime-state";
import { changedPartDefinitions, reconcilePartResources } from "../resources/part-resources";
import { destroyPartResources, type DrawResources } from "../resources/draw-resources";
import type { InstanceStorage } from "../resources/instance-storage";
import type { GpuCostAccumulator } from "../diagnostics/cost";
import { rebuildInteractionVisibilitySurfaces } from "./interaction";
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
import { discardStagedPartResources } from "./part-revision-cleanup";
import { PartRevisionMap, stagePartRevisionFlagSet } from "./part-revision-overlay";

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
  cost?: GpuCostAccumulator,
): void {
  for (const partId of partIds) {
    const part = parts.get(partId);
    if (part === undefined) throw new Error(`Added part ${partId} is not registered`);
    getPartSemanticIndex(part);
    cost?.cpu("definition-validation", 1);
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

/** Prepares an attached definition revision without mutating its live owner. */
export function preparePartRevision(options: {
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
  const flags = stagePartRevisionFlagSet(attachment.styleFlags());
  const parts = new PartRevisionMap(attachment.attachedParts);
  replaceAttachedParts(parts, options.parts, partIds);
  const prepared = prepareStagedPartRevision({
    attachment,
    parts,
    partIds,
    interaction: options.interaction,
    bundle: options.bundle,
    runtime,
    layout,
    flags: flags.values,
    results: options.results,
  });
  return {
    ...prepared,
    commitFlags: (target) => {
      flags.commit(target);
    },
  };
}

/** Publishes a fully prepared attached definition revision. */
export function commitPartRevision(
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
  bundle.draw.cost.merge(prepared.draw.cost);
  replaceAttachedParts(attachment.attachedParts, prepared.parts, partIds);
  prepared.commitFlags(attachment.styleFlags());
  commitPartLayout(attachment.layout, prepared.layout, partIds);
  applyInteractionState(attachment, prepared.interactionState);
  Object.assign(attachment, prepared.calls);
}

/** Discards one prepared definition revision without touching live resources. */
export function discardPartRevision(
  prepared: PreparedPartRevision,
  live: DrawResources,
  partIds: ReadonlySet<PartId>,
): void {
  discardStagedPartResources(prepared.draw, live, partIds);
}

function commitPartLayout(
  live: InstanceLayout | undefined,
  staged: InstanceLayout,
  partIds: ReadonlySet<PartId>,
): void {
  if (live === undefined) throw new Error("Part revision layout is unavailable");
  for (const [target, source] of layoutMaps(live, staged)) {
    for (const partId of partIds) {
      const value = source.get(partId);
      if (value === undefined) target.delete(partId);
      else target.set(partId, value);
    }
  }
}

function layoutMaps(
  live: InstanceLayout,
  staged: InstanceLayout,
): readonly [Map<PartId, unknown>, ReadonlyMap<PartId, unknown>][] {
  return [
    [live.partVisibleCounts, staged.partVisibleCounts],
    [live.partEdgeCounts, staged.partEdgeCounts],
    [live.partNodeCounts, staged.partNodeCounts],
    [live.partTransparentCounts, staged.partTransparentCounts],
    [live.partSelectionCounts, staged.partSelectionCounts],
    [live.partSelectedNodeCounts, staged.partSelectedNodeCounts],
    [live.partSelectionDrawCalls, staged.partSelectionDrawCalls],
    [live.partSurfaceDrawCalls, staged.partSurfaceDrawCalls],
  ];
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
  commitStagedPartResults(draw, prepared.draw, partIds);
}

/** Publishes result resources prepared in a detached draw owner. */
export function commitStagedPartResults(
  draw: DrawResources,
  staged: DrawResources,
  partIds: ReadonlySet<PartId>,
): void {
  for (const partId of partIds) {
    transferPartResource(draw.deformations, staged.deformations, partId);
    transferPartResource(draw.resultColors, staged.resultColors, partId);
    transferPartResource(draw.orientationGlyphs.parts, staged.orientationGlyphs.parts, partId);
  }
  if (draw.orientationGlyphs.paramsBuffer !== staged.orientationGlyphs.paramsBuffer) {
    draw.orientationGlyphs.paramsBuffer?.destroy();
    draw.orientationGlyphs.paramsBuffer = staged.orientationGlyphs.paramsBuffer;
  }
  new Uint8Array(draw.orientationGlyphs.paramsData).set(
    new Uint8Array(staged.orientationGlyphs.paramsData),
  );
  draw.orientationGlyphs.state = staged.orientationGlyphs.state;
}

function commitPartResources(
  draw: DrawResources,
  prepared: PreparedPartRevision,
  partId: PartId,
): void {
  commitStagedPartDefinition(draw, prepared.draw, partId);
}

/** Publishes exact staged definition resources and retires their prior live identities. */
export function commitStagedPartDefinition(
  draw: DrawResources,
  staged: DrawResources,
  partId: PartId,
): void {
  destroyPartResources(draw, partId);
  transferStagedPartResources(draw, staged, partId);
  commitStagedStorage(draw, staged, partId);
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

/** Publishes one affected part's prepared placement storage. */
export function commitStagedStorage(
  draw: DrawResources,
  staged: DrawResources,
  partId: PartId,
): void {
  const live = draw.storages.get(partId);
  const prepared = staged.storages.get(partId);
  if (live === undefined) {
    if (prepared !== undefined) draw.storages.set(partId, prepared);
    return;
  }
  if (prepared === undefined || live === prepared) return;
  if (live.buffer !== prepared.buffer || live.orderBuffer !== prepared.orderBuffer) {
    replaceGrownStorage(draw, partId, live, prepared);
    return;
  }
  replacePreparedSidecars(live, prepared);
  replacePreparedHighlight(live, prepared);
  live.emphasisSlots = new Set(prepared.emphasisSlots);
  live.edgeEmphasisSlots = new Set(prepared.edgeEmphasisSlots);
  if (live.data !== prepared.data) new Uint8Array(live.data).set(new Uint8Array(prepared.data));
  if (live.orderData !== prepared.orderData) live.orderData.set(prepared.orderData);
  live.orderLength = prepared.orderLength;
}

function replaceGrownStorage(
  draw: DrawResources,
  partId: PartId,
  live: InstanceStorage,
  prepared: InstanceStorage,
): void {
  replacePreparedSidecars(live, prepared);
  replacePreparedHighlight(live, prepared);
  if (live.buffer !== prepared.buffer) {
    draw.cost.releaseBuffer(live.buffer.size);
    live.buffer.destroy();
  }
  if (live.orderBuffer !== prepared.orderBuffer) {
    draw.cost.releaseBuffer(live.orderBuffer.size);
    live.orderBuffer.destroy();
  }
  const { deferRelease: _deferRelease, revisionJournal: _revisionJournal, ...committed } = prepared;
  draw.storages.set(partId, committed);
}

function replacePreparedSidecars(live: InstanceStorage, prepared: InstanceStorage): void {
  for (const kind of [
    "transparent",
    "selection",
    "nodeSelection",
    "nodeSelectionCompact",
    "edge",
    "node",
  ] as const) {
    const previous = live.sidecars[kind];
    const next = prepared.sidecars[kind];
    if (previous !== undefined && previous.buffer !== next?.buffer) previous.buffer.destroy();
    live.sidecars[kind] = next;
  }
}

function replacePreparedHighlight(live: InstanceStorage, prepared: InstanceStorage): void {
  if (live.highlight.buffer !== prepared.highlight.buffer && live.highlightOwned)
    live.highlight.buffer.destroy();
  live.highlight = prepared.highlight;
  live.highlightOwned = prepared.highlightOwned;
}

/** Flushes writes deferred from protected live buffers during preparation. */
export function commitStagedWrites(
  draw: DrawResources,
  prepared: Pick<PreparedPartRevision, "writes">,
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
    storage.sidecars.nodeSelectionCompact,
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
    rebuildInteractionVisibilitySurfaces({
      runtime: options.runtime,
      layout: options.layout,
      parts: changed,
      attachedParts: next,
      interaction: options.interaction,
      bundle: options.bundle,
    });
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
