import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { GpuBundle } from "../recovery";
import type { InstanceLayout } from "../runtime-state";
import { GpuCostAccumulator } from "../diagnostics/cost";
import { syncAttachmentInteraction, type AttachmentInteractionState } from "./interaction";
import { reviseAttachmentCalls } from "./calls";
import { rebuildVisibilitySurface } from "../visibility/skins";
import { type DrawResources, uploadGeometryPart } from "../resources/draw-resources";
import { syncDeformations } from "../frame/deformation";
import { syncOrientationGlyphs } from "../orientation-glyphs/orientation-glyph";
import { syncResultColors } from "../resources/result-colors";
import type { PartRevisionResultState } from "./part-revision-results";
import type { AttachmentCallLists } from "./calls";
import type { HiddenInteractionTuple } from "./interaction";
import type { AttachmentFlagState } from "./reconciliation";
import type { SelectionState } from "../selection-state";
import {
  createInstanceStorageRevisionJournal,
  type InstanceStorage,
} from "../resources/instance-storage";
import { stagePartRevisionSidecars } from "./part-revision-storage";
import { createHighlightRevisionJournal } from "../selection/highlight-storage";
import { createPartRevisionStagingDevice, type StagedBufferWrite } from "./part-revision-writes";
import { PartRevisionMap } from "./part-revision-overlay";
import { discardStagedPartResources } from "./part-revision-cleanup";

const PART_REVISION_SIDECARS = [
  "transparent",
  "selection",
  "nodeSelection",
  "nodeSelectionCompact",
  "edge",
  "node",
] as const;

export interface PartRevisionAttachmentHost extends AttachmentCallLists {
  interactionState: InteractionState;
  interactionBeforeLastInstanceUpdate: InteractionState | undefined;
  readonly attachedParts: Map<PartId, Part>;
  readonly runtime: PackedSceneRuntime | undefined;
  layout: InstanceLayout | undefined;
  readonly selection: SelectionState;
  readonly slotByInstanceId: ReadonlyMap<string, number>;
  appliedHiddenIds: HiddenInteractionTuple;
  usesExteriorFaceSubsets: boolean;
  styleFlags(): AttachmentFlagState;
}

/** Prepared resources and detached attachment state for a part-definition revision. */
export interface PreparedPartRevision {
  readonly draw: DrawResources;
  readonly layout: InstanceLayout;
  readonly parts: Map<PartId, Part>;
  readonly flags: AttachmentFlagState;
  readonly commitFlags: (target: AttachmentFlagState) => void;
  readonly interaction: InteractionState;
  readonly results: PartRevisionResultState | undefined;
  readonly interactionState: AttachmentInteractionState;
  readonly calls: AttachmentCallLists;
  readonly writes: readonly StagedBufferWrite[];
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
  const { draw, writes } = stageDrawResources(
    options.bundle.draw,
    options.partIds,
    stageInteraction,
    true,
  );
  try {
    return stagePartRevision({ ...options, draw, writes });
  } catch (error) {
    discardStagedPartResources(draw, options.bundle.draw, options.partIds);
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
  readonly draw: DrawResources;
  readonly writes: readonly StagedBufferWrite[];
}): StagedPartRevision {
  stagePartDefinitionResources(
    options.draw,
    options.parts,
    options.partIds,
    options.attachment.usesExteriorFaceSubsets,
  );
  stagePartResults(options);
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
  readonly draw: DrawResources;
  readonly writes: readonly StagedBufferWrite[];
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
    bundle: { ...options.bundle, device: options.draw.device, draw: options.draw },
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
      draw: options.draw,
    });
  }
  return {
    ...options,
    interactionState,
    calls: reviseAttachmentCalls(
      options.layout,
      options.attachment,
      options.partIds,
      options.draw.cost,
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
    slotByInstanceId: attachment.slotByInstanceId,
    selection: { selectedNodeFlags: flags.selectedNodeFlags, nodeFlags: flags.nodeFlags },
  };
}

function stagePartResults(options: {
  readonly draw: DrawResources;
  readonly results: PartRevisionResultState | undefined;
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly partIds: ReadonlySet<PartId>;
}): void {
  const results = options.results?.staged;
  if (results === undefined) return;
  if (results.glyphs !== undefined)
    syncOrientationGlyphs(
      options.draw.orientationGlyphs,
      results.glyphs,
      options.runtime,
      options.layout,
    );
  if (results.deformation !== undefined)
    syncDeformations(
      options.draw,
      results.deformation,
      options.runtime,
      options.layout,
      options.partIds,
    );
  if (results.colors !== undefined)
    syncResultColors(
      options.draw,
      results.colors,
      options.runtime,
      options.layout,
      options.partIds,
    );
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

/** Creates a detached draw owner for exact affected-part writes. */
export function stageDrawResources(
  draw: DrawResources,
  partIds: ReadonlySet<PartId>,
  stageInteraction: boolean,
  replaceDefinitions: boolean,
): { readonly draw: DrawResources; readonly writes: readonly StagedBufferWrite[] } {
  const writes: StagedBufferWrite[] = [];
  const protectedBuffers = protectedStorageBuffers(draw, partIds);
  const device = createPartRevisionStagingDevice(draw.device, protectedBuffers, writes);
  const cost = new GpuCostAccumulator();
  const staged = {
    ...draw,
    device,
    deferReleases: true,
    cost,
    parts: new PartRevisionMap(draw.parts),
    primitiveParts: new PartRevisionMap(draw.primitiveParts),
    nodeParts: new PartRevisionMap(draw.nodeParts),
    storages: stagedStorages(draw.storages, partIds, stageInteraction),
    visibilitySkins: new PartRevisionMap(draw.visibilitySkins),
    admissionCache: new PartRevisionMap(draw.admissionCache),
    deformations: new Map(),
    resultColors: new Map(),
    orientationGlyphs: {
      ...draw.orientationGlyphs,
      cost,
      // A definition revision cannot change the resolved glyph presentation.
      // Retaining this shared uniform also keeps unchanged glyph bind groups valid.
      paramsData: draw.orientationGlyphs.paramsData.slice(0),
      parts: new Map(),
    },
  };
  if (replaceDefinitions) {
    for (const partId of partIds) {
      staged.parts.delete(partId);
      staged.primitiveParts.delete(partId);
      staged.nodeParts.delete(partId);
      staged.visibilitySkins.delete(partId);
      staged.admissionCache.delete(partId);
    }
  }
  return { draw: staged, writes };
}

function stagedStorages(
  source: ReadonlyMap<PartId, InstanceStorage>,
  partIds: ReadonlySet<PartId>,
  stageInteraction: boolean,
): Map<PartId, InstanceStorage> {
  const staged = new PartRevisionMap(source);
  if (!stageInteraction) return staged;
  for (const partId of partIds) {
    const storage = source.get(partId);
    if (storage !== undefined) staged.set(partId, cloneStagedStorage(storage));
  }
  return staged;
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

function cloneStagedStorage(storage: InstanceStorage): InstanceStorage {
  return {
    ...storage,
    deferRelease: true,
    revisionJournal: createInstanceStorageRevisionJournal(),
    sidecars: stagePartRevisionSidecars(storage.sidecars),
    data: storage.data,
    highlight: { ...storage.highlight, revisionJournal: createHighlightRevisionJournal() },
    emphasisSlots: new Set(storage.emphasisSlots),
    edgeEmphasisSlots: new Set(storage.edgeEmphasisSlots),
    orderData: storage.orderData,
    bindGroup: undefined,
    minimalBindGroup: undefined,
    minimalTransparentBindGroup: undefined,
    nodeBindGroup: undefined,
    edgeBindGroup: undefined,
    transparentBindGroup: undefined,
    selectionBindGroup: undefined,
    subsetSelectionBindGroup: undefined,
    nodeSelectionBindGroup: undefined,
    subsetBindGroup: undefined,
    subsetTransparentBindGroup: undefined,
  };
}

function protectedStorageBuffers(
  draw: DrawResources,
  partIds: ReadonlySet<PartId>,
): Set<GPUBuffer> {
  const buffers = new Set<GPUBuffer>();
  for (const partId of partIds) {
    const storage = draw.storages.get(partId);
    if (storage === undefined) continue;
    buffers.add(storage.buffer);
    buffers.add(storage.orderBuffer);
    for (const kind of PART_REVISION_SIDECARS) {
      const sidecar = storage.sidecars[kind];
      if (sidecar !== undefined) buffers.add(sidecar.buffer);
    }
    if (storage.highlightOwned) buffers.add(storage.highlight.buffer);
  }
  if (draw.orientationGlyphs.paramsBuffer !== undefined) {
    buffers.add(draw.orientationGlyphs.paramsBuffer);
  }
  return buffers;
}
