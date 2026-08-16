import type { Part } from "../geometry/part";
import { createInteractionState, type InteractionState } from "../interaction/interaction";
import { readInteractionState } from "../interaction/state";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { PartId } from "../geometry/part";
import type { Instance, InstanceId } from "../scene/types";
import {
  destroyInstanceResources,
  patchInstances,
  writeDrawOrder,
  type DrawCall,
} from "./resources/draw-resources";
import type { GpuBundle } from "./recovery";
import type { GpuCostAccumulator } from "./diagnostics/cost";
import {
  collectInstanceUpdates,
  instanceRecordsChanged,
  type InstanceStyleFlags,
} from "./instance-updates";
import {
  buildDrawOrder,
  buildInstanceLayout,
  buildInstanceSnapshot,
  type InstanceLayout,
} from "./runtime-state";
import {
  interactionAffectedSlots,
  interactionDirtyParts,
  partsForSlots,
  syncInteractionEmphasis,
  type InteractionElementSyncOptions,
} from "./interaction-sync";
import {
  syncSelectionState,
  syncVisibleSelectionOrders,
  writeNodeOrders,
  type SelectionState,
} from "./selection-state";
import { rebuildEdgeOrders, rebuildTransparentOrders } from "./attachment-orders";
import { changedPartDefinitions, reconcilePartResources } from "./resources/part-resources";
import { getPartSemanticIndex } from "../geometry/part-semantic-index";
import { syncEdgeEmphasisFlags } from "./edges/emphasis-sync";
import { rebuildAttachmentCalls } from "./attachment-calls";

type HiddenInteractionIds = ReadonlyMap<string, ReadonlySet<number>> | undefined;
type HiddenInteractionTuple = readonly [
  HiddenInteractionIds,
  HiddenInteractionIds,
  HiddenInteractionIds,
];

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
  private edgeEmphasisFlags: boolean[] = [];
  private nodeFlags: boolean[] = [];
  private transparentFlags: boolean[] = [];
  private readonly selection: SelectionState = { selectedNodeFlags: [], nodeFlags: this.nodeFlags };
  private interactionState = createInteractionState();
  private interactionBeforeLastInstanceUpdate: InteractionState | undefined;
  private appliedHiddenIds: HiddenInteractionTuple = [undefined, undefined, undefined];
  private attachedParts: ReadonlyMap<PartId, Part> = new Map();

  /** Retains geometry for unchanged part definitions and drops replaced ones. */
  public prepareParts(parts: ReadonlyMap<PartId, Part>, bundle: GpuBundle): void {
    const changedPartIds = changedPartDefinitions(this.attachedParts, parts);
    changedPartIds?.forEach((partId) => this.layout?.partSelectionDrawCalls.delete(partId));
    this.attachedParts = reconcilePartResources(this.attachedParts, parts, bundle.draw);
    // Region queries reuse this immutable index; prepare it outside their timed readback path.
    for (const part of parts.values()) getPartSemanticIndex(part);
  }

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
    this.interactionBeforeLastInstanceUpdate = this.interactionState;
    this.interactionState = interaction;
    bundle.draw.cost.cpu("instance-scan", changedInstanceIds.length);
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
      transformChanged ||= instanceRecordsChanged(bundle.draw, partId, partUpdates);
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
      this.rebuildCalls(bundle.draw.cost);
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
    this.rebuildCalls(bundle.draw.cost);
  }

  public updateElements(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    bundle: GpuBundle,
    parts: ReadonlyMap<PartId, Part>,
    changedInstanceIds?: readonly number[],
  ): boolean {
    const previousInteraction = this.interactionBeforeLastInstanceUpdate ?? this.interactionState;
    const attached = this.attach(runtime, bundle);
    const layout = this.layout;
    if (layout === undefined) return attached;
    const fullSync = attached || changedInstanceIds === undefined;
    const changedSlots =
      changedInstanceIds === undefined || attached
        ? Array.from({ length: runtime.instanceCount }, (_, slot) => slot)
        : changedInstanceIds;
    return this.syncInteractionElements({
      runtime,
      layout,
      interaction,
      previousInteraction,
      parts,
      bundle,
      attached,
      fullSync,
      changedSlots,
    });
  }

  private syncInteractionElements(options: InteractionElementSyncOptions): boolean {
    const {
      runtime,
      layout,
      interaction,
      previousInteraction,
      parts,
      bundle,
      attached,
      fullSync,
      changedSlots,
    } = options;
    const interactionSlots = interactionAffectedSlots(
      runtime,
      previousInteraction,
      interaction,
      changedSlots,
      fullSync,
    );
    bundle.draw.cost.cpu("instance-scan", interactionSlots.length);
    const affectedParts = partsForSlots(runtime, layout, interactionSlots, fullSync);
    const interactionData = readInteractionState(interaction);
    const dirtyParts = interactionDirtyParts(
      runtime,
      layout,
      previousInteraction,
      interaction,
      fullSync,
    );
    const hiddenBodyIds = interactionData.hiddenBodyIds;
    const hiddenBlockIds = interactionData.hiddenBlockIds;
    const hiddenElementIds = interactionData.hiddenElementIds;
    const [previousBodyIds, previousBlockIds, previousElementIds] = this.appliedHiddenIds;
    const bodyVisibilityChanged = previousBodyIds !== hiddenBodyIds;
    const blockVisibilityChanged = previousBlockIds !== hiddenBlockIds;
    const elementVisibilityChanged = previousElementIds !== hiddenElementIds;
    this.appliedHiddenIds = [hiddenBodyIds, hiddenBlockIds, hiddenElementIds];
    const { transparentChanged, selectionChanged, edgeChanged } = this.syncInteractionBuffers({
      runtime,
      layout,
      interaction,
      parts,
      bundle,
      changedSlots: interactionSlots,
      affectedParts,
      selectionParts: dirtyParts.selectionParts,
      nodeParts: dirtyParts.nodeParts,
      fullSync,
    });
    if (transparentChanged.size > 0) {
      this.rebuildTransparentOrders(runtime, layout, transparentChanged, bundle);
    }
    if (transparentChanged.size > 0 || selectionChanged || edgeChanged.size > 0) {
      this.rebuildCalls(bundle.draw.cost);
    }
    this.interactionState = interaction;
    this.interactionBeforeLastInstanceUpdate = undefined;
    return attached || bodyVisibilityChanged || blockVisibilityChanged || elementVisibilityChanged;
  }

  private syncInteractionBuffers(options: {
    readonly runtime: PackedSceneRuntime;
    readonly layout: InstanceLayout;
    readonly interaction: InteractionState;
    readonly parts: ReadonlyMap<PartId, Part>;
    readonly bundle: GpuBundle;
    readonly changedSlots: readonly number[];
    readonly affectedParts: ReadonlySet<PartId>;
    readonly selectionParts: ReadonlySet<PartId>;
    readonly nodeParts: ReadonlySet<PartId>;
    readonly fullSync: boolean;
  }): {
    transparentChanged: ReadonlySet<PartId>;
    selectionChanged: boolean;
    edgeChanged: ReadonlySet<PartId>;
  } {
    const transparentChanged = syncInteractionEmphasis({
      runtime: options.runtime,
      layout: options.layout,
      interaction: options.interaction,
      parts: options.parts,
      bundle: options.bundle,
      currentFlags: this.transparentFlags,
      slotByInstanceId: this.slotByInstanceId,
      changedSlots: options.changedSlots,
      affectedParts: options.affectedParts,
    });
    const selectionChanged = syncSelectionState({
      runtime: options.runtime,
      layout: options.layout,
      interaction: options.interaction,
      parts: options.parts,
      selection: this.selection,
      bundle: options.bundle,
      selectionParts: options.selectionParts,
      nodeParts: options.nodeParts,
      changedInstanceIds: options.fullSync ? undefined : options.changedSlots,
    });
    const edgeChanged = syncEdgeEmphasisFlags(
      options.layout,
      options.bundle,
      options.affectedParts,
      this.edgeEmphasisFlags,
    );
    if (edgeChanged.size > 0) {
      this.rebuildEdgeOrders(options.runtime, options.layout, edgeChanged, options.bundle);
    }
    return { transparentChanged, selectionChanged, edgeChanged };
  }

  public updateVisibility(
    runtime: PackedSceneRuntime,
    changedInstanceIds: readonly number[],
    bundle: GpuBundle,
  ): boolean {
    const attached = this.attach(runtime, bundle);
    const layout = this.layout;
    if (layout === undefined) return attached;
    bundle.draw.cost.cpu("instance-scan", changedInstanceIds.length);
    this.rebuildVisibleOrders(runtime, layout, changedInstanceIds, bundle);
    return attached || changedInstanceIds.length > 0;
  }

  public clear(): void {
    this.runtime = this.layout = undefined;
    this.calls = this.transparentCalls = this.edgeCalls = this.nodeCalls = [];
    this.selectionCalls = this.selectedNodeCalls = [];
    this.edgeFlags = [];
    this.edgeEmphasisFlags = [];
    this.nodeFlags.length = 0;
    this.transparentFlags = [];
    this.selection.selectedNodeFlags.length = 0;
    this.interactionState = createInteractionState();
    this.interactionBeforeLastInstanceUpdate = undefined;
  }

  private fullAttach(runtime: PackedSceneRuntime, layout: InstanceLayout, bundle: GpuBundle): void {
    destroyInstanceResources(bundle.draw);
    const snapshot = buildInstanceSnapshot(runtime);
    this.instances = snapshot.instances;
    this.slotByInstanceId = snapshot.slotByInstanceId;
    this.edgeFlags = new Array<boolean>(runtime.instanceCount).fill(false);
    this.edgeEmphasisFlags = new Array<boolean>(runtime.instanceCount).fill(false);
    this.nodeFlags.length = runtime.instanceCount;
    this.nodeFlags.fill(false);
    this.transparentFlags = new Array<boolean>(runtime.instanceCount).fill(false);
    this.selection.selectedNodeFlags.length = runtime.instanceCount;
    this.selection.selectedNodeFlags.fill(false);
    this.appliedHiddenIds = [undefined, undefined, undefined];
    const allSlots = Array.from({ length: runtime.instanceCount }, (_, slot) => slot);
    bundle.draw.cost.cpu("instance-scan", allSlots.length);
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
    }
    rebuildTransparentOrders(
      runtime,
      layout,
      new Set(layout.partOrder),
      this.transparentFlags,
      bundle.draw,
    );
    this.runtime = runtime;
    this.layout = layout;
    this.rebuildCalls(bundle.draw.cost);
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
      bundle.draw.cost.cpu("order-rebuild", 1);
      const order = buildDrawOrder(layout, runtime, partId);
      writeDrawOrder(bundle.draw, partId, order);
      layout.partVisibleCounts.set(partId, order.length);
    }
    this.rebuildEdgeOrders(runtime, layout, rebuild, bundle);
    this.rebuildTransparentOrders(runtime, layout, rebuild, bundle);
    const selection = { parts: rebuild, partDefinitions: this.attachedParts };
    syncVisibleSelectionOrders(runtime, layout, this.interactionState, bundle, selection);
    layout.visibleCount = runtime.visibleCount;
    this.rebuildCalls(bundle.draw.cost);
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
    rebuildTransparentOrders(runtime, layout, parts, this.transparentFlags, bundle.draw);
  }

  private rebuildEdgeOrders(
    runtime: PackedSceneRuntime,
    layout: InstanceLayout,
    parts: ReadonlySet<PartId>,
    bundle: GpuBundle,
  ): void {
    rebuildEdgeOrders({
      runtime,
      layout,
      parts,
      flags: this.edgeFlags,
      emphasisFlags: this.edgeEmphasisFlags,
      draw: bundle.draw,
    });
  }

  private rebuildCalls(cost: GpuCostAccumulator): void {
    Object.assign(this, rebuildAttachmentCalls(this.layout, cost));
  }
}
