import type { FemViewport, InteractionState, ViewportBackground } from "../../src/index";
import { errorMessage, type WorkbenchModel } from "./model";
import type { DemoView, ViewportSlotId } from "./view";
import type { WorkbenchPresentation } from "./presentation";
import type { WorkbenchViewportSlot, WorkbenchViewportSlots } from "./viewport-slots";
import {
  syncViewportPresentation,
  viewportPresentationChanged,
  type ObservedPaneSize,
} from "./viewport-presentation";
import type { DisplayToggles, ResultDisplayMode } from "./types";
import type { SelectionGranularity } from "./pick";
import type { BoxSelectionStrategy } from "./box-selection-resolver";
import type { SectionAxis } from "./section-controls";
import { applySectionPlane } from "./section-plane-actions";

export interface WorkbenchViewportOwner {
  readonly view: DemoView;
  readonly background: ViewportBackground;
  readonly presentation: WorkbenchPresentation;
  readonly visibilityPanel: { rebuild(): void };
  readonly viewportSlots: WorkbenchViewportSlots;
  readonly rendererState: string;
  readonly model: WorkbenchModel;
  readonly interaction: InteractionState;
  readonly toggles: DisplayToggles;
  readonly continuousEnabled: boolean;
  readonly selectionGranularity: SelectionGranularity;
  readonly boxSelectionStrategy: BoxSelectionStrategy;
  readonly resultMode: ResultDisplayMode;
  readonly sectionAxis: SectionAxis;
  readonly sectionOffset: number;
  readonly observedPaneSizes: Map<ViewportSlotId, ObservedPaneSize>;
  readonly canvas: HTMLCanvasElement;
  resetHoverOwner(): void;
  viewport: FemViewport;
  applyResultMode(render: boolean): void;
  applyCurrentDisplayState(): void;
  render(): void;
  viewports(): readonly FemViewport[];
}

/** Restores shared controller state after replacing its primary viewport. */
export function setControllerViewport(owner: WorkbenchViewportOwner, viewport: FemViewport): void {
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
