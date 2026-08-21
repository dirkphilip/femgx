import type { AssemblyDefinition } from "./assembly";

interface PlacementIndex {
  readonly depth: number;
  get(id: string): number | undefined;
}

const placementIndexes = new WeakMap<AssemblyDefinition, PlacementIndex>();

/** Retains the placement-id index built while an assembly crosses validation. */
export function cachePlacementIndex(
  assembly: AssemblyDefinition,
  index: ReadonlyMap<string, number>,
): void {
  placementIndexes.set(assembly, mapIndex(index));
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

/** Derives an appended explicit-id lookup without rescanning unchanged placements. */
export function retainAppendedPlacementIndex(
  source: AssemblyDefinition,
  revision: AssemblyDefinition,
  addedId: string,
  index: number,
): void {
  const parent = placementIndex(source);
  retainOverlay(revision, parent, (id) => (id === addedId ? index : parent.get(id)));
}

/** Derives a removed explicit-id lookup and adjusts only queried later siblings. */
export function retainRemovedPlacementIndex(
  source: AssemblyDefinition,
  revision: AssemblyDefinition,
  removedId: string,
  removedIndex: number,
): void {
  const parent = placementIndex(source);
  retainOverlay(revision, parent, (id) => {
    if (id === removedId) return undefined;
    const index = parent.get(id);
    return index !== undefined && index > removedIndex ? index - 1 : index;
  });
}

function placementIndex(assembly: AssemblyDefinition): PlacementIndex {
  const cached = placementIndexes.get(assembly);
  if (cached !== undefined) return cached;
  const index = new Map<string, number>();
  for (let offset = 0; offset < assembly.placements.length; offset += 1) {
    const placement = assembly.placements[offset];
    if (placement !== undefined) index.set(placement.placementId, offset);
  }
  const result = mapIndex(index);
  placementIndexes.set(assembly, result);
  return result;
}

function retainOverlay(
  revision: AssemblyDefinition,
  parent: PlacementIndex,
  get: PlacementIndex["get"],
): void {
  if (parent.depth >= MAX_OVERLAY_DEPTH) {
    placementIndexes.delete(revision);
    placementIndex(revision);
  } else placementIndexes.set(revision, { depth: parent.depth + 1, get });
}

function mapIndex(index: ReadonlyMap<string, number>): PlacementIndex {
  return { depth: 0, get: index.get.bind(index) };
}

const MAX_OVERLAY_DEPTH = 256;
