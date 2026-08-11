import type { Part } from "../geometry/part";
import { createInteractionState, type InteractionState } from "../interaction/interaction";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { PartId } from "../geometry/part";
import type { Instance, InstanceId } from "../scene/types";
import { syncElementHighlights } from "./gpu-elements";
import {
  createDrawResources,
  destroyDrawResources,
  patchInstances,
  writeDrawOrder,
  writeEdgeOrder,
  INSTANCE_STRIDE,
  type DrawCall,
  type DrawResources,
  type InstanceUpdate,
} from "./gpu-draw";
import type { GpuBundle } from "./gpu-recovery";
import { collectInstanceUpdates } from "./instance-updates";
import {
  buildDrawOrder,
  buildEdgeOrder,
  buildInstanceLayout,
  buildInstanceSnapshot,
  type InstanceLayout,
} from "./runtime-state";

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
  public edgeCalls: readonly DrawCall[] = [];
  public instances: Instance[] = [];
  public slotByInstanceId = new Map<InstanceId, number>();
  private edgeFlags: boolean[] = [];

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
    const attached = this.attach(runtime, bundle);
    const layout = this.layout;
    if (layout === undefined) return attached;
    const { updates, edgeChanged } = collectInstanceUpdates(
      runtime,
      layout,
      interaction,
      this.edgeFlags,
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
    const visibilityChanged = runtime.visibleCount !== layout.visibleCount;
    if (visibilityChanged) {
      this.rebuildVisibleOrders(runtime, layout, changedInstanceIds, bundle);
    } else if (edgeChanged.size > 0) {
      this.rebuildCalls();
    }
    return attached || transformChanged || visibilityChanged;
  }

  /** Writes the per-part element-highlight buffers as diffed records. */
  public updateElements(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    bundle: GpuBundle,
    parts: ReadonlyMap<PartId, Part>,
  ): boolean {
    const attached = this.attach(runtime, bundle);
    const layout = this.layout;
    if (layout === undefined) return attached;
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
    return attached;
  }

  /** Rebuilds GPU draw order after runtime visibility changed. */
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

  /** Clears the attachment so the next frame re-uploads everything. */
  public clear(): void {
    this.runtime = this.layout = undefined;
    this.calls = this.edgeCalls = [];
  }

  private fullAttach(runtime: PackedSceneRuntime, layout: InstanceLayout, bundle: GpuBundle): void {
    destroyDrawResources(bundle.draw);
    bundle.draw = createDrawResources(bundle.device);
    const snapshot = buildInstanceSnapshot(runtime);
    this.instances = snapshot.instances;
    this.slotByInstanceId = snapshot.slotByInstanceId;
    this.edgeFlags = new Array<boolean>(runtime.instanceCount).fill(false);
    const allSlots = Array.from({ length: runtime.instanceCount }, (_, slot) => slot);
    const { updates } = collectInstanceUpdates(
      runtime,
      layout,
      createInteractionState(),
      this.edgeFlags,
      allSlots,
    );
    for (const [partId, partUpdates] of updates) {
      patchInstances(bundle.draw, partId, partUpdates);
    }
    for (const partId of layout.partOrder) {
      writeDrawOrder(bundle.draw, partId, buildDrawOrder(layout, runtime, partId));
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
    layout.visibleCount = runtime.visibleCount;
    this.rebuildCalls();
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
      this.edgeCalls = [];
      return;
    }
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
    this.calls = calls;
    this.edgeCalls = edgeCalls;
  }
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
