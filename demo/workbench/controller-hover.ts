import {
  setTargetHovered,
  type ElementId,
  type InstanceId,
  type InteractionState,
  type FemViewport,
} from "../../src/index";
import {
  interactionTargetForRow,
  visibilityRowTargetsEqual,
  type VisibilityRowTarget,
} from "./visibility-snapshot";
import type { ViewportSlotId } from "./view";

export type WorkbenchHoverOwner =
  | { readonly kind: "canvas"; readonly slotId: ViewportSlotId }
  | { readonly kind: "hierarchy"; readonly row: VisibilityRowTarget }
  | { readonly kind: "element-detail"; readonly target: ElementDetailHoverTarget };

/** Stable element identity used while the body-scoped detail list owns hover. */
export interface ElementDetailHoverTarget {
  readonly instanceId: InstanceId;
  readonly elementId: ElementId;
}

export interface WorkbenchHoverController {
  disposed: boolean;
  hoverOwner: WorkbenchHoverOwner | undefined;
  interaction: InteractionState;
  readonly viewportSlots: { clearHover(): void };
  readonly render: () => void;
  readonly viewports: () => readonly FemViewport[];
}

/** Commits one hierarchy row as the shared transient hover source. */
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
  owner.interaction = setTargetHovered(owner.interaction, interactionTargetForRow(target));
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
  if (next === owner.interaction) return;
  owner.interaction = next;
  owner.render();
}

/** Commits one detail-list element as the shared transient hover source. */
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
  return left.instanceId === right.instanceId && left.elementId === right.elementId;
}

/** Sends the shared interaction snapshot to each viewport. */
export function applyDisplayedInteraction(owner: WorkbenchHoverController): void {
  for (const viewport of owner.viewports()) viewport.setInteraction(owner.interaction);
}

/** Reports whether a viewport slot still owns transient canvas hover. */
export function canClearCanvasHover(
  owner: WorkbenchHoverController,
  slotId: ViewportSlotId,
): boolean {
  return owner.hoverOwner?.kind === "canvas" && owner.hoverOwner.slotId === slotId;
}

/** Marks a viewport slot as the current transient canvas hover source. */
export function markCanvasHover(owner: WorkbenchHoverController, slotId: ViewportSlotId): void {
  owner.hoverOwner = { kind: "canvas", slotId };
}

/** Clears canvas ownership for a slot without disturbing a newer source. */
export function clearCanvasHover(owner: WorkbenchHoverController, slotId: ViewportSlotId): void {
  if (canClearCanvasHover(owner, slotId)) owner.hoverOwner = undefined;
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
