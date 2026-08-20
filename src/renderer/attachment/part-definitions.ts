import type { Part, PartId } from "../../geometry/part";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { GpuBundle } from "../recovery";
import type { DrawCallLists, InstanceLayout } from "../runtime-state";
import { changedPartDefinitions, reconcilePartResources } from "../resources/part-resources";
import { rebuildVisibilitySurface } from "../visibility/skins";
import { rebuildAttachmentCalls } from "./calls";
import { releasePartDefinitions } from "./occurrences";

interface PartAttachmentOptions {
  readonly attachedParts: Map<PartId, Part>;
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
