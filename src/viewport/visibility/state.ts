import type { BodyId, PartId } from "../../geometry/part";
import { updateNestedSet, updateNestedSets } from "../../interaction/mechanics";
import type { InteractionVisibility } from "../../interaction/state";
import type { Scene } from "../../scene/scene";
import type {
  AssemblyId,
  AssemblyOccurrenceId,
  ElementId,
  ElementRef,
  PartOccurrenceId,
} from "../../scene/types";
import type { BodyRef } from "../../interaction/refs";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { VisibilityDelta } from "../../scene-runtime/visibility";
import {
  applyDefinitionPolicy,
  applyOccurrencePolicy,
  reconcilePrimitiveVisibility,
  retainedIds,
  retainedPartSlots,
} from "./reconciliation";

/** Viewport-local visibility policy retained across scene revisions. */
export class ViewportVisibilityState {
  private readonly parts: DefinitionVisibility<PartId>;
  private readonly assemblies: DefinitionVisibility<AssemblyId>;
  private readonly hiddenPartOccurrenceSlots: Set<number>;
  private readonly hiddenAssemblyOccurrenceIds: Set<AssemblyOccurrenceId>;
  private readonly runtime: PackedSceneRuntime;
  private hiddenBodyIds: ReadonlyMap<PartOccurrenceId, ReadonlySet<BodyId>>;
  private hiddenElementIds: ReadonlyMap<PartOccurrenceId, ReadonlySet<ElementId>>;

  private constructor(state: VisibilityStateData) {
    this.parts = state.parts;
    this.assemblies = state.assemblies;
    this.hiddenPartOccurrenceSlots = state.hiddenPartOccurrenceSlots;
    this.hiddenAssemblyOccurrenceIds = state.hiddenAssemblyOccurrenceIds;
    this.runtime = state.runtime;
    this.hiddenBodyIds = state.hiddenBodyIds;
    this.hiddenElementIds = state.hiddenElementIds;
  }

  static create(scene: Scene, runtime: PackedSceneRuntime): ViewportVisibilityState {
    return new ViewportVisibilityState({
      parts: definitionVisibility(scene.parts.keys(), scene.visiblePartIds),
      assemblies: definitionVisibility(scene.assemblies.keys(), scene.visibleAssemblyIds),
      hiddenPartOccurrenceSlots: new Set(),
      hiddenAssemblyOccurrenceIds: new Set(),
      runtime,
      hiddenBodyIds: new Map(),
      hiddenElementIds: new Map(),
    });
  }

  interactionVisibility(): InteractionVisibility {
    return { hiddenBodyIds: this.hiddenBodyIds, hiddenElementIds: this.hiddenElementIds };
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
    const primitiveVisibility = reconcilePrimitiveVisibility(
      this.hiddenBodyIds,
      this.hiddenElementIds,
      this.runtime,
      runtime,
      scene.parts,
    );
    applyDefinitionPolicy(runtime, scene, hiddenParts, hiddenAssemblies);
    applyOccurrencePolicy(runtime, hiddenPartOccurrences, hiddenAssemblyOccurrences);
    return new ViewportVisibilityState({
      parts: { known: new Set(scene.parts.keys()), hidden: hiddenParts },
      assemblies: { known: new Set(scene.assemblies.keys()), hidden: hiddenAssemblies },
      hiddenPartOccurrenceSlots: hiddenPartOccurrences,
      hiddenAssemblyOccurrenceIds: hiddenAssemblyOccurrences,
      runtime,
      hiddenBodyIds: primitiveVisibility.hiddenBodyIds,
      hiddenElementIds: primitiveVisibility.hiddenElementIds,
    });
  }

  /** Prepares hierarchy-owned policy changes without mutating the retained policy object. */
  reconcileHierarchy(
    scene: Scene,
    runtime: PackedSceneRuntime,
    removedPartSlots: readonly number[],
    removedAssemblyIds: readonly AssemblyOccurrenceId[],
  ): ViewportVisibilityState {
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
    const hiddenPartOccurrences = new Set(this.hiddenPartOccurrenceSlots);
    for (const slot of removedPartSlots) hiddenPartOccurrences.delete(slot);
    const hiddenAssemblyOccurrences = new Set(this.hiddenAssemblyOccurrenceIds);
    for (const id of removedAssemblyIds) hiddenAssemblyOccurrences.delete(id);
    const primitiveVisibility = reconcilePrimitiveVisibility(
      this.hiddenBodyIds,
      this.hiddenElementIds,
      this.runtime,
      runtime,
      scene.parts,
    );
    return new ViewportVisibilityState({
      parts: { known: new Set(scene.parts.keys()), hidden: hiddenParts },
      assemblies: { known: new Set(scene.assemblies.keys()), hidden: hiddenAssemblies },
      hiddenPartOccurrenceSlots: hiddenPartOccurrences,
      hiddenAssemblyOccurrenceIds: hiddenAssemblyOccurrences,
      runtime,
      hiddenBodyIds: primitiveVisibility.hiddenBodyIds,
      hiddenElementIds: primitiveVisibility.hiddenElementIds,
    });
  }

  /** Reconciles definition visibility after a hierarchy revision with no runtime occurrences. */
  reconcileUnplacedAssemblyDefinitions(scene: Scene): ViewportVisibilityState {
    return this.reconcileHierarchy(scene, this.runtime, [], []);
  }

  setPartVisible(runtime: PackedSceneRuntime, partId: PartId, visible: boolean): VisibilityDelta {
    updateHidden(this.parts.hidden, partId, visible);
    return runtime.setPartVisible(partId, visible);
  }

  /** Resolves the retained viewport policy for a newly expanded occurrence. */
  isPartVisible(partId: PartId, authoredVisible: boolean): boolean {
    return this.parts.known.has(partId) ? !this.parts.hidden.has(partId) : authoredVisible;
  }

  /** Resolves the retained viewport policy for a newly expanded assembly occurrence. */
  isAssemblyVisible(assemblyId: AssemblyId, authoredVisible: boolean): boolean {
    return this.assemblies.known.has(assemblyId)
      ? !this.assemblies.hidden.has(assemblyId)
      : authoredVisible;
  }

  /** Drops viewport-local state for occurrence identities removed by a scene revision. */
  prunePartOccurrences(slots: readonly number[]): void {
    for (const slot of slots) this.hiddenPartOccurrenceSlots.delete(slot);
  }

  /** Drops occurrence-local assembly policy for collapsed hierarchy subtrees. */
  pruneAssemblyOccurrences(ids: readonly AssemblyOccurrenceId[]): void {
    for (const id of ids) this.hiddenAssemblyOccurrenceIds.delete(id);
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

  /** Reconciles definition visibility without rebuilding retained occurrence policy. */
  reconcileAssemblies(scene: Scene, changed: ReadonlySet<AssemblyId>): void {
    for (const assemblyId of changed) {
      if (!scene.assemblies.has(assemblyId)) {
        this.assemblies.known.delete(assemblyId);
        this.assemblies.hidden.delete(assemblyId);
      } else if (!this.assemblies.known.has(assemblyId)) {
        this.assemblies.known.add(assemblyId);
        updateHidden(this.assemblies.hidden, assemblyId, scene.visibleAssemblyIds.has(assemblyId));
      }
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

  setBodyVisible(ref: BodyRef, visible: boolean): boolean {
    const hiddenBodyIds = updateNestedSet(
      this.hiddenBodyIds,
      ref.partOccurrenceId,
      ref.bodyId,
      !visible,
    );
    if (hiddenBodyIds === this.hiddenBodyIds) return false;
    this.hiddenBodyIds = hiddenBodyIds;
    return true;
  }

  setElementVisible(ref: ElementRef, visible: boolean): boolean {
    const hiddenElementIds = updateNestedSet(
      this.hiddenElementIds,
      ref.partOccurrenceId,
      ref.elementId,
      !visible,
    );
    if (hiddenElementIds === this.hiddenElementIds) return false;
    this.hiddenElementIds = hiddenElementIds;
    return true;
  }

  setBodiesVisible(
    refs: ReadonlyMap<PartOccurrenceId, ReadonlySet<BodyId>>,
    visible: boolean,
  ): boolean {
    const hiddenBodyIds = updateNestedSets(this.hiddenBodyIds, refs, !visible);
    if (hiddenBodyIds === this.hiddenBodyIds) return false;
    this.hiddenBodyIds = hiddenBodyIds;
    return true;
  }

  setElementsVisible(
    refs: ReadonlyMap<PartOccurrenceId, ReadonlySet<ElementId>>,
    visible: boolean,
  ): boolean {
    const hiddenElementIds = updateNestedSets(this.hiddenElementIds, refs, !visible);
    if (hiddenElementIds === this.hiddenElementIds) return false;
    this.hiddenElementIds = hiddenElementIds;
    return true;
  }

  isBodyVisible(ref: BodyRef): boolean {
    return this.hiddenBodyIds.get(ref.partOccurrenceId)?.has(ref.bodyId) !== true;
  }

  isElementVisible(ref: ElementRef): boolean {
    return this.hiddenElementIds.get(ref.partOccurrenceId)?.has(ref.elementId) !== true;
  }

  reconcilePrimitiveVisibility(scene: Scene, runtime: PackedSceneRuntime): void {
    const primitiveVisibility = reconcilePrimitiveVisibility(
      this.hiddenBodyIds,
      this.hiddenElementIds,
      this.runtime,
      runtime,
      scene.parts,
    );
    this.hiddenBodyIds = primitiveVisibility.hiddenBodyIds;
    this.hiddenElementIds = primitiveVisibility.hiddenElementIds;
  }

  showAll(runtime: PackedSceneRuntime): readonly PartId[] {
    const affected = new Set<PartId>();
    for (const partOccurrenceId of [
      ...this.hiddenBodyIds.keys(),
      ...this.hiddenElementIds.keys(),
    ]) {
      const slot = runtime.getInstanceSlot(partOccurrenceId);
      const partId = slot === undefined ? undefined : runtime.getPartId(slot);
      if (partId !== undefined) affected.add(partId);
    }
    for (const partId of this.parts.hidden) {
      if (runtime.getPartInstanceSlots(partId).length > 0) affected.add(partId);
      runtime.setPartVisible(partId, true);
    }
    for (const assemblyId of this.assemblies.hidden) {
      for (const slot of runtime.getAssemblyNodeSlots(assemblyId)) {
        for (const instance of runtime.getNodeInstanceSlots(slot)) {
          const partId = runtime.getPartId(instance);
          if (partId !== undefined) affected.add(partId);
        }
      }
      runtime.setAssemblyVisible(assemblyId, true);
    }
    for (const slot of this.hiddenPartOccurrenceSlots) {
      const partId = runtime.getPartId(slot);
      if (partId !== undefined) affected.add(partId);
      runtime.setInstanceVisible(slot, true);
    }
    for (const id of this.hiddenAssemblyOccurrenceIds) {
      const node = runtime.getNodeSlot(id);
      if (node === undefined) continue;
      for (const instance of runtime.getNodeInstanceSlots(node)) {
        const partId = runtime.getPartId(instance);
        if (partId !== undefined) affected.add(partId);
      }
      runtime.setAssemblyNodeVisible(node, true);
    }
    this.parts.hidden.clear();
    this.assemblies.hidden.clear();
    this.hiddenPartOccurrenceSlots.clear();
    this.hiddenAssemblyOccurrenceIds.clear();
    this.hiddenBodyIds = new Map();
    this.hiddenElementIds = new Map();
    return [...affected];
  }
}

interface DefinitionVisibility<T> {
  readonly known: Set<T>;
  readonly hidden: Set<T>;
}

interface VisibilityStateData {
  readonly parts: DefinitionVisibility<PartId>;
  readonly assemblies: DefinitionVisibility<AssemblyId>;
  readonly hiddenPartOccurrenceSlots: Set<number>;
  readonly hiddenAssemblyOccurrenceIds: Set<AssemblyOccurrenceId>;
  readonly runtime: PackedSceneRuntime;
  readonly hiddenBodyIds: ReadonlyMap<PartOccurrenceId, ReadonlySet<BodyId>>;
  readonly hiddenElementIds: ReadonlyMap<PartOccurrenceId, ReadonlySet<ElementId>>;
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
