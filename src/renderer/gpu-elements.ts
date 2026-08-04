import type { Geometry, Part } from "../geometry/part";
import {
  emphasizedElementRefs,
  resolveElementStyle,
  type InteractionState,
  type ResolvedStyle,
} from "../interaction/interaction";
import { emphasizedFaceRefs, resolveFaceStyle } from "../interaction/faces";
import { emphasizedNodeRefs, resolveNodeStyle } from "../interaction/nodes";
import type { SceneRuntime } from "../scene-runtime/runtime";
import type { Instance, InstanceId, PartId } from "../scene/types";
import type { DrawResources, InstanceStorage } from "./gpu-draw";
import { defaultStyle } from "./gpu-support";
import type { InstanceLayout } from "./runtime-state";

/**
 * Byte stride of one emphasis record. The layout mirrors the `ElementHighlight`
 * struct in `gpu-shaders.ts`:
 *
 * | offset | size | field |
 * | ------ | ---- | ----- |
 * | 0      | 4    | part-local instance slot (`u32`) |
 * | 4      | 4    | element pick id, `elementId + 1` (`u32`) |
 * | 8      | 4    | face pick id, `faceId + 1` (`u32`) |
 * | 12     | 4    | node pick id, `nodeId + 1` (`u32`) |
 * | 16     | 16   | resolved color with opacity folded into alpha (`vec4<f32>`) |
 * | 32     | 4    | emissive (`f32`) |
 * | 36     | 12   | padding |
 */
export const ELEMENT_RECORD_STRIDE = 48;

/**
 * Byte offset of the `records` array inside the highlight buffer. The WGSL
 * struct packs `count` at offset 0 and aligns the runtime-sized records array
 * to 16 bytes, so records start at offset 16.
 */
export const HIGHLIGHT_HEADER = 16;

/**
 * Initial emphasis records allocated per part. The vertex shader scans the
 * runtime-sized records list, so the buffer grows on demand when a selection
 * exceeds this size and records are never dropped.
 */
export const INITIAL_ELEMENT_HIGHLIGHTS = 128;

/** One emphasis record destined for a part's highlight buffer. */
export interface EmphasisUpdate {
  /** Part-local instance slot (matches the values in the draw-order buffer). */
  readonly slot: number;
  /** 1-based element pick id, `0` when the record emphasizes a face or node. */
  readonly elementPickId: number;
  /** 1-based face pick id, `0` when the record emphasizes an element or node. */
  readonly facePickId: number;
  /** 1-based node pick id, `0` when the record emphasizes an element or face. */
  readonly nodePickId: number;
  readonly style: ResolvedStyle;
}

/**
 * Encodes one emphasis record. Only one of the three pick ids is non-zero, so
 * the vertex shader compares exactly one key against the per-triangle or
 * per-vertex pick data.
 */
export function encodeEmphasisRecord(update: EmphasisUpdate): ArrayBuffer {
  const data = new ArrayBuffer(ELEMENT_RECORD_STRIDE);
  const ids = new Uint32Array(data);
  const floats = new Float32Array(data);
  ids[0] = update.slot;
  ids[1] = update.elementPickId;
  ids[2] = update.facePickId;
  ids[3] = update.nodePickId;
  floats[4] = update.style.color.r;
  floats[5] = update.style.color.g;
  floats[6] = update.style.color.b;
  floats[7] = update.style.color.a * update.style.opacity;
  floats[8] = update.style.emissive;
  return data;
}

/** Encodes an element-emphasis record (`elementId + 1` pick id). */
export function encodeElementHighlight(
  slot: number,
  elementId: number,
  style: ResolvedStyle,
): ArrayBuffer {
  return encodeEmphasisRecord({
    slot,
    elementPickId: elementId + 1,
    facePickId: 0,
    nodePickId: 0,
    style,
  });
}

/** Encodes a face-emphasis record (`faceId + 1` pick id). */
export function encodeFaceHighlight(
  slot: number,
  faceId: number,
  style: ResolvedStyle,
): ArrayBuffer {
  return encodeEmphasisRecord({
    slot,
    elementPickId: 0,
    facePickId: faceId + 1,
    nodePickId: 0,
    style,
  });
}

/** Encodes a node-emphasis record (`nodeId + 1` pick id). */
export function encodeNodeHighlight(
  slot: number,
  nodeId: number,
  style: ResolvedStyle,
): ArrayBuffer {
  return encodeEmphasisRecord({
    slot,
    elementPickId: 0,
    facePickId: 0,
    nodePickId: nodeId + 1,
    style,
  });
}

/**
 * Builds a deduplicated line-list of the mesh edges (unique undirected
 * vertex pairs), used by the wireframe/edge display pass. The edge set is a
 * pure function of the index buffer, so it is uploaded once per part.
 */
export function buildMeshEdges(geometry: Geometry): Uint32Array {
  const indices = geometry.indices;
  const triangleCount = Math.floor(indices.length / 3);
  const seen = new Set<string>();
  const edges: number[] = [];
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const base = triangle * 3;
    const corners = [indices[base] ?? 0, indices[base + 1] ?? 0, indices[base + 2] ?? 0];
    for (let corner = 0; corner < 3; corner++) {
      const a = corners[corner] ?? 0;
      const b = corners[(corner + 1) % 3] ?? 0;
      const key = `${Math.min(a, b)},${Math.max(a, b)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(a, b);
    }
  }
  return new Uint32Array(edges);
}

/** A GPU highlight buffer plus its full CPU mirror for diffed writes. */
export interface HighlightStorage {
  readonly buffer: GPUBuffer;
  data: Uint8Array<ArrayBuffer>;
}

/**
 * Creates a highlight buffer sized for `capacity` element-highlight records
 * plus its header. The buffer can only grow by recreating it; callers grow it
 * on demand when an emphasis list exceeds the current capacity.
 */
export function createHighlightStorage(
  device: GPUDevice,
  capacity = INITIAL_ELEMENT_HIGHLIGHTS,
): HighlightStorage {
  const size = HIGHLIGHT_HEADER + capacity * ELEMENT_RECORD_STRIDE;
  const buffer = device.createBuffer({
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  return { buffer, data: new Uint8Array(size) };
}

/**
 * Maps the currently emphasized occurrences (elements, faces, nodes) to
 * per-part emphasis updates, in deterministic order. Refs whose instance is
 * not part of the layout are dropped so stale or hidden references never reach
 * the GPU.
 */
export function collectEmphasisUpdates(
  runtime: SceneRuntime,
  layout: InstanceLayout,
  slotByInstanceId: ReadonlyMap<InstanceId, number>,
  parts: ReadonlyMap<PartId, Part>,
  interaction: InteractionState,
): ReadonlyMap<PartId, EmphasisUpdate[]> {
  const context = { runtime, layout, slotByInstanceId };
  const byPart = new Map<PartId, EmphasisUpdate[]>();
  const push = (partId: PartId, update: EmphasisUpdate): void => {
    const list = byPart.get(partId);
    if (list === undefined) byPart.set(partId, [update]);
    else list.push(update);
  };
  collectElementEmphasis(context, interaction, push);
  collectFaceEmphasis(context, parts, interaction, push);
  collectNodeEmphasis(context, interaction, push);
  return byPart;
}

/** The occurrence-resolution inputs shared by every emphasis collector. */
interface EmphasisContext {
  readonly runtime: SceneRuntime;
  readonly layout: InstanceLayout;
  readonly slotByInstanceId: ReadonlyMap<InstanceId, number>;
}

/** Collects element-level emphasis records (hover, selection, overrides). */
function collectElementEmphasis(
  context: EmphasisContext,
  interaction: InteractionState,
  push: (partId: PartId, update: EmphasisUpdate) => void,
): void {
  for (const ref of emphasizedElementRefs(interaction)) {
    const occurrence = occurrenceAt(context, ref.instanceId);
    if (occurrence === undefined) continue;
    const style = resolveElementStyle(
      occurrence.instance,
      ref.elementId,
      defaultStyle,
      interaction,
    );
    push(occurrence.instance.partId, {
      slot: occurrence.local,
      elementPickId: ref.elementId + 1,
      facePickId: 0,
      nodePickId: 0,
      style,
    });
  }
}

/** Collects face-level emphasis records, resolved to their part-local face id. */
function collectFaceEmphasis(
  context: EmphasisContext,
  parts: ReadonlyMap<PartId, Part>,
  interaction: InteractionState,
  push: (partId: PartId, update: EmphasisUpdate) => void,
): void {
  for (const ref of emphasizedFaceRefs(interaction)) {
    const occurrence = occurrenceAt(context, ref.instanceId);
    if (occurrence === undefined) continue;
    const faceId = parts
      .get(occurrence.instance.partId)
      ?.geometry.faces?.find(
        (face) => face.elementId === ref.elementId && face.key === ref.faceKey,
      )?.id;
    if (faceId === undefined) continue;
    const style = resolveFaceStyle(occurrence.instance, ref, defaultStyle, interaction);
    push(occurrence.instance.partId, {
      slot: occurrence.local,
      elementPickId: 0,
      facePickId: faceId + 1,
      nodePickId: 0,
      style,
    });
  }
}

/** Collects node-level emphasis records. */
function collectNodeEmphasis(
  context: EmphasisContext,
  interaction: InteractionState,
  push: (partId: PartId, update: EmphasisUpdate) => void,
): void {
  for (const ref of emphasizedNodeRefs(interaction)) {
    const occurrence = occurrenceAt(context, ref.instanceId);
    if (occurrence === undefined) continue;
    const style = resolveNodeStyle(occurrence.instance, ref, defaultStyle, interaction);
    push(occurrence.instance.partId, {
      slot: occurrence.local,
      elementPickId: 0,
      facePickId: 0,
      nodePickId: ref.nodeId + 1,
      style,
    });
  }
}

/** Resolves a ref's instance slot to its part-local slot and part id. */
function occurrenceAt(
  context: EmphasisContext,
  instanceId: InstanceId,
): { readonly instance: Instance; readonly local: number } | undefined {
  const slot = context.slotByInstanceId.get(instanceId);
  if (slot === undefined) return undefined;
  const partId = context.runtime.instancePartIds[slot];
  const local = context.layout.slotPartLocal[slot];
  if (partId === undefined || local === undefined || local < 0) return undefined;
  return {
    instance: {
      index: slot,
      instanceId,
      partId,
      worldTransform: context.runtime.instanceWorldTransforms.subarray(slot * 16, slot * 16 + 16),
    },
    local,
  };
}

/**
 * Replaces a part's emphasis records, writing only the byte subranges whose
 * count or records changed since the last write. When an emphasis list exceeds
 * the buffer's capacity the highlight buffer is recreated larger (destroying
 * the old buffer and invalidating the cached bind group), so every record is
 * always uploaded and no selection is silently dropped.
 */
export function writeElementHighlights(
  device: GPUDevice,
  storage: InstanceStorage,
  updates: readonly EmphasisUpdate[],
): void {
  const count = updates.length;
  growHighlightStorage(device, storage, count);
  const next = new Uint8Array(storage.highlight.data);
  const view = new Uint32Array(next.buffer);
  if (view[0] !== count) {
    view[0] = count;
  }
  for (let index = 0; index < count; index++) {
    const update = updates[index];
    if (update === undefined) continue;
    const offset = HIGHLIGHT_HEADER + index * ELEMENT_RECORD_STRIDE;
    next.set(new Uint8Array(encodeEmphasisRecord(update)), offset);
  }
  const previous = storage.highlight.data;
  const meaningful = HIGHLIGHT_HEADER + count * ELEMENT_RECORD_STRIDE;
  let rangeStart = -1;
  for (let index = 0; index < meaningful; index++) {
    const changed = next[index] !== previous[index];
    if (changed && rangeStart < 0) rangeStart = index;
    if ((!changed || index === meaningful - 1) && rangeStart >= 0) {
      const rangeEnd = changed && index === meaningful - 1 ? index + 1 : index;
      const alignedStart = rangeStart - (rangeStart % 4);
      const alignedEnd = Math.min(meaningful, rangeEnd + ((4 - (rangeEnd % 4)) % 4));
      device.queue.writeBuffer(
        storage.highlight.buffer,
        alignedStart,
        next.subarray(alignedStart, alignedEnd),
      );
      rangeStart = -1;
    }
  }
  previous.set(next);
}

/**
 * Recreates the part's highlight buffer with room for `count` records when the
 * current one is too small, copying the CPU mirror and re-uploading it so the
 * diff in `writeElementHighlights` keeps writing only changed subranges. The
 * old buffer is destroyed and the cached bind group invalidated so the next
 * draw recreates it against the larger buffer.
 */
function growHighlightStorage(device: GPUDevice, storage: InstanceStorage, count: number): void {
  const highlight = storage.highlight;
  const capacity = highlightCapacity(highlight.data.byteLength);
  if (count <= capacity) return;
  const nextCapacity = Math.max(count, capacity * 2);
  const grown = createHighlightStorage(device, nextCapacity);
  const mirror = new Uint8Array(grown.data);
  mirror.set(highlight.data);
  device.queue.writeBuffer(grown.buffer, 0, mirror);
  highlight.buffer.destroy();
  storage.highlight = grown;
  storage.bindGroup = undefined;
}

/** Element-highlight record capacity implied by a buffer's byte size. */
function highlightCapacity(byteLength: number): number {
  return (byteLength - HIGHLIGHT_HEADER) / ELEMENT_RECORD_STRIDE;
}

/** The draw-path inputs needed to sync emphasis buffers. */
export interface ElementHighlightSync {
  readonly device: GPUDevice;
  readonly draw: DrawResources;
  readonly runtime: SceneRuntime;
  readonly layout: InstanceLayout;
  readonly slotByInstanceId: ReadonlyMap<InstanceId, number>;
  readonly parts: ReadonlyMap<PartId, Part>;
}

/**
 * Recomputes every part's emphasis buffer from the current interaction state.
 * Parts without emphasized occurrences are written with an empty record list
 * so previously applied emphasis is cleared; the diffing in
 * `writeElementHighlights` skips parts whose buffer is already up to date.
 */
export function syncElementHighlights(
  sync: ElementHighlightSync,
  interaction: InteractionState,
): void {
  const updates = collectEmphasisUpdates(
    sync.runtime,
    sync.layout,
    sync.slotByInstanceId,
    sync.parts,
    interaction,
  );
  for (const [partId, storage] of sync.draw.storages) {
    writeElementHighlights(sync.device, storage, updates.get(partId) ?? []);
  }
}
