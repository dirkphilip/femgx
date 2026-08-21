import type { PartId } from "../geometry/part";
import { multiplyMatrices, type Mat4 } from "../math/mat4";
import type { Placement } from "../scene/assembly";
import type { Scene } from "../scene/scene";
import type { AssemblyOccurrenceId, PartOccurrenceId } from "../scene/types";
import { invariantValue } from "./invariants";
import type { PackedSceneRuntime } from "./runtime";

/** Relinks one retained node's mixed direct placement order without moving physical slots. */
export function relinkNodeOrder(runtime: PackedSceneRuntime, scene: Scene, node: number): void {
  const assemblyId = invariantValue(runtime.nodeAssemblyIds[node], `assembly at node ${node}`);
  const definition = invariantValue(scene.assemblies.get(assemblyId), `assembly ${assemblyId}`);
  const ownerId = invariantValue(runtime.getNodeId(node), `node id at ${node}`);
  const placements = definition.placements.map((placement, index) => {
    const id = path(ownerId, placement.placementId ?? String(index));
    const slot = placement.kind === "part" ? runtime.getInstanceSlot(id) : runtime.getNodeSlot(id);
    const resolved = invariantValue(slot, `placement ${id}`);
    return placement.kind === "part" ? resolved : ~resolved;
  });
  runtime.setNodePlacementOrder(node, placements);
}

/** Recomputes retained descendant worlds while preserving occurrence visibility overrides. */
export function patchRetainedSubtree(
  runtime: PackedSceneRuntime,
  scene: Scene,
  node: number,
  world: Mat4,
  resolvePartVisible: (partId: PartId, authoredVisible: boolean) => boolean,
): void {
  runtime.updateNodeTransform(node, world);
  const assemblyId = invariantValue(runtime.nodeAssemblyIds[node], `assembly at node ${node}`);
  const definition = invariantValue(scene.assemblies.get(assemblyId), `assembly ${assemblyId}`);
  const ownerId = invariantValue(runtime.getNodeId(node), `node id at ${node}`);
  for (let index = 0; index < definition.placements.length; index += 1) {
    const placement = invariantValue(definition.placements[index], `placement ${index}`);
    patchRetainedPlacement({ runtime, scene, node, ownerId, world, placement, resolvePartVisible });
  }
}

function patchRetainedPlacement(options: {
  readonly runtime: PackedSceneRuntime;
  readonly scene: Scene;
  readonly node: number;
  readonly ownerId: AssemblyOccurrenceId;
  readonly world: Mat4;
  readonly placement: Placement;
  readonly resolvePartVisible: (partId: PartId, authoredVisible: boolean) => boolean;
}): void {
  const { runtime, scene, node, ownerId, world, placement, resolvePartVisible } = options;
  const id = path(ownerId, invariantValue(placement.placementId, "explicit placement id"));
  const placementWorld = multiplyMatrices(world, placement.transform);
  if (placement.kind === "assembly") {
    const child = runtime.getNodeSlot(id);
    if (child !== undefined)
      patchRetainedSubtree(runtime, scene, child, placementWorld, resolvePartVisible);
    return;
  }
  const slot = runtime.getInstanceSlot(id);
  if (slot === undefined) return;
  runtime.updateInstance(slot, {
    instanceId: id,
    partId: placement.partId,
    owningNode: node,
    partVisible: resolvePartVisible(placement.partId, scene.visiblePartIds.has(placement.partId)),
    overrideVisible: runtime.instanceOverrideVisible[slot] === 1,
    worldTransform: placementWorld,
  });
}

function path(
  owner: AssemblyOccurrenceId,
  placementId: string,
): PartOccurrenceId & AssemblyOccurrenceId {
  return `${owner}/${placementId}`;
}
