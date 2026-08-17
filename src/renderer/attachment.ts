import type { Part } from "../geometry/part";
import { createInteractionState, type InteractionState } from "../interaction/interaction";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { PartId } from "../geometry/part";
import type { Instance, InstanceId } from "../scene/types";
import { patchInstances, type DrawCall } from "./resources/draw-resources";
import type { GpuBundle } from "./recovery";
import type { GpuCostAccumulator } from "./diagnostics/cost";
import { collectInstanceUpdates, instanceRecordsChanged } from "./instance-updates";
import {
  buildInstanceLayout,
  type PreviousInstanceLayout,
  type InstanceLayout,
} from "./runtime-state";
import {
  applyFullAttachment,
  applyIncrementalAttachment,
  rebuildAttachmentOrders,
  type AttachmentState,
  type AttachmentFlagState,
} from "./attachment/reconciliation";
import { writeNodeOrders, type SelectionState } from "./selection-state";
import {
  rebuildEdgeOrders as rebuildEdgeOrdersForParts,
  rebuildTransparentOrders as rebuildTransparentOrdersForParts,
} from "./attachment-orders";
import { changedPartDefinitions, reconcilePartResources } from "./resources/part-resources";
import { getPartSemanticIndex } from "../geometry/part-semantic-index";
import { rebuildAttachmentCalls } from "./attachment-calls";
import {
  syncAttachmentInteraction,
  type AttachmentInteractionState,
} from "./attachment/interaction";

type HiddenInteractionIds = ReadonlyMap<string, ReadonlySet<number>> | undefined;
type HiddenInteractionTuple = readonly [HiddenInteractionIds, HiddenInteractionIds];

/**
 * The renderer's CPU-side attachment to a packed scene runtime: the instance
 * layout, compacted draw/edge calls, pick snapshot, and edge-flag mirror, kept
 * in sync with per-part GPU storage.
 *
 * `attach` preserves per-part placement storage across runtime revisions by
 * stable occurrence identity. Transform, visibility, interaction, deformation,
 * and highlight changes remain incremental subrange updates.
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
  private appliedHiddenIds: HiddenInteractionTuple = [undefined, undefined];
  private attachedParts: ReadonlyMap<PartId, Part> = new Map();

  public usesExteriorFaceSubsets = true;

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
    const previous =
      this.runtime === undefined || this.layout === undefined
        ? undefined
        : ({ runtime: this.runtime, layout: this.layout } satisfies PreviousInstanceLayout);
    const layout = buildInstanceLayout(runtime, previous);
    if (previous === undefined) this.fullAttach(runtime, layout, bundle);
    else this.incrementalAttach(runtime, layout, previous, bundle);
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
    const { updates, edgeChanged, transparentChanged } = collectInstanceUpdates(
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
      rebuildEdgeOrdersForParts({
        runtime,
        layout,
        parts: edgeChanged,
        flags: this.edgeFlags,
        emphasisFlags: this.edgeEmphasisFlags,
        draw: bundle.draw,
      });
    }
    if (transparentChanged.size > 0) {
      rebuildTransparentOrdersForParts(
        runtime,
        layout,
        transparentChanged,
        this.transparentFlags,
        bundle.draw,
      );
    }
    const visibilityChanged = runtime.visibleCount !== layout.visibleCount;
    if (visibilityChanged) {
      this.rebuildVisibleOrders(runtime, layout, changedInstanceIds, bundle);
    } else if (edgeChanged.size > 0 || transparentChanged.size > 0) {
      this.rebuildCalls(bundle.draw.cost);
    }
    return (
      attached ||
      transformChanged ||
      visibilityChanged ||
      edgeChanged.size > 0 ||
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
    const attached = this.attach(runtime, bundle);
    const layout = this.layout;
    if (layout === undefined) return attached;
    const fullSync = attached || changedInstanceIds === undefined;
    const changedSlots =
      changedInstanceIds === undefined || attached
        ? Array.from({ length: runtime.instanceCount }, (_, slot) => slot)
        : changedInstanceIds;
    const state: AttachmentInteractionState = {
      interaction: this.interactionState,
      beforeLastInstanceUpdate: this.interactionBeforeLastInstanceUpdate,
      appliedHiddenIds: this.appliedHiddenIds,
      usesExteriorFaceSubsets: this.usesExteriorFaceSubsets,
      transparentFlags: this.transparentFlags,
      edgeFlags: this.edgeFlags,
      edgeEmphasisFlags: this.edgeEmphasisFlags,
      slotByInstanceId: this.slotByInstanceId,
      selection: this.selection,
    };
    const result = syncAttachmentInteraction({
      state,
      runtime,
      layout,
      interaction,
      parts,
      bundle,
      attached,
      fullSync,
      changedSlots,
    });
    this.interactionState = state.interaction;
    this.interactionBeforeLastInstanceUpdate = state.beforeLastInstanceUpdate;
    this.appliedHiddenIds = state.appliedHiddenIds;
    this.usesExteriorFaceSubsets = state.usesExteriorFaceSubsets;
    if (result.calls !== undefined) Object.assign(this, result.calls);
    return result.changed;
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
    const state = this.attachmentState();
    Object.assign(this, applyFullAttachment({ runtime, layout, state, draw: bundle.draw }));
    this.instances = state.instances;
    this.slotByInstanceId = state.slotByInstanceId;
    this.appliedHiddenIds = [undefined, undefined];
    this.runtime = runtime;
    this.layout = layout;
  }

  private incrementalAttach(
    runtime: PackedSceneRuntime,
    layout: InstanceLayout,
    previous: PreviousInstanceLayout,
    bundle: GpuBundle,
  ): void {
    const state: AttachmentState = this.attachmentState();
    const affectedParts = applyIncrementalAttachment({
      previous,
      runtime,
      layout,
      interaction: this.interactionState,
      state,
      draw: bundle.draw,
    });
    this.instances = state.instances;
    this.slotByInstanceId = state.slotByInstanceId;
    this.runtime = runtime;
    this.layout = layout;
    if (affectedParts.size > 0) {
      this.applyAttachmentOrders(runtime, layout, affectedParts, bundle);
    }
  }

  private attachmentState(): AttachmentState {
    return {
      flags: {
        edgeFlags: this.edgeFlags,
        edgeEmphasisFlags: this.edgeEmphasisFlags,
        nodeFlags: this.nodeFlags,
        transparentFlags: this.transparentFlags,
        selectedNodeFlags: this.selection.selectedNodeFlags,
      },
      instances: this.instances,
      slotByInstanceId: this.slotByInstanceId,
    };
  }

  private applyAttachmentOrders(
    runtime: PackedSceneRuntime,
    layout: InstanceLayout,
    parts: ReadonlySet<PartId>,
    bundle: GpuBundle,
  ): void {
    Object.assign(
      this,
      rebuildAttachmentOrders({
        runtime,
        layout,
        parts,
        flags: this.styleFlags(),
        interaction: this.interactionState,
        partDefinitions: this.attachedParts,
        selection: this.selection,
        bundle,
      }),
    );
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
    this.applyAttachmentOrders(runtime, layout, rebuild, bundle);
  }

  private styleFlags(): AttachmentFlagState {
    return {
      edgeFlags: this.edgeFlags,
      edgeEmphasisFlags: this.edgeEmphasisFlags,
      nodeFlags: this.nodeFlags,
      transparentFlags: this.transparentFlags,
      selectedNodeFlags: this.selection.selectedNodeFlags,
    };
  }

  private rebuildCalls(cost: GpuCostAccumulator): void {
    Object.assign(this, rebuildAttachmentCalls(this.layout, cost));
  }
}
