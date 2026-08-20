import type { Part, TriangleGeometry } from "../../geometry/part";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import { geometrySemanticGraph } from "../../geometry/semantic/part-semantic-graph";
import { buildGraphVisibilitySkinIndices } from "./graph-skin";
import {
  visibilityPartMetadata,
  visibilitySignature,
  visibilitySignaturesEqual,
  type VisibilityPartMetadata,
} from "./signature";
import type { InteractionState } from "../../interaction/interaction";
import { readInteractionState } from "../../interaction/state";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import { createBuffer } from "../resources/foundation";
import { writeDrawOrder } from "../resources/instance-storage";
import { buildVisibilityTriangleIndices, writeTriangleRange } from "./skin-indices";
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

/** Creates an empty cache whose complete retained skin ownership is bounded. */
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
  const metadata = visibilityPartMetadata(part);
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
    const signature = visibilitySignature(instanceId, data, metadata);
    const bucket = byHash.get(signature.hash) ?? [];
    const group = bucket.find((candidate) =>
      visibilitySignaturesEqual(candidate.signature, signature),
    );
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
  // The feature topology path already filters this signature against the shared
  // complete surface. Refuse a new compact order when it would break the
  // per-Part ownership bound instead of retaining an unbounded active entry.
  return retainVisibilitySkin({ cache, draw, signature, indices, active });
}

function retainVisibilitySkin(options: {
  readonly cache: VisibilitySkinCache;
  readonly draw: VisibilityDrawOwner;
  readonly signature: VisibilitySignature;
  readonly indices: Uint32Array;
  readonly active: Set<VisibilitySkinEntry>;
}): VisibilitySkin | undefined {
  const { cache, draw, signature, indices, active } = options;
  if (indices.length === 0)
    return { signature, indexBuffer: emptyBuffer(draw), indexCount: 0, byteLength: 0 };
  const byteLength = indices.byteLength;
  if (!releaseLeastRecentlyUsed(cache, draw, byteLength, active)) return undefined;
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
  const semantic = geometrySemanticGraph(geometry);
  if (semantic !== undefined) {
    return buildGraphVisibilitySkinIndices(semantic, signature, geometry.indices.length);
  }
  const metadata = getPartSemanticIndex(part);
  return buildVisibilityTriangleIndices(geometry.indices.length, (target) =>
    writeGenericSkin(geometry, metadata, signature, target),
  );
}

function writeGenericSkin(
  geometry: TriangleGeometry,
  metadata: Pick<ReturnType<typeof getPartSemanticIndex>, "bodyForElement" | "elementOrdinal">,
  signature: VisibilitySignature,
  target: Uint32Array | number[] | undefined,
): number {
  let offset = 0;
  const faces = geometry.faces;
  if (faces === undefined) return 0;
  for (const face of faces) {
    const ownerBody = face.bodyId ?? metadata.bodyForElement(face.elementId);
    const ownerVisible =
      !contains(signature.bodyIds, ownerBody) &&
      !genericElementHidden(signature, face.elementId, metadata.elementOrdinal);
    if (!ownerVisible) continue;
    const neighborBody =
      face.neighborElementId === undefined
        ? undefined
        : metadata.bodyForElement(face.neighborElementId);
    const neighborVisible =
      face.neighborElementId !== undefined &&
      !contains(signature.bodyIds, neighborBody) &&
      !genericElementHidden(signature, face.neighborElementId, metadata.elementOrdinal);
    if (neighborVisible) continue;
    offset = writeTriangleRange(target, offset, face.primitiveStart, face.primitiveCount);
  }
  return offset;
}

function genericElementHidden(
  signature: VisibilitySignature,
  elementId: number,
  ordinalForElement: (id: number) => number | undefined,
): boolean {
  const words = signature.elementWords;
  if (words === undefined) return contains(signature.elementIds, elementId);
  const ordinal = ordinalForElement(elementId);
  if (ordinal === undefined) return false;
  const bit = ordinal - 1;
  return ((words[bit >> 5] ?? 0) & (1 << (bit & 31))) !== 0;
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
    ?.find((entry) => visibilitySignaturesEqual(entry.skin.signature, signature));
}

function releaseLeastRecentlyUsed(
  cache: VisibilitySkinCache,
  draw: VisibilityDrawOwner,
  requiredBytes: number,
  active: ReadonlySet<VisibilitySkinEntry>,
): boolean {
  while (cache.residentBytes + requiredBytes > cache.budgetBytes) {
    let candidate: VisibilitySkinEntry | undefined;
    for (const entries of cache.entries.values()) {
      for (const entry of entries) {
        if (
          !active.has(entry) &&
          (candidate === undefined || entry.lastUsed < candidate.lastUsed)
        ) {
          candidate = entry;
        }
      }
    }
    if (candidate === undefined) return false;
    removeEntry(cache, draw, candidate);
  }
  return true;
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

function contains(ids: ArrayLike<number>, value: number | undefined): boolean {
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
