import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { GpuBundle } from "../recovery";
import type { InstanceLayout } from "../runtime-state";
import { syncAttachmentInteraction, type AttachmentInteractionState } from "./interaction";
import { reviseAttachmentCalls } from "./calls";
import { rebuildVisibilitySurface } from "../visibility/skins";
import { type DrawResources, uploadGeometryPart } from "../resources/draw-resources";
import type { PartRevisionResultState } from "./part-revision-results";
import type { AttachmentCallLists } from "./calls";
import type { AttachmentPublicationToken } from "./call-publication";
import type { HiddenInteractionTuple } from "./interaction";
import type { AttachmentFlagState } from "./reconciliation";
import type { SelectionState } from "../selection-state";
import { PartRevisionMap } from "./part-revision-overlay";
import { prepareDrawRevision, type PreparedDrawRevision } from "./prepared-draw-revision";

export interface PartRevisionAttachmentHost extends AttachmentCallLists {
  commitCalls(calls: AttachmentCallLists, token: AttachmentPublicationToken): void;
  commitInteractionState(
    interaction: InteractionState,
    beforeLastInstanceUpdate: InteractionState | undefined,
    token: AttachmentPublicationToken,
    appliedHiddenIds?: HiddenInteractionTuple,
    usesExteriorFaceSubsets?: boolean,
  ): void;
  interactionState: InteractionState;
  interactionBeforeLastInstanceUpdate: InteractionState | undefined;
  readonly attachedParts: Map<PartId, Part>;
  readonly runtime: PackedSceneRuntime | undefined;
  layout: InstanceLayout | undefined;
  readonly selection: SelectionState;
  readonly slotByInstanceId: ReadonlyMap<string, number>;
  readonly edgesVisible: boolean;
  readonly nodesVisible: boolean;
  appliedHiddenIds: HiddenInteractionTuple;
  usesExteriorFaceSubsets: boolean;
  styleFlags(): AttachmentFlagState;
}

/** Prepared resources and detached attachment state for a part-definition revision. */
export interface PreparedPartRevision {
  readonly drawRevision: PreparedDrawRevision;
  readonly layout: InstanceLayout;
  readonly parts: Map<PartId, Part>;
  readonly flags: AttachmentFlagState;
  readonly commitFlags: (target: AttachmentFlagState) => void;
  readonly interaction: InteractionState;
  readonly interactionState: AttachmentInteractionState;
  readonly calls: AttachmentCallLists;
}

type StagedPartRevision = Omit<PreparedPartRevision, "commitFlags">;

/** Stages every fallible resource operation before the live attachment changes. */
export function prepareStagedPartRevision(options: {
  readonly attachment: PartRevisionAttachmentHost;
  readonly parts: Map<PartId, Part>;
  readonly partIds: ReadonlySet<PartId>;
  readonly interaction: InteractionState;
  readonly bundle: GpuBundle;
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly flags: AttachmentFlagState;
  readonly results: PartRevisionResultState | undefined;
}): StagedPartRevision {
  const stageInteraction = options.interaction !== options.attachment.interactionState;
  const drawRevision = prepareDrawRevision({
    live: options.bundle.draw,
    affectedPartIds: options.partIds,
    replacedPartIds: options.partIds,
    stageInteraction,
    kind: "part",
  });
  try {
    return stagePartRevision({ ...options, drawRevision });
  } catch (error) {
    drawRevision.discard();
    throw error;
  }
}

/** Copies revision-local layout mirrors. */
export function clonePartRevisionLayout(layout: InstanceLayout): InstanceLayout {
  return {
    ...layout,
    partVisibleCounts: new PartRevisionMap(layout.partVisibleCounts),
    partEdgeCounts: new PartRevisionMap(layout.partEdgeCounts),
    partNodeCounts: new PartRevisionMap(layout.partNodeCounts),
    partTransparentCounts: new PartRevisionMap(layout.partTransparentCounts),
    partSelectionCounts: new PartRevisionMap(layout.partSelectionCounts),
    partSelectedNodeCounts: new PartRevisionMap(layout.partSelectedNodeCounts),
    partSelectionDrawCalls: new PartRevisionMap(layout.partSelectionDrawCalls),
    partSurfaceDrawCalls: new PartRevisionMap(layout.partSurfaceDrawCalls),
    partEdgeNeedsFullTopology: new PartRevisionMap(layout.partEdgeNeedsFullTopology),
  };
}

function stagePartRevision(options: {
  readonly attachment: PartRevisionAttachmentHost;
  readonly parts: Map<PartId, Part>;
  readonly partIds: ReadonlySet<PartId>;
  readonly interaction: InteractionState;
  readonly bundle: GpuBundle;
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly flags: AttachmentFlagState;
  readonly results: PartRevisionResultState | undefined;
  readonly drawRevision: PreparedDrawRevision;
}): StagedPartRevision {
  stagePartDefinitionResources(
    options.drawRevision.draw,
    options.parts,
    options.partIds,
    options.attachment.usesExteriorFaceSubsets,
  );
  options.drawRevision.stageResults(options.results, options.runtime, options.layout);
  return stagePartInteraction(options);
}

function stagePartInteraction(options: {
  readonly attachment: PartRevisionAttachmentHost;
  readonly parts: Map<PartId, Part>;
  readonly partIds: ReadonlySet<PartId>;
  readonly interaction: InteractionState;
  readonly bundle: GpuBundle;
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly flags: AttachmentFlagState;
  readonly results: PartRevisionResultState | undefined;
  readonly drawRevision: PreparedDrawRevision;
}): StagedPartRevision {
  const interactionState = stagedInteractionState(options.attachment, options.flags);
  if (options.interaction === options.attachment.interactionState) {
    return { ...options, interactionState, calls: attachmentCalls(options.attachment) };
  }
  const changedSlots: number[] = [];
  for (const partId of options.partIds) {
    changedSlots.push(...options.runtime.getPartInstanceSlots(partId));
  }
  const result = syncAttachmentInteraction({
    state: interactionState,
    runtime: options.runtime,
    layout: options.layout,
    interaction: options.interaction,
    parts: options.parts,
    bundle: {
      ...options.bundle,
      device: options.drawRevision.draw.device,
      draw: options.drawRevision.draw,
    },
    attached: false,
    fullSync: false,
    changedSlots,
    forceParts: options.partIds,
  });
  for (const partId of result.visibilityParts ?? []) {
    const part = options.parts.get(partId);
    if (part === undefined) continue;
    rebuildVisibilitySurface({
      runtime: options.runtime,
      layout: options.layout,
      part,
      interaction: options.interaction,
      draw: options.drawRevision.draw,
    });
  }
  return {
    ...options,
    interactionState,
    calls: reviseAttachmentCalls(
      options.layout,
      options.attachment,
      options.partIds,
      options.drawRevision.draw.cost,
    ),
  };
}

function stagedInteractionState(
  attachment: PartRevisionAttachmentHost,
  flags: AttachmentFlagState,
): AttachmentInteractionState {
  return {
    interaction: attachment.interactionState,
    beforeLastInstanceUpdate: attachment.interactionBeforeLastInstanceUpdate,
    appliedHiddenIds: attachment.appliedHiddenIds,
    usesExteriorFaceSubsets: attachment.usesExteriorFaceSubsets,
    transparentFlags: flags.transparentFlags,
    edgeFlags: flags.edgeFlags,
    edgeEmphasisFlags: flags.edgeEmphasisFlags,
    edgesVisible: attachment.edgesVisible,
    nodesVisible: attachment.nodesVisible,
    slotByInstanceId: attachment.slotByInstanceId,
    selection: { selectedNodeFlags: flags.selectedNodeFlags, nodeFlags: flags.nodeFlags },
  };
}

/** Clears stale definition bindings and uploads exact replacement geometry into a staged draw. */
export function stagePartDefinitionResources(
  draw: DrawResources,
  parts: ReadonlyMap<PartId, Part>,
  partIds: ReadonlySet<PartId>,
  preferSubset: boolean,
): void {
  for (const partId of partIds) {
    draw.parts.delete(partId);
    draw.primitiveParts.delete(partId);
    draw.nodeParts.delete(partId);
    draw.visibilitySkins.delete(partId);
    draw.admissionCache.delete(partId);
    draw.deformations.delete(partId);
    draw.resultColors.delete(partId);
    draw.orientationGlyphs.parts.delete(partId);
    const part = parts.get(partId);
    if (part === undefined) continue;
    for (const geometry of part.geometries) uploadGeometryPart(draw, part, geometry, preferSubset);
  }
}

function attachmentCalls(attachment: AttachmentCallLists): AttachmentCallLists {
  return {
    calls: attachment.calls,
    transparentCalls: attachment.transparentCalls,
    edgeCalls: attachment.edgeCalls,
    nodeCalls: attachment.nodeCalls,
    selectionCalls: attachment.selectionCalls,
    selectedNodeCalls: attachment.selectedNodeCalls,
  };
}
