import {
  clearSelection,
  isTargetHighlighted,
  isTargetSelected,
  selectedTargets,
  setTargetHighlighted,
  setTargetSelected,
  type InteractionState,
} from "../../src/index";
import { elementTarget, type SelectTarget } from "./pick";

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
