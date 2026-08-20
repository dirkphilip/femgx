import type { Part, PartId } from "../../geometry/part";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { GpuBundle } from "../recovery";
import type { DrawCallLists, InstanceLayout } from "../runtime-state";
import { cloneAttachmentFlags, copyAttachmentFlags } from "./reconciliation";
import { changedPartDefinitions, reconcilePartResources } from "../resources/part-resources";
import { destroyPartResources, type DrawResources } from "../resources/draw-resources";
import { rebuildVisibilitySurface } from "../visibility/skins";
import { rebuildAttachmentCalls, reviseAttachmentCalls } from "./calls";
import { syncAttachmentInteraction } from "./interaction";
import type { PartRevisionResultState } from "./part-revision-results";
import { releasePartDefinitions } from "./occurrences";
import {
  clonePartRevisionLayout,
  prepareStagedPartRevision,
  type PartRevisionAttachmentHost,
  type PreparedPartRevision,
} from "./part-revision-stage";

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
): void {
  for (const partId of partIds) {
    const part = parts.get(partId);
    if (part === undefined) throw new Error(`Added part ${partId} is not registered`);
    getPartSemanticIndex(part);
  }
}

/** Admits exact added definitions without scanning or replacing retained resources. */
export function addAttachmentParts(
  attachedParts: Map<PartId, Part>,
  parts: ReadonlyMap<PartId, Part>,
  partIds: ReadonlySet<PartId>,
): void {
  for (const partId of partIds) {
    const part = parts.get(partId);
    if (part === undefined) throw new Error(`Added part ${partId} is not registered`);
    attachedParts.set(partId, part);
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
    attachment.interactionState = revision.interaction;
    attachment.interactionBeforeLastInstanceUpdate = undefined;
    return;
  }
  const prepared = preparePartRevision({
    attachment,
    parts,
    partIds,
    ...revision,
  });
  commitPartRevision(attachment, prepared, partIds, revision.bundle);
}

function preparePartRevision(options: {
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
  const flags = cloneAttachmentFlags(attachment.styleFlags());
  const parts = new Map(attachment.attachedParts);
  replaceAttachedParts(parts, options.parts, partIds);
  return prepareStagedPartRevision({
    attachment,
    parts,
    partIds,
    interaction: options.interaction,
    bundle: options.bundle,
    runtime,
    layout,
    flags,
    results: options.results,
  });
}

function commitPartRevision(
  attachment: PartRevisionAttachmentHost,
  prepared: PreparedPartRevision,
  partIds: ReadonlySet<PartId>,
  bundle: GpuBundle,
): void {
  const runtime = attachment.runtime;
  if (runtime === undefined) throw new Error("Part revision runtime is unavailable");
  for (const partId of partIds) commitPartResources(bundle.draw, prepared, partId);
  commitPartResults(bundle.draw, prepared, partIds);
  replaceAttachedParts(attachment.attachedParts, prepared.parts, partIds);
  copyAttachmentFlags(attachment.styleFlags(), prepared.flags);
  attachment.layout = prepared.layout;
  const state = {
    interaction: attachment.interactionState,
    beforeLastInstanceUpdate: attachment.interactionBeforeLastInstanceUpdate,
    appliedHiddenIds: attachment.appliedHiddenIds,
    usesExteriorFaceSubsets: attachment.usesExteriorFaceSubsets,
    transparentFlags: prepared.flags.transparentFlags,
    edgeFlags: prepared.flags.edgeFlags,
    edgeEmphasisFlags: prepared.flags.edgeEmphasisFlags,
    slotByInstanceId: attachment.slotByInstanceId,
    selection: {
      selectedNodeFlags: prepared.flags.selectedNodeFlags,
      nodeFlags: prepared.flags.nodeFlags,
    },
  };
  const changedSlots: number[] = [];
  for (const partId of partIds) changedSlots.push(...runtime.getPartInstanceSlots(partId));
  const result = syncAttachmentInteraction({
    state,
    runtime,
    layout: prepared.layout,
    interaction: prepared.interaction,
    parts: prepared.parts,
    bundle,
    attached: false,
    fullSync: false,
    changedSlots,
    forceParts: partIds,
  });
  for (const partId of result.visibilityParts ?? []) {
    const part = prepared.parts.get(partId);
    if (part !== undefined)
      rebuildVisibilitySurface({
        runtime,
        layout: prepared.layout,
        part,
        interaction: prepared.interaction,
        draw: bundle.draw,
      });
  }
  applyInteractionState(attachment, state);
  Object.assign(
    attachment,
    result.calls ?? reviseAttachmentCalls(prepared.layout, attachment, partIds, bundle.draw.cost),
  );
}

function applyInteractionState(
  attachment: PartRevisionAttachmentHost,
  state: Parameters<typeof syncAttachmentInteraction>[0]["state"],
): void {
  attachment.interactionState = state.interaction;
  attachment.interactionBeforeLastInstanceUpdate = state.beforeLastInstanceUpdate;
  attachment.appliedHiddenIds = state.appliedHiddenIds;
  attachment.usesExteriorFaceSubsets = state.usesExteriorFaceSubsets;
}

function commitPartResults(
  draw: DrawResources,
  prepared: PreparedPartRevision,
  partIds: ReadonlySet<PartId>,
): void {
  for (const partId of partIds) {
    transferPartResource(draw.deformations, prepared.draw.deformations, partId);
    transferPartResource(draw.resultColors, prepared.draw.resultColors, partId);
    transferPartResource(
      draw.orientationGlyphs.parts,
      prepared.draw.orientationGlyphs.parts,
      partId,
    );
  }
  if (draw.orientationGlyphs.paramsBuffer !== prepared.draw.orientationGlyphs.paramsBuffer) {
    draw.orientationGlyphs.paramsBuffer?.destroy();
    draw.orientationGlyphs.paramsBuffer = prepared.draw.orientationGlyphs.paramsBuffer;
  }
  new Uint8Array(draw.orientationGlyphs.paramsData).set(
    new Uint8Array(prepared.draw.orientationGlyphs.paramsData),
  );
  draw.orientationGlyphs.state = prepared.draw.orientationGlyphs.state;
}

function commitPartResources(
  draw: DrawResources,
  prepared: PreparedPartRevision,
  partId: PartId,
): void {
  destroyPartResources(draw, partId);
  transferStagedPartResources(draw, prepared.draw, partId);
}

function transferStagedPartResources(
  draw: DrawResources,
  staged: DrawResources,
  partId: PartId,
): void {
  transferPartResource(draw.parts, staged.parts, partId);
  transferPartResource(draw.primitiveParts, staged.primitiveParts, partId);
  transferPartResource(draw.nodeParts, staged.nodeParts, partId);
  transferPartResource(draw.admissionCache, staged.admissionCache, partId);
}

function transferPartResource<T>(
  target: Map<PartId, T>,
  source: ReadonlyMap<PartId, T>,
  partId: PartId,
): void {
  const resource = source.get(partId);
  if (resource === undefined) target.delete(partId);
  else target.set(partId, resource);
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
    for (const partId of changed) rebuildPartVisibility(options, next.get(partId));
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

/** Retires exact removed definitions without scanning the retained registry. */
export function removeAttachmentParts(
  options: PartAttachmentOptions,
  sourceParts: Map<PartId, Part>,
  partIds: ReadonlySet<PartId>,
  rebuildCalls = true,
): DrawCallLists | undefined {
  const removed = releasePartDefinitions({
    ...options,
    sourceParts,
    partIds,
    draw: options.bundle.draw,
  });
  return removed && rebuildCalls
    ? rebuildAttachmentCalls(options.layout, options.bundle.draw.cost)
    : undefined;
}

function rebuildPartVisibility(options: PartAttachmentOptions, part: Part | undefined): void {
  if (part === undefined || options.runtime === undefined || options.layout === undefined) return;
  rebuildVisibilitySurface({
    runtime: options.runtime,
    layout: options.layout,
    part,
    interaction: options.interaction,
    draw: options.bundle.draw,
  });
}
