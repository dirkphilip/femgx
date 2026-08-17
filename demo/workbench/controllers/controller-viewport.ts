import type { Viewport, InteractionState, ViewportBackground } from "../../../src/entries/root";
import { setProjection } from "../../../src/entries/camera";
import { errorMessage, type WorkbenchModel } from "../models/model";
import type { DemoView, ViewportSlotId } from "../viewport/view";
import type { WorkbenchPresentation } from "../viewport/presentation";
import type { WorkbenchViewportSlot, WorkbenchViewportSlots } from "../viewport/viewport-slots";
import {
  syncViewportPresentation,
  viewportPresentationChanged,
  type ObservedPaneSize,
} from "../viewport/viewport-presentation";
import type { DisplayToggles, ResultDisplayMode } from "../types";
import type { WorkbenchInteraction } from "../interaction/interaction";
import type { SelectionGranularity } from "../selection/pick";
import type { BoxSelectionStrategy } from "../selection/box-selection-resolver";
import type { SectionAxis } from "../section-controls";
import { applyBoxSelectionResolvers } from "./controller-box-selection";
import { applySectionPlane } from "../section-plane-actions";
import type { WorkbenchShowState } from "../state/show-state";

export interface WorkbenchViewportOwner {
  readonly disposed: boolean;
  readonly view: DemoView;
  background: ViewportBackground;
  readonly presentation: WorkbenchPresentation;
  readonly visibilityPanel: { rebuild(): void };
  readonly viewportSlots: WorkbenchViewportSlots;
  readonly activeViewport: () => Viewport;
  readonly showState: (slotId: ViewportSlotId) => WorkbenchShowState;
  readonly rendererState: string;
  readonly model: WorkbenchModel;
  readonly interaction: InteractionState;
  toggles: DisplayToggles;
  continuousEnabled: boolean;
  readonly selectionGranularity: SelectionGranularity;
  readonly boxSelectionStrategy: BoxSelectionStrategy;
  readonly resultMode: ResultDisplayMode;
  readonly scalarFieldId: string;
  readonly sectionAxis: SectionAxis;
  readonly sectionOffset: number;
  readonly observedPaneSizes: Map<ViewportSlotId, ObservedPaneSize>;
  readonly canvas: HTMLCanvasElement;
  resetHoverOwner(): void;
  viewport: Viewport;
  applyResultMode(render: boolean): void;
  applyCurrentDisplayState(): void;
  render(): void;
  viewports(): readonly Viewport[];
}

/** Returns the currently active viewport for controller-owned slot state. */
export function activeViewportForOwner(
  owner: Pick<WorkbenchViewportOwner, "viewportSlots">,
): Viewport {
  return owner.viewportSlots.activeViewport();
}

/** Changes the active viewport slot through the controller-owned slot graph. */
export function setActiveSlotForOwner(
  owner: Pick<WorkbenchViewportOwner, "viewportSlots">,
  slotId: ViewportSlotId,
): void {
  owner.viewportSlots.setActiveSlot(slotId);
}

/** Toggles projection for the active camera and refits its viewport. */
export function setProjectionForOwner(owner: { activeViewport(): Viewport; render(): void }): void {
  const viewport = owner.activeViewport();
  viewport.setCamera(
    setProjection(
      viewport.camera,
      viewport.camera.mode === "perspective" ? "orthographic" : "perspective",
    ),
  );
  viewport.fitView();
  owner.render();
}

/** Fits only the active viewport to its current visible selection. */
export function fitSelectionForOwner(owner: { activeViewport(): Viewport; render(): void }): void {
  owner.activeViewport().fitSelection();
  owner.render();
}

/** Records pane-local camera gesture ownership for render-loop and focus policy. */
export function setCameraGestureActiveForOwner(
  owner: Pick<WorkbenchViewportOwner, "viewportSlots">,
  slotId: ViewportSlotId,
  active: boolean,
): void {
  owner.viewportSlots.setCameraGestureActive(slotId, active);
}

/** Routes selected-element hiding through the active viewport's visibility owner. */
export function hideSelectedForOwner(owner: { visibilityActions: { hideSelected(): void } }): void {
  owner.visibilityActions.hideSelected();
}

/** Restores visibility only in the active viewport. */
export function showAllForOwner(owner: { visibilityActions: { showAll(): void } }): void {
  owner.visibilityActions.showAll();
}

/** Invalidates pointer interaction across the viewport slot graph. */
export function invalidateInteractionForOwner(
  owner: Pick<WorkbenchViewportOwner, "viewportSlots">,
): void {
  owner.viewportSlots.invalidateInteraction();
}

/** Detaches the primary viewport from the slot graph. */
export function detachViewportForOwner(owner: Pick<WorkbenchViewportOwner, "viewportSlots">): void {
  owner.viewportSlots.detachPrimary();
}

/** Reports whether a viewport slot currently owns a pointer gesture. */
export function isPointerGestureActiveForOwner(
  owner: Pick<WorkbenchViewportOwner, "viewportSlots">,
): boolean {
  return owner.viewportSlots.isPointerGestureActive();
}

/** Returns interaction statistics from the controller-owned interaction adapter. */
export function boxSelectionStatsForOwner(owner: {
  readonly interactionController: WorkbenchInteraction;
}): ReturnType<WorkbenchInteraction["getBoxSelectionStats"]> {
  return owner.interactionController.getBoxSelectionStats();
}

/** Toggles the secondary viewport and refreshes its selection resolvers. */
export async function toggleSecondaryViewportForOwner(
  owner: WorkbenchViewportOwner,
): Promise<void> {
  await owner.viewportSlots.toggleSecondaryViewport();
  applyBoxSelectionResolvers(owner);
}

interface WorkbenchPresentationOwner {
  readonly disposed: boolean;
  applyDisplayedInteraction(): void;
  syncViewportPresentation(): void;
  publishSnapshot(): void;
}

/** Restores active-slot presentation after a pane receives focus. */
export function activeSlotChangedForController(
  owner: WorkbenchPresentationOwner & {
    readonly menu: { hide(): void };
    readonly visibilityPanel: { rebuild(): void };
    readonly presentation: WorkbenchPresentation;
    readonly applyActiveState: () => void;
  },
  slotId: ViewportSlotId,
  setActiveSlotId: (slotId: ViewportSlotId) => void,
): void {
  setActiveSlotId(slotId);
  owner.menu.hide();
  owner.applyActiveState();
  owner.visibilityPanel.rebuild();
  owner.presentation.reflectResults();
  activeSlotChangedForOwner(owner);
}

/** Renders the current controller state through the presentation adapters. */
export function renderForOwner(owner: WorkbenchPresentationOwner): void {
  if (owner.disposed) return;
  owner.applyDisplayedInteraction();
  owner.syncViewportPresentation();
  owner.publishSnapshot();
}

/** Publishes the current controller snapshot. */
export function publishSnapshotForOwner(owner: {
  readonly snapshotBridge: { publish(): void };
}): void {
  owner.snapshotBridge.publish();
}

/** Publishes state after the active viewport slot changes. */
export function activeSlotChangedForOwner(owner: WorkbenchPresentationOwner): void {
  owner.syncViewportPresentation();
  owner.publishSnapshot();
}

/** Restores shared controller state after replacing its primary viewport. */
export function setControllerViewport(owner: WorkbenchViewportOwner, viewport: Viewport): void {
  owner.viewportSlots.invalidateInteraction();
  owner.viewport = viewport;
  owner.viewportSlots.setPrimaryViewport(viewport);
  try {
    viewport.setBackground(owner.background);
  } catch (error) {
    owner.presentation.setFeedback(
      `Background could not be restored: ${errorMessage(error)}`,
      "error",
    );
  }
  owner.resetHoverOwner();
  owner.applyResultMode(false);
  owner.applyCurrentDisplayState();
  applySectionPlane(owner, false);
  owner.visibilityPanel.rebuild();
  owner.render();
}

/** Synchronizes the plain TypeScript presentation adapter from the active slot. */
export function syncControllerViewportPresentation(owner: WorkbenchViewportOwner): void {
  if (owner.disposed) return;
  syncViewportPresentation({
    activeSlot: owner.viewportSlots.activeSlot(),
    slots: owner.viewportSlots.all(),
    presentation: owner.presentation,
    rendererState: owner.rendererState,
    model: owner.model,
    interaction: owner.interaction,
    toggles: owner.toggles,
    continuous: owner.continuousEnabled,
    selectionGranularity: owner.selectionGranularity,
    boxSelectionStrategy: owner.boxSelectionStrategy,
    resultMode: owner.resultMode,
    sectionAxis: owner.sectionAxis,
    sectionOffset: owner.sectionOffset,
    background: owner.background,
    showState: owner.showState.bind(owner),
  });
}

/** Resets a slot's loop when its pane geometry or device pixel ratio changes. */
export function resetViewportRenderLoop(
  slot: WorkbenchViewportSlot,
  timestamp: number,
  observed: Map<ViewportSlotId, ObservedPaneSize>,
): void {
  if (viewportPresentationChanged(slot, observed)) slot.renderLoop.reset(timestamp);
}
