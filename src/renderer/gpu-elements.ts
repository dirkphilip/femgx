import { bodyIdForElement, type Part } from "../geometry/part";
import {
  emphasizedElementRefs,
  resolveBodyStyle,
  resolveElementStyle,
  type InteractionState,
  type ResolvedStyle,
} from "../interaction/interaction";
import { emphasizedBodyRefs, isBodyVisible } from "../interaction/bodies";
import { emphasizedFaceRefs, resolveFaceStyle } from "../interaction/faces";
import { emphasizedNodeRefs, resolveNodeStyle } from "../interaction/nodes";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { PartId } from "../geometry/part";
import type { Instance, InstanceId } from "../scene/types";
import { BODY_HIGHLIGHT_MARKER } from "./gpu-highlight-table";
import { defaultStyle } from "./gpu-support";

interface InstanceLayout {
  readonly slotPartLocal: Int32Array;
}

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
 * | 36     | 4    | hidden (`u32`) |
 * | 40     | 8    | trailing alignment padding |
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
  /** 1-based body pick id, `0` for element/face/node records. */
  readonly bodyPickId?: number;
  /** Hides the matching body triangles in both color and pick passes. */
  readonly hidden?: boolean;
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
  ids[1] = update.bodyPickId ?? update.elementPickId;
  ids[2] = update.bodyPickId === undefined ? update.facePickId : BODY_HIGHLIGHT_MARKER;
  ids[3] = update.nodePickId;
  floats[4] = update.style.color.r;
  floats[5] = update.style.color.g;
  floats[6] = update.style.color.b;
  floats[7] = update.style.color.a * update.style.opacity;
  floats[8] = update.style.emissive;
  ids[9] = update.hidden === true ? 1 : 0;
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

/** Encodes a body-emphasis record (`bodyId + 1` plus the body marker). */
export function encodeBodyHighlight(
  slot: number,
  bodyId: number,
  style: ResolvedStyle,
  hidden = false,
): ArrayBuffer {
  return encodeEmphasisRecord({
    slot,
    elementPickId: 0,
    facePickId: 0,
    nodePickId: 0,
    bodyPickId: bodyId + 1,
    hidden,
    style,
  });
}

/**
 * Maps the currently emphasized occurrences (elements, faces, nodes) to
 * per-part emphasis updates, in deterministic order. Refs whose instance is
 * not part of the layout are dropped so stale or hidden references never reach
 * the GPU.
 */
export function collectEmphasisUpdates(
  runtime: PackedSceneRuntime,
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
  collectBodyEmphasis(context, parts, interaction, push);
  collectElementEmphasis(context, parts, interaction, push);
  collectFaceEmphasis(context, parts, interaction, push);
  collectNodeEmphasis(context, interaction, push);
  return byPart;
}

/** Collects body-level style and visibility records. */
function collectBodyEmphasis(
  context: EmphasisContext,
  parts: ReadonlyMap<PartId, Part>,
  interaction: InteractionState,
  push: (partId: PartId, update: EmphasisUpdate) => void,
): void {
  for (const ref of emphasizedBodyRefs(interaction)) {
    const occurrence = occurrenceAt(context, ref.instanceId);
    if (occurrence === undefined) continue;
    const part = parts.get(occurrence.instance.partId);
    const body = part?.geometry.bodies?.find((candidate) => candidate.id === ref.bodyId);
    if (body === undefined) continue;
    push(occurrence.instance.partId, {
      slot: occurrence.local,
      elementPickId: 0,
      facePickId: 0,
      nodePickId: 0,
      bodyPickId: ref.bodyId + 1,
      hidden: !isBodyVisible(interaction, ref),
      style: resolveBodyStyle(occurrence.instance, ref.bodyId, defaultStyle, interaction),
    });
  }
}

/** The occurrence-resolution inputs shared by every emphasis collector. */
interface EmphasisContext {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly slotByInstanceId: ReadonlyMap<InstanceId, number>;
}

/** Collects element-level emphasis records (hover, selection, overrides). */
function collectElementEmphasis(
  context: EmphasisContext,
  parts: ReadonlyMap<PartId, Part>,
  interaction: InteractionState,
  push: (partId: PartId, update: EmphasisUpdate) => void,
): void {
  for (const ref of emphasizedElementRefs(interaction)) {
    const occurrence = occurrenceAt(context, ref.instanceId);
    if (occurrence === undefined) continue;
    const geometry = parts.get(occurrence.instance.partId)?.geometry;
    const bodyId = geometry === undefined ? undefined : bodyIdForElement(geometry, ref.elementId);
    const style = resolveElementStyle(
      occurrence.instance,
      ref.elementId,
      defaultStyle,
      interaction,
      bodyId,
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
    const geometry = parts.get(occurrence.instance.partId)?.geometry;
    if (geometry?.primitive !== "triangles") continue;
    const face = geometry.faces?.find(
      (face) => face.elementId === ref.elementId && face.key === ref.faceKey,
    )?.id;
    if (face === undefined) continue;
    const descriptor = geometry.faces?.[face];
    const style = resolveFaceStyle(
      occurrence.instance,
      ref,
      defaultStyle,
      interaction,
      descriptor?.bodyId ?? bodyIdForElement(geometry, ref.elementId),
    );
    push(occurrence.instance.partId, {
      slot: occurrence.local,
      elementPickId: 0,
      facePickId: face + 1,
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
