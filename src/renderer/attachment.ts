import type { Part, PartId } from "../geometry/part";
import { createInteractionState, type InteractionState } from "../interaction/interaction";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { PartOccurrence, PartOccurrenceId } from "../scene/types";
import { patchInstances } from "./resources/draw-resources";
import type { GpuBundle } from "./recovery";
import type { GpuCostAccumulator } from "./diagnostics/cost";
import { collectInstanceUpdates, instanceRecordsChanged } from "./instance-updates";
import {
  buildInstanceLayout,
  emptyDrawCallLists,
  type PreviousInstanceLayout,
  type InstanceLayout,
} from "./runtime-state";
import {
  applyFullAttachment,
  applyIncrementalAttachment,
  rebuildAttachmentOrders,
  type AttachmentState,
  type AttachmentFlagState,
  type AttachmentOrderParts,
} from "./attachment/reconciliation";
import { type SelectionState } from "./selection-state";
import {
  changedInstanceParts,
  rebuildChangedStyleOrders,
  rebuildOverlayOrders,
} from "./attachment/overlay";
import { rebuildAttachmentCalls } from "./attachment/calls";
import {
  AttachmentPublicationState,
  internalAttachmentPublicationToken,
} from "./attachment/call-publication";
import { destroyVisibilitySkinCaches } from "./visibility/skins";
import { syncOccurrenceInteractionEmphasis } from "./attachment/interaction";
import type { AttachmentInteractionState } from "./attachment/interaction";
import { updateAttachmentElements } from "./attachment/elements";
import type { RuntimeOccurrenceDelta } from "../scene-runtime/occurrence-update";
import { applyOccurrenceAttachment } from "./attachment/occurrences";
import {
  addAttachmentParts,
  prepareAddedAttachmentParts,
  prepareAttachmentParts,
  removeAttachmentParts,
  replaceAttachedPartDefinitions,
} from "./attachment/part-definitions";
import type { PartRevisionResultState } from "./attachment/part-revision-results";

/**
 * The renderer's CPU-side attachment to a packed scene runtime: the instance
 * layout, compacted draw/edge calls, pick snapshot, and edge-flag mirror, kept
 * in sync with per-part GPU storage.
 *
 * `attach` preserves per-part placement storage across runtime revisions by
 * stable occurrence identity. Transform, visibility, interaction, deformation,
 * and highlight changes remain incremental subrange updates.
 */
export class RendererAttachment extends AttachmentPublicationState {
  public runtime: PackedSceneRuntime | undefined;
  public layout: InstanceLayout | undefined;
  public instances: Array<PartOccurrence | undefined> = [];
  public slotByInstanceId = new Map<PartOccurrenceId, number>();
  private edgeFlags: boolean[] = [];
  private edgeEmphasisFlags: boolean[] = [];
  private nodeFlags: boolean[] = [];
  private transparentFlags: boolean[] = [];
  public edgesVisible = false;
  public nodesVisible = false;
  readonly selection: SelectionState = { selectedNodeFlags: [], nodeFlags: this.nodeFlags };
  attachedParts = new Map<PartId, Part>();

  /** Retains geometry for unchanged part definitions and drops replaced ones. */
  public prepareParts(parts: ReadonlyMap<PartId, Part>, bundle: GpuBundle): void {
    const result = prepareAttachmentParts(this.partAttachmentOptions(bundle), parts);
    this.attachedParts = result.parts;
    if (result.calls !== undefined)
      this.commitCalls(result.calls, internalAttachmentPublicationToken);
  }

  /** Validates renderer-owned metadata for exact added definitions before commit. */
  public prepareAddedParts(parts: ReadonlyMap<PartId, Part>, partIds: ReadonlySet<PartId>): void {
    prepareAddedAttachmentParts(parts, partIds);
  }

  /** Admits exact added definitions without broad resource reconciliation. */
  public addParts(
    parts: ReadonlyMap<PartId, Part>,
    partIds: ReadonlySet<PartId>,
    sourceParts?: Map<PartId, Part>,
  ): void {
    addAttachmentParts(this.attachedParts, parts, partIds);
    if (sourceParts !== undefined) addAttachmentParts(sourceParts, parts, partIds);
  }

  /** Replaces only changed immutable part resources while retaining occurrence storage. */
  public replaceParts(
    parts: ReadonlyMap<PartId, Part>,
    partIds: ReadonlySet<PartId>,
    interaction: InteractionState,
    bundle: GpuBundle,
    results?: PartRevisionResultState,
  ): void {
    replaceAttachedPartDefinitions(this, parts, partIds, { interaction, bundle, results });
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
    this.commitInteractionState(
      interaction,
      this.interactionState,
      internalAttachmentPublicationToken,
    );
    bundle.draw.cost.cpu("instance-scan", changedInstanceIds.length);
    const attached = this.attach(runtime, bundle);
    const layout = this.layout;
    if (layout === undefined) return attached;
    const { updates, transparentChanged } = collectInstanceUpdates(
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
    const styleOrdersChanged = rebuildChangedStyleOrders({
      runtime,
      layout,
      transparentChanged,
      transparentFlags: this.transparentFlags,
      draw: bundle.draw,
    });
    const visibilityChanged = runtime.visibleCount !== layout.visibleCount;
    if (visibilityChanged) {
      this.applyAttachmentOrders(
        runtime,
        layout,
        changedInstanceParts(runtime, changedInstanceIds),
        bundle,
      );
    } else if (styleOrdersChanged) {
      this.rebuildCalls(bundle.draw.cost);
    }
    return attached || transformChanged || visibilityChanged || styleOrdersChanged;
  }

  /** Applies exact direct-placement membership changes to an attached runtime. */
  public updateOccurrences(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    delta: RuntimeOccurrenceDelta,
    sourceParts: Map<PartId, Part>,
    bundle: GpuBundle,
  ): boolean {
    const layout = this.layout;
    if (this.runtime !== runtime || layout === undefined) return false;
    this.commitInteractionState(
      interaction,
      this.interactionState,
      internalAttachmentPublicationToken,
    );
    const state = this.attachmentState();
    const optionalParts = applyOccurrenceAttachment({
      runtime,
      layout,
      delta,
      interaction,
      state,
      draw: bundle.draw,
      edgesVisible: this.edgesVisible,
    });
    this.commitRuntimeSnapshot(runtime, layout, state);
    syncOccurrenceInteractionEmphasis({
      runtime,
      layout,
      interaction,
      parts: this.attachedParts,
      bundle,
      transparentFlags: this.transparentFlags,
      slotByInstanceId: this.slotByInstanceId,
      changedSlots: delta.slots.map(({ slot }) => slot),
      affectedParts: delta.affectedPartIds,
    });
    const partOptions = this.partAttachmentOptions(bundle);
    removeAttachmentParts(partOptions, sourceParts, delta.removedPartIds, false);
    this.applyAttachmentOrders(runtime, layout, delta.affectedPartIds, bundle, optionalParts);
    return true;
  }

  public updateElements(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    bundle: GpuBundle,
    parts: ReadonlyMap<PartId, Part>,
    changedInstanceIds?: readonly number[],
  ): boolean {
    return updateAttachmentElements({
      attachment: this,
      runtime,
      interaction,
      bundle,
      parts,
      changedInstanceIds,
    });
  }

  public elementInteractionState(): AttachmentInteractionState {
    return {
      interaction: this.interactionState,
      beforeLastInstanceUpdate: this.interactionBeforeLastInstanceUpdate,
      appliedHiddenIds: this.appliedHiddenIds,
      usesExteriorFaceSubsets: this.usesExteriorFaceSubsets,
      transparentFlags: this.transparentFlags,
      edgeFlags: this.edgeFlags,
      edgeEmphasisFlags: this.edgeEmphasisFlags,
      edgesVisible: this.edgesVisible,
      nodesVisible: this.nodesVisible,
      slotByInstanceId: this.slotByInstanceId,
      selection: this.selection,
    };
  }

  public updateVisibility(
    runtime: PackedSceneRuntime,
    affectedPartIds: readonly PartId[],
    bundle: GpuBundle,
  ): boolean {
    const attached = this.attach(runtime, bundle);
    const layout = this.layout;
    if (layout === undefined) return attached;
    bundle.draw.cost.cpu("part-scan", affectedPartIds.length);
    this.applyAttachmentOrders(runtime, layout, new Set(affectedPartIds), bundle);
    return attached || affectedPartIds.length > 0;
  }

  public setOverlayVisibility(
    edgesVisible: boolean,
    nodesVisible: boolean,
    bundle: GpuBundle,
  ): boolean {
    if (this.edgesVisible === edgesVisible && this.nodesVisible === nodesVisible) return false;
    this.edgesVisible = edgesVisible;
    this.nodesVisible = nodesVisible;
    const layout = this.layout;
    const runtime = this.runtime;
    if (layout === undefined || runtime === undefined) return true;
    const parts = new Set(layout.partOrder);
    rebuildOverlayOrders({
      runtime,
      layout,
      parts,
      edgeFlags: this.edgeFlags,
      edgeEmphasisFlags: this.edgeEmphasisFlags,
      attachedParts: this.attachedParts,
      selection: this.selection,
      interaction: this.interactionState,
      bundle,
      force: true,
      edgesVisible,
      nodesVisible,
    });
    this.rebuildCalls(bundle.draw.cost);
    return true;
  }

  public clear(bundle?: GpuBundle): void {
    if (bundle !== undefined) destroyVisibilitySkinCaches(bundle.draw);
    this.runtime = this.layout = undefined;
    this.commitCalls(emptyDrawCallLists(), internalAttachmentPublicationToken);
    [this.edgeFlags, this.edgeEmphasisFlags] = [[], []];
    this.nodeFlags.length = 0;
    this.transparentFlags = [];
    this.selection.selectedNodeFlags.length = 0;
    this.commitInteractionState(
      createInteractionState(),
      undefined,
      internalAttachmentPublicationToken,
      [undefined, undefined],
      true,
    );
  }

  private fullAttach(runtime: PackedSceneRuntime, layout: InstanceLayout, bundle: GpuBundle): void {
    const state = this.attachmentState();
    const calls = applyFullAttachment({ runtime, layout, state, draw: bundle.draw });
    this.commitRuntimeSnapshot(runtime, layout, state);
    this.commitCalls(calls, internalAttachmentPublicationToken);
    this.resetAppliedHiddenIds(internalAttachmentPublicationToken);
    this.rewriteOverlayVisibility(runtime, layout, new Set(layout.partOrder), bundle);
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
    this.commitRuntimeSnapshot(runtime, layout, state);
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

  private commitRuntimeSnapshot(
    runtime: PackedSceneRuntime,
    layout: InstanceLayout,
    state: AttachmentState,
  ): void {
    this.instances = state.instances;
    this.slotByInstanceId = state.slotByInstanceId;
    this.runtime = runtime;
    this.layout = layout;
  }

  private applyAttachmentOrders(
    runtime: PackedSceneRuntime,
    layout: InstanceLayout,
    parts: ReadonlySet<PartId>,
    bundle: GpuBundle,
    optionalParts?: AttachmentOrderParts,
  ): void {
    this.commitCalls(
      rebuildAttachmentOrders({
        runtime,
        layout,
        parts,
        flags: this.styleFlags(),
        interaction: this.interactionState,
        partDefinitions: this.attachedParts,
        selection: this.selection,
        bundle,
        previousCalls: this,
        ...(optionalParts === undefined ? {} : { optionalParts }),
      }),
      internalAttachmentPublicationToken,
    );
    this.rewriteOverlayVisibility(runtime, layout, parts, bundle);
  }

  private rewriteOverlayVisibility(
    runtime: PackedSceneRuntime,
    layout: InstanceLayout,
    parts: ReadonlySet<PartId>,
    bundle: GpuBundle,
  ): void {
    const activeParts = new Set([...parts].filter((partId) => layout.partSlots.has(partId)));
    if (
      rebuildOverlayOrders({
        runtime,
        layout,
        parts: activeParts,
        edgeFlags: this.edgeFlags,
        edgeEmphasisFlags: this.edgeEmphasisFlags,
        attachedParts: this.attachedParts,
        selection: this.selection,
        interaction: this.interactionState,
        bundle,
        edgesVisible: this.edgesVisible,
        nodesVisible: this.nodesVisible,
      })
    )
      this.rebuildCalls(bundle.draw.cost);
  }

  styleFlags(): AttachmentFlagState {
    return {
      edgeFlags: this.edgeFlags,
      edgeEmphasisFlags: this.edgeEmphasisFlags,
      nodeFlags: this.nodeFlags,
      transparentFlags: this.transparentFlags,
      selectedNodeFlags: this.selection.selectedNodeFlags,
    };
  }

  private rebuildCalls(cost: GpuCostAccumulator): void {
    this.commitCalls(rebuildAttachmentCalls(this.layout, cost), internalAttachmentPublicationToken);
  }

  private partAttachmentOptions(bundle: GpuBundle) {
    return {
      attachedParts: this.attachedParts,
      runtime: this.runtime,
      layout: this.layout,
      interaction: this.interactionState,
      bundle,
    };
  }
}
