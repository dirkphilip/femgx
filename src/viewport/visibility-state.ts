import type { PartId } from "../geometry/part";
import type { Scene } from "../scene/scene";
import type { AssemblyId, AssemblyOccurrenceId, PartOccurrenceId } from "../scene/types";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { VisibilityDelta } from "../scene-runtime/visibility";

/** Viewport-local visibility policy keyed only by stable scene identities. */
export class ViewportVisibilityState {
  private constructor(
    private readonly parts: DefinitionVisibility<PartId>,
    private readonly assemblies: DefinitionVisibility<AssemblyId>,
    private readonly hiddenPartOccurrenceIds: Set<PartOccurrenceId>,
    private readonly hiddenAssemblyOccurrenceIds: Set<AssemblyOccurrenceId>,
  ) {}

  static create(scene: Scene): ViewportVisibilityState {
    return new ViewportVisibilityState(
      definitionVisibility(scene.parts.keys(), scene.visiblePartIds),
      definitionVisibility(scene.assemblies.keys(), scene.visibleAssemblyIds),
      new Set(),
      new Set(),
    );
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
    const hiddenPartOccurrences = retainedIds(this.hiddenPartOccurrenceIds, (id) =>
      runtime.getInstanceSlot(id),
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
    );
  }

  setPart(runtime: PackedSceneRuntime, partId: PartId, visible: boolean): VisibilityDelta {
    updateHidden(this.parts.hidden, partId, visible);
    return runtime.setPartVisible(partId, visible);
  }

  setAssembly(
    runtime: PackedSceneRuntime,
    assemblyId: AssemblyId,
    visible: boolean,
  ): VisibilityDelta {
    updateHidden(this.assemblies.hidden, assemblyId, visible);
    return runtime.setAssemblyVisible(assemblyId, visible);
  }

  setAssemblyOccurrence(
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
    occurrenceIds: readonly PartOccurrenceId[],
    slots: readonly number[],
    visible: boolean,
  ): VisibilityDelta {
    for (const occurrenceId of occurrenceIds) {
      updateHidden(this.hiddenPartOccurrenceIds, occurrenceId, visible);
    }
    return runtime.setInstancesVisible(slots, visible);
  }
}

interface DefinitionVisibility<T> {
  readonly known: ReadonlySet<T>;
  readonly hidden: Set<T>;
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
  hiddenParts: ReadonlySet<PartOccurrenceId>,
  hiddenAssemblies: ReadonlySet<AssemblyOccurrenceId>,
): void {
  for (const id of hiddenParts)
    runtime.setInstanceVisible(runtime.getInstanceSlot(id) ?? -1, false);
  for (const id of hiddenAssemblies) {
    runtime.setAssemblyNodeVisible(runtime.getNodeSlot(id) ?? -1, false);
  }
}
