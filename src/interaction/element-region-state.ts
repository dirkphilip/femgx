import { readInteractionState, updateInteractionState, type InteractionStateData } from "./state";
import {
  assertElementRegionSelection,
  copyElementRegionSelection,
  createElementRegionSelection,
  type ElementRegionSelection,
} from "./element-region-selection";
import type { InteractionState } from "./interaction";

const cache = new WeakMap<InteractionState, ElementRegionSelection>();

/** Applies one packed element selection without expanding interaction targets. */
export function setElementRegionSelected(
  state: InteractionState,
  selection: ElementRegionSelection,
  operation: "replace" | "add",
): InteractionState {
  assertElementRegionSelection(selection);
  const data = readInteractionState(state);
  const elements = apply(data.selectedElementIds, selection, operation === "replace");
  if (operation === "add")
    return elements === data.selectedElementIds
      ? state
      : updateInteractionState(state, { selectedElementIds: elements });
  if (onlyElements(data) && equals(data.selectedElementIds, selection)) return state;
  return updateInteractionState(state, {
    selectedPartIds: new Set(),
    selectedPartOccurrenceIds: new Set(),
    selectedBodyIds: new Map(),
    selectedElementIds: elements,
    selectedFaces: new Map(),
    selectedNodeIds: new Map(),
    selectedEdges: new Map(),
  });
}

/** Returns caller-owned packed columns for the current selected elements. */
export function selectedElementRegion(state: InteractionState): ElementRegionSelection {
  let cached = cache.get(state);
  if (cached === undefined) {
    cached = createElementRegionSelection(readInteractionState(state).selectedElementIds);
    cache.set(state, cached);
  }
  return copyElementRegionSelection(cached);
}

function apply(
  current: ReadonlyMap<string, ReadonlySet<number>>,
  selection: ElementRegionSelection,
  replace: boolean,
): ReadonlyMap<string, ReadonlySet<number>> {
  const base = replace ? new Map<string, ReadonlySet<number>>() : current;
  let next: Map<string, ReadonlySet<number>> | undefined;
  for (let group = 0; group < selection.partOccurrenceIds.length; group += 1) {
    const occurrence = selection.partOccurrenceIds[group];
    const start = selection.offsets[group];
    const end = selection.offsets[group + 1];
    if (occurrence === undefined || start === undefined || end === undefined) continue;
    const existing = base.get(occurrence);
    let values: Set<number> | undefined;
    for (let index = start; index < end; index += 1) {
      const id = selection.elementIds[index];
      if (id !== undefined && existing?.has(id) !== true)
        (values ??= new Set(existing ?? [])).add(id);
    }
    if (values !== undefined) (next ??= new Map(base)).set(occurrence, values);
  }
  return next ?? base;
}

function onlyElements(data: InteractionStateData): boolean {
  return (
    data.selectedPartIds.size === 0 &&
    data.selectedPartOccurrenceIds.size === 0 &&
    data.selectedBodyIds.size === 0 &&
    data.selectedFaces.size === 0 &&
    data.selectedNodeIds.size === 0 &&
    data.selectedEdges.size === 0
  );
}

function equals(
  current: ReadonlyMap<string, ReadonlySet<number>>,
  selection: ElementRegionSelection,
): boolean {
  if (current.size !== selection.partOccurrenceIds.length) return false;
  for (let group = 0; group < selection.partOccurrenceIds.length; group += 1) {
    const occurrence = selection.partOccurrenceIds[group];
    const start = selection.offsets[group];
    const end = selection.offsets[group + 1];
    const values = occurrence === undefined ? undefined : current.get(occurrence);
    if (
      values === undefined ||
      start === undefined ||
      end === undefined ||
      values.size !== end - start
    )
      return false;
    for (let index = start; index < end; index += 1)
      if (!values.has(selection.elementIds[index] ?? -1)) return false;
  }
  return true;
}
