import type { PartId } from "../../geometry/part";
import { destroyDeformationBuffer } from "../frame/deformation";
import { destroyOrientationGlyphPart } from "../orientation-glyphs/orientation-glyph";
import {
  destroyInstancePartResources,
  type DrawResources,
  destroyPartResource,
  destroyPartResources,
} from "../resources/draw-resources";
import type { PartResource } from "../resources/foundation";
import { destroyResultColorBuffer } from "../resources/result-colors";
import { rollbackStagedInstanceStorage, type InstanceStorage } from "../resources/instance-storage";
import { rollbackStagedHighlight } from "../selection/highlight-storage";
import { destroyDetachedVisibilitySkinCache } from "../visibility/skins";
import { PartRevisionMap } from "./part-revision-overlay";
import type { PartRevisionResultState } from "./part-revision-results";

interface StagedBufferWrite {
  readonly buffer: GPUBuffer;
  readonly offset: number;
  readonly data: Uint8Array;
}

export type DrawRevisionKind = "part" | "occurrence";

export interface CommitDrawRevisionOptions {
  readonly live: DrawResources;
  readonly staged: DrawResources;
  readonly affectedPartIds: ReadonlySet<PartId>;
  readonly replacedPartIds: ReadonlySet<PartId>;
  readonly kind: DrawRevisionKind;
  readonly writes: readonly StagedBufferWrite[];
  readonly results: PartRevisionResultState | undefined;
}

/** Publishes staged draw resources and deferred writes after all staging succeeds. */
export function commitDrawRevisionResources(options: CommitDrawRevisionOptions): void {
  const { live, staged, affectedPartIds, replacedPartIds } = options;
  if (options.kind === "part") {
    for (const partId of affectedPartIds) commitPartDefinition(live, staged, partId);
  } else {
    for (const partId of replacedPartIds) commitPartDefinition(live, staged, partId);
    for (const partId of affectedPartIds) {
      if (replacedPartIds.has(partId)) continue;
      commitStorage(live, staged, partId);
      commitOverlayEntries(live, staged, partId);
    }
  }
  commitResults(live, staged, affectedPartIds, options.results);
  commitWrites(live, options.writes, affectedPartIds);
}

/** Destroys only resources allocated by an uncommitted draw revision. */
export function discardDrawRevisionResources(
  staged: DrawResources,
  live: DrawResources,
  partIds: ReadonlySet<PartId>,
): void {
  for (const partId of partIds) {
    discardGeometry(staged, live, partId);
    discardStorage(staged, live, partId);
    discardResultResources(staged, live, partId);
    discardVisibilitySkin(staged, live, partId);
  }
  if (staged.orientationGlyphs.paramsBuffer !== live.orientationGlyphs.paramsBuffer) {
    staged.orientationGlyphs.paramsBuffer?.destroy();
  }
}

function commitPartDefinition(draw: DrawResources, staged: DrawResources, partId: PartId): void {
  destroyPartResources(draw, partId);
  transferPartResources(draw, staged, partId);
  commitStorage(draw, staged, partId);
}

function transferPartResources(draw: DrawResources, staged: DrawResources, partId: PartId): void {
  transfer(draw.parts, staged.parts, partId);
  transfer(draw.primitiveParts, staged.primitiveParts, partId);
  transfer(draw.nodeParts, staged.nodeParts, partId);
  transfer(draw.visibilitySkins, staged.visibilitySkins, partId);
  transfer(draw.admissionCache, staged.admissionCache, partId);
}

function commitStorage(draw: DrawResources, staged: DrawResources, partId: PartId): void {
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

function commitResults(
  draw: DrawResources,
  staged: DrawResources,
  partIds: ReadonlySet<PartId>,
  results: PartRevisionResultState | undefined,
): void {
  for (const partId of partIds) {
    if (draw.deformations.get(partId) !== staged.deformations.get(partId)) {
      destroyDeformationBuffer(draw.deformations, partId, draw.cost);
    }
    if (draw.resultColors.get(partId) !== staged.resultColors.get(partId)) {
      destroyResultColorBuffer(draw, partId);
    }
    if (draw.orientationGlyphs.parts.get(partId) !== staged.orientationGlyphs.parts.get(partId)) {
      destroyOrientationGlyphPart(draw.orientationGlyphs, partId);
    }
    transfer(draw.deformations, staged.deformations, partId);
    transfer(draw.resultColors, staged.resultColors, partId);
    transfer(draw.orientationGlyphs.parts, staged.orientationGlyphs.parts, partId);
  }
  if (draw.orientationGlyphs.paramsBuffer !== staged.orientationGlyphs.paramsBuffer) {
    draw.orientationGlyphs.paramsBuffer?.destroy();
    draw.orientationGlyphs.paramsBuffer = staged.orientationGlyphs.paramsBuffer;
  }
  new Uint8Array(draw.orientationGlyphs.paramsData).set(
    new Uint8Array(staged.orientationGlyphs.paramsData),
  );
  draw.orientationGlyphs.state = results?.glyphs;
}

function commitWrites(
  draw: DrawResources,
  writes: readonly StagedBufferWrite[],
  partIds: ReadonlySet<PartId>,
): void {
  const liveBuffers = committedStorageBuffers(draw, partIds);
  for (const write of writes) {
    if (liveBuffers.has(write.buffer))
      draw.writePort.writeBuffer(write.buffer, write.offset, write.data);
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
    for (const sidecar of storageSidecars(storage)) {
      if (sidecar !== undefined) buffers.add(sidecar.buffer);
    }
    if (storage.highlightOwned) buffers.add(storage.highlight.buffer);
  }
  if (draw.orientationGlyphs.paramsBuffer !== undefined) {
    buffers.add(draw.orientationGlyphs.paramsBuffer);
  }
  return buffers;
}

function storageSidecars(storage: InstanceStorage) {
  return [
    storage.sidecars.transparent,
    storage.sidecars.selection,
    storage.sidecars.nodeSelection,
    storage.sidecars.nodeSelectionCompact,
    storage.sidecars.edge,
    storage.sidecars.node,
  ];
}

function commitOverlayEntries(draw: DrawResources, staged: DrawResources, partId: PartId): void {
  transferOverlayEntry(draw.parts, staged.parts, partId);
  transferOverlayEntry(draw.primitiveParts, staged.primitiveParts, partId);
  transferOverlayEntry(draw.nodeParts, staged.nodeParts, partId);
  transferOverlayEntry(draw.visibilitySkins, staged.visibilitySkins, partId);
  transferOverlayEntry(draw.admissionCache, staged.admissionCache, partId);
}

function transfer<K, V>(target: Map<K, V>, source: ReadonlyMap<K, V>, key: K): void {
  const value = source.get(key);
  if (value === undefined) target.delete(key);
  else target.set(key, value);
}

function transferOverlayEntry<K, V>(target: Map<K, V>, source: ReadonlyMap<K, V>, key: K): void {
  if (source instanceof PartRevisionMap && !source.owns(key)) return;
  transfer(target, source, key);
}

function discardGeometry(staged: DrawResources, live: DrawResources, partId: PartId): void {
  const retained = partResources(live, partId, false);
  const stagedResources = partResources(staged, partId, true);
  for (const resource of stagedResources) {
    if (retained.has(resource)) continue;
    destroyPartResource(resource);
  }
}

function partResources(draw: DrawResources, partId: PartId, ownedOnly: boolean): Set<PartResource> {
  const resources = new Set<PartResource>();
  if (!ownedOnly || owns(draw.parts, partId)) addResource(resources, draw.parts.get(partId));
  if (!ownedOnly || owns(draw.primitiveParts, partId)) {
    for (const resource of draw.primitiveParts.get(partId)?.values() ?? [])
      addResource(resources, resource);
  }
  if (!ownedOnly || owns(draw.nodeParts, partId))
    addResource(resources, draw.nodeParts.get(partId));
  return resources;
}

function addResource(resources: Set<PartResource>, resource: PartResource | undefined): void {
  if (resource !== undefined) resources.add(resource);
}

function owns<K, V>(map: ReadonlyMap<K, V>, key: K): boolean {
  return !(map instanceof PartRevisionMap) || map.owns(key);
}

function discardStorage(staged: DrawResources, live: DrawResources, partId: PartId): void {
  if (!owns(staged.storages, partId)) return;
  const storage = staged.storages.get(partId);
  if (storage === undefined) return;
  const current = live.storages.get(partId);
  if (current === undefined) {
    destroyInstancePartResources(staged, partId);
    return;
  }
  if (storage === current) return;
  rollbackStagedInstanceStorage(storage);
  rollbackStagedHighlight(storage.highlight);
  const buffers = new Set<GPUBuffer>();
  if (storage.buffer !== current.buffer) buffers.add(storage.buffer);
  if (storage.orderBuffer !== current.orderBuffer) buffers.add(storage.orderBuffer);
  for (const kind of [
    "transparent",
    "selection",
    "nodeSelection",
    "nodeSelectionCompact",
    "edge",
    "node",
  ] as const) {
    const sidecar = storage.sidecars[kind];
    if (sidecar !== undefined && sidecar.buffer !== current.sidecars[kind]?.buffer)
      buffers.add(sidecar.buffer);
  }
  if (storage.highlightOwned && storage.highlight.buffer !== current.highlight.buffer)
    buffers.add(storage.highlight.buffer);
  for (const buffer of buffers) buffer.destroy();
}

function discardResultResources(staged: DrawResources, live: DrawResources, partId: PartId): void {
  if (staged.deformations.get(partId) !== live.deformations.get(partId)) {
    destroyDeformationBuffer(staged.deformations, partId, staged.cost);
  }
  if (staged.resultColors.get(partId) !== live.resultColors.get(partId)) {
    destroyResultColorBuffer(staged, partId);
  }
  if (staged.orientationGlyphs.parts.get(partId) !== live.orientationGlyphs.parts.get(partId)) {
    destroyOrientationGlyphPart(staged.orientationGlyphs, partId);
  }
}

function discardVisibilitySkin(staged: DrawResources, live: DrawResources, partId: PartId): void {
  if (!owns(staged.visibilitySkins, partId)) return;
  const skins = staged.visibilitySkins.get(partId);
  if (skins !== undefined && skins !== live.visibilitySkins.get(partId)) {
    destroyDetachedVisibilitySkinCache(staged, skins);
  }
}
