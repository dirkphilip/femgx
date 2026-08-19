import type { AssemblyId } from "./types";
import { hasDefinitionChanges, type SceneStructuralChanges } from "./update-changes";

/** Whether transaction methods already validated every changed ownership boundary. */
export function hasOnlyDirectPartPlacementChanges(changes: SceneStructuralChanges): boolean {
  if (hasDefinitions(changes)) return false;
  return (
    changes.placements.length > 0 &&
    changes.placements.every(
      ({ before, after }) =>
        (before === undefined || (before.kind === "part" && before.placementId !== undefined)) &&
        (after === undefined || (after.kind === "part" && after.placementId !== undefined)),
    )
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
