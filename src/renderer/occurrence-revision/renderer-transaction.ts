import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { RuntimeOccurrenceDelta } from "../../scene-runtime/occurrence-update";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import {
  prepareAttachmentOccurrenceUpdate,
  type PreparedAttachmentOccurrenceUpdate,
} from "../attachment/occurrence-transaction";
import type { PartRevisionResultState } from "../attachment/part-revision-results";
import type { RendererAttachment } from "../attachment";
import type { OrientationGlyphState } from "../orientation-glyphs/orientation-glyph";
import type { RendererPicking } from "../picking/renderer-picking";
import type { GpuDeviceLifecycle } from "../recovery";
import type { PreparedSectionCapRevision } from "../resources/section-caps/revision";
import type { SectionCapController } from "../section-cap-controller";
import type { SectionPlane } from "../../math/section-plane";
import type { DeformationState } from "../../results/deform";
import type { ResultColorMap } from "../../results/colors";

interface RendererOccurrenceOwner {
  readonly attachment: RendererAttachment;
  readonly lifecycle: GpuDeviceLifecycle;
  readonly sectionCaps: SectionCapController;
  readonly picking: RendererPicking;
  parts: Map<PartId, Part>;
  sourceParts: ReadonlyMap<PartId, Part> | undefined;
  interaction: InteractionState;
  sectionPlane: SectionPlane | undefined;
  deformation: DeformationState | undefined;
  resultColors: ResultColorMap | undefined;
  orientationGlyphs: OrientationGlyphState | undefined;
}

/** Renderer-private prepared placement transaction passed through the viewport owner. */
export interface PreparedRendererOccurrenceUpdate {
  readonly attachment: PreparedAttachmentOccurrenceUpdate;
  readonly caps: PreparedSectionCapRevision;
  readonly runtime: PackedSceneRuntime;
  readonly interaction: InteractionState;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly results: PartRevisionResultState | undefined;
}

/** Completes every fallible renderer allocation for one occurrence revision. */
export function prepareRendererOccurrenceUpdate(
  renderer: RendererOccurrenceOwner,
  options: {
    readonly runtime: PackedSceneRuntime;
    readonly interaction: InteractionState;
    readonly delta: RuntimeOccurrenceDelta;
    readonly parts: ReadonlyMap<PartId, Part>;
    readonly results?: PartRevisionResultState;
    readonly replacedPartIds?: ReadonlySet<PartId>;
  },
): PreparedRendererOccurrenceUpdate {
  const { runtime, interaction, delta, parts, results, replacedPartIds } = options;
  const attachment = prepareAttachmentOccurrenceUpdate({
    attachment: renderer.attachment,
    runtime,
    interaction,
    delta,
    sourceParts: renderer.parts,
    parts,
    bundle: renderer.lifecycle.bundle,
    ...(results === undefined ? {} : { results }),
    ...(replacedPartIds === undefined ? {} : { replacedPartIds }),
    edgesVisible: renderer.attachment.edgesVisible,
    nodesVisible: renderer.attachment.nodesVisible,
  });
  try {
    const caps = renderer.sectionCaps.prepareOccurrenceRevision({
      runtime,
      parts: attachment.sourceParts,
      delta,
      plane: renderer.sectionPlane,
      interaction,
      deformation: results?.deformation ?? renderer.deformation,
      resultColors: results?.colors ?? renderer.resultColors,
      draw: attachment.draw,
    });
    return { attachment, caps, runtime, interaction, parts, results };
  } catch (error) {
    attachment.discard();
    throw error;
  }
}

/** Publishes prepared renderer owners and invalidates picking exactly once. */
export function commitRendererOccurrenceUpdate(
  renderer: RendererOccurrenceOwner,
  prepared: PreparedRendererOccurrenceUpdate,
): void {
  prepared.attachment.commit();
  renderer.sectionCaps.commitOccurrenceRevision(
    prepared.caps,
    prepared.attachment.draw,
    renderer.lifecycle.bundle.draw,
  );
  if (renderer.sourceParts !== undefined) renderer.sourceParts = prepared.parts;
  renderer.interaction = prepared.interaction;
  if (prepared.results !== undefined) {
    renderer.deformation = prepared.results.deformation;
    renderer.resultColors = prepared.results.colors;
    renderer.orientationGlyphs = prepared.results.glyphs;
  }
  renderer.picking.invalidate();
}

/** Destroys allocations owned by an uncommitted renderer occurrence revision. */
export function discardRendererOccurrenceUpdate(
  renderer: RendererOccurrenceOwner,
  prepared: PreparedRendererOccurrenceUpdate,
): void {
  renderer.sectionCaps.discardOccurrenceRevision(prepared.caps, prepared.attachment.draw);
  prepared.attachment.discard();
}
