import { createInteractionState, type InteractionState } from "../interaction/interaction";
import type { SceneRuntime } from "../scene-runtime/runtime";
import type { Instance, InstanceId, PartId } from "../scene/types";
import { syncElementHighlights } from "./gpu-elements";
import {
  createDrawResources,
  destroyDrawResources,
  patchInstances,
  writeDrawOrder,
  writeEdgeOrder,
  type DrawCall,
} from "./gpu-draw";
import type { GpuBundle } from "./gpu-recovery";
import { collectInstanceUpdates } from "./instance-updates";
import {
  buildDrawOrder,
  buildEdgeOrder,
  buildInstanceLayout,
  buildInstanceSnapshot,
  computeRuntimeGrowth,
  instanceAt,
  type InstanceLayout,
  type RuntimeGrowth,
} from "./runtime-state";

/**
 * The renderer's CPU-side attachment to a packed scene runtime: the instance
 * layout, compacted draw/edge calls, pick snapshot, and edge-flag mirror, kept
 * in sync with per-part GPU storage.
 *
 * `attach` is incremental when the runtime merely grew (a chunked model
 * appended parts/instances): only the new part geometry and instance records
 * are uploaded and only the affected draw/edge orders are rewritten, so
 * already-loaded geometry is never re-uploaded. Any other runtime change falls
 * back to a full rebuild.
 */
export class RendererAttachment {
  public runtime: SceneRuntime | undefined;
  public layout: InstanceLayout | undefined;
  public calls: readonly DrawCall[] = [];
  public edgeCalls: readonly DrawCall[] = [];
  public instances: Instance[] = [];
  public slotByInstanceId = new Map<InstanceId, number>();
  private edgeFlags: boolean[] = [];

  /**
   * Ensures the attachment matches `runtime`, growing in place when the runtime
   * is a compatible superset of the previously attached one.
   */
  public attach(runtime: SceneRuntime, bundle: GpuBundle): void {
    if (
      this.runtime === runtime &&
      this.layout !== undefined &&
      this.layout.instanceCount === runtime.instanceCount
    ) {
      return;
    }
    const layout = buildInstanceLayout(runtime);
    if (this.runtime !== undefined && this.layout !== undefined) {
      const growth = computeRuntimeGrowth(this.runtime, runtime, this.layout, layout);
      if (growth !== undefined) {
        this.growAttach(runtime, layout, growth, bundle);
        return;
      }
    }
    this.fullAttach(runtime, layout, bundle);
  }

  /** Writes only the GPU subranges affected by the changed instance slots. */
  public updateInstances(
    runtime: SceneRuntime,
    interaction: InteractionState,
    changedInstanceIds: readonly number[],
    bundle: GpuBundle,
  ): void {
    this.attach(runtime, bundle);
    const layout = this.layout;
    if (layout === undefined) return;
    const { updates, edgeChanged } = collectInstanceUpdates(
      runtime,
      layout,
      interaction,
      this.edgeFlags,
      changedInstanceIds,
    );
    for (const [partId, partUpdates] of updates) {
      patchInstances(bundle.draw, partId, partUpdates);
    }
    if (edgeChanged.size > 0) {
      this.rebuildEdgeOrders(runtime, layout, edgeChanged, bundle);
    }
    if (runtime.visibleCount !== layout.visibleCount) {
      this.rebuildVisibleOrders(runtime, layout, changedInstanceIds, bundle);
    } else if (edgeChanged.size > 0) {
      this.rebuildCalls();
    }
  }

  /** Writes the per-part element-highlight buffers as diffed records. */
  public updateElements(
    runtime: SceneRuntime,
    interaction: InteractionState,
    bundle: GpuBundle,
  ): void {
    this.attach(runtime, bundle);
    const layout = this.layout;
    if (layout === undefined) return;
    syncElementHighlights(
      {
        device: bundle.device,
        draw: bundle.draw,
        runtime,
        layout,
        slotByInstanceId: this.slotByInstanceId,
      },
      interaction,
    );
  }

  /** Rebuilds GPU draw order after runtime visibility changed. */
  public updateVisibility(
    runtime: SceneRuntime,
    changedInstanceIds: readonly number[],
    bundle: GpuBundle,
  ): void {
    this.attach(runtime, bundle);
    const layout = this.layout;
    if (layout === undefined) return;
    this.rebuildVisibleOrders(runtime, layout, changedInstanceIds, bundle);
  }

  /** Clears the attachment so the next frame re-uploads everything. */
  public clear(): void {
    this.runtime = this.layout = undefined;
    this.calls = this.edgeCalls = [];
  }

  private fullAttach(runtime: SceneRuntime, layout: InstanceLayout, bundle: GpuBundle): void {
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

  /**
   * Extends an existing attachment with only the delta of a grown runtime:
   * encodes and patches the appended instance records, appends their pick
   * snapshot entries, and rebuilds the draw/edge orders of the parts that
   * gained instances or changed visibility. Already-uploaded geometry and
   * instance buffers are left untouched.
   */
  private growAttach(
    runtime: SceneRuntime,
    layout: InstanceLayout,
    growth: RuntimeGrowth,
    bundle: GpuBundle,
  ): void {
    const previousCount = this.layout?.instanceCount ?? 0;
    if (this.edgeFlags.length < runtime.instanceCount) {
      const flags = new Array<boolean>(runtime.instanceCount).fill(false);
      for (let slot = 0; slot < previousCount; slot++) {
        flags[slot] = this.edgeFlags[slot] ?? false;
      }
      this.edgeFlags = flags;
    }
    const { updates } = collectInstanceUpdates(
      runtime,
      layout,
      createInteractionState(),
      this.edgeFlags,
      growth.newSlots,
    );
    for (const [partId, partUpdates] of updates) {
      patchInstances(bundle.draw, partId, partUpdates);
    }
    for (let slot = previousCount; slot < runtime.instanceCount; slot++) {
      const instanceId = runtime.getInstanceId(slot);
      const partId = runtime.instancePartIds[slot];
      if (instanceId === undefined || partId === undefined) continue;
      this.slotByInstanceId.set(instanceId, slot);
      this.instances.push(instanceAt(runtime, slot, partId));
    }
    for (const partId of growth.changedParts) {
      const order = buildDrawOrder(layout, runtime, partId);
      writeDrawOrder(bundle.draw, partId, order);
      layout.partVisibleCounts.set(partId, order.length);
    }
    this.rebuildEdgeOrders(runtime, layout, growth.changedParts, bundle);
    this.runtime = runtime;
    this.layout = layout;
    this.rebuildCalls();
  }

  private rebuildVisibleOrders(
    runtime: SceneRuntime,
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
    runtime: SceneRuntime,
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
