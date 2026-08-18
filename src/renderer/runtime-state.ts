import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { Part, PartId } from "../geometry/part";
import type { Instance, InstanceId } from "../scene/types";
import { readInteractionState, type InteractionState } from "../interaction/state";
import type { DrawCall } from "./resources/draw-resources";
import { hasValidNodeSelection, partNodeCount } from "./selection/node-selection";

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
  /** Node-annotation visible instance count per part. */
  readonly partNodeCounts: Map<PartId, number>;
  /** Transparent visible instance count per part. */
  readonly partTransparentCounts: Map<PartId, number>;
  /** Visible selected-instance count per part. */
  readonly partSelectionCounts: Map<PartId, number>;
  /** Visible selected-node-instance count per part. */
  readonly partSelectedNodeCounts: Map<PartId, number>;
  /** Ranged selected calls, when all selected targets map to authored ranges. */
  readonly partSelectionDrawCalls: Map<PartId, readonly DrawCall[]>;
  /** Surface calls split by active visibility signature when compact skins exist. */
  readonly partSurfaceDrawCalls: Map<PartId, readonly DrawCall[]>;
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
  const partVisibleCounts = new Map<PartId, number>();
  const partEdgeCounts = new Map<PartId, number>();
  const partNodeCounts = new Map<PartId, number>();
  const partTransparentCounts = new Map<PartId, number>();
  const partSelectionCounts = new Map<PartId, number>();
  const partSelectedNodeCounts = new Map<PartId, number>();
  const partSelectionDrawCalls = new Map<PartId, readonly DrawCall[]>();
  const partSurfaceDrawCalls = new Map<PartId, readonly DrawCall[]>();
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
  }
  return {
    instanceCount,
    slotPartLocal,
    partSlots,
    partOrder,
    partVisibleCounts,
    partEdgeCounts,
    partNodeCounts,
    partTransparentCounts,
    partSelectionCounts,
    partSelectedNodeCounts,
    partSelectionDrawCalls,
    partSurfaceDrawCalls,
    visibleCount: drawList.length,
  };
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
  previous: PreviousInstanceLayout | undefined,
): void {
  const localByInstanceId = previousInstanceLocals(previous);
  const usedLocals = new Map<PartId, Set<number>>();
  for (const [partId, slots] of partSlots) {
    const used = new Set<number>();
    usedLocals.set(partId, used);
    for (const slot of slots) {
      const instanceId = runtime.getInstanceId(slot);
      const previousLocal =
        instanceId === undefined ? undefined : localByInstanceId.get(instanceId);
      if (previousLocal?.partId !== partId || previousLocal.local < 0) continue;
      slotPartLocal[slot] = previousLocal.local;
      used.add(previousLocal.local);
    }
  }
  for (const [partId, slots] of partSlots) {
    const used = usedLocals.get(partId);
    if (used === undefined) continue;
    for (const slot of slots) {
      const currentLocal = slotPartLocal[slot];
      if (currentLocal !== undefined && currentLocal >= 0) continue;
      const local = nextFreeLocal(used);
      slotPartLocal[slot] = local;
      used.add(local);
    }
  }
}

interface PreviousInstanceLocal {
  readonly partId: PartId;
  readonly local: number;
}

function previousInstanceLocals(
  previous: PreviousInstanceLayout | undefined,
): ReadonlyMap<string, PreviousInstanceLocal> {
  if (previous === undefined) return new Map();
  const locals = new Map<string, PreviousInstanceLocal>();
  for (let slot = 0; slot < previous.runtime.instanceCount; slot += 1) {
    const instanceId = previous.runtime.getInstanceId(slot);
    const partId = previous.runtime.instancePartIds[slot];
    const local = previous.layout.slotPartLocal[slot];
    if (instanceId !== undefined && partId !== undefined && local !== undefined && local >= 0) {
      locals.set(instanceId, { partId, local });
    }
  }
  return locals;
}

function nextFreeLocal(used: ReadonlySet<number>): number {
  let local = 0;
  while (used.has(local)) local += 1;
  return local;
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
  readonly selectedNodeFlags?: readonly boolean[];
}): Uint32Array {
  if (
    options.parts
      .get(options.partId)
      ?.geometries.every((geometry) => geometry.primitive === "points")
  ) {
    return new Uint32Array();
  }
  return buildCompactedOrder(
    options.layout,
    options.partId,
    (slot) =>
      (options.nodeFlags[slot] === true || options.selectedNodeFlags?.[slot] === true) &&
      options.runtime.isInstanceVisible(slot),
  );
}

/** Returns visible part-local slots with an explicitly selected node. */
export function buildNodeSelectionOrder(
  layout: InstanceLayout,
  runtime: PackedSceneRuntime,
  partId: PartId,
  selectedNodeFlags: readonly boolean[],
  parts: ReadonlyMap<PartId, Part>,
): Uint32Array {
  if (parts.get(partId)?.geometries.every((geometry) => geometry.primitive === "points"))
    return new Uint32Array();
  return buildCompactedOrder(
    layout,
    partId,
    (slot) => selectedNodeFlags[slot] === true && runtime.isInstanceVisible(slot),
  );
}

/** Returns visible part-local slots that carry any selected target. */
export function buildSelectionOrder(
  layout: InstanceLayout,
  runtime: PackedSceneRuntime,
  partId: PartId,
  interaction: InteractionState,
  parts: ReadonlyMap<PartId, Part>,
): Uint32Array {
  const data = readInteractionState(interaction);
  return buildCompactedOrder(layout, partId, (slot) => {
    const instanceId = runtime.getInstanceId(slot);
    return (
      instanceId !== undefined &&
      runtime.isInstanceVisible(slot) &&
      hasSelectedTarget(data, instanceId, partId, parts.get(partId))
    );
  });
}

function hasSelectedTarget(
  data: ReturnType<typeof readInteractionState>,
  instanceId: InstanceId,
  partId: PartId,
  part: Part | undefined,
): boolean {
  return (
    data.selectedPartIds.has(partId) ||
    data.selectedInstanceIds.has(instanceId) ||
    (data.selectedBodyIds.get(instanceId)?.size ?? 0) > 0 ||
    (data.selectedElementIds.get(instanceId)?.size ?? 0) > 0 ||
    (data.selectedFaces.get(instanceId)?.size ?? 0) > 0 ||
    hasValidNodeSelection(
      data.selectedNodeIds.get(instanceId),
      part === undefined ? 0 : partNodeCount(part),
    )
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
export function buildEdgeOrder(
  layout: InstanceLayout,
  runtime: PackedSceneRuntime,
  partId: PartId,
  edgeFlags: readonly boolean[],
  edgeEmphasisFlags: readonly boolean[] = [],
): Uint32Array {
  return buildCompactedOrder(
    layout,
    partId,
    (slot) =>
      (edgeFlags[slot] === true || edgeEmphasisFlags[slot] === true) &&
      runtime.isInstanceVisible(slot),
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
export function instanceAt(runtime: PackedSceneRuntime, slot: number, partId: PartId): Instance {
  return {
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
  readonly transparentCalls: DrawCall[];
  readonly edgeCalls: DrawCall[];
  readonly nodeCalls: DrawCall[];
  readonly selectionCalls: DrawCall[];
  readonly selectedNodeCalls: DrawCall[];
}

/** Builds the deterministic per-part draw calls from the layout's counts. */
export function buildDrawCalls(layout: InstanceLayout): DrawCallLists {
  const calls: DrawCall[] = [];
  const transparentCalls: DrawCall[] = [];
  const edgeCalls: DrawCall[] = [];
  const nodeCalls: DrawCall[] = [];
  const selectionCalls: DrawCall[] = [];
  const selectedNodeCalls: DrawCall[] = [];
  for (const partId of layout.partOrder) {
    const count = layout.partVisibleCounts.get(partId);
    if (count !== undefined && count > 0) {
      const surfaceCalls = layout.partSurfaceDrawCalls.get(partId);
      if (surfaceCalls === undefined) calls.push({ partId, instanceCount: count });
      else calls.push(...surfaceCalls);
    }
    const edgeCount = layout.partEdgeCounts.get(partId);
    if (edgeCount !== undefined && edgeCount > 0) {
      edgeCalls.push({ partId, instanceCount: edgeCount });
    }
    const transparentCount = layout.partTransparentCounts.get(partId);
    if (transparentCount !== undefined && transparentCount > 0) {
      transparentCalls.push({ partId, instanceCount: transparentCount });
    }
    const nodeCount = layout.partNodeCounts.get(partId);
    if (nodeCount !== undefined && nodeCount > 0) {
      nodeCalls.push({ partId, instanceCount: nodeCount });
    }
    const selectionCount = layout.partSelectionCounts.get(partId);
    if (selectionCount !== undefined && selectionCount > 0) {
      const rangedCalls = layout.partSelectionDrawCalls.get(partId);
      if (rangedCalls === undefined) {
        selectionCalls.push({ partId, instanceCount: selectionCount });
      } else {
        selectionCalls.push(...rangedCalls);
      }
    }
    const selectedNodeCount = layout.partSelectedNodeCounts.get(partId);
    if (selectedNodeCount !== undefined && selectedNodeCount > 0) {
      selectedNodeCalls.push({ partId, instanceCount: selectedNodeCount });
    }
  }
  return { calls, transparentCalls, edgeCalls, nodeCalls, selectionCalls, selectedNodeCalls };
}
