import type { InteractionState } from "../interaction/interaction";
import { readInteractionState } from "../interaction/state";

/** Returns whether immutable interaction state changes cap geometry admission. */
export function sectionCapVisibilityChanged(
  previous: InteractionState,
  next: InteractionState,
): boolean {
  const before = readInteractionState(previous);
  const after = readInteractionState(next);
  return (
    !sameHiddenElements(before.hiddenBodyIds, after.hiddenBodyIds) ||
    !sameHiddenElements(before.hiddenElementIds, after.hiddenElementIds)
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
