import type { Part } from "../geometry/part";
import {
  createInteractionState,
  resolveInstanceStyle,
  type InteractionState,
} from "../interaction/interaction";
import { readInteractionState } from "../interaction/state";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { PartId } from "../geometry/part";
import type { Instance, InstanceId } from "../scene/types";
import { collectEmphasisUpdates } from "./gpu-elements";
import { syncElementHighlights } from "./gpu-highlight-storage";
import {
  createDrawResources,
  destroyDrawResources,
  patchInstances,
  writeDrawOrder,
  writeTransparentOrder,
  writeEdgeOrder,
  INSTANCE_STRIDE,
  type DrawCall,
  type DrawResources,
  type InstanceUpdate,
} from "./gpu-draw";
import type { GpuBundle } from "./gpu-recovery";
import { collectInstanceUpdates, type InstanceStyleFlags } from "./instance-updates";
import { defaultStyle } from "./gpu-support";
import {
  buildDrawOrder,
  buildEdgeOrder,
  buildTransparentOrder,
  buildDrawCalls,
  buildInstanceLayout,
  buildInstanceSnapshot,
  instanceAt,
  type InstanceLayout,
} from "./runtime-state";
import {
  syncSelectionState,
  syncVisibleSelectionOrders,
  writeNodeOrders,
  type SelectionState,
} from "./selection-state";

/**
 * The renderer's CPU-side attachment to a packed scene runtime: the instance
 * layout, compacted draw/edge calls, pick snapshot, and edge-flag mirror, kept
 * in sync with per-part GPU storage.
 *
 * `attach` performs one full geometry/layout upload for each runtime identity.
 * Transform, visibility, interaction, deformation, and highlight changes after
 * attachment remain incremental subrange updates.
 */
export class RendererAttachment {
  public runtime: PackedSceneRuntime | undefined;
  public layout: InstanceLayout | undefined;
  public calls: readonly DrawCall[] = [];
  public transparentCalls: readonly DrawCall[] = [];
  public edgeCalls: readonly DrawCall[] = [];
  public nodeCalls: readonly DrawCall[] = [];
  public selectionCalls: readonly DrawCall[] = [];
  public selectedNodeCalls: readonly DrawCall[] = [];
  public instances: Instance[] = [];
  public slotByInstanceId = new Map<InstanceId, number>();
  private edgeFlags: boolean[] = [];
  private nodeFlags: boolean[] = [];
  private transparentFlags: boolean[] = [];
  private readonly selection: SelectionState = { selectedNodeFlags: [], nodeFlags: this.nodeFlags };
  private interactionState = createInteractionState();
  private appliedHiddenBodyIds: ReadonlyMap<string, ReadonlySet<number>> | undefined;

  /**
   * Ensures the attachment matches `runtime`, rebuilding the attachment when
   * the runtime identity changes.
   */
  public attach(runtime: PackedSceneRuntime, bundle: GpuBundle): boolean {
    if (
      this.runtime === runtime &&
      this.layout !== undefined &&
      this.layout.instanceCount === runtime.instanceCount
    ) {
      return false;
    }
    const layout = buildInstanceLayout(runtime);
    this.fullAttach(runtime, layout, bundle);
    return true;
  }

  /** Writes only the GPU subranges affected by the changed instance slots. */
  public updateInstances(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    changedInstanceIds: readonly number[],
    bundle: GpuBundle,
  ): boolean {
    this.interactionState = interaction;
    const attached = this.attach(runtime, bundle);
    const layout = this.layout;
    if (layout === undefined) return attached;
    const { updates, edgeChanged, nodeChanged, transparentChanged } = collectInstanceUpdates(
      runtime,
      layout,
      interaction,
      this.styleFlags(),
      changedInstanceIds,
    );
    let transformChanged = false;
    for (const [partId, partUpdates] of updates) {
      transformChanged ||= instanceTransformsChanged(bundle.draw, partId, partUpdates);
      patchInstances(bundle.draw, partId, partUpdates);
    }
    if (edgeChanged.size > 0) {
      this.rebuildEdgeOrders(runtime, layout, edgeChanged, bundle);
    }
    if (transparentChanged.size > 0) {
      this.rebuildTransparentOrders(runtime, layout, transparentChanged, bundle);
    }
    const visibilityChanged = runtime.visibleCount !== layout.visibleCount;
    if (visibilityChanged) {
      this.rebuildVisibleOrders(runtime, layout, changedInstanceIds, bundle);
    } else if (edgeChanged.size > 0 || nodeChanged.size > 0 || transparentChanged.size > 0) {
      this.rebuildCalls();
    }
    return (
      attached ||
      transformChanged ||
      visibilityChanged ||
      edgeChanged.size > 0 ||
      nodeChanged.size > 0 ||
      transparentChanged.size > 0
    );
  }

  public updateNodeOrders(parts: ReadonlyMap<PartId, Part>, bundle: GpuBundle): void {
    const runtime = this.runtime;
    const layout = this.layout;
    if (runtime === undefined || layout === undefined) return;
    writeNodeOrders({ runtime, layout, parts, selection: this.selection, bundle });
    this.rebuildCalls();
  }

  public updateElements(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    bundle: GpuBundle,
    parts: ReadonlyMap<PartId, Part>,
  ): boolean {
    this.interactionState = interaction;
    const attached = this.attach(runtime, bundle);
    const layout = this.layout;
    if (layout === undefined) return attached;
    const hiddenBodyIds = readInteractionState(interaction).hiddenBodyIds;
    const bodyVisibilityChanged = this.appliedHiddenBodyIds !== hiddenBodyIds;
    syncElementHighlights(
      {
        device: bundle.device,
        draw: bundle.draw,
        runtime,
        layout,
        slotByInstanceId: this.slotByInstanceId,
        parts,
      },
      interaction,
    );
    this.appliedHiddenBodyIds = hiddenBodyIds;
    const transparentChanged = refreshTransparencyFlags(
      runtime,
      layout,
      interaction,
      parts,
      this.transparentFlags,
    );
    const selectionChanged = syncSelectionState({
      runtime,
      layout,
      interaction,
      parts,
      slotByInstanceId: this.slotByInstanceId,
      selection: this.selection,
      bundle,
    });
    if (transparentChanged.size > 0) {
      this.rebuildTransparentOrders(runtime, layout, transparentChanged, bundle);
    }
    this.rebuildCalls();
    return attached || bodyVisibilityChanged || transparentChanged.size > 0 || selectionChanged;
  }

  public updateVisibility(
    runtime: PackedSceneRuntime,
    changedInstanceIds: readonly number[],
    bundle: GpuBundle,
  ): boolean {
    const attached = this.attach(runtime, bundle);
    const layout = this.layout;
    if (layout === undefined) return attached;
    this.rebuildVisibleOrders(runtime, layout, changedInstanceIds, bundle);
    return attached || changedInstanceIds.length > 0;
  }

  public clear(): void {
    this.runtime = this.layout = undefined;
    this.calls = this.transparentCalls = this.edgeCalls = this.nodeCalls = [];
    this.selectionCalls = [];
    this.selectedNodeCalls = [];
    this.edgeFlags = [];
    this.nodeFlags.length = 0;
    this.transparentFlags = [];
    this.selection.selectedNodeFlags.length = 0;
    this.interactionState = createInteractionState();
    this.appliedHiddenBodyIds = undefined;
  }

  private fullAttach(runtime: PackedSceneRuntime, layout: InstanceLayout, bundle: GpuBundle): void {
    destroyDrawResources(bundle.draw);
    bundle.draw = createDrawResources(bundle.device);
    const snapshot = buildInstanceSnapshot(runtime);
    this.instances = snapshot.instances;
    this.slotByInstanceId = snapshot.slotByInstanceId;
    this.edgeFlags = new Array<boolean>(runtime.instanceCount).fill(false);
    this.nodeFlags.length = runtime.instanceCount;
    this.nodeFlags.fill(false);
    this.transparentFlags = new Array<boolean>(runtime.instanceCount).fill(false);
    this.selection.selectedNodeFlags.length = runtime.instanceCount;
    this.selection.selectedNodeFlags.fill(false);
    this.appliedHiddenBodyIds = undefined;
    const allSlots = Array.from({ length: runtime.instanceCount }, (_, slot) => slot);
    const { updates } = collectInstanceUpdates(
      runtime,
      layout,
      createInteractionState(),
      this.styleFlags(),
      allSlots,
    );
    for (const [partId, partUpdates] of updates) {
      patchInstances(bundle.draw, partId, partUpdates);
    }
    for (const partId of layout.partOrder) {
      writeDrawOrder(bundle.draw, partId, buildDrawOrder(layout, runtime, partId));
      writeTransparentOrder(
        bundle.draw,
        partId,
        buildTransparentOrder(layout, runtime, partId, this.transparentFlags),
      );
    }
    this.runtime = runtime;
    this.layout = layout;
    this.rebuildCalls();
  }

  private rebuildVisibleOrders(
    runtime: PackedSceneRuntime,
    layout: InstanceLayout,
    changedInstanceIds: readonly number[],
    bundle: GpuBundle,
  ): void {
    const affected = new Set<PartId>();
    for (const slot of changedInstanceIds) {
      if (slot < 0 || slot >= runtime.instanceCount) continue;
      const partId = runtime.instancePartIds[slot];
      if (partId !== undefined) affected.add(partId);
    }
    const rebuild = affected.size > 0 ? affected : new Set(layout.partOrder);
    for (const partId of rebuild) {
      const order = buildDrawOrder(layout, runtime, partId);
      writeDrawOrder(bundle.draw, partId, order);
      layout.partVisibleCounts.set(partId, order.length);
    }
    this.rebuildEdgeOrders(runtime, layout, rebuild, bundle);
    this.rebuildTransparentOrders(runtime, layout, rebuild, bundle);
    syncVisibleSelectionOrders(runtime, layout, this.interactionState, bundle, rebuild);
    layout.visibleCount = runtime.visibleCount;
    this.rebuildCalls();
  }

  private styleFlags(): InstanceStyleFlags {
    return {
      edgeFlags: this.edgeFlags,
      nodeFlags: this.nodeFlags,
      transparentFlags: this.transparentFlags,
    };
  }

  private rebuildTransparentOrders(
    runtime: PackedSceneRuntime,
    layout: InstanceLayout,
    parts: ReadonlySet<PartId>,
    bundle: GpuBundle,
  ): void {
    for (const partId of parts) {
      const order = buildTransparentOrder(layout, runtime, partId, this.transparentFlags);
      writeTransparentOrder(bundle.draw, partId, order);
      layout.partTransparentCounts.set(partId, order.length);
    }
  }

  private rebuildEdgeOrders(
    runtime: PackedSceneRuntime,
    layout: InstanceLayout,
    parts: ReadonlySet<PartId>,
    bundle: GpuBundle,
  ): void {
    for (const partId of parts) {
      const order = buildEdgeOrder(layout, runtime, partId, this.edgeFlags);
      writeEdgeOrder(bundle.draw, partId, order);
      layout.partEdgeCounts.set(partId, order.length);
    }
  }

  private rebuildCalls(): void {
    const layout = this.layout;
    if (layout === undefined) {
      this.calls = [];
      this.transparentCalls = [];
      this.edgeCalls = [];
      this.nodeCalls = [];
      this.selectionCalls = [];
      return;
    }
    const calls = buildDrawCalls(layout);
    this.calls = calls.calls;
    this.transparentCalls = calls.transparentCalls;
    this.edgeCalls = calls.edgeCalls;
    this.nodeCalls = calls.nodeCalls;
    this.selectionCalls = calls.selectionCalls;
    this.selectedNodeCalls = calls.selectedNodeCalls;
  }
}

function refreshTransparencyFlags(
  runtime: PackedSceneRuntime,
  layout: InstanceLayout,
  interaction: InteractionState,
  parts: ReadonlyMap<PartId, Part>,
  currentFlags: boolean[],
): ReadonlySet<PartId> {
  const next = new Array<boolean>(runtime.instanceCount).fill(false);
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const partId = runtime.instancePartIds[slot];
    if (partId === undefined) continue;
    const style = resolveInstanceStyle(
      instanceAt(runtime, slot, partId),
      defaultStyle,
      interaction,
    );
    next[slot] = isTransparent(style.color.a * style.opacity);
  }
  const updates = collectEmphasisUpdates(
    runtime,
    layout,
    new Map(
      Array.from({ length: runtime.instanceCount }, (_, slot) => [
        runtime.getInstanceId(slot) ?? String(slot),
        slot,
      ]),
    ),
    parts,
    interaction,
  );
  for (const [partId, emphasis] of updates) {
    const slots = layout.partSlots.get(partId);
    if (slots === undefined) continue;
    for (const update of emphasis) {
      const slot = slots[update.slot];
      if (slot !== undefined && isTransparent(update.style.color.a * update.style.opacity)) {
        next[slot] = true;
      }
    }
  }
  const changed = new Set<PartId>();
  for (let slot = 0; slot < next.length; slot += 1) {
    if (next[slot] !== currentFlags[slot]) {
      const partId = runtime.instancePartIds[slot];
      if (partId !== undefined) changed.add(partId);
    }
    currentFlags[slot] = next[slot] ?? false;
  }
  return changed;
}

function isTransparent(alpha: number): boolean {
  return alpha < 1;
}

function instanceTransformsChanged(
  draw: DrawResources,
  partId: PartId,
  updates: readonly InstanceUpdate[],
): boolean {
  const storage = draw.storages.get(partId);
  if (storage === undefined) return updates.length > 0;
  const current = new Uint8Array(storage.data);
  for (const update of updates) {
    const offset = update.slot * INSTANCE_STRIDE;
    const next = new Uint8Array(update.data, 0, 64);
    const previous = current.subarray(offset, offset + 64);
    if (next.some((value, index) => value !== previous[index])) return true;
  }
  return false;
}
