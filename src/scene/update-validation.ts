import type { AssemblyDefinition } from "./assembly";
import { validateAssemblyDefinition, type Scene } from "./scene";
import type { AssemblyId } from "./types";
import { hasDefinitionChanges, type SceneStructuralChanges } from "./update-changes";
import { equalPlacement } from "./update-equality";

/** Whether transaction methods already validated every changed ownership boundary. */
export function hasOnlyDirectPartPlacementChanges(changes: SceneStructuralChanges): boolean {
  if (hasDefinitions(changes)) return false;
  return hasOnlyExplicitPartPlacements(changes);
}

/** Whether a revision can use retained runtime slots, including part-definition changes. */
export function hasOnlyDirectPartRuntimeChanges(changes: SceneStructuralChanges): boolean {
  if (hasDefinitionChanges(changes.assemblies)) return false;
  if (changes.parts.replaced.size > 0) return false;
  if (
    changes.parts.added.size === 0 &&
    changes.parts.removed.size === 0 &&
    changes.placements.length === 0
  )
    return false;
  return hasOnlyExplicitPartPlacements(changes);
}

/** Whether a transaction changes only existing immutable part definitions. */
export function hasOnlyPartReplacementChanges(changes: SceneStructuralChanges): boolean {
  return (
    !hasDefinitionChanges(changes.assemblies) &&
    changes.parts.added.size === 0 &&
    changes.parts.removed.size === 0 &&
    changes.parts.replaced.size > 0 &&
    changes.placements.length === 0
  );
}

/** Whether changed assembly topology can use the private retained-node delta path. */
export function hasIncrementalHierarchyChanges(changes: SceneStructuralChanges): boolean {
  if (hasDefinitionChanges(changes.assemblies)) return true;
  return changes.placements.some(
    ({ before, after }) => before?.kind === "assembly" || after?.kind === "assembly",
  );
}

/** Validates changed definitions and only edges capable of introducing a hierarchy cycle. */
export function validateIncrementalHierarchy(
  source: Scene,
  candidate: Scene,
  changes: SceneStructuralChanges,
): void {
  const changed = new Set<AssemblyId>([
    ...changes.assemblies.added,
    ...changes.assemblies.replaced,
  ]);
  for (const change of changes.placements) changed.add(change.ownerAssemblyId);
  for (const assemblyId of changed) {
    const assembly = candidate.assemblies.get(assemblyId);
    if (assembly !== undefined) {
      validateAssemblyDefinition(assemblyId, assembly, candidate.parts, candidate.assemblies);
    }
  }
  for (const assemblyId of changed) {
    const before = source.assemblies.get(assemblyId);
    const after = candidate.assemblies.get(assemblyId);
    if (after === undefined) continue;
    for (const target of changedAssemblyTargets(before, after)) {
      if (reaches(candidate.assemblies, target, assemblyId)) {
        throw new Error(`AssemblyDefinition hierarchy contains a cycle through ${target}`);
      }
    }
  }
}

function hasOnlyExplicitPartPlacements(changes: SceneStructuralChanges): boolean {
  return changes.placements.every(
    ({ before, after }) =>
      (before === undefined || (before.kind === "part" && before.placementId !== undefined)) &&
      (after === undefined || (after.kind === "part" && after.placementId !== undefined)),
  );
}

function changedAssemblyTargets(
  before: AssemblyDefinition | undefined,
  after: AssemblyDefinition,
): readonly AssemblyId[] {
  const previous = new Map<string, AssemblyDefinition["placements"][number]>();
  for (const placement of before?.placements ?? []) {
    if (placement.placementId !== undefined) previous.set(placement.placementId, placement);
  }
  const targets: AssemblyId[] = [];
  for (const placement of after.placements) {
    if (placement.kind !== "assembly") continue;
    const existing =
      placement.placementId === undefined ? undefined : previous.get(placement.placementId);
    if (!equalPlacement(existing ?? placement, placement) || existing === undefined) {
      targets.push(placement.assemblyId);
    }
  }
  return targets;
}

function reaches(
  assemblies: ReadonlyMap<AssemblyId, AssemblyDefinition>,
  entry: AssemblyId,
  target: AssemblyId,
): boolean {
  const visited = new Set<AssemblyId>();
  const stack = [entry];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || visited.has(current)) continue;
    if (current === target) return true;
    visited.add(current);
    const assembly = assemblies.get(current);
    if (assembly === undefined) continue;
    for (const placement of assembly.placements) {
      if (placement.kind === "assembly") stack.push(placement.assemblyId);
    }
  }
  return false;
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
