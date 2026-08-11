import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { PartId } from "../geometry/part";
import type { Instance, InstanceId } from "../scene/types";
import type { DrawCall } from "./gpu-draw";

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
  /** Edge-overlay visible instance count per part. */
  readonly partEdgeCounts: Map<PartId, number>;
  /** Total visible instance count, kept in sync with the runtime. */
  visibleCount: number;
}

/** Builds the stable slot/part layout and current visibility counts. */
export function buildInstanceLayout(runtime: PackedSceneRuntime): InstanceLayout {
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
  const partEdgeCounts = new Map<PartId, number>();
  const drawList = runtime.getDrawList();
  for (const slot of drawList) {
    const partId = runtime.instancePartIds[slot];
    if (partId === undefined) continue;
    partVisibleCounts.set(partId, (partVisibleCounts.get(partId) ?? 0) + 1);
  }
  for (const partId of partOrder) {
    partEdgeCounts.set(partId, 0);
  }
  return {
    instanceCount,
    slotPartLocal,
    partSlots,
    partOrder,
    partVisibleCounts,
    partEdgeCounts,
    visibleCount: drawList.length,
  };
}

/** Returns the visible part-local slots of a part in ascending draw order. */
export function buildDrawOrder(
  layout: InstanceLayout,
  runtime: PackedSceneRuntime,
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

/**
 * Returns the visible part-local slots of a part whose resolved style requests
 * the edge overlay, in ascending draw order.
 */
export function buildEdgeOrder(
  layout: InstanceLayout,
  runtime: PackedSceneRuntime,
  partId: PartId,
  edgeFlags: readonly boolean[],
): Uint32Array {
  const slots = layout.partSlots.get(partId);
  if (slots === undefined) return new Uint32Array();
  const overlay: number[] = [];
  for (const slot of slots) {
    const local = layout.slotPartLocal[slot];
    if (
      local !== undefined &&
      local >= 0 &&
      edgeFlags[slot] === true &&
      runtime.isInstanceVisible(slot)
    ) {
      overlay.push(local);
    }
  }
  return new Uint32Array(overlay);
}

/** Describes one placed part with a world-transform view into the runtime. */
export function instanceAt(runtime: PackedSceneRuntime, slot: number, partId: PartId): Instance {
  return {
    index: slot,
    instanceId: runtime.getInstanceId(slot) ?? String(slot),
    partId,
    worldTransform: runtime.instanceWorldTransforms.subarray(slot * 16, slot * 16 + 16),
  };
}

/** The stable instance descriptors and their id-to-slot map for one runtime. */
export interface InstanceSnapshot {
  readonly instances: Instance[];
  readonly slotByInstanceId: Map<InstanceId, number>;
}

/** Snapshots every placed instance for CPU-side pick resolution. */
export function buildInstanceSnapshot(runtime: PackedSceneRuntime): InstanceSnapshot {
  const instances: Instance[] = [];
  const slotByInstanceId = new Map<InstanceId, number>();
  for (let slot = 0; slot < runtime.instanceCount; slot++) {
    const instanceId = runtime.getInstanceId(slot);
    const partId = runtime.instancePartIds[slot];
    if (instanceId === undefined || partId === undefined) continue;
    slotByInstanceId.set(instanceId, slot);
    instances.push(instanceAt(runtime, slot, partId));
  }
  return { instances, slotByInstanceId };
}

/** The per-part surface and edge-overlay draw calls of a layout. */
export interface DrawCallLists {
  readonly calls: DrawCall[];
  readonly edgeCalls: DrawCall[];
}

/** Builds the deterministic per-part draw calls from the layout's counts. */
export function buildDrawCalls(layout: InstanceLayout): DrawCallLists {
  const calls: DrawCall[] = [];
  const edgeCalls: DrawCall[] = [];
  for (const partId of layout.partOrder) {
    const count = layout.partVisibleCounts.get(partId);
    if (count !== undefined && count > 0) {
      calls.push({ partId, instanceCount: count });
    }
    const edgeCount = layout.partEdgeCounts.get(partId);
    if (edgeCount !== undefined && edgeCount > 0) {
      edgeCalls.push({ partId, instanceCount: edgeCount });
    }
  }
  return { calls, edgeCalls };
}
