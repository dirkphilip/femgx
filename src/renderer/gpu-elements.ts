import type { Part } from "../geometry/part";
import {
  emphasizedElementRefs,
  resolveElementBlockStyle,
  resolveBodyStyle,
  resolveElementStyle,
  type InteractionState,
  type ResolvedStyle,
} from "../interaction/interaction";
import { emphasizedBodyRefs, isBodyVisible } from "../interaction/bodies";
import { emphasizedElementBlockRefs, isElementBlockVisible } from "../interaction/blocks";
import { isElementVisible } from "../interaction/elements";
import { emphasizedFaceRefs, resolveFaceStyle } from "../interaction/faces";
import { emphasizedNodeRefs, resolveNodeStyle } from "../interaction/nodes";
import { emphasizedEdgeRefs, resolveEdgeStyle } from "../interaction/edges";
import { readInteractionState } from "../interaction/state";
import { faceRefKey } from "../interaction/refs";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { PartId } from "../geometry/part";
import type { Instance, InstanceId } from "../scene/types";
import { BODY_HIGHLIGHT_MARKER } from "./gpu-highlight-table";
import { EDGE_HIGHLIGHT_MARKER } from "./gpu-highlight-table";
import { defaultStyle } from "./gpu-support";
import { getPartInteractionMetadata } from "./part-interaction-metadata";

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
 * | 40     | 4    | selected (`u32`) |
 * | 44     | 4    | trailing alignment padding |
 */
export const ELEMENT_RECORD_STRIDE = 48;

/**
 * Byte offset of the packed payload inside the highlight buffer. The fixed
 * header contains sparse-table metadata, dense-selection ranges, and the
 * selected theme; the payload contains sparse records followed by bitsets.
 */
export const HIGHLIGHT_HEADER = 64;

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
  /** 1-based private authored-edge id, `0` for non-edge records. */
  readonly edgePickId?: number;
  /** 1-based body pick id, `0` for element/face/node records. */
  readonly bodyPickId?: number;
  /** 1-based semantic element-block pick id, `0` for other records. */
  readonly blockPickId?: number;
  /** Hides the matching body triangles in both color and pick passes. */
  readonly hidden?: boolean;
  /** Marks the matching primitive for the renderer-owned x-ray selection pass. */
  readonly selected?: boolean;
  readonly style: ResolvedStyle;
}

/** One immutable interaction snapshot shared by highlight and transparency sync. */
export type EmphasisUpdates = ReadonlyMap<PartId, readonly EmphasisUpdate[]>;

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
  ids[1] = update.edgePickId ?? update.bodyPickId ?? update.elementPickId;
  ids[2] =
    update.edgePickId === undefined
      ? update.bodyPickId === undefined
        ? update.facePickId
        : BODY_HIGHLIGHT_MARKER
      : EDGE_HIGHLIGHT_MARKER;
  ids[3] = update.edgePickId === undefined ? update.nodePickId : 0;
  floats[4] = update.style.color.r;
  floats[5] = update.style.color.g;
  floats[6] = update.style.color.b;
  floats[7] = update.style.color.a * update.style.opacity;
  floats[8] = update.style.emissive;
  ids[9] = update.hidden === true ? 1 : 0;
  ids[10] = update.selected === true ? 1 : 0;
  ids[11] = update.blockPickId ?? 0;
  return data;
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
): EmphasisUpdates {
  const context = { runtime, layout, slotByInstanceId };
  const byPart = new Map<PartId, EmphasisUpdate[]>();
  const push = (partId: PartId, update: EmphasisUpdate): void => {
    const list = byPart.get(partId);
    if (list === undefined) byPart.set(partId, [update]);
    else list.push(update);
  };
  collectBodyEmphasis(context, parts, interaction, push);
  collectBlockEmphasis(context, parts, interaction, push);
  collectElementEmphasis(context, parts, interaction, push);
  collectFaceEmphasis(context, parts, interaction, push);
  collectNodeEmphasis(context, interaction, push);
  collectEdgeEmphasis(context, parts, interaction, push);
  return byPart;
}

/** Collects authored-edge emphasis records using stable geometry metadata. */
function collectEdgeEmphasis(
  context: EmphasisContext,
  parts: ReadonlyMap<PartId, Part>,
  interaction: InteractionState,
  push: (partId: PartId, update: EmphasisUpdate) => void,
): void {
  for (const ref of emphasizedEdgeRefs(interaction)) {
    const occurrence = occurrenceAt(context, ref.instanceId);
    if (occurrence === undefined) continue;
    const part = parts.get(occurrence.instance.partId);
    const edge =
      part === undefined ? undefined : getPartInteractionMetadata(part).edges.get(ref.key);
    if (edge === undefined) continue;
    push(occurrence.instance.partId, {
      slot: occurrence.local,
      elementPickId: 0,
      facePickId: 0,
      nodePickId: 0,
      edgePickId: edge.edgePickId,
      selected:
        readInteractionState(interaction).selectedEdges.get(ref.instanceId)?.has(ref.key) === true,
      style: resolveEdgeStyle(occurrence.instance, ref, defaultStyle, interaction),
    });
  }
}

/** Collects semantic block style and visibility records. */
function collectBlockEmphasis(
  context: EmphasisContext,
  parts: ReadonlyMap<PartId, Part>,
  interaction: InteractionState,
  push: (partId: PartId, update: EmphasisUpdate) => void,
): void {
  const data = readInteractionState(interaction);
  for (const ref of emphasizedElementBlockRefs(interaction)) {
    const occurrence = occurrenceAt(context, ref.instanceId);
    if (occurrence === undefined) continue;
    const part = parts.get(occurrence.instance.partId);
    const metadata = part === undefined ? undefined : getPartInteractionMetadata(part);
    const block = metadata?.blocks.get(ref.blockId);
    if (block === undefined) continue;
    const bodyId = metadata?.bodyByBlock.get(ref.blockId);
    push(occurrence.instance.partId, {
      slot: occurrence.local,
      elementPickId: 0,
      facePickId: 0,
      nodePickId: 0,
      blockPickId: ref.blockId + 1,
      hidden: !isElementBlockVisible(interaction, ref),
      selected: data.selectedBlockIds.get(ref.instanceId)?.has(ref.blockId) === true,
      style: resolveElementBlockStyle(
        occurrence.instance,
        ref.blockId,
        defaultStyle,
        interaction,
        bodyId,
      ),
    });
  }
}

/** Collects body-level style and visibility records. */
function collectBodyEmphasis(
  context: EmphasisContext,
  parts: ReadonlyMap<PartId, Part>,
  interaction: InteractionState,
  push: (partId: PartId, update: EmphasisUpdate) => void,
): void {
  const data = readInteractionState(interaction);
  for (const ref of emphasizedBodyRefs(interaction)) {
    const occurrence = occurrenceAt(context, ref.instanceId);
    if (occurrence === undefined) continue;
    const part = parts.get(occurrence.instance.partId);
    const body =
      part === undefined ? undefined : getPartInteractionMetadata(part).bodies.get(ref.bodyId);
    if (body === undefined) continue;
    push(occurrence.instance.partId, {
      slot: occurrence.local,
      elementPickId: 0,
      facePickId: 0,
      nodePickId: 0,
      bodyPickId: ref.bodyId + 1,
      hidden: !isBodyVisible(interaction, ref),
      selected: data.selectedBodyIds.get(ref.instanceId)?.has(ref.bodyId) === true,
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
  const data = readInteractionState(interaction);
  for (const ref of emphasizedElementRefs(interaction)) {
    const occurrence = occurrenceAt(context, ref.instanceId);
    if (occurrence === undefined) continue;
    const part = parts.get(occurrence.instance.partId);
    const metadata = part === undefined ? undefined : getPartInteractionMetadata(part);
    const bodyId = metadata?.bodyByElement.get(ref.elementId);
    const blockId = metadata?.blockByElement.get(ref.elementId);
    const style = resolveElementStyle(
      occurrence.instance,
      ref.elementId,
      defaultStyle,
      interaction,
      { bodyId, blockId },
    );
    push(occurrence.instance.partId, {
      slot: occurrence.local,
      elementPickId: ref.elementId + 1,
      facePickId: 0,
      nodePickId: 0,
      hidden: !isElementVisible(interaction, ref),
      selected: data.selectedElementIds.get(ref.instanceId)?.has(ref.elementId) === true,
      style,
    });
  }
}

/** Collects face-level emphasis records, resolving authored identities to private GPU ids. */
function collectFaceEmphasis(
  context: EmphasisContext,
  parts: ReadonlyMap<PartId, Part>,
  interaction: InteractionState,
  push: (partId: PartId, update: EmphasisUpdate) => void,
): void {
  const data = readInteractionState(interaction);
  for (const ref of emphasizedFaceRefs(interaction)) {
    const occurrence = occurrenceAt(context, ref.instanceId);
    if (occurrence === undefined) continue;
    const part = parts.get(occurrence.instance.partId);
    const metadata = part === undefined ? undefined : getPartInteractionMetadata(part);
    const faceMetadata = metadata?.faces.get(faceRefKey(ref));
    if (faceMetadata === undefined) continue;
    const { face, faceId } = faceMetadata;
    const style = resolveFaceStyle(occurrence.instance, ref, defaultStyle, interaction, {
      bodyId: face.bodyId ?? metadata?.bodyByElement.get(ref.elementId),
      blockId: face.blockId,
    });
    push(occurrence.instance.partId, {
      slot: occurrence.local,
      elementPickId: 0,
      facePickId: faceId + 1,
      nodePickId: 0,
      selected: data.selectedFaces.get(ref.instanceId)?.has(faceRefKey(ref)) === true,
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
  const data = readInteractionState(interaction);
  for (const ref of emphasizedNodeRefs(interaction)) {
    const occurrence = occurrenceAt(context, ref.instanceId);
    if (occurrence === undefined) continue;
    const style = resolveNodeStyle(occurrence.instance, ref, defaultStyle, interaction);
    push(occurrence.instance.partId, {
      slot: occurrence.local,
      elementPickId: 0,
      facePickId: 0,
      nodePickId: ref.nodeId + 1,
      selected: data.selectedNodeIds.get(ref.instanceId)?.has(ref.nodeId) === true,
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
