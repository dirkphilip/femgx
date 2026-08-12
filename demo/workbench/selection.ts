import {
  clearSelection,
  isTargetHighlighted,
  isTargetSelected,
  selectedTargets,
  setTargetHighlighted,
  setTargetSelected,
  type InteractionState,
} from "../../src/index";
import { elementTarget, targetKey, type SelectTarget } from "./pick";

/** Applies one selection toggle without coupling it to the DOM or renderer. */
export function toggleSelection(
  interaction: InteractionState,
  target: SelectTarget,
): InteractionState {
  return setTargetSelected(interaction, target, !isSelected(interaction, target));
}

/** Removes every selected target while preserving hover, highlights, and styles. */
export { clearSelection };

/** Replaces the selection for a plain click, toggling off an already selected target. */
export function replaceSelection(
  interaction: InteractionState,
  target: SelectTarget,
): InteractionState {
  if (isSelected(interaction, target)) return clearSelection(interaction);
  return toggleSelection(clearSelection(interaction), target);
}

/** Selects an owning element directly, or removes only that element if selected. */
export function toggleElementSelection(
  interaction: InteractionState,
  target: SelectTarget,
): InteractionState {
  const element = elementTarget(target);
  if (element === undefined) return interaction;
  if (isSelected(interaction, element)) return setTargetSelected(interaction, element, false);
  return replaceSelection(interaction, element);
}

/** Replaces the selection with the visible elements returned by one box pick. */
export function replaceElementSelection(
  interaction: InteractionState,
  targets: readonly SelectTarget[],
): InteractionState {
  let next = clearSelection(interaction);
  for (const target of uniqueTargets(targets)) next = setTargetSelected(next, target, true);
  return next;
}

/** Toggles each distinct visible element returned by one box pick. */
export function toggleElementSelections(
  interaction: InteractionState,
  targets: readonly SelectTarget[],
): InteractionState {
  let next = interaction;
  for (const target of uniqueTargets(targets)) {
    next = setTargetSelected(next, target, !isSelected(next, target));
  }
  return next;
}

/** Applies one highlight toggle without coupling it to the DOM or renderer. */
export function toggleHighlight(
  interaction: InteractionState,
  target: SelectTarget,
): InteractionState {
  return setTargetHighlighted(interaction, target, !isHighlighted(interaction, target));
}

/** Stable selection keys used by demo diagnostics and e2e assertions. */
export function selectedKeys(interaction: InteractionState): string[] {
  const keys: string[] = [];
  for (const target of selectedTargets(interaction)) {
    switch (target.kind) {
      case "node":
        keys.push(`n:${target.instanceId}:${target.nodeId}`);
        break;
      case "face":
        keys.push(`f:${target.instanceId}:${target.elementId}:${target.key}`);
        break;
      case "element":
        keys.push(`e:${target.instanceId}:${target.elementId}`);
        break;
      case "instance":
        keys.push(`i:${target.instanceId}`);
        break;
      case "part":
        keys.push(`p:${target.partId}`);
        break;
    }
  }
  return keys;
}

function isSelected(interaction: InteractionState, target: SelectTarget): boolean {
  return isTargetSelected(interaction, target);
}

function isHighlighted(interaction: InteractionState, target: SelectTarget): boolean {
  return isTargetHighlighted(interaction, target);
}

function uniqueTargets(targets: readonly SelectTarget[]): SelectTarget[] {
  const seen = new Set<string>();
  const unique: SelectTarget[] = [];
  for (const target of targets) {
    const key = targetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }
  return unique;
}
