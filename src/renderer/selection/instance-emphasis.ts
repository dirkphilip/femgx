import type { PartId } from "../../geometry/part";
import type { EmphasisUpdates } from "../resources/element-resources";
import {
  INSTANCE_EMPHASIS_FLAG,
  INSTANCE_EDGE_EMPHASIS_FLAG,
  INSTANCE_STRIDE,
  captureStagedInstanceRecord,
  type InstanceStorage,
} from "../resources/instance-storage";
import { writeChangedRecordRanges } from "../resources/buffer-writes";
import type { GpuCostAccumulator } from "../diagnostics/cost";
import type { DenseElementSelections } from "./element-selection";
import type { DenseNodeSelections } from "./node-selection";

interface InstanceEmphasisSync {
  readonly device: GPUDevice;
  readonly cost: GpuCostAccumulator;
  readonly storages: ReadonlyMap<PartId, InstanceStorage>;
}

export interface InstanceEmphasisMemberships {
  readonly elements?: DenseElementSelections;
  readonly nodes?: DenseNodeSelections;
  readonly hidden?: DenseElementSelections;
}

/** Updates per-occurrence admission bits without touching unaffected records. */
export function syncInstanceEmphasisAdmission(
  sync: InstanceEmphasisSync,
  updates: EmphasisUpdates,
  affectedParts: ReadonlySet<PartId>,
  dense: InstanceEmphasisMemberships = {},
): void {
  for (const partId of affectedParts) {
    const storage = sync.storages.get(partId);
    if (storage === undefined) continue;
    const partUpdates = updates.get(partId) ?? [];
    const nextSlots = new Set(partUpdates.map((update) => update.slot));
    const nextEdgeSlots = new Set(
      partUpdates.filter((update) => update.edgePickId !== undefined).map((update) => update.slot),
    );
    for (const occurrence of dense.elements?.get(partId)?.occurrences ?? []) {
      nextSlots.add(occurrence.slot);
    }
    for (const occurrence of dense.hidden?.get(partId)?.occurrences ?? []) {
      nextSlots.add(occurrence.slot);
    }
    for (const occurrence of dense.nodes?.get(partId)?.occurrences ?? []) {
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
      captureStagedInstanceRecord(storage, slot);
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
