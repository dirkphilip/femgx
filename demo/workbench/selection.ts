import {
  setElementOverride,
  setElementSelected,
  setFaceHighlighted,
  setFaceSelected,
  setInstanceHighlighted,
  setInstanceSelected,
  setNodeHighlighted,
  setNodeSelected,
  setPartHighlighted,
  setPartSelected,
  type ElementRef,
  type InteractionState,
} from "../../src/index";
import type { SelectTarget } from "../pick";

/** Applies one selection toggle without coupling it to the DOM or renderer. */
export function toggleSelection(
  interaction: InteractionState,
  target: SelectTarget,
): InteractionState {
  const state = interaction;
  switch (target.kind) {
    case "node": {
      const on = state.selectedNodeIds.get(target.instanceId)?.has(target.nodeId) ?? false;
      return setNodeSelected(state, { instanceId: target.instanceId, nodeId: target.nodeId }, !on);
    }
    case "face": {
      const on = state.selectedFaces.get(target.instanceId)?.has(target.faceKey) ?? false;
      return setFaceSelected(
        state,
        { instanceId: target.instanceId, elementId: target.elementId, faceKey: target.faceKey },
        !on,
      );
    }
    case "element": {
      const on = state.selectedElementIds.get(target.instanceId)?.has(target.elementId) ?? false;
      return setElementSelected(
        state,
        { instanceId: target.instanceId, elementId: target.elementId },
        !on,
      );
    }
    case "instance":
      return setInstanceSelected(
        state,
        target.instanceId,
        !state.selectedInstanceIds.has(target.instanceId),
      );
    case "part":
      return setPartSelected(state, target.partId, !state.selectedPartIds.has(target.partId));
  }
}

/** Applies one highlight toggle without coupling it to the DOM or renderer. */
export function toggleHighlight(
  interaction: InteractionState,
  target: SelectTarget,
): InteractionState {
  const state = interaction;
  switch (target.kind) {
    case "node": {
      const on = state.highlightedNodeIds.get(target.instanceId)?.has(target.nodeId) ?? false;
      return setNodeHighlighted(
        state,
        { instanceId: target.instanceId, nodeId: target.nodeId },
        !on,
      );
    }
    case "face": {
      const on = state.highlightedFaces.get(target.instanceId)?.has(target.faceKey) ?? false;
      return setFaceHighlighted(
        state,
        { instanceId: target.instanceId, elementId: target.elementId, faceKey: target.faceKey },
        !on,
      );
    }
    case "element": {
      const ref: ElementRef = { instanceId: target.instanceId, elementId: target.elementId };
      const has = state.elementOverrides.get(ref.instanceId)?.has(ref.elementId) ?? false;
      return setElementOverride(state, ref, has ? undefined : { emissive: 0.35 });
    }
    case "instance":
      return setInstanceHighlighted(
        state,
        target.instanceId,
        !state.highlightedInstanceIds.has(target.instanceId),
      );
    case "part":
      return setPartHighlighted(state, target.partId, !state.highlightedPartIds.has(target.partId));
  }
}

/** Stable selection keys used by demo diagnostics and e2e assertions. */
export function selectedKeys(interaction: InteractionState): string[] {
  const keys: string[] = [];
  for (const [instanceId, ids] of sortedMap(interaction.selectedNodeIds)) {
    for (const nodeId of sortedNumbers(ids)) keys.push(`n:${instanceId}:${nodeId}`);
  }
  for (const [instanceId, faces] of sortedMap(interaction.selectedFaces)) {
    for (const [faceKey, elementId] of sortedFaces(faces)) {
      keys.push(`f:${instanceId}:${elementId}:${faceKey}`);
    }
  }
  for (const [instanceId, ids] of sortedMap(interaction.selectedElementIds)) {
    for (const elementId of sortedNumbers(ids)) keys.push(`e:${instanceId}:${elementId}`);
  }
  for (const instanceId of sortedStrings(interaction.selectedInstanceIds))
    keys.push(`i:${instanceId}`);
  for (const partId of sortedNumbers(interaction.selectedPartIds)) keys.push(`p:${partId}`);
  return keys;
}

function sortedMap<K, V>(map: ReadonlyMap<K, V>): Array<readonly [K, V]> {
  return [...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

function sortedNumbers(values: Iterable<number>): number[] {
  return [...values].sort((a, b) => a - b);
}

function sortedStrings(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function sortedFaces(faces: ReadonlyMap<string, number>): Array<readonly [string, number]> {
  return [...faces.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
