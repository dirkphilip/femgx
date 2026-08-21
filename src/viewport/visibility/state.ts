import type { PartId } from "../../geometry/part";
import type { Scene } from "../../scene/scene";
import type { AssemblyId, AssemblyOccurrenceId, PartOccurrenceId } from "../../scene/types";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { VisibilityDelta } from "../../scene-runtime/visibility";

/** Viewport-local visibility policy retained across scene revisions. */
export class ViewportVisibilityState {
  private constructor(
    private readonly parts: DefinitionVisibility<PartId>,
    private readonly assemblies: DefinitionVisibility<AssemblyId>,
    private readonly hiddenPartOccurrenceSlots: Set<number>,
    private readonly hiddenAssemblyOccurrenceIds: Set<AssemblyOccurrenceId>,
    private readonly runtime: PackedSceneRuntime,
  ) {}

  static create(scene: Scene, runtime: PackedSceneRuntime): ViewportVisibilityState {
    return new ViewportVisibilityState(
      definitionVisibility(scene.parts.keys(), scene.visiblePartIds),
      definitionVisibility(scene.assemblies.keys(), scene.visibleAssemblyIds),
      new Set(),
      new Set(),
      runtime,
    );
  }

  snapshot(): ViewportVisibilityPolicy {
    const partOccurrences: VisibilityPolicyEntry<PartOccurrenceId>[] = [];
    for (let slot = 0; slot < this.runtime.instanceCount; slot += 1) {
      const id = this.runtime.getInstanceId(slot);
      if (id !== undefined)
        partOccurrences.push({ id, visible: !this.hiddenPartOccurrenceSlots.has(slot) });
    }
    const assemblyOccurrences: VisibilityPolicyEntry<AssemblyOccurrenceId>[] = [];
    for (let node = 0; node < this.runtime.nodeCount; node += 1) {
      const id = this.runtime.getNodeId(node);
      if (id !== undefined)
        assemblyOccurrences.push({ id, visible: !this.hiddenAssemblyOccurrenceIds.has(id) });
    }
    return {
      parts: visibilityEntries(this.parts),
      assemblies: visibilityEntries(this.assemblies),
      partOccurrences,
      assemblyOccurrences,
    };
  }

  reconcile(scene: Scene, runtime: PackedSceneRuntime): ViewportVisibilityState {
    const hiddenParts = reconcileDefinitions(
      scene.parts.keys(),
      this.parts.known,
      this.parts.hidden,
      scene.visiblePartIds,
    );
    const hiddenAssemblies = reconcileDefinitions(
      scene.assemblies.keys(),
      this.assemblies.known,
      this.assemblies.hidden,
      scene.visibleAssemblyIds,
    );
    const hiddenPartOccurrences = retainedPartSlots(
      this.hiddenPartOccurrenceSlots,
      this.runtime,
      runtime,
    );
    const hiddenAssemblyOccurrences = retainedIds(this.hiddenAssemblyOccurrenceIds, (id) =>
      runtime.getNodeSlot(id),
    );
    applyDefinitionPolicy(runtime, scene, hiddenParts, hiddenAssemblies);
    applyOccurrencePolicy(runtime, hiddenPartOccurrences, hiddenAssemblyOccurrences);
    return new ViewportVisibilityState(
      { known: new Set(scene.parts.keys()), hidden: hiddenParts },
      { known: new Set(scene.assemblies.keys()), hidden: hiddenAssemblies },
      hiddenPartOccurrences,
      hiddenAssemblyOccurrences,
      runtime,
    );
  }

  setPartVisible(runtime: PackedSceneRuntime, partId: PartId, visible: boolean): VisibilityDelta {
    updateHidden(this.parts.hidden, partId, visible);
    return runtime.setPartVisible(partId, visible);
  }

  /** Resolves the retained viewport policy for a newly expanded occurrence. */
  isPartVisible(partId: PartId, authoredVisible: boolean): boolean {
    return this.parts.known.has(partId) ? !this.parts.hidden.has(partId) : authoredVisible;
  }

  /** Drops viewport-local state for occurrence identities removed by a scene revision. */
  prunePartOccurrences(slots: readonly number[]): void {
    for (const slot of slots) this.hiddenPartOccurrenceSlots.delete(slot);
  }

  /** Drops definition policy for parts removed from the authoritative scene. */
  pruneParts(partIds: ReadonlySet<PartId>): void {
    for (const partId of partIds) {
      this.parts.known.delete(partId);
      this.parts.hidden.delete(partId);
    }
  }

  /** Seeds definition policy for newly registered parts from authored visibility. */
  admitParts(scene: Scene, partIds: ReadonlySet<PartId>): void {
    for (const partId of partIds) {
      this.parts.known.add(partId);
      updateHidden(this.parts.hidden, partId, scene.visiblePartIds.has(partId));
    }
  }

  setAssemblyVisible(
    runtime: PackedSceneRuntime,
    assemblyId: AssemblyId,
    visible: boolean,
  ): VisibilityDelta {
    updateHidden(this.assemblies.hidden, assemblyId, visible);
    return runtime.setAssemblyVisible(assemblyId, visible);
  }

  setAssemblyOccurrenceVisible(
    runtime: PackedSceneRuntime,
    occurrenceId: AssemblyOccurrenceId,
    node: number,
    visible: boolean,
  ): VisibilityDelta {
    updateHidden(this.hiddenAssemblyOccurrenceIds, occurrenceId, visible);
    return runtime.setAssemblyNodeVisible(node, visible);
  }

  setPartOccurrences(
    runtime: PackedSceneRuntime,
    slots: readonly number[],
    visible: boolean,
  ): VisibilityDelta {
    for (const slot of slots) updateHidden(this.hiddenPartOccurrenceSlots, slot, visible);
    return runtime.setInstancesVisible(slots, visible);
  }
}

interface DefinitionVisibility<T> {
  readonly known: Set<T>;
  readonly hidden: Set<T>;
}

export interface ViewportVisibilityPolicy {
  readonly parts: readonly VisibilityPolicyEntry<PartId>[];
  readonly assemblies: readonly VisibilityPolicyEntry<AssemblyId>[];
  readonly partOccurrences: readonly VisibilityPolicyEntry<PartOccurrenceId>[];
  readonly assemblyOccurrences: readonly VisibilityPolicyEntry<AssemblyOccurrenceId>[];
}

export interface VisibilityPolicyEntry<T> {
  readonly id: T;
  readonly visible: boolean;
}

function visibilityEntries<T>(visibility: DefinitionVisibility<T>): VisibilityPolicyEntry<T>[] {
  return [...visibility.known].map((id) => ({ id, visible: !visibility.hidden.has(id) }));
}

function updateHidden<T>(hidden: Set<T>, id: T, visible: boolean): void {
  if (visible) hidden.delete(id);
  else hidden.add(id);
}

function definitionVisibility<T>(
  ids: Iterable<T>,
  visible: ReadonlySet<T>,
): DefinitionVisibility<T> {
  const known = new Set(ids);
  return { known, hidden: new Set([...known].filter((id) => !visible.has(id))) };
}

function reconcileDefinitions<T>(
  ids: Iterable<T>,
  known: ReadonlySet<T>,
  hidden: ReadonlySet<T>,
  authoredVisible: ReadonlySet<T>,
): Set<T> {
  return new Set(
    [...ids].filter((id) => (known.has(id) ? hidden.has(id) : !authoredVisible.has(id))),
  );
}

function retainedIds<T>(hidden: ReadonlySet<T>, resolve: (id: T) => number | undefined): Set<T> {
  return new Set([...hidden].filter((id) => resolve(id) !== undefined));
}

function retainedPartSlots(
  hidden: ReadonlySet<number>,
  previous: PackedSceneRuntime,
  runtime: PackedSceneRuntime,
): Set<number> {
  const retained = new Set<number>();
  for (const slot of hidden) {
    const id = previous.getInstanceId(slot);
    const next = id === undefined ? undefined : runtime.getInstanceSlot(id);
    if (next !== undefined) retained.add(next);
  }
  return retained;
}

function applyDefinitionPolicy(
  runtime: PackedSceneRuntime,
  scene: Scene,
  hiddenParts: ReadonlySet<PartId>,
  hiddenAssemblies: ReadonlySet<AssemblyId>,
): void {
  for (const partId of scene.parts.keys()) runtime.setPartVisible(partId, !hiddenParts.has(partId));
  for (const assemblyId of scene.assemblies.keys()) {
    runtime.setAssemblyVisible(assemblyId, !hiddenAssemblies.has(assemblyId));
  }
}

function applyOccurrencePolicy(
  runtime: PackedSceneRuntime,
  hiddenParts: ReadonlySet<number>,
  hiddenAssemblies: ReadonlySet<AssemblyOccurrenceId>,
): void {
  for (const slot of hiddenParts) runtime.setInstanceVisible(slot, false);
  for (const id of hiddenAssemblies) {
    runtime.setAssemblyNodeVisible(runtime.getNodeSlot(id) ?? -1, false);
  }
}
