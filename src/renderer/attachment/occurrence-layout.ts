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
  };
}

/** Stages sparse writes to the global-slot to part-local index. */
export function stageSlotLocals(source: Int32Array): StagedSlotLocals {
  const changes = new Map<number, number>();
  const values = new Proxy(source, {
    get(target, key) {
      if (key === "length") return target.length;
      const index = arrayIndex(key);
      if (index !== undefined) return changes.get(index) ?? target[index];
      return Reflect.get(target, key, target) as unknown;
    },
    set(target, key, value) {
      const index = arrayIndex(key);
      if (index === undefined) return Reflect.set(target, key, value, target);
      changes.set(index, Number(value));
      return true;
    },
  });
  return {
    values,
    commit(target) {
      for (const [index, value] of changes) target.slotPartLocal[index] = value;
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
}

function commitOverlay<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  if (source instanceof PartRevisionMap) source.commit(target);
}

function arrayIndex(key: PropertyKey): number | undefined {
  if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key)) return undefined;
  const index = Number(key);
  return Number.isSafeInteger(index) ? index : undefined;
}
