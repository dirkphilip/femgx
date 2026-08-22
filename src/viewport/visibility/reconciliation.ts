import type { BodyId, Part, PartId } from "../../geometry/part";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import type { InteractionVisibility } from "../../interaction/state";
import type { Scene } from "../../scene/scene";
import type {
  AssemblyId,
  AssemblyOccurrenceId,
  ElementId,
  PartOccurrenceId,
} from "../../scene/types";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";

/** Retains hidden identities that still resolve in the next runtime. */
export function retainedIds<T>(
  hidden: ReadonlySet<T>,
  resolve: (id: T) => number | undefined,
): Set<T> {
  return new Set([...hidden].filter((id) => resolve(id) !== undefined));
}

/** Retains hidden placement policy by stable occurrence identity. */
export function retainedPartSlots(
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

/** Applies retained definition-level visibility to a packed runtime. */
export function applyDefinitionPolicy(
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

/** Applies retained occurrence-level visibility to a packed runtime. */
export function applyOccurrencePolicy(
  runtime: PackedSceneRuntime,
  hiddenParts: ReadonlySet<number>,
  hiddenAssemblies: ReadonlySet<AssemblyOccurrenceId>,
): void {
  for (const slot of hiddenParts) runtime.setInstanceVisible(slot, false);
  for (const id of hiddenAssemblies) {
    runtime.setAssemblyNodeVisible(runtime.getNodeSlot(id) ?? -1, false);
  }
}

/** Reconciles primitive visibility by occurrence identity and semantic index. */
export function reconcilePrimitiveVisibility(
  hiddenBodyIds: ReadonlyMap<PartOccurrenceId, ReadonlySet<BodyId>>,
  hiddenElementIds: ReadonlyMap<PartOccurrenceId, ReadonlySet<ElementId>>,
  previous: PackedSceneRuntime,
  runtime: PackedSceneRuntime,
  parts: ReadonlyMap<PartId, Part>,
): InteractionVisibility {
  return {
    hiddenBodyIds: reconcilePrimitiveMap(hiddenBodyIds, previous, runtime, parts, (index, id) =>
      index.hasBody(id),
    ),
    hiddenElementIds: reconcilePrimitiveMap(
      hiddenElementIds,
      previous,
      runtime,
      parts,
      (index, id) => index.hasElement(id),
    ),
  };
}

function reconcilePrimitiveMap<Id extends number>(
  hidden: ReadonlyMap<PartOccurrenceId, ReadonlySet<Id>>,
  previous: PackedSceneRuntime,
  runtime: PackedSceneRuntime,
  parts: ReadonlyMap<PartId, Part>,
  isValid: (index: ReturnType<typeof getPartSemanticIndex>, id: Id) => boolean,
): ReadonlyMap<PartOccurrenceId, ReadonlySet<Id>> {
  const next = new Map<PartOccurrenceId, ReadonlySet<Id>>();
  for (const [previousId, ids] of hidden) {
    const previousSlot = previous.getInstanceSlot(previousId);
    const nextId = previousSlot === undefined ? undefined : previous.getInstanceId(previousSlot);
    const nextSlot = nextId === undefined ? undefined : runtime.getInstanceSlot(nextId);
    const partId = nextSlot === undefined ? undefined : runtime.getPartId(nextSlot);
    const part = partId === undefined ? undefined : parts.get(partId);
    if (nextId === undefined || nextSlot === undefined || part === undefined) continue;
    const index = getPartSemanticIndex(part);
    const retained = new Set<Id>();
    for (const id of ids) if (isValid(index, id)) retained.add(id);
    if (retained.size > 0) next.set(nextId, retained);
  }
  return next;
}
