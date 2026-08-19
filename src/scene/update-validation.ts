import type { AssemblyId } from "./types";
import { hasDefinitionChanges, type SceneStructuralChanges } from "./update-changes";

/** Whether transaction methods already validated every changed ownership boundary. */
export function hasOnlyDirectPartPlacementChanges(changes: SceneStructuralChanges): boolean {
  if (hasDefinitions(changes)) return false;
  return hasOnlyExplicitPartPlacements(changes);
}

/** Whether a revision can use retained runtime slots, including part-definition removal. */
export function hasOnlyDirectPartRuntimeChanges(changes: SceneStructuralChanges): boolean {
  if (hasDefinitionChanges(changes.assemblies)) return false;
  if (changes.parts.added.size > 0 || changes.parts.replaced.size > 0) return false;
  if (changes.parts.removed.size === 0 && changes.placements.length === 0) return false;
  return hasOnlyExplicitPartPlacements(changes);
}

function hasOnlyExplicitPartPlacements(changes: SceneStructuralChanges): boolean {
  return changes.placements.every(
    ({ before, after }) =>
      (before === undefined || (before.kind === "part" && before.placementId !== undefined)) &&
      (after === undefined || (after.kind === "part" && after.placementId !== undefined)),
  );
}

/** Validates an explicit placement path segment before publishing its assembly revision. */
export function validateExplicitPlacementId(
  id: string,
  assemblyId: AssemblyId,
  index: number,
): void {
  if (id.length === 0 || id.includes("/")) {
    throw new Error(
      `AssemblyDefinition ${assemblyId} placement ${index} id must be a non-empty string without '/'`,
    );
  }
}

function hasDefinitions(changes: SceneStructuralChanges): boolean {
  return hasDefinitionChanges(changes.parts) || hasDefinitionChanges(changes.assemblies);
}
