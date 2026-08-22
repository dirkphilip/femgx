import type { Part, PartId } from "../../geometry/part";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { GpuBundle } from "../recovery";
import type { DrawCallLists, InstanceLayout } from "../runtime-state";
import { changedPartDefinitions, reconcilePartResources } from "../resources/part-resources";
import type { GpuCostAccumulator } from "../diagnostics/cost";
import { rebuildInteractionVisibilitySurfaces } from "./interaction";
import type { AttachmentInteractionState } from "./interaction";
import { rebuildAttachmentCalls } from "./calls";
import { internalAttachmentPublicationToken } from "./call-publication";
import type { PartRevisionResultState } from "./part-revision-results";
import {
  clonePartRevisionLayout,
  prepareStagedPartRevision,
  type PartRevisionAttachmentHost,
  type PreparedPartRevision,
} from "./part-revision-stage";
import { PartRevisionMap, stagePartRevisionFlagSet } from "./part-revision-overlay";

interface PartAttachmentOptions {
  attachedParts: Map<PartId, Part>;
  readonly runtime: PackedSceneRuntime | undefined;
  readonly layout: InstanceLayout | undefined;
  readonly interaction: InteractionState;
  readonly bundle: GpuBundle;
}

/** Builds lazy semantic metadata for exact added definitions before live mutation. */
export function prepareAddedAttachmentParts(
  parts: ReadonlyMap<PartId, Part>,
  partIds: ReadonlySet<PartId>,
  cost?: GpuCostAccumulator,
): void {
  for (const partId of partIds) {
    const part = parts.get(partId);
    if (part === undefined) throw new Error(`Added part ${partId} is not registered`);
    getPartSemanticIndex(part);
    cost?.cpu("definition-validation", 1);
  }
}

/** Applies one definition revision through the existing attached-resource owner. */
export function replaceAttachedPartDefinitions(
  attachment: PartRevisionAttachmentHost,
  parts: ReadonlyMap<PartId, Part>,
  partIds: ReadonlySet<PartId>,
  revision: {
    readonly interaction: InteractionState;
    readonly bundle: GpuBundle;
    readonly results: PartRevisionResultState | undefined;
  },
): void {
  prepareAddedAttachmentParts(parts, partIds);
  const runtime = attachment.runtime;
  const layout = attachment.layout;
  if (runtime === undefined || layout === undefined) {
    replaceAttachedParts(attachment.attachedParts, parts, partIds);
    attachment.commitInteractionState(
      revision.interaction,
      undefined,
      internalAttachmentPublicationToken,
    );
    return;
  }
  const prepared = preparePartRevision({
    attachment,
    parts,
    partIds,
    ...revision,
  });
  commitPartRevision(attachment, prepared, partIds);
}

/** Prepares an attached definition revision without mutating its live owner. */
export function preparePartRevision(options: {
  readonly attachment: PartRevisionAttachmentHost;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly partIds: ReadonlySet<PartId>;
  readonly interaction: InteractionState;
  readonly bundle: GpuBundle;
  readonly results: PartRevisionResultState | undefined;
}): PreparedPartRevision {
  const { attachment, partIds } = options;
  const runtime = attachment.runtime;
  const attachedLayout = attachment.layout;
  if (runtime === undefined || attachedLayout === undefined) {
    throw new Error("Part revisions require an attached renderer runtime");
  }
  const layout = clonePartRevisionLayout(attachedLayout);
  const flags = stagePartRevisionFlagSet(attachment.styleFlags());
  const parts = new PartRevisionMap(attachment.attachedParts);
  replaceAttachedParts(parts, options.parts, partIds);
  const prepared = prepareStagedPartRevision({
    attachment,
    parts,
    partIds,
    interaction: options.interaction,
    bundle: options.bundle,
    runtime,
    layout,
    flags: flags.values,
    results: options.results,
  });
  return {
    ...prepared,
    commitFlags: (target) => {
      flags.commit(target);
    },
  };
}

/** Publishes a fully prepared attached definition revision. */
export function commitPartRevision(
  attachment: PartRevisionAttachmentHost,
  prepared: PreparedPartRevision,
  partIds: ReadonlySet<PartId>,
): void {
  const runtime = attachment.runtime;
  if (runtime === undefined) throw new Error("Part revision runtime is unavailable");
  prepared.drawRevision.commit();
  replaceAttachedParts(attachment.attachedParts, prepared.parts, partIds);
  prepared.commitFlags(attachment.styleFlags());
  commitPartLayout(attachment.layout, prepared.layout, partIds);
  applyInteractionState(attachment, prepared.interactionState);
  attachment.commitCalls(prepared.calls, internalAttachmentPublicationToken);
}

/** Discards one prepared definition revision without touching live resources. */
export function discardPartRevision(prepared: PreparedPartRevision): void {
  prepared.drawRevision.discard();
}

function commitPartLayout(
  live: InstanceLayout | undefined,
  staged: InstanceLayout,
  partIds: ReadonlySet<PartId>,
): void {
  if (live === undefined) throw new Error("Part revision layout is unavailable");
  for (const [target, source] of layoutMaps(live, staged)) {
    for (const partId of partIds) {
      const value = source.get(partId);
      if (value === undefined) target.delete(partId);
      else target.set(partId, value);
    }
  }
}

function layoutMaps(
  live: InstanceLayout,
  staged: InstanceLayout,
): readonly [Map<PartId, unknown>, ReadonlyMap<PartId, unknown>][] {
  return [
    [live.partVisibleCounts, staged.partVisibleCounts],
    [live.partEdgeCounts, staged.partEdgeCounts],
    [live.partNodeCounts, staged.partNodeCounts],
    [live.partTransparentCounts, staged.partTransparentCounts],
    [live.partSelectionCounts, staged.partSelectionCounts],
    [live.partSelectedNodeCounts, staged.partSelectedNodeCounts],
    [live.partSelectionDrawCalls, staged.partSelectionDrawCalls],
    [live.partSurfaceDrawCalls, staged.partSurfaceDrawCalls],
    [live.partEdgeNeedsFullTopology, staged.partEdgeNeedsFullTopology],
  ];
}

function applyInteractionState(
  attachment: PartRevisionAttachmentHost,
  state: AttachmentInteractionState,
): void {
  attachment.commitInteractionState(
    state.interaction,
    state.beforeLastInstanceUpdate,
    internalAttachmentPublicationToken,
    state.appliedHiddenIds,
    state.usesExteriorFaceSubsets,
  );
}

function replaceAttachedParts(
  target: Map<PartId, Part>,
  parts: ReadonlyMap<PartId, Part>,
  partIds: ReadonlySet<PartId>,
): void {
  for (const partId of partIds) {
    const part = parts.get(partId);
    if (part === undefined) throw new Error(`Replaced part ${partId} is not registered`);
    target.set(partId, part);
  }
}

/** Reconciles immutable definition resources for a general runtime replacement. */
export function prepareAttachmentParts(
  options: PartAttachmentOptions,
  parts: ReadonlyMap<PartId, Part>,
): { readonly parts: Map<PartId, Part>; readonly calls: DrawCallLists | undefined } {
  const changed = changedPartDefinitions(options.attachedParts, parts);
  changed?.forEach((partId) => {
    options.layout?.partSelectionDrawCalls.delete(partId);
    options.layout?.partSurfaceDrawCalls.delete(partId);
  });
  const next = new Map(reconcilePartResources(options.attachedParts, parts, options.bundle.draw));
  if (changed !== undefined && options.runtime !== undefined && options.layout !== undefined) {
    rebuildInteractionVisibilitySurfaces({
      runtime: options.runtime,
      layout: options.layout,
      parts: changed,
      attachedParts: next,
      interaction: options.interaction,
      bundle: options.bundle,
    });
  }
  for (const partId of changed ?? []) {
    const part = parts.get(partId);
    if (part !== undefined) getPartSemanticIndex(part);
  }
  const calls =
    changed !== undefined && options.runtime !== undefined && options.layout !== undefined
      ? rebuildAttachmentCalls(options.layout, options.bundle.draw.cost)
      : undefined;
  return { parts: next, calls };
}
