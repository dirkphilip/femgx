import type { InteractionState } from "./interaction";
import type { BodyId } from "../geometry/part";
import { resolveBodyStyle, resolveInstanceStyle, type ResolvedStyle } from "./interaction";
import type { FaceRef } from "./refs";
import type { Instance } from "../scene/types";
import {
  applyStyleLayers,
  collectUniqueRefs,
  sameRef,
  sortedStrings,
  updateNestedMap,
} from "./mechanics";

function updateFaceSet(
  state: InteractionState,
  key: "selectedFaces" | "highlightedFaces",
  ref: FaceRef,
  enabled: boolean,
): InteractionState {
  const map = updateNestedMap(
    state[key],
    ref.instanceId,
    ref.faceKey,
    enabled ? ref.elementId : undefined,
  );
  if (map === state[key]) return state;
  return { ...state, [key]: map };
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

/** Sets the currently hovered face, or clears hover with `undefined`. */
export function setHoveredFace(
  state: InteractionState,
  ref: FaceRef | undefined,
): InteractionState {
  if (
    sameRef(state.hoveredFace, ref, (value) => [value.instanceId, value.elementId, value.faceKey])
  ) {
    return state;
  }
  if (ref === undefined) {
    const { hoveredFace: _, ...withoutHover } = state;
    return withoutHover;
  }
  return { ...state, hoveredFace: ref };
}

/** Returns whether a face occurrence carries emphasis (hover, highlight, selection). */
export function isFaceEmphasized(state: InteractionState, ref: FaceRef): boolean {
  return (
    (state.hoveredFace?.instanceId === ref.instanceId &&
      state.hoveredFace.elementId === ref.elementId &&
      state.hoveredFace.faceKey === ref.faceKey) ||
    state.highlightedFaces.get(ref.instanceId)?.has(ref.faceKey) === true ||
    state.selectedFaces.get(ref.instanceId)?.has(ref.faceKey) === true
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
  const style =
    bodyId === undefined
      ? resolveInstanceStyle(instance, base, state)
      : resolveBodyStyle(instance, bodyId, base, state);
  return applyStyleLayers(style, [
    state.highlightedFaces.get(ref.instanceId)?.has(ref.faceKey) === true
      ? state.theme.highlighted
      : undefined,
    sameRef(state.hoveredFace, ref, (value) => [value.instanceId, value.elementId, value.faceKey])
      ? state.theme.hoveredFace
      : undefined,
    state.selectedFaces.get(ref.instanceId)?.has(ref.faceKey) === true
      ? state.theme.selectedFace
      : undefined,
  ]);
}

/**
 * Collects every face occurrence that currently carries face-level emphasis
 * (hovered, highlighted, or selected), in deterministic order with no
 * duplicates.
 */
export function emphasizedFaceRefs(state: InteractionState): readonly FaceRef[] {
  return collectUniqueRefs(
    state.hoveredFace,
    (ref) => `${ref.instanceId}/${ref.faceKey}`,
    (push) => {
      for (const [instanceId, faces] of state.highlightedFaces) {
        for (const faceKey of sortedStrings(faces.keys())) {
          const elementId = faces.get(faceKey);
          if (elementId !== undefined) push({ instanceId, elementId, faceKey });
        }
      }
      for (const [instanceId, faces] of state.selectedFaces) {
        for (const faceKey of sortedStrings(faces.keys())) {
          const elementId = faces.get(faceKey);
          if (elementId !== undefined) push({ instanceId, elementId, faceKey });
        }
      }
    },
  );
}
