import type { PartId } from "../geometry/part";
import type { EmphasisUpdates } from "./gpu-elements";
import {
  INSTANCE_EMPHASIS_FLAG,
  INSTANCE_EDGE_EMPHASIS_FLAG,
  INSTANCE_STRIDE,
  type InstanceStorage,
} from "./gpu-instance-storage";
import { writeChangedRecordRanges } from "./gpu-writes";
import type { GpuCostAccumulator } from "./gpu-cost";
import type { DenseElementSelections } from "./gpu-element-selection";

interface InstanceEmphasisSync {
  readonly device: GPUDevice;
  readonly cost: GpuCostAccumulator;
  readonly storages: ReadonlyMap<PartId, InstanceStorage>;
}

/** Updates per-occurrence admission bits without touching unaffected records. */
export function syncInstanceEmphasisAdmission(
  sync: InstanceEmphasisSync,
  updates: EmphasisUpdates,
  affectedParts: ReadonlySet<PartId>,
  denseSelections?: DenseElementSelections,
): void {
  for (const [partId, storage] of sync.storages) {
    if (!affectedParts.has(partId)) continue;
    const partUpdates = updates.get(partId) ?? [];
    const nextSlots = new Set(partUpdates.map((update) => update.slot));
    const nextEdgeSlots = new Set(
      partUpdates.filter((update) => update.edgePickId !== undefined).map((update) => update.slot),
    );
    for (const occurrence of denseSelections?.get(partId)?.occurrences ?? []) {
      nextSlots.add(occurrence.slot);
    }
    const changedSlots = new Set([
      ...changedEmphasisSlots(storage.emphasisSlots, nextSlots),
      ...changedEmphasisSlots(storage.edgeEmphasisSlots, nextEdgeSlots),
    ]);
    if (changedSlots.size === 0) continue;
    const next = new Uint8Array(storage.data);
    const flags = new Uint32Array(next.buffer);
    for (const slot of changedSlots) {
      const word = slot * (INSTANCE_STRIDE / 4) + 22;
      const current = flags[word] ?? 0;
      flags[word] = nextSlots.has(slot)
        ? current | INSTANCE_EMPHASIS_FLAG
        : current & ~INSTANCE_EMPHASIS_FLAG;
      flags[word] = nextEdgeSlots.has(slot)
        ? (flags[word] ?? 0) | INSTANCE_EDGE_EMPHASIS_FLAG
        : (flags[word] ?? 0) & ~INSTANCE_EDGE_EMPHASIS_FLAG;
    }
    writeChangedRecordRanges(sync.device, {
      buffer: storage.buffer,
      next,
      recordOffset: 0,
      recordStride: INSTANCE_STRIDE,
      recordIndices: [...changedSlots],
      cost: sync.cost,
      category: "instance",
    });
    storage.emphasisSlots = nextSlots;
    storage.edgeEmphasisSlots = nextEdgeSlots;
  }
}

function changedEmphasisSlots(previous: ReadonlySet<number>, next: ReadonlySet<number>): number[] {
  const changed = new Set<number>();
  for (const slot of previous) if (!next.has(slot)) changed.add(slot);
  for (const slot of next) if (!previous.has(slot)) changed.add(slot);
  return [...changed];
}
