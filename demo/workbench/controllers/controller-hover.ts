import { type PartOccurrenceId, type Viewport } from "../../../src/entries/root";
import {
  setTargetHovered,
  setTargetsHighlighted,
  type InteractionState,
} from "../../../src/entries/interaction";
import type { ElementId } from "../../../src/entries/model";
import {
  interactionTargetsForRow,
  visibilityRowTargetsEqual,
  type VisibilityRowTarget,
} from "../state/visibility-snapshot";
import type { ViewportSlotId } from "../viewport/view";

export type WorkbenchHoverOwner =
  | { readonly kind: "canvas"; readonly slotId: ViewportSlotId }
  | { readonly kind: "hierarchy"; readonly row: VisibilityRowTarget }
  | { readonly kind: "element-detail"; readonly target: ElementDetailHoverTarget };

/** Stable element identity used while the body-scoped detail list owns hover. */
export interface ElementDetailHoverTarget {
  readonly partOccurrenceId: PartOccurrenceId;
  readonly elementId: ElementId;
}

export interface WorkbenchHoverController {
  disposed: boolean;
  hoverOwner: WorkbenchHoverOwner | undefined;
  readonly hoverOwnerForSlot?: (slotId: ViewportSlotId) => WorkbenchHoverOwner | undefined;
  readonly setHoverOwnerForSlot?: (
    slotId: ViewportSlotId,
    value: WorkbenchHoverOwner | undefined,
  ) => void;
  interaction: InteractionState;
  readonly viewportSlots: { clearHover(): void };
  readonly render: () => void;
  readonly activeViewport?: () => Viewport;
  readonly viewports?: () => readonly Viewport[];
}

/** Commits one hierarchy row as the active viewport's transient hover source. */
export function setHierarchyHover(
  owner: WorkbenchHoverController,
  target: VisibilityRowTarget,
): void {
  if (owner.disposed) return;
  if (
    owner.hoverOwner?.kind === "hierarchy" &&
    visibilityRowTargetsEqual(owner.hoverOwner.row, target)
  ) {
    return;
  }
  owner.viewportSlots.clearHover();
  owner.interaction = setTargetHovered(
    owner.interaction,
    target.kind === "assembly" ? undefined : target,
  );
  owner.hoverOwner = { kind: "hierarchy", row: target };
  owner.render();
}

/** Clears a hierarchy row only while that row still owns transient hover. */
export function clearHierarchyHover(
  owner: WorkbenchHoverController,
  target: VisibilityRowTarget,
): void {
  if (
    owner.disposed ||
    owner.hoverOwner?.kind !== "hierarchy" ||
    !visibilityRowTargetsEqual(owner.hoverOwner.row, target)
  ) {
    return;
  }
  owner.hoverOwner = undefined;
  const next = setTargetHovered(owner.interaction, undefined);
  if (next === owner.interaction) {
    owner.render();
    return;
  }
  owner.interaction = next;
  owner.render();
}

/** Commits one detail-list element as the active viewport's transient hover source. */
export function setElementDetailHover(
  owner: WorkbenchHoverController,
  target: ElementDetailHoverTarget,
): void {
  if (owner.disposed) return;
  if (
    owner.hoverOwner?.kind === "element-detail" &&
    elementDetailTargetsEqual(owner.hoverOwner.target, target)
  ) {
    return;
  }
  owner.viewportSlots.clearHover();
  owner.interaction = setTargetHovered(owner.interaction, { kind: "element", ...target });
  owner.hoverOwner = { kind: "element-detail", target };
  owner.render();
}

/** Clears detail-list hover only while the same element still owns it. */
export function clearElementDetailHover(
  owner: WorkbenchHoverController,
  target: ElementDetailHoverTarget,
): void {
  if (
    owner.disposed ||
    owner.hoverOwner?.kind !== "element-detail" ||
    !elementDetailTargetsEqual(owner.hoverOwner.target, target)
  ) {
    return;
  }
  owner.hoverOwner = undefined;
  const next = setTargetHovered(owner.interaction, undefined);
  if (next === owner.interaction) return;
  owner.interaction = next;
  owner.render();
}

function elementDetailTargetsEqual(
  left: ElementDetailHoverTarget,
  right: ElementDetailHoverTarget,
): boolean {
  return left.partOccurrenceId === right.partOccurrenceId && left.elementId === right.elementId;
}

/** Sends the active interaction snapshot to the active viewport. */
export function applyDisplayedInteraction(owner: WorkbenchHoverController): void {
  const displayed = displayedInteraction(owner);
  activeViewport(owner)?.interaction.set(displayed);
}

function displayedInteraction(owner: WorkbenchHoverController): InteractionState {
  const hoverOwner = owner.hoverOwner;
  if (hoverOwner?.kind !== "hierarchy" || hoverOwner.row.kind !== "assembly") {
    return owner.interaction;
  }
  return setTargetsHighlighted(
    owner.interaction,
    interactionTargetsForRow(activeViewport(owner)?.runtime ?? ownerRuntime(owner), hoverOwner.row),
    true,
  );
}

function activeViewport(owner: WorkbenchHoverController): Viewport | undefined {
  return owner.activeViewport?.() ?? owner.viewports?.()[0];
}

function ownerRuntime(owner: WorkbenchHoverController): Viewport["runtime"] {
  const viewport = activeViewport(owner);
  if (viewport === undefined) throw new Error("Workbench hover has no viewport");
  return viewport.runtime;
}

/** Reports whether a viewport slot still owns transient canvas hover. */
export function canClearCanvasHover(
  owner: WorkbenchHoverController,
  slotId: ViewportSlotId,
): boolean {
  const hoverOwner = owner.hoverOwnerForSlot?.(slotId) ?? owner.hoverOwner;
  return hoverOwner?.kind === "canvas" && hoverOwner.slotId === slotId;
}

/** Marks a viewport slot as the current transient canvas hover source. */
export function markCanvasHover(owner: WorkbenchHoverController, slotId: ViewportSlotId): void {
  if (owner.setHoverOwnerForSlot !== undefined) {
    owner.setHoverOwnerForSlot(slotId, { kind: "canvas", slotId });
  } else {
    owner.hoverOwner = { kind: "canvas", slotId };
  }
}

/** Clears canvas ownership for a slot without disturbing a newer source. */
export function clearCanvasHover(owner: WorkbenchHoverController, slotId: ViewportSlotId): void {
  if (!canClearCanvasHover(owner, slotId)) return;
  if (owner.setHoverOwnerForSlot !== undefined) owner.setHoverOwnerForSlot(slotId, undefined);
  else owner.hoverOwner = undefined;
}

/** Drops source ownership without changing the interaction snapshot. */
export function resetHoverOwner(owner: WorkbenchHoverController): void {
  owner.hoverOwner = undefined;
}

/** Invalidates every pending hover and clears the shared transient target. */
export function clearTransientHover(owner: WorkbenchHoverController): void {
  owner.viewportSlots.clearHover();
  owner.hoverOwner = undefined;
  owner.interaction = setTargetHovered(owner.interaction, undefined);
}
