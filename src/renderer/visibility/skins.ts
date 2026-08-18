import type { Part, TriangleGeometry } from "../../geometry/part";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import { packedSemanticStorage } from "../../geometry/packed/packed-semantic";
import { buildPackedVisibilitySkinIndices } from "./packed-skin";
import type { InteractionState } from "../../interaction/interaction";
import { readInteractionState } from "../../interaction/state";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { InstanceId } from "../../scene/types";
import { createBuffer } from "../resources/foundation";
import { writeDrawOrder } from "../resources/instance-storage";
import type {
  VisibilityDrawCall,
  VisibilityDrawOwner,
  VisibilityLayout,
  VisibilitySignature,
  VisibilitySkin,
  VisibilitySkinCache,
  VisibilitySkinEntry,
  VisibilitySurfaceOptions,
} from "./types";

const MIN_SKIN_BUDGET = 64 * 1024;
const MAX_SKIN_BUDGET = 16 * 1024 * 1024;

/** Creates an empty bounded skin cache. */
export function createVisibilitySkinCache(): VisibilitySkinCache {
  return { entries: new Map(), budgetBytes: MIN_SKIN_BUDGET, residentBytes: 0, clock: 0 };
}

/** Rebuilds only the surface order and calls for the selected part. */
export function rebuildVisibilitySurface(
  options: VisibilitySurfaceOptions,
): readonly VisibilityDrawCall[] {
  const { runtime, layout, part, interaction, draw } = options;
  const slots = layout.partSlots.get(part.id);
  if (slots === undefined) return [];
  const triangleGeometry = triangleGeometryForSkin(part);
  if (triangleGeometry === undefined) return rebuildUnskinnedSurface(runtime, layout, part, draw);
  const metadata = buildVisibilityMetadata(part, triangleGeometry);
  const groups = groupVisibleSlots(runtime, layout, slots, interaction, metadata);
  const hasHiddenSignature = groups.some((group) => group.signature.hasHidden);
  const cache = draw.visibilitySkins.get(part.id) ?? createVisibilitySkinCache();
  draw.visibilitySkins.set(part.id, cache);
  cache.budgetBytes = skinBudget(triangleGeometry);
  const order: number[] = [];
  const calls: VisibilityDrawCall[] = [];
  const active = new Set<VisibilitySkinEntry>();
  for (const group of groups) {
    const skin = !group.signature.hasHidden
      ? undefined
      : ensureVisibilitySkin({
          cache,
          draw,
          part,
          geometry: triangleGeometry,
          signature: group.signature,
          active,
        });
    if (skin !== undefined && skin.indexCount === 0) continue;
    const firstInstance = order.length;
    order.push(...group.locals);
    calls.push({
      partId: part.id,
      instanceCount: group.locals.length,
      ...(firstInstance === 0 ? {} : { firstInstance }),
      ...(hasHiddenSignature && !group.signature.hasHidden && skin === undefined
        ? { surfaceSubset: true }
        : {}),
      ...(skin === undefined ? {} : { visibilitySkin: skin }),
    });
  }
  writeDrawOrder(draw, part.id, new Uint32Array(order));
  layout.partVisibleCounts.set(part.id, order.length);
  layout.partSurfaceDrawCalls.set(part.id, calls);
  releaseInactiveSkins(cache, draw, active);
  return calls;
}

function rebuildUnskinnedSurface(
  runtime: PackedSceneRuntime,
  layout: VisibilityLayout,
  part: Part,
  draw: VisibilityDrawOwner,
): readonly VisibilityDrawCall[] {
  const order = buildVisibleOrder(layout, runtime, part.id);
  writeDrawOrder(draw, part.id, order);
  layout.partVisibleCounts.set(part.id, order.length);
  layout.partSurfaceDrawCalls.delete(part.id);
  return order.length === 0 ? [] : [{ partId: part.id, instanceCount: order.length }];
}

function buildVisibleOrder(
  layout: VisibilityLayout,
  runtime: PackedSceneRuntime,
  partId: number,
): Uint32Array {
  const slots = layout.partSlots.get(partId);
  if (slots === undefined) return new Uint32Array();
  const order: number[] = [];
  for (const slot of slots) {
    const local = layout.slotPartLocal[slot];
    if (local !== undefined && local >= 0 && runtime.isInstanceVisible(slot)) order.push(local);
  }
  return new Uint32Array(order);
}

/** Releases every cached skin for one part. */
export function destroyVisibilitySkinCache(draw: VisibilityDrawOwner, partId: number): void {
  const cache = draw.visibilitySkins.get(partId);
  if (cache === undefined) return;
  for (const entries of cache.entries.values()) {
    for (const entry of entries) destroySkin(draw, entry.skin);
  }
  draw.visibilitySkins.delete(partId);
}

/** Releases all cached skins, used when a scene or device is reset. */
export function destroyVisibilitySkinCaches(draw: VisibilityDrawOwner): void {
  for (const partId of [...draw.visibilitySkins.keys()]) {
    destroyVisibilitySkinCache(draw, partId);
  }
}

interface VisibilityPartMetadata {
  readonly elements: { has(id: number): boolean };
  readonly knownBodies: ReadonlySet<number>;
}

function buildVisibilityMetadata(
  part: Part,
  geometry: TriangleGeometry | undefined,
): VisibilityPartMetadata {
  const metadata = getPartSemanticIndex(part);
  const knownBodies = new Set<number>([
    ...metadata.bodies.keys(),
    ...metadata.bodyByElement.values(),
  ]);
  const packed = packedSemanticStorage(part);
  if (packed !== undefined) {
    for (const neighborOrdinal of packed.faceNeighborElementOrdinals) {
      if (neighborOrdinal === 0) continue;
      const bodyId = packed.elementBodyIds?.[neighborOrdinal - 1] ?? 0;
      if (bodyId !== 0) knownBodies.add(bodyId);
    }
    return { elements: metadata.elements, knownBodies };
  }
  for (const face of geometry?.faces ?? []) {
    if (face.bodyId !== undefined) knownBodies.add(face.bodyId);
    if (face.neighborElementId !== undefined) {
      const bodyId = metadata.bodyByElement.get(face.neighborElementId);
      if (bodyId !== undefined) knownBodies.add(bodyId);
    }
  }
  return { elements: metadata.elements, knownBodies };
}

function signatureForOccurrence(
  instanceId: InstanceId,
  data: ReturnType<typeof readInteractionState>,
  metadata: VisibilityPartMetadata,
): VisibilitySignature {
  const bodyIds = relevantIds(data.hiddenBodyIds.get(instanceId), metadata.knownBodies);
  const elementIds = relevantIds(data.hiddenElementIds.get(instanceId), metadata.elements);
  if (bodyIds.length === 0 && elementIds.length === 0) return EMPTY_SIGNATURE;
  return {
    hash: signatureHash(bodyIds, elementIds),
    bodyIds,
    elementIds,
    hasHidden: true,
  };
}

const EMPTY_SIGNATURE: VisibilitySignature = {
  hash: 0,
  bodyIds: [],
  elementIds: [],
  hasHidden: false,
};

interface VisibilityGroup {
  readonly signature: VisibilitySignature;
  readonly locals: readonly number[];
}

function groupVisibleSlots(
  runtime: PackedSceneRuntime,
  layout: VisibilityLayout,
  slots: Uint32Array,
  interaction: InteractionState,
  metadata: VisibilityPartMetadata,
): readonly VisibilityGroup[] {
  const groups: Array<{ signature: VisibilitySignature; locals: number[] }> = [];
  const byHash = new Map<number, Array<{ signature: VisibilitySignature; locals: number[] }>>();
  const data = readInteractionState(interaction);
  for (const slot of slots) {
    if (!runtime.isInstanceVisible(slot)) continue;
    const instanceId = runtime.getInstanceId(slot);
    const local = layout.slotPartLocal[slot];
    if (instanceId === undefined || local === undefined || local < 0) continue;
    const signature = signatureForOccurrence(instanceId, data, metadata);
    const bucket = byHash.get(signature.hash) ?? [];
    const group = bucket.find((candidate) => signaturesEqual(candidate.signature, signature));
    if (group === undefined) {
      const next = { signature, locals: [local] };
      bucket.push(next);
      byHash.set(signature.hash, bucket);
      groups.push(next);
    } else group.locals.push(local);
  }
  return groups;
}

function ensureVisibilitySkin(options: {
  readonly cache: VisibilitySkinCache;
  readonly draw: VisibilityDrawOwner;
  readonly part: Part;
  readonly geometry: TriangleGeometry;
  readonly signature: VisibilitySignature;
  readonly active: Set<VisibilitySkinEntry>;
}): VisibilitySkin | undefined {
  const { cache, draw, part, geometry, signature, active } = options;
  const existing = findEntry(cache, signature);
  if (existing !== undefined) {
    existing.lastUsed = ++cache.clock;
    active.add(existing);
    return existing.skin;
  }
  const indices = buildSkinIndices(part, geometry, signature);
  if (indices.length === 0)
    return { signature, indexBuffer: emptyBuffer(draw), indexCount: 0, byteLength: 0 };
  const byteLength = indices.byteLength;
  if (byteLength > cache.budgetBytes) return undefined;
  releaseLeastRecentlyUsed(cache, draw, byteLength, active);
  if (cache.residentBytes + byteLength > cache.budgetBytes) return undefined;
  const indexBuffer = createBuffer(
    draw.device,
    indices,
    GPUBufferUsage.INDEX,
    "femgx visibility skin",
  );
  draw.cost.allocateBuffer(indexBuffer.size);
  const entry: VisibilitySkinEntry = {
    skin: { signature, indexBuffer, indexCount: indices.length, byteLength },
    lastUsed: ++cache.clock,
  };
  const entries = cache.entries.get(signature.hash) ?? [];
  entries.push(entry);
  cache.entries.set(signature.hash, entries);
  cache.residentBytes += byteLength;
  active.add(entry);
  return entry.skin;
}

function buildSkinIndices(
  part: Part,
  geometry: TriangleGeometry,
  signature: VisibilitySignature,
): Uint32Array {
  const metadata = getPartSemanticIndex(part);
  const packed = packedSemanticStorage(part);
  if (packed !== undefined) return buildPackedVisibilitySkinIndices(packed, signature);
  const indices: number[] = [];
  for (const face of geometry.faces ?? []) {
    const ownerBody = face.bodyId ?? metadata.bodyByElement.get(face.elementId);
    const ownerVisible =
      !contains(signature.bodyIds, ownerBody) && !contains(signature.elementIds, face.elementId);
    if (!ownerVisible) continue;
    const neighborBody =
      face.neighborElementId === undefined
        ? undefined
        : metadata.bodyByElement.get(face.neighborElementId);
    const neighborVisible =
      face.neighborElementId !== undefined &&
      !contains(signature.bodyIds, neighborBody) &&
      !contains(signature.elementIds, face.neighborElementId);
    if (neighborVisible) continue;
    for (
      let primitive = face.primitiveStart;
      primitive < face.primitiveStart + face.primitiveCount;
      primitive += 1
    ) {
      const base = primitive * 3;
      indices.push(base, base + 1, base + 2);
    }
  }
  return new Uint32Array(indices);
}

function triangleGeometryForSkin(part: Part): TriangleGeometry | undefined {
  const triangleGeometries = part.geometries.filter(
    (candidate): candidate is TriangleGeometry => candidate.primitive === "triangles",
  );
  if (triangleGeometries.length !== 1) return undefined;
  const geometry = triangleGeometries[0];
  return geometry?.primitive === "triangles" && geometry.faces !== undefined ? geometry : undefined;
}

function skinBudget(geometry: TriangleGeometry): number {
  return Math.max(MIN_SKIN_BUDGET, Math.min(MAX_SKIN_BUDGET, geometry.indices.byteLength * 2));
}

function findEntry(
  cache: VisibilitySkinCache,
  signature: VisibilitySignature,
): VisibilitySkinEntry | undefined {
  return cache.entries
    .get(signature.hash)
    ?.find((entry) => signaturesEqual(entry.skin.signature, signature));
}

function releaseLeastRecentlyUsed(
  cache: VisibilitySkinCache,
  draw: VisibilityDrawOwner,
  requiredBytes: number,
  active: ReadonlySet<VisibilitySkinEntry>,
): void {
  while (cache.residentBytes + requiredBytes > cache.budgetBytes) {
    const candidate = [...cache.entries.values()]
      .flat()
      .filter((entry) => !active.has(entry))
      .sort((left, right) => left.lastUsed - right.lastUsed)[0];
    if (candidate === undefined) return;
    removeEntry(cache, draw, candidate);
  }
}

function releaseInactiveSkins(
  cache: VisibilitySkinCache,
  draw: VisibilityDrawOwner,
  active: ReadonlySet<VisibilitySkinEntry>,
): void {
  for (const entries of [...cache.entries.values()]) {
    for (const entry of [...entries]) {
      if (!active.has(entry)) removeEntry(cache, draw, entry);
    }
  }
}

function removeEntry(
  cache: VisibilitySkinCache,
  draw: VisibilityDrawOwner,
  entry: VisibilitySkinEntry,
): void {
  const entries = cache.entries.get(entry.skin.signature.hash);
  if (entries === undefined) return;
  const index = entries.indexOf(entry);
  if (index < 0) return;
  entries.splice(index, 1);
  if (entries.length === 0) cache.entries.delete(entry.skin.signature.hash);
  destroySkin(draw, entry.skin);
  cache.residentBytes -= entry.skin.byteLength;
}

function destroySkin(draw: VisibilityDrawOwner, skin: VisibilitySkin): void {
  if (skin.byteLength === 0) return;
  draw.cost.releaseBuffer(skin.indexBuffer.size);
  skin.indexBuffer.destroy();
}

function emptyBuffer(draw: VisibilityDrawOwner): GPUBuffer {
  return draw.emptyOrderBuffer;
}

function relevantIds(
  ids: ReadonlySet<number> | undefined,
  known: { has(id: number): boolean },
): readonly number[] {
  if (ids === undefined || ids.size === 0) return [];
  const result = [...ids].filter((id) => known.has(id));
  return result.sort((left, right) => left - right);
}

function contains(ids: readonly number[], value: number | undefined): boolean {
  if (value === undefined) return false;
  let low = 0;
  let high = ids.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = ids[middle];
    if (candidate === value) return true;
    if ((candidate ?? 0) < value) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}

function signaturesEqual(left: VisibilitySignature, right: VisibilitySignature): boolean {
  return arraysEqual(left.bodyIds, right.bodyIds) && arraysEqual(left.elementIds, right.elementIds);
}

function arraysEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function signatureHash(bodyIds: readonly number[], elementIds: readonly number[]): number {
  let hash = 2166136261;
  for (const id of bodyIds) hash = mixHash(hash, 1, id);
  for (const id of elementIds) hash = mixHash(hash, 2, id);
  return hash >>> 0;
}

function mixHash(hash: number, kind: number, id: number): number {
  let next = hash ^ kind;
  next = Math.imul(next, 16777619);
  next ^= id;
  return Math.imul(next, 16777619);
}
