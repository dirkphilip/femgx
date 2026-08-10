import type { InstanceId, PartId, SceneRuntime } from "../../src/index";

/** Rebuilds the stable instance/part lookup maps used by demo picking and diagnostics. */
export function indexRuntime(
  runtime: SceneRuntime,
  slotByInstanceId: Map<InstanceId, number>,
  partIdByInstanceId: Map<InstanceId, PartId>,
  partFirstSlot: Map<PartId, number>,
): void {
  slotByInstanceId.clear();
  partIdByInstanceId.clear();
  partFirstSlot.clear();
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const instanceId = runtime.getInstanceId(slot);
    const partId = runtime.instancePartIds[slot];
    if (instanceId !== undefined) {
      slotByInstanceId.set(instanceId, slot);
      if (partId !== undefined) partIdByInstanceId.set(instanceId, partId);
    }
    if (partId !== undefined && !partFirstSlot.has(partId)) partFirstSlot.set(partId, slot);
  }
}
