import type { Geometry } from "../geometry/part";
import {
  emphasizedElementRefs,
  resolveElementStyle,
  type InteractionState,
  type ResolvedStyle,
} from "../interaction/interaction";
import type { SceneRuntime } from "../scene-runtime/runtime";
import type { InstanceId, PartId } from "../scene/types";
import type { DrawResources, InstanceStorage } from "./gpu-draw";
import { defaultStyle } from "./gpu-support";
import type { InstanceLayout } from "./runtime-state";

/**
 * Byte stride of one element-highlight record. The layout mirrors the
 * `ElementHighlight` struct in `gpu-shaders.ts`:
 *
 * | offset | size | field |
 * | ------ | ---- | ----- |
 * | 0      | 4    | part-local instance slot (`u32`) |
 * | 4      | 4    | element pick id, `elementId + 1` (`u32`) |
 * | 8      | 8    | padding |
 * | 16     | 16   | resolved color with opacity folded into alpha (`vec4<f32>`) |
 * | 32     | 4    | emissive (`f32`) |
 * | 36     | 12   | padding |
 */
export const ELEMENT_RECORD_STRIDE = 48;

/**
 * Byte offset of the `items` array inside the highlight buffer. The WGSL
 * struct packs `count` at offset 0 and aligns the 128-element array to 16
 * bytes, so records start at offset 16.
 */
export const HIGHLIGHT_HEADER = 16;

/**
 * Maximum element-highlight records written per part. The vertex shader scans
 * this bounded list, so selections larger than this render the first records
 * only; see `wiki/element-interaction.md`.
 */
export const MAX_ELEMENT_HIGHLIGHTS = 128;

/** One element-level emphasis record destined for a part's highlight buffer. */
export interface ElementHighlightUpdate {
  /** Part-local instance slot (matches the values in the draw-order buffer). */
  readonly slot: number;
  /** The element id this record emphasizes. */
  readonly elementId: number;
  readonly style: ResolvedStyle;
}

/**
 * Encodes one element-highlight record. The element is stored as its 1-based
 * pick id (`elementId + 1`) so the vertex shader compares it directly against
 * the per-triangle element pick ids.
 */
export function encodeElementHighlight(
  slot: number,
  elementId: number,
  style: ResolvedStyle,
): ArrayBuffer {
  const data = new ArrayBuffer(ELEMENT_RECORD_STRIDE);
  const ids = new Uint32Array(data);
  const floats = new Float32Array(data);
  ids[0] = slot;
  ids[1] = elementId + 1;
  floats[4] = style.color.r;
  floats[5] = style.color.g;
  floats[6] = style.color.b;
  floats[7] = style.color.a * style.opacity;
  floats[8] = style.emissive;
  return data;
}

/**
 * Builds the per-triangle element pick id map for a part: one `u32` per
 * triangle holding `elementId + 1` (0 = "no element"). Parts without element
 * descriptors produce an all-zero map.
 */
export function buildElementTrianglePickIds(geometry: Geometry): Uint32Array {
  const triangleCount = Math.floor(geometry.indices.length / 3);
  const pickIds = new Uint32Array(triangleCount);
  for (const element of geometry.elements ?? []) {
    const end = element.triangleStart + element.triangleCount;
    for (let triangle = element.triangleStart; triangle < end; triangle++) {
      pickIds[triangle] = element.id + 1;
    }
  }
  return pickIds;
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

/** Creates the fixed-capacity highlight buffer for one part's storage. */
export function createHighlightStorage(device: GPUDevice): HighlightStorage {
  const size = HIGHLIGHT_HEADER + MAX_ELEMENT_HIGHLIGHTS * ELEMENT_RECORD_STRIDE;
  const buffer = device.createBuffer({
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  return { buffer, data: new Uint8Array(size) };
}

/**
 * Maps the currently emphasized element occurrences to per-part highlight
 * updates, in deterministic order. Refs whose instance is not part of the
 * layout are dropped so stale or hidden references never reach the GPU.
 */
export function collectElementHighlightUpdates(
  runtime: SceneRuntime,
  layout: InstanceLayout,
  slotByInstanceId: ReadonlyMap<InstanceId, number>,
  interaction: InteractionState,
): ReadonlyMap<PartId, ElementHighlightUpdate[]> {
  const byPart = new Map<PartId, ElementHighlightUpdate[]>();
  for (const ref of emphasizedElementRefs(interaction)) {
    const slot = slotByInstanceId.get(ref.instanceId);
    if (slot === undefined) continue;
    const partId = runtime.instancePartIds[slot];
    const local = layout.slotPartLocal[slot];
    if (partId === undefined || local === undefined || local < 0) continue;
    const style = resolveElementStyle(
      {
        index: slot,
        instanceId: ref.instanceId,
        partId,
        worldTransform: runtime.instanceWorldTransforms.subarray(slot * 16, slot * 16 + 16),
      },
      ref.elementId,
      defaultStyle,
      interaction,
    );
    const update: ElementHighlightUpdate = { slot: local, elementId: ref.elementId, style };
    const list = byPart.get(partId);
    if (list === undefined) byPart.set(partId, [update]);
    else list.push(update);
  }
  return byPart;
}

/**
 * Replaces a part's emphasis records, writing only the byte subranges whose
 * count or records changed since the last write. Records beyond the per-part
 * capacity are dropped so the buffer size stays fixed and bind groups stay
 * valid across selection deltas.
 */
export function writeElementHighlights(
  device: GPUDevice,
  storage: InstanceStorage,
  updates: readonly ElementHighlightUpdate[],
): void {
  const next = new Uint8Array(storage.highlight.data);
  const count = Math.min(updates.length, MAX_ELEMENT_HIGHLIGHTS);
  const view = new Uint32Array(next.buffer);
  if (view[0] !== count) {
    view[0] = count;
  }
  for (let index = 0; index < count; index++) {
    const update = updates[index];
    if (update === undefined) continue;
    const offset = HIGHLIGHT_HEADER + index * ELEMENT_RECORD_STRIDE;
    next.set(
      new Uint8Array(encodeElementHighlight(update.slot, update.elementId, update.style)),
      offset,
    );
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

/** The draw-path inputs needed to sync element-highlight buffers. */
export interface ElementHighlightSync {
  readonly device: GPUDevice;
  readonly draw: DrawResources;
  readonly runtime: SceneRuntime;
  readonly layout: InstanceLayout;
  readonly slotByInstanceId: ReadonlyMap<InstanceId, number>;
}

/**
 * Recomputes every part's element-highlight buffer from the current interaction
 * state. Parts without emphasized elements are written with an empty record
 * list so previously applied emphasis is cleared; the diffing in
 * `writeElementHighlights` skips parts whose buffer is already up to date.
 */
export function syncElementHighlights(
  sync: ElementHighlightSync,
  interaction: InteractionState,
): void {
  const updates = collectElementHighlightUpdates(
    sync.runtime,
    sync.layout,
    sync.slotByInstanceId,
    interaction,
  );
  for (const [partId, storage] of sync.draw.storages) {
    writeElementHighlights(sync.device, storage, updates.get(partId) ?? []);
  }
}
