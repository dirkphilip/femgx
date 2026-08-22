import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { Part, PartId } from "../geometry/part";
import type { PartOccurrence, PartOccurrenceId } from "../scene/types";
import type { DrawCall } from "./resources/draw-resources";
import { isPointOnlyPart } from "./selection/order";

export { buildSelectionOrder } from "./selection/order";

/**
 * CPU-side bridge between the packed scene runtime and per-part GPU storage.
 * Maps stable instance slots to part-local slots and derives compacted draw
 * order lists from the current visibility bits without touching geometry.
 */
export interface InstanceLayout {
  instanceCount: number;
  /** Part-local slot per global instance slot. */
  slotPartLocal: Int32Array;
  /** Global slots of each part in ascending order. */
  readonly partSlots: Map<PartId, Uint32Array>;
  /** Global slot by stable part-local slot, with `-1` for retained holes. */
  readonly partLocalSlots: Map<PartId, Int32Array>;
  /** Deterministic part draw order (ascending part id). */
  readonly partOrder: PartId[];
  /** Visible instance count per part. */
  readonly partVisibleCounts: Map<PartId, number>;
  /** Edge-overlay visible instance count per part. */
  readonly partEdgeCounts: Map<PartId, number>;
  /** Node-annotation visible instance count per part. */
  readonly partNodeCounts: Map<PartId, number>;
  /** Transparent visible instance count per part. */
  readonly partTransparentCounts: Map<PartId, number>;
  /** Visible selected-instance count per part. */
  readonly partSelectionCounts: Map<PartId, number>;
  /** Visible selected-node-instance count per part. */
  readonly partSelectedNodeCounts: Map<PartId, number>;
  /** Selected-node calls, split between compact sparse and dense replay orders. */
  readonly partSelectedNodeDrawCalls: Map<PartId, readonly DrawCall[]>;
  /** Ranged selected calls, when all selected targets map to authored ranges. */
  readonly partSelectionDrawCalls: Map<PartId, readonly DrawCall[]>;
  /** Surface calls split by active visibility signature when compact skins exist. */
  readonly partSurfaceDrawCalls: Map<PartId, readonly DrawCall[]>;
  /** Whether the edge pass needs full authored topology for each part. */
  readonly partEdgeNeedsFullTopology: Map<PartId, boolean>;
  /** Total visible instance count, kept in sync with the runtime. */
  visibleCount: number;
}

/** Builds the stable slot/part layout and current visibility counts. */
export interface PreviousInstanceLayout {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
}

/**
 * Builds the current slot layout, retaining part-local slots for surviving
 * placement identities when a host scene revision changes.
 */
export function buildInstanceLayout(
  runtime: PackedSceneRuntime,
  previous?: PreviousInstanceLayout,
): InstanceLayout {
  const instanceCount = runtime.instanceCount;
  const slotPartLocal = new Int32Array(instanceCount).fill(-1);
  const partOrder = Array.from(runtime.sortedPartIds);
  const partSlots = new Map<PartId, Uint32Array>();
  for (const partId of partOrder) {
    const slots = runtime.getPartInstanceSlots(partId);
    partSlots.set(partId, slots);
  }
  if (previous === undefined) assignInitialPartLocals(partSlots, slotPartLocal);
  else assignPartLocals(runtime, partSlots, slotPartLocal, previous);
  const partLocalSlots = buildPartLocalSlots(partSlots, slotPartLocal);
  const partVisibleCounts = new Map<PartId, number>();
  const partEdgeCounts = new Map<PartId, number>();
  const partNodeCounts = new Map<PartId, number>();
  const partTransparentCounts = new Map<PartId, number>();
  const partSelectionCounts = new Map<PartId, number>();
  const partSelectedNodeCounts = new Map<PartId, number>();
  const partSelectedNodeDrawCalls = new Map<PartId, readonly DrawCall[]>();
  const partSelectionDrawCalls = new Map<PartId, readonly DrawCall[]>();
  const partSurfaceDrawCalls = new Map<PartId, readonly DrawCall[]>();
  const partEdgeNeedsFullTopology = new Map<PartId, boolean>();
  const drawList = runtime.getDrawList();
  for (const slot of drawList) {
    const partId = runtime.instancePartIds[slot];
    if (partId === undefined) continue;
    partVisibleCounts.set(partId, (partVisibleCounts.get(partId) ?? 0) + 1);
  }
  for (const partId of partOrder) {
    partEdgeCounts.set(partId, 0);
    partNodeCounts.set(partId, 0);
    partTransparentCounts.set(partId, 0);
    partSelectionCounts.set(partId, 0);
    partSelectedNodeCounts.set(partId, 0);
    partEdgeNeedsFullTopology.set(partId, false);
  }
  return {
    instanceCount,
    slotPartLocal,
    partSlots,
    partLocalSlots,
    partOrder,
    partVisibleCounts,
    partEdgeCounts,
    partNodeCounts,
    partTransparentCounts,
    partSelectionCounts,
    partSelectedNodeCounts,
    partSelectedNodeDrawCalls,
    partSelectionDrawCalls,
    partSurfaceDrawCalls,
    partEdgeNeedsFullTopology,
    visibleCount: drawList.length,
  };
}

function buildPartLocalSlots(
  partSlots: ReadonlyMap<PartId, Uint32Array>,
  slotPartLocal: Int32Array,
): Map<PartId, Int32Array> {
  const localSlots = new Map<PartId, Int32Array>();
  for (const [partId, slots] of partSlots) {
    let capacity = 0;
    for (const slot of slots) capacity = Math.max(capacity, (slotPartLocal[slot] ?? -1) + 1);
    const byLocal = new Int32Array(capacity).fill(-1);
    for (const slot of slots) {
      const local = slotPartLocal[slot];
      if (local !== undefined && local >= 0) byLocal[local] = slot;
    }
    localSlots.set(partId, byLocal);
  }
  return localSlots;
}

function assignInitialPartLocals(
  partSlots: ReadonlyMap<PartId, Uint32Array>,
  slotPartLocal: Int32Array,
): void {
  for (const slots of partSlots.values()) {
    for (let local = 0; local < slots.length; local += 1) {
      const slot = slots[local];
      if (slot !== undefined) slotPartLocal[slot] = local;
    }
  }
}

function assignPartLocals(
  runtime: PackedSceneRuntime,
  partSlots: ReadonlyMap<PartId, Uint32Array>,
  slotPartLocal: Int32Array,
  previous: PreviousInstanceLayout,
): void {
  for (const [partId, slots] of partSlots) {
    const used = new Uint8Array(slots.length);
    for (const slot of slots) {
      const instanceId = runtime.getInstanceId(slot);
      const previousSlot =
        instanceId === undefined ? undefined : previous.runtime.getInstanceSlot(instanceId);
      if (previousSlot === undefined || previous.runtime.instancePartIds[previousSlot] !== partId) {
        continue;
      }
      const local = previous.layout.slotPartLocal[previousSlot];
      if (local === undefined || local < 0) continue;
      slotPartLocal[slot] = local;
      used[local] = 1;
    }
    let nextLocal = 0;
    for (const slot of slots) {
      const currentLocal = slotPartLocal[slot];
      if (currentLocal !== undefined && currentLocal >= 0) continue;
      while (used[nextLocal] === 1) nextLocal += 1;
      slotPartLocal[slot] = nextLocal;
      used[nextLocal] = 1;
    }
  }
}

/**
 * Returns the visible part-local slots whose resolved style requests node
 * annotations. Point parts are excluded because their primary glyph already
 * represents the authored node.
 */
export function buildNodeOrder(options: {
  readonly layout: InstanceLayout;
  readonly runtime: PackedSceneRuntime;
  readonly partId: PartId;
  readonly nodeFlags: readonly boolean[];
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly includeAll?: boolean;
}): Uint32Array {
  if (isPointOnlyPart(options.parts.get(options.partId))) {
    return new Uint32Array();
  }
  return buildCompactedOrder(
    options.layout,
    options.partId,
    (slot) =>
      (options.includeAll === true || options.nodeFlags[slot] === true) &&
      options.runtime.isInstanceVisible(slot),
  );
}

/** Returns the visible part-local slots of a part in ascending draw order. */
export function buildDrawOrder(
  layout: InstanceLayout,
  runtime: PackedSceneRuntime,
  partId: PartId,
): Uint32Array {
  return buildCompactedOrder(layout, partId, (slot) => runtime.isInstanceVisible(slot));
}

/**
 * Returns the visible part-local slots of a part whose resolved style requests
 * the edge overlay, in ascending draw order.
 */
export function buildEdgeOrder(options: {
  readonly layout: InstanceLayout;
  readonly runtime: PackedSceneRuntime;
  readonly partId: PartId;
  readonly edgeFlags: readonly boolean[];
  readonly edgeEmphasisFlags?: readonly boolean[];
  readonly includeAll?: boolean;
}): Uint32Array {
  return buildCompactedOrder(
    options.layout,
    options.partId,
    (slot) =>
      (options.includeAll === true ||
        options.edgeFlags[slot] === true ||
        options.edgeEmphasisFlags?.[slot] === true) &&
      options.runtime.isInstanceVisible(slot),
  );
}

/** Returns the visible part-local slots classified for weighted transparency. */
export function buildTransparentOrder(
  layout: InstanceLayout,
  runtime: PackedSceneRuntime,
  partId: PartId,
  transparentFlags: readonly boolean[],
): Uint32Array {
  return buildCompactedOrder(
    layout,
    partId,
    (slot) => transparentFlags[slot] === true && runtime.isInstanceVisible(slot),
  );
}

function buildCompactedOrder(
  layout: InstanceLayout,
  partId: PartId,
  include: (slot: number) => boolean,
): Uint32Array {
  const slots = layout.partSlots.get(partId);
  if (slots === undefined) return new Uint32Array();
  const order: number[] = [];
  for (const slot of slots) {
    const local = layout.slotPartLocal[slot];
    if (local !== undefined && local >= 0 && include(slot)) order.push(local);
  }
  return new Uint32Array(order);
}

/** Describes one placed part with a world-transform view into the runtime. */
export function instanceAt(
  runtime: PackedSceneRuntime,
  slot: number,
  partId: PartId,
): PartOccurrence {
  return {
    partOccurrenceId: runtime.getInstanceId(slot) ?? String(slot),
    partId,
    worldTransform: runtime.instanceWorldTransforms.subarray(slot * 16, slot * 16 + 16),
  };
}

/** The stable instance descriptors and their id-to-slot map for one runtime. */
export interface InstanceSnapshot {
  readonly instances: Array<PartOccurrence | undefined>;
  readonly slotByInstanceId: Map<PartOccurrenceId, number>;
}

/** Snapshots every placed instance for CPU-side pick resolution. */
export function buildInstanceSnapshot(runtime: PackedSceneRuntime): InstanceSnapshot {
  const instances = Array.from(
    { length: runtime.instanceCount },
    (): PartOccurrence | undefined => undefined,
  );
  const slotByInstanceId = new Map<PartOccurrenceId, number>();
  for (let slot = 0; slot < runtime.instanceCount; slot++) {
    const instanceId = runtime.getInstanceId(slot);
    const partId = runtime.instancePartIds[slot];
    if (instanceId === undefined || partId === undefined) continue;
    slotByInstanceId.set(instanceId, slot);
    instances[slot] = instanceAt(runtime, slot, partId);
  }
  return { instances, slotByInstanceId };
}

/** The per-part surface and edge-overlay draw calls of a layout. */
export interface DrawCallLists {
  readonly calls: DrawCall[];
  readonly transparentCalls: DrawCall[];
  readonly edgeCalls: DrawCall[];
  readonly nodeCalls: DrawCall[];
  readonly selectionCalls: DrawCall[];
  readonly selectedNodeCalls: DrawCall[];
}

/** Builds the deterministic per-part draw calls from the layout's counts. */
export function buildDrawCalls(layout: InstanceLayout): DrawCallLists {
  const calls = emptyDrawCallLists();
  for (const partId of layout.partOrder) appendPartDrawCalls(calls, layout, partId);
  return calls;
}

/** Creates mutable empty per-pass call lists for attachment-owned derivation. */
export function emptyDrawCallLists(): DrawCallLists {
  return {
    calls: [],
    transparentCalls: [],
    edgeCalls: [],
    nodeCalls: [],
    selectionCalls: [],
    selectedNodeCalls: [],
  };
}

/** Appends one part's current calls to ascending attachment call lists. */
export function appendPartDrawCalls(
  target: DrawCallLists,
  layout: InstanceLayout,
  partId: PartId,
): void {
  const count = layout.partVisibleCounts.get(partId);
  if (count !== undefined && count > 0) {
    const surfaceCalls = layout.partSurfaceDrawCalls.get(partId);
    if (surfaceCalls === undefined) target.calls.push({ partId, instanceCount: count });
    else target.calls.push(...surfaceCalls);
  }
  appendCountCall(
    target.edgeCalls,
    partId,
    layout.partEdgeCounts.get(partId),
    layout.partEdgeNeedsFullTopology.get(partId) === true,
  );
  appendCountCall(target.transparentCalls, partId, layout.partTransparentCounts.get(partId));
  appendCountCall(target.nodeCalls, partId, layout.partNodeCounts.get(partId));
  const selectionCount = layout.partSelectionCounts.get(partId);
  if (selectionCount !== undefined && selectionCount > 0) {
    const rangedCalls = layout.partSelectionDrawCalls.get(partId);
    if (rangedCalls === undefined) {
      target.selectionCalls.push({ partId, instanceCount: selectionCount });
    } else target.selectionCalls.push(...rangedCalls);
  }
  const selectedNodeCalls = layout.partSelectedNodeDrawCalls.get(partId);
  if (selectedNodeCalls !== undefined) target.selectedNodeCalls.push(...selectedNodeCalls);
}

function appendCountCall(
  target: DrawCall[],
  partId: PartId,
  count: number | undefined,
  fullEdgeTopology = false,
): void {
  if (count !== undefined && count > 0) {
    target.push({
      partId,
      instanceCount: count,
      ...(fullEdgeTopology ? { fullEdgeTopology: true } : {}),
    });
  }
}
