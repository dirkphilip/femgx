import type { SceneRuntime } from "../scene-runtime/runtime";
import type { PartId } from "../scene/types";

/**
 * CPU-side bridge between the packed scene runtime and per-part GPU storage.
 * Maps stable instance slots to part-local slots and derives compacted draw
 * order lists from the current visibility bits without touching geometry.
 */
export interface InstanceLayout {
  readonly instanceCount: number;
  /** Part-local slot per global instance slot. */
  readonly slotPartLocal: Int32Array;
  /** Global slots of each part in ascending order. */
  readonly partSlots: ReadonlyMap<PartId, Uint32Array>;
  /** Deterministic part draw order (ascending part id). */
  readonly partOrder: readonly PartId[];
  /** Visible instance count per part. */
  readonly partVisibleCounts: Map<PartId, number>;
  /** Total visible instance count, kept in sync with the runtime. */
  visibleCount: number;
}

/** Builds the stable slot/part layout and current visibility counts. */
export function buildInstanceLayout(runtime: SceneRuntime): InstanceLayout {
  const instanceCount = runtime.instanceCount;
  const slotPartLocal = new Int32Array(instanceCount).fill(-1);
  const grouped = new Map<PartId, number[]>();
  for (let slot = 0; slot < instanceCount; slot++) {
    const partId = runtime.instancePartIds[slot];
    if (partId === undefined) continue;
    const slots = grouped.get(partId);
    if (slots === undefined) {
      grouped.set(partId, [slot]);
      slotPartLocal[slot] = 0;
    } else {
      slots.push(slot);
      slotPartLocal[slot] = slots.length - 1;
    }
  }
  const partOrder = Array.from(grouped.keys()).sort((a, b) => a - b);
  const partSlots = new Map<PartId, Uint32Array>();
  for (const partId of partOrder) {
    partSlots.set(partId, new Uint32Array(grouped.get(partId) ?? []));
  }
  const partVisibleCounts = new Map<PartId, number>();
  const drawList = runtime.getDrawList();
  for (const slot of drawList) {
    const partId = runtime.instancePartIds[slot];
    if (partId === undefined) continue;
    partVisibleCounts.set(partId, (partVisibleCounts.get(partId) ?? 0) + 1);
  }
  return {
    instanceCount,
    slotPartLocal,
    partSlots,
    partOrder,
    partVisibleCounts,
    visibleCount: drawList.length,
  };
}

/** Returns the visible part-local slots of a part in ascending draw order. */
export function buildDrawOrder(
  layout: InstanceLayout,
  runtime: SceneRuntime,
  partId: PartId,
): Uint32Array {
  const slots = layout.partSlots.get(partId);
  if (slots === undefined) return new Uint32Array();
  const visible: number[] = [];
  for (const slot of slots) {
    const local = layout.slotPartLocal[slot];
    if (local !== undefined && local >= 0 && runtime.isInstanceVisible(slot)) {
      visible.push(local);
    }
  }
  return new Uint32Array(visible);
}
