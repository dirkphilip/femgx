import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { GpuBundle } from "../recovery";
import type { AttachmentCallLists } from "./calls";
import type { AttachmentPublicationToken } from "./call-publication";
import type { InstanceLayout } from "../runtime-state";
import type { AttachmentInteractionState } from "./interaction";
import { rebuildInteractionVisibilitySurfaces, syncAttachmentInteraction } from "./interaction";
import { internalAttachmentPublicationToken } from "./call-publication";

interface ElementSynchronizationOwner {
  readonly layout: InstanceLayout | undefined;
  readonly attachedParts: ReadonlyMap<PartId, Part>;
  readonly interactionState: InteractionState;
  attach(runtime: PackedSceneRuntime, bundle: GpuBundle): boolean;
  elementInteractionState(): AttachmentInteractionState;
  commitInteractionState(
    interaction: InteractionState,
    beforeLastInstanceUpdate: InteractionState | undefined,
    token: AttachmentPublicationToken,
    appliedHiddenIds?: AttachmentInteractionState["appliedHiddenIds"],
    usesExteriorFaceSubsets?: boolean,
  ): void;
  commitCalls(calls: AttachmentCallLists, token: AttachmentPublicationToken): void;
}

/** Synchronizes element-owned GPU state for a renderer attachment. */
export function updateAttachmentElements(options: {
  readonly attachment: ElementSynchronizationOwner;
  readonly runtime: PackedSceneRuntime;
  readonly interaction: InteractionState;
  readonly bundle: GpuBundle;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly changedInstanceIds?: readonly number[] | undefined;
}): boolean {
  const { attachment } = options;
  const attached = attachment.attach(options.runtime, options.bundle);
  const layout = attachment.layout;
  if (layout === undefined) return attached;
  const fullSync = attached || options.changedInstanceIds === undefined;
  const changedSlots =
    options.changedInstanceIds === undefined || attached
      ? Array.from({ length: options.runtime.instanceCount }, (_, slot) => slot)
      : options.changedInstanceIds;
  const state = attachment.elementInteractionState();
  const result = syncAttachmentInteraction({
    state,
    runtime: options.runtime,
    layout,
    interaction: options.interaction,
    parts: options.parts,
    bundle: options.bundle,
    attached,
    fullSync,
    changedSlots,
  });
  attachment.commitInteractionState(
    state.interaction,
    state.beforeLastInstanceUpdate,
    internalAttachmentPublicationToken,
    state.appliedHiddenIds,
    state.usesExteriorFaceSubsets,
  );
  if (result.visibilityParts !== undefined) {
    attachment.commitCalls(
      rebuildInteractionVisibilitySurfaces({
        runtime: options.runtime,
        layout,
        parts: result.visibilityParts,
        attachedParts: attachment.attachedParts,
        interaction: attachment.interactionState,
        bundle: options.bundle,
      }),
      internalAttachmentPublicationToken,
    );
  } else if (result.calls !== undefined) {
    attachment.commitCalls(result.calls, internalAttachmentPublicationToken);
  }
  return result.changed;
}
