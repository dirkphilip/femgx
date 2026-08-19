import type { AssemblyDefinition, Placement } from "./assembly";
import {
  cachePlacementIndex,
  retainAppendedPlacementIndex,
  retainPlacementIndex,
  retainRemovedPlacementIndex,
} from "./assembly-index";
import type { AssemblyId } from "./types";

interface MutableAssemblyPlacements {
  readonly placements: Placement[];
  readonly index: Map<string, number>;
}

/** Owns transaction-local mutable placement arrays and publishes one immutable revision. */
export class ScenePlacementDrafts {
  private readonly drafts = new Map<AssemblyId, MutableAssemblyPlacements>();
  private readonly appendedOwners = new Set<AssemblyId>();

  constructor(private readonly publish: (id: AssemblyId, assembly: AssemblyDefinition) => void) {}

  discard(assemblyId: AssemblyId): void {
    this.drafts.delete(assemblyId);
    this.appendedOwners.delete(assemblyId);
  }

  append(
    assemblyId: AssemblyId,
    assembly: AssemblyDefinition,
    placementId: string,
    placement: Placement,
  ): void {
    if (!this.appendedOwners.has(assemblyId)) {
      const revision = { ...assembly, placements: [...assembly.placements, placement] };
      retainAppendedPlacementIndex(assembly, revision, placementId, assembly.placements.length);
      this.publish(assemblyId, revision);
      this.appendedOwners.add(assemblyId);
      return;
    }
    const draft = this.mutable(assemblyId, assembly);
    draft.index.set(placementId, draft.placements.length);
    draft.placements.push(placement);
  }

  edit(
    assemblyId: AssemblyId,
    assembly: AssemblyDefinition,
    index: number,
    placementId: string,
    replacement: Placement | undefined,
  ): void {
    if (!this.drafts.has(assemblyId)) {
      const placements = assembly.placements.slice();
      if (replacement === undefined) placements.splice(index, 1);
      else placements[index] = replacement;
      const revision = { ...assembly, placements };
      if (replacement === undefined) {
        retainRemovedPlacementIndex(assembly, revision, placementId, index);
      } else retainPlacementIndex(assembly, revision);
      this.publish(assemblyId, revision);
      return;
    }
    const draft = this.mutable(assemblyId, assembly);
    if (replacement !== undefined) {
      draft.placements[index] = replacement;
      return;
    }
    draft.placements.splice(index, 1);
    draft.index.delete(placementId);
    for (let offset = index; offset < draft.placements.length; offset += 1) {
      const id = draft.placements[offset]?.placementId;
      if (id !== undefined) draft.index.set(id, offset);
    }
  }

  replaceAll(
    assemblyId: AssemblyId,
    assembly: AssemblyDefinition,
    placements: readonly Placement[],
  ): void {
    if (this.drafts.has(assemblyId)) this.install(assemblyId, assembly, placements);
    else this.publish(assemblyId, { ...assembly, placements });
  }

  private mutable(assemblyId: AssemblyId, assembly: AssemblyDefinition): MutableAssemblyPlacements {
    return this.drafts.get(assemblyId) ?? this.install(assemblyId, assembly, assembly.placements);
  }

  private install(
    assemblyId: AssemblyId,
    assembly: AssemblyDefinition,
    source: readonly Placement[],
  ): MutableAssemblyPlacements {
    const placements = source.slice();
    const index = new Map<string, number>();
    for (let offset = 0; offset < placements.length; offset += 1) {
      const id = placements[offset]?.placementId;
      if (id !== undefined) index.set(id, offset);
    }
    const definition = { ...assembly, placements };
    cachePlacementIndex(definition, index);
    const draft = { placements, index };
    this.drafts.set(assemblyId, draft);
    this.publish(assemblyId, definition);
    return draft;
  }
}
