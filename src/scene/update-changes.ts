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
