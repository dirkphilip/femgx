import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { RendererAttachment } from "../attachment";
import type { GpuBundle } from "../recovery";
import type { SectionCapController } from "../section-cap-controller";

interface RendererPartRevisionOptions {
  readonly bundle: GpuBundle;
  readonly runtime: PackedSceneRuntime;
  readonly interaction: InteractionState;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly partIds: ReadonlySet<PartId>;
}

/** Replaces one definition through retained attachment, cap, and interaction ownership. */
export function applyRendererPartRevision(
  attachment: RendererAttachment,
  renderedParts: Map<PartId, Part>,
  sourceParts: ReadonlyMap<PartId, Part> | undefined,
  sectionCaps: SectionCapController,
  options: RendererPartRevisionOptions,
): ReadonlyMap<PartId, Part> | undefined {
  attachment.prepareAddedParts(options.parts, options.partIds);
  attachment.replaceParts(options.parts, options.partIds, options.interaction, options.bundle);
  for (const partId of options.partIds) {
    const part = options.parts.get(partId);
    if (part === undefined) throw new Error(`Replaced part ${partId} is not registered`);
    renderedParts.set(partId, part);
  }
  sectionCaps.replaceParts(options.partIds, renderedParts, options.bundle.draw);
  sectionCaps.syncInteraction(
    options.interaction,
    options.runtime,
    renderedParts,
    options.bundle.draw,
  );
  return sourceParts === undefined ? undefined : options.parts;
}
