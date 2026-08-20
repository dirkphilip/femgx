import type { Part } from "../../geometry/part";
import {
  emphasizedElementRefs,
  resolveBodyStyle,
  resolveElementStyle,
  resolveInstanceStyle,
  type InteractionState,
  type ResolvedStyle,
} from "../../interaction/interaction";
import { emphasizedBodyRefs, isBodyVisible } from "../../interaction/bodies";
import { isElementVisible } from "../../interaction/elements";
import { emphasizedFaceRefs, resolveFaceStyle } from "../../interaction/faces";
import { emphasizedNodeRefs, resolveNodeStyle } from "../../interaction/nodes";
import { emphasizedEdgeRefs, resolveEdgeStyle } from "../../interaction/edges";
import { readInteractionState } from "../../interaction/state";
import { faceIdentity as faceKey } from "../../geometry/element-face-selection";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { PartId } from "../../geometry/part";
import type { PartOccurrence, PartOccurrenceId } from "../../scene/types";
import { BODY_HIGHLIGHT_MARKER, EDGE_HIGHLIGHT_MARKER } from "../selection/highlight-table";
import { defaultStyle } from "./foundation";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import {
  sparseElementEmphasisRefs,
  type DenseElementSelections,
} from "../selection/element-selection";
import {
  partNodeCount,
  sparseNodeEmphasisRefs,
  type DenseNodeSelections,
} from "../selection/node-selection";
export {
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
  INITIAL_ELEMENT_HIGHLIGHTS,
} from "../selection/highlight-layout";
import { ELEMENT_RECORD_STRIDE } from "../selection/highlight-layout";

interface InstanceLayout {
  readonly slotPartLocal: Int32Array;
}

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
  /** Hides the matching body triangles in both color and pick passes. */
  readonly hidden?: boolean;
  /** Marks the matching primitive for the renderer-owned x-ray selection pass. */
  readonly selected?: boolean;
  /** Keeps the active scalar result color beneath this emphasis. */
  readonly keepsResultColor?: boolean;
  readonly style: ResolvedStyle;
}

/** One immutable interaction snapshot shared by highlight and transparency sync. */
export type EmphasisUpdates = ReadonlyMap<PartId, readonly EmphasisUpdate[]>;

interface EmphasisCollectionOptions {
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly interaction: InteractionState;
  readonly denseSelections?: DenseElementSelections;
  readonly denseHidden?: DenseElementSelections;
  readonly denseNodeSelections?: DenseNodeSelections;
  readonly edgeKeysByPart?: ReadonlyMap<PartId, readonly string[]>;
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
  const keyPickId = update.edgePickId ?? update.bodyPickId ?? update.elementPickId;
  const keyMarker =
    update.edgePickId !== undefined
      ? EDGE_HIGHLIGHT_MARKER
      : update.bodyPickId !== undefined
        ? BODY_HIGHLIGHT_MARKER
        : update.facePickId;
  ids[0] = update.slot;
  ids[1] = keyPickId;
  ids[2] = keyMarker;
  ids[3] = update.edgePickId === undefined ? update.nodePickId : 0;
  floats[4] = update.style.color.r;
  floats[5] = update.style.color.g;
  floats[6] = update.style.color.b;
  floats[7] = update.style.color.a * update.style.opacity;
  floats[8] = update.style.emissive;
  ids[9] = update.hidden === true ? 1 : 0;
  ids[10] = update.selected === true ? 1 : 0;
  ids[11] = update.keepsResultColor === true ? 1 : 0;
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
  slotByInstanceId: ReadonlyMap<PartOccurrenceId, number>,
  options: EmphasisCollectionOptions,
): EmphasisUpdates {
  const context = { runtime, layout, slotByInstanceId };
  const { parts, interaction, denseSelections, denseHidden, denseNodeSelections, edgeKeysByPart } =
    options;
  const byPart = new Map<PartId, EmphasisUpdate[]>();
  const push = (partId: PartId, update: EmphasisUpdate): void => {
    const list = byPart.get(partId);
    if (list === undefined) byPart.set(partId, [update]);
    else list.push(update);
  };
  collectBodyEmphasis(context, parts, interaction, push);
  collectElementEmphasis(context, parts, interaction, push, {
    selections: denseSelections,
    hidden: denseHidden,
  });
  collectFaceEmphasis(context, parts, interaction, push);
  collectNodeEmphasis(context, parts, interaction, push, denseNodeSelections);
  collectEdgeEmphasis(context, interaction, edgeKeysByPart, push);
  return byPart;
}

/** Collects authored-edge emphasis records using rendered resource keys. */
function collectEdgeEmphasis(
  context: EmphasisContext,
  interaction: InteractionState,
  edgeKeysByPart: ReadonlyMap<PartId, readonly string[]> | undefined,
  push: (partId: PartId, update: EmphasisUpdate) => void,
): void {
  for (const ref of emphasizedEdgeRefs(interaction)) {
    const occurrence = occurrenceAt(context, ref.partOccurrenceId);
    if (occurrence === undefined) continue;
    const edgePickId = edgeKeysByPart?.get(occurrence.instance.partId)?.indexOf(ref.key);
    if (edgePickId === undefined || edgePickId < 0) continue;
    push(occurrence.instance.partId, {
      slot: occurrence.local,
      elementPickId: 0,
      facePickId: 0,
      nodePickId: 0,
      edgePickId: edgePickId + 1,
      selected:
        readInteractionState(interaction).selectedEdges.get(ref.partOccurrenceId)?.has(ref.key) ===
        true,
      style: resolveEdgeStyle(occurrence.instance, ref, defaultStyle, interaction),
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
    const occurrence = occurrenceAt(context, ref.partOccurrenceId);
    if (occurrence === undefined) continue;
    const part = parts.get(occurrence.instance.partId);
    const body = part === undefined ? undefined : getPartSemanticIndex(part).body(ref.bodyId);
    if (body === undefined) continue;
    const explicitOverride = data.bodyOverrides.get(ref.partOccurrenceId)?.get(ref.bodyId);
    const style = resolveBodyStyle(occurrence.instance, ref.bodyId, defaultStyle, interaction);
    const selected = data.selectedBodyIds.get(ref.partOccurrenceId)?.has(ref.bodyId) === true;
    push(occurrence.instance.partId, {
      slot: occurrence.local,
      elementPickId: 0,
      facePickId: 0,
      nodePickId: 0,
      bodyPickId: ref.bodyId + 1,
      hidden: !isBodyVisible(interaction, ref),
      selected,
      keepsResultColor:
        explicitOverride?.color === undefined &&
        explicitOverride?.opacity === undefined &&
        (selected || keepsResultColor(occurrence.instance, style, interaction)),
      style,
    });
  }
}

/** The occurrence-resolution inputs shared by every emphasis collector. */
interface EmphasisContext {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly slotByInstanceId: ReadonlyMap<PartOccurrenceId, number>;
}

interface DenseElementEmphasis {
  readonly selections: DenseElementSelections | undefined;
  readonly hidden: DenseElementSelections | undefined;
}

/** Collects element-level emphasis records (hover, selection, overrides). */
function collectElementEmphasis(
  context: EmphasisContext,
  parts: ReadonlyMap<PartId, Part>,
  interaction: InteractionState,
  push: (partId: PartId, update: EmphasisUpdate) => void,
  dense: DenseElementEmphasis,
): void {
  const data = readInteractionState(interaction);
  const refs =
    dense.selections === undefined && dense.hidden === undefined
      ? emphasizedElementRefs(interaction)
      : sparseElementEmphasisRefs(
          context.runtime,
          context.layout,
          interaction,
          dense.selections ?? new Map(),
          dense.hidden,
        );
  for (const ref of refs) {
    const occurrence = occurrenceAt(context, ref.partOccurrenceId);
    if (occurrence === undefined) continue;
    const part = parts.get(occurrence.instance.partId);
    const metadata = part === undefined ? undefined : getPartSemanticIndex(part);
    const bodyId = metadata?.bodyForElement(ref.elementId);
    const explicitOverride = data.elementOverrides.get(ref.partOccurrenceId)?.get(ref.elementId);
    const style = resolveElementStyle(
      occurrence.instance,
      ref.elementId,
      defaultStyle,
      interaction,
      bodyId,
    );
    const selected = data.selectedElementIds.get(ref.partOccurrenceId)?.has(ref.elementId) === true;
    push(occurrence.instance.partId, {
      slot: occurrence.local,
      elementPickId: ref.elementId + 1,
      facePickId: 0,
      nodePickId: 0,
      hidden: !isElementVisible(interaction, ref),
      selected,
      keepsResultColor:
        explicitOverride?.color === undefined &&
        explicitOverride?.opacity === undefined &&
        (selected || keepsResultColor(occurrence.instance, style, interaction)),
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
    const occurrence = occurrenceAt(context, ref.partOccurrenceId);
    if (occurrence === undefined) continue;
    const part = parts.get(occurrence.instance.partId);
    const metadata = part === undefined ? undefined : getPartSemanticIndex(part);
    const faceMetadata = metadata?.face(ref.elementId, ref.faceIndex);
    if (faceMetadata === undefined) continue;
    const { face, faceId } = faceMetadata;
    const style = resolveFaceStyle(
      occurrence.instance,
      ref,
      defaultStyle,
      interaction,
      face.bodyId ?? metadata?.bodyForElement(ref.elementId),
    );
    push(occurrence.instance.partId, {
      slot: occurrence.local,
      elementPickId: 0,
      facePickId: faceId + 1,
      nodePickId: 0,
      selected:
        data.selectedFaces.get(ref.partOccurrenceId)?.has(faceKey(ref.elementId, ref.faceIndex)) ===
        true,
      keepsResultColor: keepsResultColor(occurrence.instance, style, interaction),
      style,
    });
  }
}

/** Collects node-level emphasis records. */
function collectNodeEmphasis(
  context: EmphasisContext,
  parts: ReadonlyMap<PartId, Part>,
  interaction: InteractionState,
  push: (partId: PartId, update: EmphasisUpdate) => void,
  denseNodeSelections?: DenseNodeSelections,
): void {
  const data = readInteractionState(interaction);
  const refs =
    denseNodeSelections === undefined
      ? emphasizedNodeRefs(interaction)
      : sparseNodeEmphasisRefs(context.runtime, context.layout, interaction, denseNodeSelections);
  for (const ref of refs) {
    const occurrence = occurrenceAt(context, ref.partOccurrenceId);
    if (occurrence === undefined) continue;
    const part = parts.get(occurrence.instance.partId);
    const nodeCount = part === undefined ? 0 : partNodeCount(part);
    if (!Number.isSafeInteger(ref.nodeId) || ref.nodeId < 0 || ref.nodeId >= nodeCount) continue;
    const style = resolveNodeStyle(occurrence.instance, ref, defaultStyle, interaction);
    push(occurrence.instance.partId, {
      slot: occurrence.local,
      elementPickId: 0,
      facePickId: 0,
      nodePickId: ref.nodeId + 1,
      selected: data.selectedNodeIds.get(ref.partOccurrenceId)?.has(ref.nodeId) === true,
      keepsResultColor: keepsResultColor(occurrence.instance, style, interaction),
      style,
    });
  }
}

function keepsResultColor(
  instance: PartOccurrence,
  style: ResolvedStyle,
  interaction: InteractionState,
): boolean {
  const base = resolveInstanceStyle(instance, defaultStyle, interaction);
  return style.color === base.color && style.opacity === base.opacity;
}

/** Resolves a ref's instance slot to its part-local slot and part id. */
function occurrenceAt(
  context: EmphasisContext,
  instanceId: PartOccurrenceId,
): { readonly instance: PartOccurrence; readonly local: number } | undefined {
  const slot = context.slotByInstanceId.get(instanceId);
  if (slot === undefined) return undefined;
  const partId = context.runtime.instancePartIds[slot];
  const local = context.layout.slotPartLocal[slot];
  if (partId === undefined || local === undefined || local < 0) return undefined;
  return {
    instance: {
      partOccurrenceId: instanceId,
      partId,
      worldTransform: context.runtime.instanceWorldTransforms.subarray(slot * 16, slot * 16 + 16),
    },
    local,
  };
}
