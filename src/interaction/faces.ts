import type { ElementId } from "../elements/element";
import type { FaceKey } from "../elements/faces";
import type { InstanceId } from "../scene/types";
import type { InteractionState } from "./interaction";
import { resolveInstanceStyle, type ResolvedStyle } from "./interaction";
import type { FaceRef } from "./refs";
import type { Instance } from "../scene/types";

function updateFaceSet(
  state: InteractionState,
  key: "selectedFaces" | "highlightedFaces",
  ref: FaceRef,
  enabled: boolean,
): InteractionState {
  const current = state[key].get(ref.instanceId);
  const has = current?.has(ref.faceKey) ?? false;
  if (has === enabled) return state;
  const faces = new Map(current ?? []);
  if (enabled) faces.set(ref.faceKey, ref.elementId);
  else faces.delete(ref.faceKey);
  const map = new Map(state[key]);
  if (faces.size === 0) map.delete(ref.instanceId);
  else map.set(ref.instanceId, faces);
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
  const current = state.hoveredFace;
  if (current === ref) return state;
  if (
    current !== undefined &&
    ref !== undefined &&
    current.instanceId === ref.instanceId &&
    current.elementId === ref.elementId &&
    current.faceKey === ref.faceKey
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
): ResolvedStyle {
  let style = resolveInstanceStyle(instance, base, state);
  if (state.highlightedFaces.get(ref.instanceId)?.has(ref.faceKey) === true) {
    style = { ...style, ...state.theme.highlighted };
  }
  if (
    state.hoveredFace?.instanceId === ref.instanceId &&
    state.hoveredFace.elementId === ref.elementId &&
    state.hoveredFace.faceKey === ref.faceKey
  ) {
    style = { ...style, ...state.theme.hoveredFace };
  }
  if (state.selectedFaces.get(ref.instanceId)?.has(ref.faceKey) === true) {
    style = { ...style, ...state.theme.selectedFace };
  }
  return style;
}

/**
 * Collects every face occurrence that currently carries face-level emphasis
 * (hovered, highlighted, or selected), in deterministic order with no
 * duplicates.
 */
export function emphasizedFaceRefs(state: InteractionState): readonly FaceRef[] {
  const refs: FaceRef[] = [];
  const seen = new Set<string>();
  const push = (instanceId: InstanceId, elementId: ElementId, faceKey: FaceKey): void => {
    const key = `${instanceId}/${faceKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ instanceId, elementId, faceKey });
  };
  const hovered = state.hoveredFace;
  if (hovered !== undefined) push(hovered.instanceId, hovered.elementId, hovered.faceKey);
  for (const [instanceId, faces] of state.highlightedFaces) {
    for (const faceKey of sortedKeys(faces)) {
      const elementId = faces.get(faceKey);
      if (elementId !== undefined) push(instanceId, elementId, faceKey);
    }
  }
  for (const [instanceId, faces] of state.selectedFaces) {
    for (const faceKey of sortedKeys(faces)) {
      const elementId = faces.get(faceKey);
      if (elementId !== undefined) push(instanceId, elementId, faceKey);
    }
  }
  return refs;
}

function sortedKeys(faces: ReadonlyMap<FaceKey, ElementId>): FaceKey[] {
  return Array.from(faces.keys()).sort();
}
