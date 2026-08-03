import type { Instance, PartId } from "../scene/types";

/** A contiguous draw range for one reusable part. */
export interface InstanceBatch {
  readonly partId: PartId;
  readonly instances: readonly Instance[];
}

/** Groups instances by part while preserving first-seen and source ordering. */
export function batchInstancesByPart(instances: readonly Instance[]): readonly InstanceBatch[] {
  const batches = new Map<PartId, Instance[]>();
  for (const instance of instances) {
    const batch = batches.get(instance.partId);
    if (batch === undefined) {
      batches.set(instance.partId, [instance]);
    } else {
      batch.push(instance);
    }
  }
  return Array.from(batches, ([partId, groupedInstances]) => ({
    partId,
    instances: groupedInstances,
  }));
}
