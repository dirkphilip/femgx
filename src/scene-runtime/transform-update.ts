import { multiplyMatrices, type Mat4 } from "../math/mat4";
import type { AssemblyPlacement, PartPlacement } from "../scene/assembly";
import type { Scene } from "../scene/scene";
import type { SceneStructuralChanges } from "../scene/update-changes";
import { isTransformOnlyChanges } from "../scene/update-changes";
import type { AssemblyOccurrenceId, PartOccurrenceId } from "../scene/types";
import { invariantValue } from "./invariants";
import type { PackedSceneRuntime } from "./runtime";

interface TransformPatch {
  readonly nodeTransforms: ReadonlyMap<number, Mat4>;
  readonly instanceTransforms: ReadonlyMap<number, Mat4>;
}

interface MutableTransformPatch {
  readonly nodeTransforms: Map<number, Mat4>;
  readonly instanceTransforms: Map<number, Mat4>;
}

/** Prepares changed-subtree transform patches when identities and topology are unchanged. */
export function prepareTransformPatch(
  runtime: PackedSceneRuntime,
  scene: Scene,
  changes: SceneStructuralChanges,
): TransformPatch | undefined {
  if (!isTransformOnlyChanges(changes)) return undefined;
  const patches: MutableTransformPatch = {
    nodeTransforms: new Map<number, Mat4>(),
    instanceTransforms: new Map<number, Mat4>(),
  };
  for (const change of changes.placements) {
    const after = invariantValue(change.after, "transformed placement");
    for (const ownerNode of runtime.getAssemblyNodeSlots(change.ownerAssemblyId)) {
      const ownerId = invariantValue(runtime.getNodeId(ownerNode), `node id at ${ownerNode}`);
      const ownerWorld = nodeTransform(runtime, patches.nodeTransforms, ownerNode);
      if (after.kind === "part") {
        const slot = runtime.getInstanceSlot(placementPath(ownerId, after));
        if (slot === undefined) return undefined;
        patches.instanceTransforms.set(slot, multiplyMatrices(ownerWorld, after.transform));
      } else if (
        !collectSubtreePatch(
          runtime,
          scene,
          placementPath(ownerId, after),
          multiplyMatrices(ownerWorld, after.transform),
          patches,
        )
      ) {
        return undefined;
      }
    }
  }
  return patches;
}

/** Applies a previously prepared transform patch and returns the changed instance slots. */
export function applyTransformPatch(
  runtime: PackedSceneRuntime,
  patch: TransformPatch,
): readonly number[] {
  for (const [node, transform] of patch.nodeTransforms) {
    runtime.nodeWorldTransforms.set(transform, node * 16);
  }
  for (const [slot, transform] of patch.instanceTransforms) {
    runtime.instanceWorldTransforms.set(transform, slot * 16);
  }
  return [...patch.instanceTransforms.keys()];
}

function collectSubtreePatch(
  runtime: PackedSceneRuntime,
  scene: Scene,
  entryId: AssemblyOccurrenceId,
  entryWorld: Mat4,
  patches: MutableTransformPatch,
): boolean {
  const stack: SubtreeEntry[] = [{ id: entryId, world: entryWorld }];
  while (stack.length > 0) {
    const entry = invariantValue(stack.pop(), "transform subtree entry");
    const node = runtime.getNodeSlot(entry.id);
    if (node === undefined) return false;
    const assemblyId = invariantValue(runtime.nodeAssemblyIds[node], `assembly at node ${node}`);
    const assembly = scene.assemblies.get(assemblyId);
    if (assembly === undefined) return false;
    patches.nodeTransforms.set(node, entry.world);
    for (let index = 0; index < assembly.placements.length; index += 1) {
      const placement = invariantValue(assembly.placements[index], `placement at ${index}`);
      const id = placementPath(entry.id, placement, index);
      const world = multiplyMatrices(entry.world, placement.transform);
      if (placement.kind === "assembly") stack.push({ id, world });
      else {
        const slot = runtime.getInstanceSlot(id);
        if (slot === undefined) return false;
        patches.instanceTransforms.set(slot, world);
      }
    }
  }
  return true;
}

function placementPath(
  ownerId: AssemblyOccurrenceId,
  placement: PartPlacement | AssemblyPlacement,
  index?: number,
): PartOccurrenceId & AssemblyOccurrenceId {
  return `${ownerId}/${placement.placementId ?? invariantValue(index, "placement index")}`;
}

function nodeTransform(
  runtime: PackedSceneRuntime,
  pending: ReadonlyMap<number, Mat4>,
  node: number,
): Mat4 {
  return pending.get(node) ?? runtime.nodeWorldTransforms.subarray(node * 16, node * 16 + 16);
}

interface SubtreeEntry {
  readonly id: AssemblyOccurrenceId;
  readonly world: Mat4;
}
