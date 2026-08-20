import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { RuntimeOccurrenceDelta } from "../../scene-runtime/occurrence-update";
import type { RendererAttachment } from "../attachment";
import type { GpuBundle } from "../recovery";
import type { SectionCapController } from "../section-cap-controller";

interface RendererInteractionHost {
  readonly attachment: RendererAttachment;
  readonly sectionCaps: SectionCapController;
  bundle(): GpuBundle;
  parts(): Map<PartId, Part>;
}

/** Coordinates attachment and cap interaction work while keeping renderer facade methods small. */
export class RendererInteractionController {
  public constructor(private readonly host: RendererInteractionHost) {}

  public updateInstances(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    changedInstanceIds: readonly number[],
  ): boolean {
    const bundle = this.host.bundle();
    const changed = this.host.attachment.updateInstances(
      runtime,
      interaction,
      changedInstanceIds,
      bundle,
    );
    if (changed) this.host.sectionCaps.invalidate();
    this.host.sectionCaps.syncInteraction(interaction, runtime, this.host.parts(), bundle.draw);
    return changed;
  }

  public updateOccurrences(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    delta: RuntimeOccurrenceDelta,
    parts: ReadonlyMap<PartId, Part>,
  ): boolean {
    const bundle = this.host.bundle();
    const renderedParts = this.host.parts();
    this.host.attachment.addParts(parts, delta.addedPartIds, renderedParts);
    const changed = delta.slots.length > 0 || delta.removedPartIds.size > 0;
    if (changed)
      this.host.attachment.updateOccurrences(runtime, interaction, delta, renderedParts, bundle);
    this.host.sectionCaps.updateOccurrences(delta, renderedParts, bundle.draw);
    return changed;
  }

  public updateElements(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    changedInstanceIds: readonly number[] | undefined,
  ): boolean {
    const bundle = this.host.bundle();
    const changed = this.host.attachment.updateElements(
      runtime,
      interaction,
      bundle,
      this.host.parts(),
      changedInstanceIds,
    );
    this.host.sectionCaps.syncInteraction(interaction, runtime, this.host.parts(), bundle.draw);
    return changed;
  }

  public updateVisibility(
    runtime: PackedSceneRuntime,
    affectedPartIds: readonly PartId[],
  ): boolean {
    if (!this.host.attachment.updateVisibility(runtime, affectedPartIds, this.host.bundle()))
      return false;
    this.host.sectionCaps.invalidate();
    return true;
  }
}
