import type { AssemblyDefinition } from "./assembly";

const placementIndexes = new WeakMap<AssemblyDefinition, ReadonlyMap<string, number>>();

/** Retains the placement-id index built while an assembly crosses validation. */
export function cachePlacementIndex(
  assembly: AssemblyDefinition,
  index: ReadonlyMap<string, number>,
): void {
  placementIndexes.set(assembly, index);
}

/** Resolves an explicit placement id from its validation-owned assembly index. */
export function explicitPlacementIndex(assembly: AssemblyDefinition, id: string): number {
  return placementIndex(assembly).get(id) ?? -1;
}

/** Shares an unchanged placement-id layout with an identity-preserving revision. */
export function retainPlacementIndex(
  source: AssemblyDefinition,
  revision: AssemblyDefinition,
): void {
  placementIndexes.set(revision, placementIndex(source));
}

function placementIndex(assembly: AssemblyDefinition): ReadonlyMap<string, number> {
  const cached = placementIndexes.get(assembly);
  if (cached !== undefined) return cached;
  const index = new Map<string, number>();
  for (let offset = 0; offset < assembly.placements.length; offset += 1) {
    const placement = assembly.placements[offset];
    if (placement?.placementId !== undefined) index.set(placement.placementId, offset);
  }
  placementIndexes.set(assembly, index);
  return index;
}
