import type { Part } from "../geometry/part";
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
import {
  buildHighlightTable,
  HIGHLIGHT_BUCKET_SIZE,
  type HighlightTableEntry,
} from "./gpu-highlight-table";
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
 * Initial emphasis record slots allocated per part. Records are placed in
 * four-entry buckets so the vertex shader performs a bounded lookup.
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
 * Replaces a part's emphasis table, writing only the byte subranges whose
 * header or buckets changed since the last write. When the bounded table does
 * not fit, the highlight buffer is recreated larger and every record remains
 * addressable without a linear shader scan.
 */
export function writeElementHighlights(
  device: GPUDevice,
  storage: InstanceStorage,
  updates: readonly EmphasisUpdate[],
): void {
  const entries = updates.map(toTableEntry);
  let table = buildHighlightTable(entries, highlightCapacity(storage.highlight.data.byteLength));
  while (table === undefined) {
    growHighlightStorage(device, storage, nextTableCapacity(entries.length));
    table = buildHighlightTable(entries, highlightCapacity(storage.highlight.data.byteLength));
  }
  const next = new Uint8Array(storage.highlight.data.length);
  const view = new Uint32Array(next.buffer);
  view[0] = entries.length;
  view[1] = table.bucketCount;
  view[2] = table.seed;
  for (let index = 0; index < table.entries.length; index += 1) {
    const entry = table.entries[index];
    if (entry === undefined) continue;
    next.set(new Uint8Array(entry.data), HIGHLIGHT_HEADER + index * ELEMENT_RECORD_STRIDE);
  }
  const previous = storage.highlight.data;
  const previousView = new Uint32Array(previous.buffer);
  const previousSlots = (previousView[1] ?? 0) * HIGHLIGHT_BUCKET_SIZE;
  const nextSlots = table.bucketCount * HIGHLIGHT_BUCKET_SIZE;
  const meaningful = Math.min(
    next.byteLength,
    HIGHLIGHT_HEADER + Math.max(previousSlots, nextSlots) * ELEMENT_RECORD_STRIDE,
  );
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
 * Recreates the part's highlight buffer with room for the requested table,
 * copying the CPU mirror and re-uploading it so diffed writes remain intact.
 * The old buffer is destroyed and both cached bind groups are invalidated.
 */
function growHighlightStorage(
  device: GPUDevice,
  storage: InstanceStorage,
  minimumRecords: number,
): void {
  const highlight = storage.highlight;
  const capacity = highlightCapacity(highlight.data.byteLength);
  if (minimumRecords <= capacity) return;
  const nextCapacity = Math.max(minimumRecords, capacity * 2);
  const grown = createHighlightStorage(device, nextCapacity);
  const mirror = new Uint8Array(grown.data);
  mirror.set(highlight.data);
  device.queue.writeBuffer(grown.buffer, 0, mirror);
  highlight.buffer.destroy();
  storage.highlight = grown;
  storage.bindGroup = undefined;
  storage.edgeBindGroup = undefined;
}
/** Element-highlight record capacity implied by a buffer's byte size. */
function highlightCapacity(byteLength: number): number {
  return (byteLength - HIGHLIGHT_HEADER) / ELEMENT_RECORD_STRIDE;
}

function toTableEntry(update: EmphasisUpdate): HighlightTableEntry {
  return { ...update, data: encodeEmphasisRecord(update) };
}

function nextTableCapacity(count: number): number {
  if (count === 0) return 0;
  let bucketCount = 1;
  while (bucketCount * 2 < Math.ceil(count / 2)) bucketCount *= 2;
  return bucketCount * HIGHLIGHT_BUCKET_SIZE * 2;
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
