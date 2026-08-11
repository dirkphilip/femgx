import type { Assembly, NamedAssembly, Placement } from "./assembly";
import type { Part, PartId } from "../geometry/part";
import type { AssemblyId } from "./types";

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
      if (state.parts.has(part.id)) {
        throw new Error(`Part ${part.id} is already registered`);
      }
      const parts = new Map(state.parts);
      parts.set(part.id, part);
      const visiblePartIds = new Set(state.visiblePartIds);
      visiblePartIds.add(part.id);
      return update({ parts, visiblePartIds });
    },
    addAssembly(assembly: NamedAssembly): SceneBuilder {
      if (state.assemblies.has(assembly.id)) {
        throw new Error(`Assembly ${assembly.id} is already registered`);
      }
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
      validateScene(rootAssemblyId, parts, assemblies);
      return { rootAssemblyId, parts, assemblies, visiblePartIds, visibleAssemblyIds };
    },
  };
}

function validateScene(
  rootAssemblyId: AssemblyId,
  parts: ReadonlyMap<PartId, Part>,
  assemblies: ReadonlyMap<AssemblyId, Assembly>,
): void {
  if (!assemblies.has(rootAssemblyId)) {
    throw new Error(`Scene root assembly ${rootAssemblyId} is not registered`);
  }
  for (const assembly of assemblies.values()) {
    for (const placement of assembly.placements) {
      validatePlacement(placement, parts, assemblies, assembly.id);
    }
  }
  validateAcyclic(assemblies);
}

function validatePlacement(
  placement: Placement,
  parts: ReadonlyMap<PartId, Part>,
  assemblies: ReadonlyMap<AssemblyId, Assembly>,
  ownerId: AssemblyId,
): void {
  if (placement.kind === "part" && !parts.has(placement.partId)) {
    throw new Error(`Assembly ${ownerId} references missing part ${placement.partId}`);
  }
  if (placement.kind === "assembly" && !assemblies.has(placement.assemblyId)) {
    throw new Error(`Assembly ${ownerId} references missing assembly ${placement.assemblyId}`);
  }
}

function validateAcyclic(assemblies: ReadonlyMap<AssemblyId, Assembly>): void {
  const state = new Map<AssemblyId, "visiting" | "visited">();
  for (const id of assemblies.keys()) {
    if (state.has(id)) {
      continue;
    }
    const stack: Array<{ readonly id: AssemblyId; nextIndex: number }> = [{ id, nextIndex: 0 }];
    state.set(id, "visiting");
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) {
        continue;
      }
      const assembly = assemblies.get(frame.id);
      if (assembly === undefined || frame.nextIndex >= assembly.placements.length) {
        state.set(frame.id, "visited");
        stack.pop();
        continue;
      }
      const placement = assembly.placements[frame.nextIndex];
      frame.nextIndex += 1;
      if (placement?.kind !== "assembly") {
        continue;
      }
      const childState = state.get(placement.assemblyId);
      if (childState === "visiting") {
        throw new Error(`Assembly hierarchy contains a cycle through ${placement.assemblyId}`);
      }
      if (childState === "visited") {
        continue;
      }
      state.set(placement.assemblyId, "visiting");
      stack.push({ id: placement.assemblyId, nextIndex: 0 });
    }
  }
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
