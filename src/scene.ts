import type { Assembly, NamedAssembly } from "./assembly";
import type { Part } from "./part";
import type { AssemblyId, PartId } from "./types";

/**
 * The authoritative CPU-side scene: parts, assemblies, and their visibility.
 * Renderers sync deltas from this model; all updates are immutable.
 */
export interface Scene {
  readonly rootAssemblyId: AssemblyId;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly assemblies: ReadonlyMap<AssemblyId, Assembly>;
  readonly visiblePartIds: ReadonlySet<PartId>;
  readonly visibleAssemblyIds: ReadonlySet<AssemblyId>;
}

export interface SceneBuilder {
  withRoot(rootAssemblyId: AssemblyId): SceneBuilder;
  addPart(part: Part): SceneBuilder;
  addAssembly(assembly: NamedAssembly): SceneBuilder;
  hidePart(partId: PartId): SceneBuilder;
  showPart(partId: PartId): SceneBuilder;
  hideAssembly(assemblyId: AssemblyId): SceneBuilder;
  showAssembly(assemblyId: AssemblyId): SceneBuilder;
  build(): Scene;
}

interface SceneState {
  readonly rootAssemblyId?: AssemblyId;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly assemblies: ReadonlyMap<AssemblyId, Assembly>;
  readonly visiblePartIds: ReadonlySet<PartId>;
  readonly visibleAssemblyIds: ReadonlySet<AssemblyId>;
}

function createBuilder(state: SceneState): SceneBuilder {
  const update = (next: Partial<SceneState>): SceneBuilder => createBuilder({ ...state, ...next });
  return {
    withRoot(rootAssemblyId: AssemblyId): SceneBuilder {
      return update({ rootAssemblyId });
    },
    addPart(part: Part): SceneBuilder {
      const parts = new Map(state.parts);
      parts.set(part.id, part);
      const visiblePartIds = new Set(state.visiblePartIds);
      visiblePartIds.add(part.id);
      return update({ parts, visiblePartIds });
    },
    addAssembly(assembly: NamedAssembly): SceneBuilder {
      const assemblies = new Map(state.assemblies);
      assemblies.set(assembly.id, assembly);
      const visibleAssemblyIds = new Set(state.visibleAssemblyIds);
      visibleAssemblyIds.add(assembly.id);
      return update({ assemblies, visibleAssemblyIds });
    },
    hidePart(partId: PartId): SceneBuilder {
      const visiblePartIds = new Set(state.visiblePartIds);
      visiblePartIds.delete(partId);
      return update({ visiblePartIds });
    },
    showPart(partId: PartId): SceneBuilder {
      const visiblePartIds = new Set(state.visiblePartIds);
      visiblePartIds.add(partId);
      return update({ visiblePartIds });
    },
    hideAssembly(assemblyId: AssemblyId): SceneBuilder {
      const visibleAssemblyIds = new Set(state.visibleAssemblyIds);
      visibleAssemblyIds.delete(assemblyId);
      return update({ visibleAssemblyIds });
    },
    showAssembly(assemblyId: AssemblyId): SceneBuilder {
      const visibleAssemblyIds = new Set(state.visibleAssemblyIds);
      visibleAssemblyIds.add(assemblyId);
      return update({ visibleAssemblyIds });
    },
    build(): Scene {
      const { rootAssemblyId, parts, assemblies, visiblePartIds, visibleAssemblyIds } = state;
      if (rootAssemblyId === undefined) {
        throw new Error("Scene root assembly is not set");
      }
      return { rootAssemblyId, parts, assemblies, visiblePartIds, visibleAssemblyIds };
    },
  };
}

/** Creates an empty scene builder. */
export function createScene(): SceneBuilder {
  return createBuilder({
    parts: new Map(),
    assemblies: new Map(),
    visiblePartIds: new Set(),
    visibleAssemblyIds: new Set(),
  });
}
