import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { RuntimeOccurrenceDelta } from "../../scene-runtime/occurrence-update";
import type { PartOccurrence, PartOccurrenceId } from "../../scene/types";
import type { GpuBundle } from "../recovery";
import type { InstanceLayout } from "../runtime-state";
import {
  rebuildAttachmentOrders,
  type AttachmentFlagState,
  type AttachmentState,
} from "./reconciliation";
import { applyOccurrenceAttachment, releasePartDefinitions } from "./occurrences";
import {
  rebuildInteractionVisibilitySurfaces,
  syncOccurrenceInteractionEmphasis,
} from "./interaction";
import {
  PartRevisionMap,
  stagePartRevisionArray,
  stagePartRevisionFlagSet,
  type PartRevisionFlagSet,
} from "./part-revision-overlay";
import { stageDrawResources, stagePartDefinitionResources } from "./part-revision-stage";
import { discardStagedOccurrenceResources } from "./occurrence-resources";
import {
  commitStagedPartDefinition,
  commitStagedStorage,
  commitStagedWrites,
} from "./part-definitions";
import { commitStagedPartResults } from "./part-revision-result-resources";
import type { PartRevisionResultState } from "./part-revision-results";
import { syncDeformations } from "../frame/deformation";
import { syncOrientationGlyphs } from "../orientation-glyphs/orientation-glyph";
import { syncResultColors } from "../resources/result-colors";
import type { DrawResources } from "../resources/draw-resources";
import type { StagedBufferWrite } from "./part-revision-writes";
import type { AttachmentCallLists } from "./calls";
import {
  internalAttachmentPublicationToken,
  type AttachmentPublicationToken,
} from "./call-publication";
import {
  commitOccurrenceLayout,
  stageOccurrenceLayout,
  stageSlotLocals,
  type StagedSlotLocals,
} from "./occurrence-layout";

interface OccurrenceAttachmentOwner extends AttachmentCallLists {
  commitCalls(calls: AttachmentCallLists, token: AttachmentPublicationToken): void;
  commitInteractionState(
    interaction: InteractionState,
    beforeLastInstanceUpdate: InteractionState | undefined,
    token: AttachmentPublicationToken,
  ): void;
  readonly runtime: PackedSceneRuntime | undefined;
  readonly layout: InstanceLayout | undefined;
  readonly instances: Array<PartOccurrence | undefined>;
  readonly slotByInstanceId: Map<PartOccurrenceId, number>;
  readonly attachedParts: Map<PartId, Part>;
  interactionState: InteractionState;
  interactionBeforeLastInstanceUpdate: InteractionState | undefined;
  readonly edgesVisible: boolean;
  readonly nodesVisible: boolean;
  readonly usesExteriorFaceSubsets: boolean;
  styleFlags(): AttachmentFlagState;
}

interface OccurrenceUpdateOptions {
  readonly attachment: OccurrenceAttachmentOwner;
  readonly runtime: PackedSceneRuntime;
  readonly interaction: InteractionState;
  readonly delta: RuntimeOccurrenceDelta;
  readonly sourceParts: Map<PartId, Part>;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly bundle: GpuBundle;
  readonly edgesVisible: boolean;
  readonly nodesVisible: boolean;
  readonly results?: PartRevisionResultState;
  readonly replacedPartIds?: ReadonlySet<PartId>;
}

/** Detached renderer placement state whose GPU allocations are complete. */
export interface PreparedAttachmentOccurrenceUpdate {
  readonly draw: DrawResources;
  readonly layout: InstanceLayout;
  readonly parts: PartRevisionMap<PartId, Part>;
  readonly sourceParts: PartRevisionMap<PartId, Part>;
  readonly interaction: InteractionState;
  readonly results: PartRevisionResultState | undefined;
  commit(): void;
  discard(): void;
}

/** Prepares exact placement, presentation, and result writes without mutating live owners. */
export function prepareAttachmentOccurrenceUpdate(
  options: OccurrenceUpdateOptions,
): PreparedAttachmentOccurrenceUpdate {
  const liveLayout = options.attachment.layout;
  if (options.attachment.runtime !== options.runtime || liveLayout === undefined)
    throw new Error("Occurrence revisions require the attached renderer runtime");
  const state = prepareOccurrenceState(options, liveLayout);
  let completed = false;
  try {
    const calls = stagePreparedOccurrence(options, state);
    return preparedUpdate({
      ...options,
      ...state,
      calls,
      liveSourceParts: options.sourceParts,
      complete: () => {
        completed = true;
      },
      completed: () => completed,
    });
  } catch (error) {
    discardStagedOccurrenceResources(
      state.draw,
      options.bundle.draw,
      options.delta.affectedPartIds,
    );
    throw error;
  }
}

function prepareOccurrenceState(options: OccurrenceUpdateOptions, liveLayout: InstanceLayout) {
  const partIds = options.delta.affectedPartIds;
  const flags = stagePartRevisionFlagSet(options.attachment.styleFlags());
  const instances = stagePartRevisionArray(options.attachment.instances);
  const slotByInstanceId = new PartRevisionMap(options.attachment.slotByInstanceId);
  const sourceParts = new PartRevisionMap(options.sourceParts);
  const attachedParts = new PartRevisionMap(options.attachment.attachedParts);
  const replacedPartIds = options.replacedPartIds ?? new Set<PartId>();
  stageParts(
    options.parts,
    new Set([...options.delta.addedPartIds, ...replacedPartIds]),
    sourceParts,
    attachedParts,
  );
  const slotLocals = stageSlotLocals(liveLayout.slotPartLocal);
  const layout = stageOccurrenceLayout(liveLayout, slotLocals.values, partIds);
  const staged = stageDrawResources(options.bundle.draw, partIds, true, false);
  return {
    flags,
    instances,
    slotByInstanceId,
    sourceParts,
    attachedParts,
    slotLocals,
    layout,
    draw: staged.draw,
    writes: staged.writes,
    replacedPartIds,
  };
}

function stagePreparedOccurrence(
  options: OccurrenceUpdateOptions,
  state: ReturnType<typeof prepareOccurrenceState>,
): AttachmentCallLists {
  stagePartDefinitionResources(
    state.draw,
    state.attachedParts,
    state.replacedPartIds,
    options.attachment.usesExteriorFaceSubsets,
  );
  const calls = stageOccurrenceChanges({ ...options, ...state });
  stageResults(
    state.draw,
    options.results,
    options.runtime,
    state.layout,
    options.delta.affectedPartIds,
  );
  if (state.replacedPartIds.size === 0) return calls;
  return rebuildInteractionVisibilitySurfaces({
    runtime: options.runtime,
    layout: state.layout,
    parts: state.replacedPartIds,
    attachedParts: state.attachedParts,
    interaction: options.interaction,
    bundle: { ...options.bundle, device: state.draw.device, draw: state.draw },
  });
}

function stageOccurrenceChanges(options: {
  readonly attachment: OccurrenceAttachmentOwner;
  readonly runtime: PackedSceneRuntime;
  readonly interaction: InteractionState;
  readonly delta: RuntimeOccurrenceDelta;
  readonly bundle: GpuBundle;
  readonly layout: InstanceLayout;
  readonly flags: PartRevisionFlagSet;
  readonly instances: ReturnType<typeof stagePartRevisionArray<PartOccurrence | undefined>>;
  readonly slotByInstanceId: PartRevisionMap<string, number>;
  readonly attachedParts: ReadonlyMap<PartId, Part>;
  readonly draw: DrawResources;
  readonly edgesVisible: boolean;
  readonly nodesVisible: boolean;
}) {
  const state: AttachmentState = {
    flags: options.flags.values,
    instances: options.instances.values,
    slotByInstanceId: options.slotByInstanceId,
  };
  const optionalParts = applyOccurrenceAttachment({
    runtime: options.runtime,
    layout: options.layout,
    delta: options.delta,
    interaction: options.interaction,
    state,
    edgesVisible: options.edgesVisible,
    nodesVisible: options.nodesVisible,
    draw: options.draw,
  });
  const bundle = { ...options.bundle, device: options.draw.device, draw: options.draw };
  syncOccurrenceInteractionEmphasis({
    runtime: options.runtime,
    layout: options.layout,
    interaction: options.interaction,
    parts: options.attachedParts,
    bundle,
    transparentFlags: options.flags.values.transparentFlags,
    slotByInstanceId: options.slotByInstanceId,
    changedSlots: options.delta.slots.map(({ slot }) => slot),
    affectedParts: options.delta.affectedPartIds,
  });
  return rebuildAttachmentOrders({
    runtime: options.runtime,
    layout: options.layout,
    parts: options.delta.affectedPartIds,
    flags: options.flags.values,
    interaction: options.interaction,
    partDefinitions: options.attachedParts,
    selection: {
      selectedNodeFlags: options.flags.values.selectedNodeFlags,
      nodeFlags: options.flags.values.nodeFlags,
    },
    bundle,
    optionalParts,
    edgesVisible: options.edgesVisible,
    nodesVisible: options.nodesVisible,
    previousCalls: options.attachment,
  });
}

type PreparedOptions = Parameters<typeof prepareAttachmentOccurrenceUpdate>[0] & {
  readonly calls: Pick<
    AttachmentCallLists,
    | "calls"
    | "transparentCalls"
    | "edgeCalls"
    | "nodeCalls"
    | "selectionCalls"
    | "selectedNodeCalls"
  >;
  readonly flags: PartRevisionFlagSet;
  readonly instances: ReturnType<typeof stagePartRevisionArray<PartOccurrence | undefined>>;
  readonly slotByInstanceId: PartRevisionMap<string, number>;
  readonly slotLocals: StagedSlotLocals;
  readonly layout: InstanceLayout;
  readonly liveSourceParts: Map<PartId, Part>;
  readonly sourceParts: PartRevisionMap<PartId, Part>;
  readonly attachedParts: PartRevisionMap<PartId, Part>;
  readonly draw: DrawResources;
  readonly writes: readonly StagedBufferWrite[];
  readonly replacedPartIds: ReadonlySet<PartId>;
  readonly complete: () => void;
  readonly completed: () => boolean;
};

function preparedUpdate(options: PreparedOptions): PreparedAttachmentOccurrenceUpdate {
  return {
    draw: options.draw,
    layout: options.layout,
    parts: options.attachedParts,
    sourceParts: options.sourceParts,
    interaction: options.interaction,
    results: options.results,
    commit: () => {
      commitPrepared(options);
    },
    discard: () => {
      if (options.completed()) return;
      discardStagedOccurrenceResources(
        options.draw,
        options.bundle.draw,
        options.delta.affectedPartIds,
      );
      options.complete();
    },
  };
}

function commitPrepared(options: PreparedOptions): void {
  if (options.completed()) throw new Error("Occurrence revision is no longer pending");
  const liveLayout = options.attachment.layout;
  if (liveLayout === undefined) throw new Error("Occurrence revision layout is unavailable");
  const partIds = options.delta.affectedPartIds;
  for (const partId of options.replacedPartIds) {
    commitStagedPartDefinition(options.bundle.draw, options.draw, partId);
  }
  for (const partId of partIds) {
    if (!options.replacedPartIds.has(partId)) {
      commitStagedStorage(options.bundle.draw, options.draw, partId);
    }
  }
  commitStagedPartResults(options.bundle.draw, options.draw, partIds, options.results);
  commitStagedWrites(options.bundle.draw, options, partIds);
  commitDrawOverlays(options.bundle.draw, options.draw);
  commitOccurrenceLayout(liveLayout, options.layout, options.slotLocals);
  options.flags.commit(options.attachment.styleFlags());
  options.instances.commit(options.attachment.instances);
  options.slotByInstanceId.commit(options.attachment.slotByInstanceId);
  options.attachedParts.commit(options.attachment.attachedParts);
  options.sourceParts.commit(options.liveSourceParts);
  options.attachment.commitCalls(options.calls, internalAttachmentPublicationToken);
  options.attachment.commitInteractionState(
    options.interaction,
    options.attachment.interactionState,
    internalAttachmentPublicationToken,
  );
  releasePartDefinitions({
    runtime: options.runtime,
    layout: liveLayout,
    attachedParts: options.attachment.attachedParts,
    sourceParts: options.liveSourceParts,
    partIds: options.delta.removedPartIds,
    draw: options.bundle.draw,
  });
  options.bundle.draw.cost.merge(options.draw.cost);
  options.bundle.draw.cost.completeTransaction();
  options.complete();
}

function stageParts(
  parts: ReadonlyMap<PartId, Part>,
  partIds: ReadonlySet<PartId>,
  source: PartRevisionMap<PartId, Part>,
  attached: PartRevisionMap<PartId, Part>,
): void {
  for (const partId of partIds) {
    const part = parts.get(partId);
    if (part === undefined) throw new Error(`Revised part ${partId} is not registered`);
    source.set(partId, part);
    attached.set(partId, part);
  }
}

function stageResults(
  draw: DrawResources,
  results: PartRevisionResultState | undefined,
  runtime: PackedSceneRuntime,
  layout: InstanceLayout,
  partIds: ReadonlySet<PartId>,
): void {
  const staged = results?.staged;
  if (staged === undefined) return;
  if (staged.glyphs !== undefined)
    syncOrientationGlyphs(draw.orientationGlyphs, staged.glyphs, runtime, layout);
  if (staged.deformation !== undefined)
    syncDeformations(draw, staged.deformation, runtime, layout, partIds);
  if (staged.colors !== undefined) syncResultColors(draw, staged.colors, runtime, layout, partIds);
}

function commitDrawOverlays(live: DrawResources, staged: DrawResources): void {
  commitOverlay(live.parts, staged.parts);
  commitOverlay(live.primitiveParts, staged.primitiveParts);
  commitOverlay(live.nodeParts, staged.nodeParts);
  commitOverlay(live.visibilitySkins, staged.visibilitySkins);
  commitOverlay(live.admissionCache, staged.admissionCache);
}

function commitOverlay<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  if (source instanceof PartRevisionMap) source.commit(target);
}
