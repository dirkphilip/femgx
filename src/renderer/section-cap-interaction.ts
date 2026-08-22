import type { InteractionState } from "../interaction/interaction";
import { readInteractionVisibility } from "../interaction/state";

/** Returns whether immutable interaction state changes cap geometry admission. */
export function sectionCapVisibilityChanged(
  previous: InteractionState,
  next: InteractionState,
): boolean {
  const before = readInteractionVisibility(previous);
  const after = readInteractionVisibility(next);
  return (
    !sameHiddenElements(before.hiddenBodyIds, after.hiddenBodyIds) ||
    !sameHiddenElements(before.hiddenElementIds, after.hiddenElementIds)
  );
}

/** Returns whether a visibility update can only remove admitted cap elements. */
export function sectionCapVisibilityCanOnlyReduce(
  previous: InteractionState,
  next: InteractionState,
): boolean {
  const before = readInteractionVisibility(previous);
  const after = readInteractionVisibility(next);
  return (
    hiddenSetsIncluded(before.hiddenBodyIds, after.hiddenBodyIds) &&
    hiddenSetsIncluded(before.hiddenElementIds, after.hiddenElementIds)
  );
}

function sameHiddenElements(
  left: ReadonlyMap<string, ReadonlySet<number>>,
  right: ReadonlyMap<string, ReadonlySet<number>>,
): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [instanceId, leftIds] of left) {
    const rightIds = right.get(instanceId);
    if (rightIds === undefined || leftIds.size !== rightIds.size) return false;
    for (const id of leftIds) if (!rightIds.has(id)) return false;
  }
  return true;
}

function hiddenSetsIncluded(
  before: ReadonlyMap<string, ReadonlySet<number>>,
  after: ReadonlyMap<string, ReadonlySet<number>>,
): boolean {
  for (const [instanceId, ids] of before) {
    const next = after.get(instanceId);
    if (next === undefined) return false;
    for (const id of ids) if (!next.has(id)) return false;
  }
  return true;
}
