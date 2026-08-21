import { type InteractionState, type ResolvedStyle } from "../../interaction/interaction";
import { resolveInstanceStyleLayers } from "../../interaction/instance-style";
import { readInteractionState } from "../../interaction/state";
import type { InteractionTarget } from "../../interaction/target-types";
import {
  instanceMatchesAssemblyId,
  instanceMatchesAssemblyOccurrence,
  instanceMatchesAssemblyTarget,
} from "../../scene-runtime/interaction-hierarchy";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";

/** Resolves one instance style with private assembly-target projection. */
export function resolveRuntimeInstanceStyle(
  runtime: PackedSceneRuntime,
  slot: number,
  base: ResolvedStyle,
  interaction: InteractionState,
  includeSelection = true,
): ResolvedStyle {
  const partId = runtime.instancePartIds[slot];
  const instanceId = runtime.getInstanceId(slot);
  if (partId === undefined || instanceId === undefined) return base;
  const instance = { partOccurrenceId: instanceId, partId };
  const data = readInteractionState(interaction);
  const hovered = data.hoveredTarget;
  const highlighted =
    instanceMatchesAssemblyTarget(
      runtime,
      slot,
      data.highlightedAssemblyIds,
      data.highlightedAssemblyOccurrenceIds,
    ) || targetMatchesInstance(runtime, slot, hovered);
  const selected = instanceMatchesAssemblyTarget(
    runtime,
    slot,
    data.selectedAssemblyIds,
    data.selectedAssemblyOccurrenceIds,
  );
  return resolveInstanceStyleLayers(instance, base, interaction, includeSelection, {
    highlighted,
    selected,
  });
}

/** Returns whether a runtime instance belongs to any selected broad target. */
export function runtimeInstanceIsSelected(
  runtime: PackedSceneRuntime,
  slot: number,
  interaction: InteractionState,
): boolean {
  const instanceId = runtime.getInstanceId(slot);
  const partId = runtime.instancePartIds[slot];
  if (instanceId === undefined || partId === undefined) return false;
  const data = readInteractionState(interaction);
  return (
    data.selectedPartIds.has(partId) ||
    data.selectedPartOccurrenceIds.has(instanceId) ||
    instanceMatchesAssemblyTarget(
      runtime,
      slot,
      data.selectedAssemblyIds,
      data.selectedAssemblyOccurrenceIds,
    )
  );
}

/** Returns whether a runtime instance belongs to any selected assembly target. */
export function runtimeInstanceIsHighlighted(
  runtime: PackedSceneRuntime,
  slot: number,
  interaction: InteractionState,
): boolean {
  const data = readInteractionState(interaction);
  return instanceMatchesAssemblyTarget(
    runtime,
    slot,
    data.highlightedAssemblyIds,
    data.highlightedAssemblyOccurrenceIds,
  );
}

function targetMatchesInstance(
  runtime: PackedSceneRuntime,
  slot: number,
  target: InteractionTarget | undefined,
): boolean {
  if (target?.kind === "assembly")
    return instanceMatchesAssemblyId(runtime, slot, target.assemblyId);
  if (target?.kind === "assemblyOccurrence") {
    return instanceMatchesAssemblyOccurrence(runtime, slot, target.assemblyOccurrenceId);
  }
  return false;
}
