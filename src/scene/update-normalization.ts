import type { PartId } from "../geometry/part";
import { explicitPlacementIndex } from "./assembly-index";
import type { Scene } from "./scene";
import type { AssemblyId } from "./types";
import type { PlacementChange } from "./update-changes";
import { equalPlacement } from "./update-equality";

/** Reports whether draft edits preserve topology and every placement target. */
export function hasOnlyTransformChanges(
  touchedParts: ReadonlySet<PartId>,
  touchedAssemblies: ReadonlySet<AssemblyId>,
  changes: readonly PlacementChange[],
): boolean {
  return (
    touchedParts.size === 0 &&
    touchedAssemblies.size === 0 &&
    changes.length > 0 &&
    changes.every(
      ({ before, after }) =>
        before !== undefined &&
        after !== undefined &&
        before.kind === after.kind &&
        before.placementId === after.placementId &&
        (before.kind === "part"
          ? after.kind === "part" && before.partId === after.partId
          : after.kind === "assembly" && before.assemblyId === after.assemblyId),
    )
  );
}

/** Detects a transform transaction whose final changed placements match the source. */
export function restoresSourcePlacements(
  sourceScene: Scene,
  candidate: Scene,
  changes: readonly PlacementChange[],
): boolean {
  const changed = new Set(
    changes.map(({ ownerAssemblyId, before }) => `${ownerAssemblyId}/${before?.placementId}`),
  );
  for (const key of changed) {
    const separator = key.indexOf("/");
    const ownerId = Number(key.slice(0, separator));
    const placementId = key.slice(separator + 1);
    const source = sourceScene.assemblies.get(ownerId);
    const revision = candidate.assemblies.get(ownerId);
    if (source === undefined || revision === undefined) return false;
    const sourcePlacement = source.placements[explicitPlacementIndex(source, placementId)];
    const revisionPlacement = revision.placements[explicitPlacementIndex(revision, placementId)];
    if (sourcePlacement === undefined || !equalPlacement(sourcePlacement, revisionPlacement)) {
      return false;
    }
  }
  return true;
}

/** Reuses source map identity when a draft is semantically unchanged. */
export function normalizedMap<K, V>(
  source: ReadonlyMap<K, V>,
  changed: ReadonlyMap<K, V> | undefined,
  equal: (left: V, right: V) => boolean,
): ReadonlyMap<K, V> {
  if (changed === undefined || changed.size !== source.size) return changed ?? source;
  for (const [key, value] of changed) {
    const previous = source.get(key);
    if (previous === undefined || !equal(value, previous)) return changed;
  }
  return source;
}

/** Reuses source set identity when a draft is semantically unchanged. */
export function normalizedSet<T>(
  source: ReadonlySet<T>,
  changed: ReadonlySet<T> | undefined,
): ReadonlySet<T> {
  if (changed === undefined || changed.size !== source.size) return changed ?? source;
  for (const value of changed) if (!source.has(value)) return changed;
  return source;
}
