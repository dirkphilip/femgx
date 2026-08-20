import {
  clearSelection,
  isTargetHighlighted,
  isTargetSelected,
  selectedTargets,
  setTargetHighlighted,
  setTargetSelected,
  setTargetsSelected,
  type InteractionState,
} from "@/entries/interaction";
import { selectedTargetCount, selectedTargetSummary } from "@/interaction/selection-queries";
import type { PartId } from "@/entries/root";
import type { SceneOccurrences } from "@/entries/root";
import { elementTarget, targetKey, type SelectTarget } from "./pick";

const MAX_EXACT_SELECTION_DATASET_TARGETS = 256;

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

/** Counts selection without materializing target objects for presentation-only status. */
export function selectedCount(interaction: InteractionState): number {
  return selectedTargetCount(interaction);
}

/** Keeps the browser-test seam bounded when a dense selection contains many identities. */
export function selectionDatasetValue(interaction: InteractionState): string {
  const count = selectedCount(interaction);
  return count > MAX_EXACT_SELECTION_DATASET_TARGETS
    ? `count:${count}`
    : selectedKeys(interaction).join(",");
}

/** Returns whether the current selection contains geometry in a visible occurrence. */
export function hasVisibleSelection(
  interaction: InteractionState,
  runtime: SceneOccurrences,
): boolean {
  const visiblePartIds = visiblePartIdsFor(runtime);
  const selection = selectedTargetSummary(interaction);
  for (const partId of selection.partIds) if (visiblePartIds.has(partId)) return true;
  for (const partOccurrenceId of selection.partOccurrenceIds) {
    if (runtime.isPartOccurrenceVisible(partOccurrenceId)) return true;
  }
  return false;
}

function visiblePartIdsFor(runtime: SceneOccurrences): Set<PartId> {
  const visiblePartIds = new Set<PartId>();
  for (const partOccurrenceId of runtime.visiblePartOccurrenceIds()) {
    const partId = runtime.getPartId(partOccurrenceId);
    if (partId !== undefined) visiblePartIds.add(partId);
  }
  return visiblePartIds;
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
