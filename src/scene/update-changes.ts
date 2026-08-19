import type { PartId } from "../geometry/part";
import type { Placement } from "./assembly";
import type { Scene } from "./scene";
import type { AssemblyId } from "./types";

/** Private stable-identity changes prepared with one scene revision. */
export interface SceneStructuralChanges {
  readonly parts: DefinitionChanges<PartId>;
  readonly assemblies: DefinitionChanges<AssemblyId>;
  readonly placements: readonly PlacementChange[];
}

/** One prepared scene revision and its short-lived private structural changes. */
export interface PreparedSceneUpdate {
  readonly scene: Scene;
  readonly changes: SceneStructuralChanges;
}

export interface DefinitionChanges<T> {
  readonly added: ReadonlySet<T>;
  readonly replaced: ReadonlySet<T>;
  readonly removed: ReadonlySet<T>;
}

export interface PlacementChange {
  readonly ownerAssemblyId: AssemblyId;
  readonly before: Placement | undefined;
  readonly after: Placement | undefined;
}

/** Whether a revision changes only transforms while preserving every authored identity. */
export function isTransformOnlyChanges(changes: SceneStructuralChanges): boolean {
  if (hasDefinitionChanges(changes.parts) || hasDefinitionChanges(changes.assemblies)) return false;
  return (
    changes.placements.length > 0 &&
    changes.placements.every(
      ({ before, after }) =>
        before !== undefined && after !== undefined && samePlacementIdentity(before, after),
    )
  );
}

/** Classifies only definition identities touched by the authoring transaction. */
export function definitionChanges<K, V>(
  source: ReadonlyMap<K, V>,
  candidate: ReadonlyMap<K, V>,
  touched: ReadonlySet<K>,
): DefinitionChanges<K> {
  const added = new Set<K>();
  const replaced = new Set<K>();
  const removed = new Set<K>();
  for (const id of touched) {
    const before = source.get(id);
    const after = candidate.get(id);
    if (before === undefined && after !== undefined) added.add(id);
    else if (before !== undefined && after === undefined) removed.add(id);
    else if (before !== after) replaced.add(id);
  }
  return { added, replaced, removed };
}

/** Whether a definition registry has any prepared identity changes. */
export function hasDefinitionChanges(changes: DefinitionChanges<unknown>): boolean {
  return changes.added.size + changes.replaced.size + changes.removed.size > 0;
}

function samePlacementIdentity(before: Placement, after: Placement): boolean {
  if (before.kind !== after.kind || before.placementId !== after.placementId) return false;
  if (before.kind === "part" && after.kind === "part") return before.partId === after.partId;
  return (
    before.kind === "assembly" &&
    after.kind === "assembly" &&
    before.assemblyId === after.assemblyId
  );
}
