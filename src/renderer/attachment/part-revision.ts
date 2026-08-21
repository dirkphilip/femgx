import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { RendererAttachment } from "../attachment";
import type { GpuBundle } from "../recovery";
import type { SectionCapController } from "../section-cap-controller";
import type { PartRevisionResultState } from "./part-revision-results";
import type { SectionPlane } from "../../math/section-plane";
import type { DeformationState } from "../../results/deform";
import type { ResultColorMap } from "../../results/colors";
import {
  commitPartRevision,
  discardPartRevision,
  prepareAddedAttachmentParts,
  preparePartRevision,
} from "./part-definitions";
import { PartRevisionMap } from "./part-revision-overlay";

interface RendererPartRevisionOptions {
  readonly bundle: GpuBundle;
  readonly runtime: PackedSceneRuntime;
  readonly interaction: InteractionState;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly partIds: ReadonlySet<PartId>;
  readonly results: PartRevisionResultState | undefined;
  readonly plane: SectionPlane | undefined;
  readonly deformation: DeformationState | undefined;
  readonly resultColors: ResultColorMap | undefined;
}

/** Replaces one definition through retained attachment, cap, and interaction ownership. */
export function applyRendererPartRevision(
  attachment: RendererAttachment,
  renderedParts: Map<PartId, Part>,
  sourceParts: ReadonlyMap<PartId, Part> | undefined,
  sectionCaps: SectionCapController,
  options: RendererPartRevisionOptions,
): ReadonlyMap<PartId, Part> | undefined {
  prepareAddedAttachmentParts(options.parts, options.partIds, options.bundle.draw.cost);
  const nextParts = new PartRevisionMap(renderedParts);
  for (const partId of options.partIds) {
    const part = options.parts.get(partId);
    if (part === undefined) throw new Error(`Replaced part ${partId} is not registered`);
    nextParts.set(partId, part);
  }
  const prepared = preparePartRevision({
    attachment,
    parts: options.parts,
    partIds: options.partIds,
    interaction: options.interaction,
    bundle: options.bundle,
    results: options.results,
  });
  try {
    const caps = sectionCaps.preparePartRevision({
      runtime: options.runtime,
      parts: nextParts,
      partIds: options.partIds,
      plane: options.plane,
      interaction: options.interaction,
      deformation: options.deformation,
      resultColors: options.resultColors,
      draw: prepared.draw,
    });
    commitPartRevision(attachment, prepared, options.partIds, options.bundle);
    sectionCaps.commitPartRevision(caps, prepared.draw, options.bundle.draw);
    options.bundle.draw.cost.completeTransaction();
    for (const partId of options.partIds) {
      const part = nextParts.get(partId);
      if (part !== undefined) renderedParts.set(partId, part);
    }
  } catch (error) {
    discardPartRevision(prepared, options.bundle.draw, options.partIds);
    throw error;
  }
  return sourceParts === undefined ? undefined : options.parts;
}
