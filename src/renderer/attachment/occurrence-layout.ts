import type { PartId } from "../../geometry/part";
import type { InstanceLayout } from "../runtime-state";
import { PartRevisionMap } from "./part-revision-overlay";

export interface StagedSlotLocals {
  readonly values: Int32Array;
  commit(target: InstanceLayout): void;
}

/** Stages sparse layout membership changes for exact affected definitions. */
export function stageOccurrenceLayout(
  source: InstanceLayout,
  slotPartLocal: Int32Array,
  partIds: ReadonlySet<PartId>,
): InstanceLayout {
  const partLocalSlots = new PartRevisionMap(source.partLocalSlots);
  for (const partId of partIds) {
    const slots = source.partLocalSlots.get(partId);
    if (slots !== undefined) partLocalSlots.set(partId, slots.slice());
  }
  return {
    ...source,
    slotPartLocal,
    partSlots: new PartRevisionMap(source.partSlots),
    partLocalSlots,
    partOrder: source.partOrder.slice(),
    partVisibleCounts: new PartRevisionMap(source.partVisibleCounts),
    partEdgeCounts: new PartRevisionMap(source.partEdgeCounts),
    partNodeCounts: new PartRevisionMap(source.partNodeCounts),
    partTransparentCounts: new PartRevisionMap(source.partTransparentCounts),
    partSelectionCounts: new PartRevisionMap(source.partSelectionCounts),
    partSelectedNodeCounts: new PartRevisionMap(source.partSelectedNodeCounts),
    partSelectedNodeDrawCalls: new PartRevisionMap(source.partSelectedNodeDrawCalls),
    partSelectionDrawCalls: new PartRevisionMap(source.partSelectionDrawCalls),
    partSurfaceDrawCalls: new PartRevisionMap(source.partSurfaceDrawCalls),
    partEdgeNeedsFullTopology: new PartRevisionMap(source.partEdgeNeedsFullTopology),
  };
}

/** Stages a detached global-slot to part-local index for fast read-heavy rebuilds. */
export function stageSlotLocals(source: Int32Array): StagedSlotLocals {
  const values = source.slice();
  return {
    values,
    commit(target) {
      target.slotPartLocal = values;
    },
  };
}

/** Publishes a staged layout after its renderer resources have committed. */
export function commitOccurrenceLayout(
  live: InstanceLayout,
  staged: InstanceLayout,
  slots: StagedSlotLocals,
): void {
  if (staged.slotPartLocal !== slots.values) live.slotPartLocal = staged.slotPartLocal;
  else slots.commit(live);
  live.instanceCount = staged.instanceCount;
  live.visibleCount = staged.visibleCount;
  live.partOrder.splice(0, live.partOrder.length, ...staged.partOrder);
  commitOverlay(live.partSlots, staged.partSlots);
  commitOverlay(live.partLocalSlots, staged.partLocalSlots);
  commitOverlay(live.partVisibleCounts, staged.partVisibleCounts);
  commitOverlay(live.partEdgeCounts, staged.partEdgeCounts);
  commitOverlay(live.partNodeCounts, staged.partNodeCounts);
  commitOverlay(live.partTransparentCounts, staged.partTransparentCounts);
  commitOverlay(live.partSelectionCounts, staged.partSelectionCounts);
  commitOverlay(live.partSelectedNodeCounts, staged.partSelectedNodeCounts);
  commitOverlay(live.partSelectedNodeDrawCalls, staged.partSelectedNodeDrawCalls);
  commitOverlay(live.partSelectionDrawCalls, staged.partSelectionDrawCalls);
  commitOverlay(live.partSurfaceDrawCalls, staged.partSurfaceDrawCalls);
  commitOverlay(live.partEdgeNeedsFullTopology, staged.partEdgeNeedsFullTopology);
}

function commitOverlay<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  if (source instanceof PartRevisionMap) source.commit(target);
}
