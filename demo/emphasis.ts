import {
  emphasizedFaceRefs,
  emphasizedNodeRefs,
  type ElementId,
  type ElementModel,
  type InstanceId,
  type InteractionState,
  type PartId,
  type SceneRuntime,
  type StyleOverride,
} from "../src/index";

/**
 * Derives per-element style overrides from node and face emphasis so both
 * renderers can emphasize a node or face selection without new geometry: a
 * selected/hovered node emphasizes every element sharing the node, and a
 * selected/hovered face emphasizes its owning element. Explicit element
 * overrides (context-menu highlight) merge in last.
 */

export interface EmphasisContext {
  readonly runtime: SceneRuntime;
  readonly slotByInstanceId: ReadonlyMap<InstanceId, number>;
  readonly elementModels: ReadonlyMap<PartId, ElementModel>;
}

/** Rebuilds `elementOverrides` from explicit + node/face emphasis state. */
export function rebuildElementOverrides(
  state: InteractionState,
  ctx: EmphasisContext,
  explicit: ReadonlyMap<InstanceId, ReadonlyMap<ElementId, StyleOverride>>,
): InteractionState {
  const overrides = new Map<InstanceId, Map<ElementId, StyleOverride>>();
  const add = (instanceId: InstanceId, elementId: ElementId, style: StyleOverride): void => {
    let elements = overrides.get(instanceId);
    if (elements === undefined) {
      elements = new Map();
      overrides.set(instanceId, elements);
    }
    elements.set(elementId, style);
  };
  for (const [instanceId, elements] of explicit) {
    for (const [elementId, style] of elements) add(instanceId, elementId, style);
  }
  for (const ref of emphasizedNodeRefs(state)) {
    const style = nodeEmphasisStyle(state, ref.instanceId, ref.nodeId);
    if (style === undefined) continue;
    const slot = ctx.slotByInstanceId.get(ref.instanceId);
    if (slot === undefined) continue;
    const partId = ctx.runtime.instancePartIds[slot];
    if (partId === undefined) continue;
    const model = ctx.elementModels.get(partId);
    if (model === undefined) continue;
    for (const element of model.elements) {
      if (element.nodeIds.includes(ref.nodeId)) add(ref.instanceId, element.id, style);
    }
  }
  for (const ref of emphasizedFaceRefs(state)) {
    const style = faceEmphasisStyle(state, ref.instanceId, ref.elementId, ref.faceKey);
    if (style === undefined) continue;
    add(ref.instanceId, ref.elementId, style);
  }
  return { ...state, elementOverrides: overrides };
}

/** The style for an emphasized node occurrence, or undefined when none. */
export function nodeEmphasisStyle(
  state: InteractionState,
  instanceId: InstanceId,
  nodeId: number,
): StyleOverride | undefined {
  const hovered = state.hoveredNode;
  if (hovered !== undefined && hovered.instanceId === instanceId && hovered.nodeId === nodeId) {
    return state.theme.hoveredNode;
  }
  if (state.highlightedNodeIds.get(instanceId)?.has(nodeId) === true) {
    return state.theme.highlighted;
  }
  if (state.selectedNodeIds.get(instanceId)?.has(nodeId) === true) {
    return state.theme.selectedNode;
  }
  return undefined;
}

/** The style for an emphasized face occurrence, or undefined when none. */
export function faceEmphasisStyle(
  state: InteractionState,
  instanceId: InstanceId,
  elementId: ElementId,
  faceKey: string,
): StyleOverride | undefined {
  const hovered = state.hoveredFace;
  if (
    hovered !== undefined &&
    hovered.instanceId === instanceId &&
    hovered.elementId === elementId &&
    hovered.faceKey === faceKey
  ) {
    return state.theme.hoveredFace;
  }
  if (state.highlightedFaces.get(instanceId)?.has(faceKey) === true) {
    return state.theme.highlighted;
  }
  if (state.selectedFaces.get(instanceId)?.has(faceKey) === true) {
    return state.theme.selectedFace;
  }
  return undefined;
}
