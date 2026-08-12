import type { BodyId } from "../geometry/part";
import {
  isHoveredTarget,
  readInteractionState,
  updateInteractionState,
  type InteractionState,
  type ResolvedStyle,
} from "./state";
import { resolveBodyStyle, resolveInstanceStyle } from "./interaction";
import type { FaceRef } from "./refs";
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
    ref.faceKey,
    enabled ? ref.elementId : undefined,
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
      key: ref.faceKey,
    }) ||
    data.highlightedFaces.get(ref.instanceId)?.has(ref.faceKey) === true ||
    data.selectedFaces.get(ref.instanceId)?.has(ref.faceKey) === true
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
  bodyId?: BodyId,
): ResolvedStyle {
  const data = readInteractionState(state);
  const style =
    bodyId === undefined
      ? resolveInstanceStyle(instance, base, state)
      : resolveBodyStyle(instance, bodyId, base, state);
  return applyStyleLayers(style, [
    data.highlightedFaces.get(ref.instanceId)?.has(ref.faceKey) === true
      ? data.theme.highlighted
      : undefined,
    isHoveredTarget(state, {
      kind: "face",
      instanceId: ref.instanceId,
      elementId: ref.elementId,
      key: ref.faceKey,
    })
      ? data.theme.hoveredFace
      : undefined,
    data.selectedFaces.get(ref.instanceId)?.has(ref.faceKey) === true
      ? data.theme.selectedFace
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
          faceKey: data.hoveredTarget.key,
        }
      : undefined,
    (ref) => `${ref.instanceId}/${ref.faceKey}`,
    (push) => {
      for (const [instanceId, faces] of data.highlightedFaces) {
        for (const faceKey of sortedStrings(faces.keys())) {
          const elementId = faces.get(faceKey);
          if (elementId !== undefined) push({ instanceId, elementId, faceKey });
        }
      }
      for (const [instanceId, faces] of data.selectedFaces) {
        for (const faceKey of sortedStrings(faces.keys())) {
          const elementId = faces.get(faceKey);
          if (elementId !== undefined) push({ instanceId, elementId, faceKey });
        }
      }
    },
  );
}
