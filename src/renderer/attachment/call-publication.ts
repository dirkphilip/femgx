import type { DrawCall } from "../resources/draw-resources";
import { createInteractionState, type InteractionState } from "../../interaction/interaction";
import { emptyDrawCallLists } from "../runtime-state";
import type { AttachmentCallLists } from "./calls";
import type { HiddenInteractionTuple } from "./interaction";

const attachmentPublicationToken = Symbol("attachment-publication");
export type AttachmentPublicationToken = typeof attachmentPublicationToken;

/**
 * Owns the complete attachment draw-call publication record while retaining
 * the existing semantic list names for renderer consumers.
 */
export abstract class AttachmentPublicationState implements AttachmentCallLists {
  private callLists: AttachmentCallLists = emptyDrawCallLists();
  interactionState = createInteractionState();
  interactionBeforeLastInstanceUpdate: InteractionState | undefined;
  appliedHiddenIds: HiddenInteractionTuple = [undefined, undefined];
  public usesExteriorFaceSubsets = true;

  public get calls(): readonly DrawCall[] {
    return this.callLists.calls;
  }

  public get transparentCalls(): readonly DrawCall[] {
    return this.callLists.transparentCalls;
  }

  public get edgeCalls(): readonly DrawCall[] {
    return this.callLists.edgeCalls;
  }

  public get nodeCalls(): readonly DrawCall[] {
    return this.callLists.nodeCalls;
  }

  public get selectionCalls(): readonly DrawCall[] {
    return this.callLists.selectionCalls;
  }

  public get selectedNodeCalls(): readonly DrawCall[] {
    return this.callLists.selectedNodeCalls;
  }

  /** Publishes one complete attachment-owned call-list record. */
  public commitCalls(calls: AttachmentCallLists, token: AttachmentPublicationToken): void {
    if (token !== attachmentPublicationToken) throw new Error("Invalid attachment commit token");
    this.callLists = calls;
  }

  /** Publishes interaction fields changed by one prepared attachment operation. */
  public commitInteractionState(
    interaction: InteractionState,
    beforeLastInstanceUpdate: InteractionState | undefined,
    token: AttachmentPublicationToken,
    appliedHiddenIds = this.appliedHiddenIds,
    usesExteriorFaceSubsets = this.usesExteriorFaceSubsets,
  ): void {
    if (token !== attachmentPublicationToken) throw new Error("Invalid attachment commit token");
    this.interactionState = interaction;
    this.interactionBeforeLastInstanceUpdate = beforeLastInstanceUpdate;
    this.appliedHiddenIds = appliedHiddenIds;
    this.usesExteriorFaceSubsets = usesExteriorFaceSubsets;
  }

  /** Resets hidden interaction ids through the owned interaction publication. */
  public resetAppliedHiddenIds(token: AttachmentPublicationToken): void {
    this.commitInteractionState(
      this.interactionState,
      this.interactionBeforeLastInstanceUpdate,
      token,
      [undefined, undefined],
    );
  }
}

export const internalAttachmentPublicationToken: AttachmentPublicationToken =
  attachmentPublicationToken;
