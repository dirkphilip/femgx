import type { BodyId } from "../geometry/part";
import {
  isHoveredTarget,
  readInteractionState,
  updateInteractionState,
  type InteractionState,
  type ResolvedStyle,
} from "./state";
import {
  applySelectionStyle,
  resolveBodyStyle,
  resolveElementBlockStyle,
  resolveInstanceStyle,
} from "./interaction";
import type { ElementBlockId } from "../elements/model";
import { faceRefKey, type FaceRef } from "./refs";
import type { Instance } from "../scene/types";
import { applyStyleLayers, collectUniqueRefs, sortedStrings, updateNestedMap } from "./mechanics";

function updateFaceSet(
  state: InteractionState,
  key: "selectedFaces" | "highlightedFaces",
  ref: FaceRef,
  enabled: boolean,
): InteractionState {
  const data = readInteractionState(state);
  const map = updateNestedMap(
    data[key],
    ref.instanceId,
    faceRefKey(ref),
    enabled ? ref : undefined,
  );
  if (map === data[key]) return state;
  return updateInteractionState(state, { [key]: map });
}

/** Sets or clears a face selection without mutating the previous state. */
export function setFaceSelected(
  state: InteractionState,
  ref: FaceRef,
  selected: boolean,
): InteractionState {
  return updateFaceSet(state, "selectedFaces", ref, selected);
}

/** Sets or clears a face highlight without mutating the previous state. */
export function setFaceHighlighted(
  state: InteractionState,
  ref: FaceRef,
  highlighted: boolean,
): InteractionState {
  return updateFaceSet(state, "highlightedFaces", ref, highlighted);
}

/** Returns whether a face occurrence carries emphasis (hover, highlight, selection). */
export function isFaceEmphasized(state: InteractionState, ref: FaceRef): boolean {
  const data = readInteractionState(state);
  return (
    isHoveredTarget(state, {
      kind: "face",
      instanceId: ref.instanceId,
      elementId: ref.elementId,
      faceIndex: ref.faceIndex,
    }) ||
    data.highlightedFaces.get(ref.instanceId)?.has(faceRefKey(ref)) === true ||
    data.selectedFaces.get(ref.instanceId)?.has(faceRefKey(ref)) === true
  );
}

/**
 * Resolves the style of one face occurrence. Face-level state is more specific
 * than part/instance state, so face highlight, hover, and selection win over
 * `resolveInstanceStyle`; selection beats hover, and hover beats highlight.
 */
export function resolveFaceStyle(
  instance: Instance,
  ref: FaceRef,
  base: ResolvedStyle,
  state: InteractionState,
  ownership?:
    | BodyId
    | {
        readonly bodyId?: BodyId | undefined;
        readonly blockId?: ElementBlockId | undefined;
      },
): ResolvedStyle {
  const data = readInteractionState(state);
  const bodyId = typeof ownership === "number" ? ownership : ownership?.bodyId;
  const blockId = typeof ownership === "number" ? undefined : ownership?.blockId;
  const style =
    blockId === undefined
      ? bodyId === undefined
        ? resolveInstanceStyle(instance, base, state)
        : resolveBodyStyle(instance, bodyId, base, state)
      : resolveElementBlockStyle(instance, blockId, base, state, bodyId);
  return applyStyleLayers(style, [
    data.highlightedFaces.get(ref.instanceId)?.has(faceRefKey(ref)) === true
      ? data.theme.highlighted
      : undefined,
    isHoveredTarget(state, {
      kind: "face",
      instanceId: ref.instanceId,
      elementId: ref.elementId,
      faceIndex: ref.faceIndex,
    })
      ? data.theme.hoveredFace
      : undefined,
    data.selectedFaces.get(ref.instanceId)?.has(faceRefKey(ref)) === true
      ? applySelectionStyle(style, data.theme.selectedFace)
      : undefined,
  ]);
}

/**
 * Collects every face occurrence that currently carries face-level emphasis
 * (hovered, highlighted, or selected), in deterministic order with no
 * duplicates.
 */
export function emphasizedFaceRefs(state: InteractionState): readonly FaceRef[] {
  const data = readInteractionState(state);
  return collectUniqueRefs(
    data.hoveredTarget?.kind === "face"
      ? {
          instanceId: data.hoveredTarget.instanceId,
          elementId: data.hoveredTarget.elementId,
          faceIndex: data.hoveredTarget.faceIndex,
        }
      : undefined,
    (ref) => `${ref.instanceId}/${faceRefKey(ref)}`,
    (push) => {
      for (const [, faces] of data.highlightedFaces) {
        for (const key of sortedStrings(faces.keys())) {
          const ref = faces.get(key);
          if (ref !== undefined) push(ref);
        }
      }
      for (const [, faces] of data.selectedFaces) {
        for (const key of sortedStrings(faces.keys())) {
          const ref = faces.get(key);
          if (ref !== undefined) push(ref);
        }
      }
    },
  );
}
