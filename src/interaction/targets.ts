import type { ElementId, NodeId } from "../elements/element";
import type { FaceKey } from "../elements/faces";
import type { BodyId, PartId } from "../geometry/part";
import type { InstanceId } from "../scene/types";
import { setBodyHighlighted, setBodySelected } from "./bodies";
import { setFaceHighlighted, setFaceSelected } from "./faces";
import { setNodeHighlighted, setNodeSelected } from "./nodes";
import {
  setElementHighlighted,
  setElementSelected,
  setInstanceHighlighted,
  setInstanceSelected,
  setPartHighlighted,
  setPartSelected,
  type InteractionState,
} from "./interaction";

/** One stable identity that can be selected or highlighted. */
export type InteractionTarget =
  | { readonly kind: "part"; readonly partId: PartId }
  | { readonly kind: "instance"; readonly instanceId: InstanceId }
  | { readonly kind: "body"; readonly instanceId: InstanceId; readonly bodyId: BodyId }
  | { readonly kind: "element"; readonly instanceId: InstanceId; readonly elementId: ElementId }
  | {
      readonly kind: "face";
      readonly instanceId: InstanceId;
      readonly elementId: ElementId;
      readonly key: FaceKey;
    }
  | { readonly kind: "node"; readonly instanceId: InstanceId; readonly nodeId: NodeId };

/** Sets or clears selection for any supported stable interaction target. */
export function setTargetSelected(
  state: InteractionState,
  target: InteractionTarget,
  selected: boolean,
): InteractionState {
  switch (target.kind) {
    case "part":
      return setPartSelected(state, target.partId, selected);
    case "instance":
      return setInstanceSelected(state, target.instanceId, selected);
    case "body":
      return setBodySelected(state, target, selected);
    case "element":
      return setElementSelected(state, target, selected);
    case "face":
      return setFaceSelected(state, { ...target, faceKey: target.key }, selected);
    case "node":
      return setNodeSelected(state, target, selected);
  }
}

/** Sets or clears highlight for any supported stable interaction target. */
export function setTargetHighlighted(
  state: InteractionState,
  target: InteractionTarget,
  highlighted: boolean,
): InteractionState {
  switch (target.kind) {
    case "part":
      return setPartHighlighted(state, target.partId, highlighted);
    case "instance":
      return setInstanceHighlighted(state, target.instanceId, highlighted);
    case "body":
      return setBodyHighlighted(state, target, highlighted);
    case "element":
      return setElementHighlighted(state, target, highlighted);
    case "face":
      return setFaceHighlighted(state, { ...target, faceKey: target.key }, highlighted);
    case "node":
      return setNodeHighlighted(state, target, highlighted);
  }
}

/** Applies one deterministic, duplicate-safe highlight operation to many targets. */
export function setTargetsHighlighted(
  state: InteractionState,
  targets: readonly InteractionTarget[],
  highlighted: boolean,
): InteractionState {
  let next = state;
  for (const target of targets) {
    next = setTargetHighlighted(next, target, highlighted);
  }
  return next;
}

/** Clears all six selection collections while preserving every other state layer. */
export function clearSelection(state: InteractionState): InteractionState {
  if (
    state.selectedPartIds.size === 0 &&
    state.selectedInstanceIds.size === 0 &&
    state.selectedBodyIds.size === 0 &&
    state.selectedElementIds.size === 0 &&
    state.selectedFaces.size === 0 &&
    state.selectedNodeIds.size === 0
  ) {
    return state;
  }
  return {
    ...state,
    selectedPartIds: new Set(),
    selectedInstanceIds: new Set(),
    selectedBodyIds: new Map(),
    selectedElementIds: new Map(),
    selectedFaces: new Map(),
    selectedNodeIds: new Map(),
  };
}
