import {
  clearSelection,
  isTargetHighlighted,
  isTargetSelected,
  selectedTargets,
  setTargetHighlighted,
  setTargetSelected,
  setTargetsSelected,
  type InteractionState,
} from "../../../src/entries/root";
import { selectedTargetSummary } from "../../../src/interaction/selection-queries";
import type { SceneRuntime } from "../../../src/entries/runtime";
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

/** Replaces the selection with the visible targets returned by one box pick. */
export function replaceTargets(
  interaction: InteractionState,
  targets: readonly SelectTarget[],
): InteractionState {
  return setTargetsSelected(clearSelection(interaction), targets, true);
}

/** Appends each distinct visible target returned by one modified box pick. */
export function appendTargets(
  interaction: InteractionState,
  targets: readonly SelectTarget[],
): InteractionState {
  return setTargetsSelected(interaction, uniqueTargets(targets), true);
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
  return selectedTargets(interaction).map(targetKey);
}

/** Returns whether the current selection contains geometry in a visible occurrence. */
export function hasVisibleSelection(interaction: InteractionState, runtime: SceneRuntime): boolean {
  const visiblePartIds = new Set(
    runtime
      .getInstances()
      .filter((instance) => instance.visible)
      .map((instance) => instance.partId),
  );
  const selection = selectedTargetSummary(interaction);
  for (const partId of selection.partIds) if (visiblePartIds.has(partId)) return true;
  for (const instanceId of selection.instanceIds) {
    if (runtime.isInstanceVisible(instanceId)) return true;
  }
  return false;
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
