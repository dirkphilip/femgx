import { applyDisplayState, applyResultState } from "../state/display-state";
import type { FemViewport } from "../../../src/entries/root";
import { errorMessage, type WorkbenchModel } from "../models/model";
import type { ResultDisplayMode } from "../types";
import {
  scalarFieldForModel,
  vectorConfigForDisplay,
  type VectorDisplayState,
} from "../results/result-controls";
import type { WorkbenchPresentation } from "../viewport/presentation";
import type { WorkbenchViewportOwner } from "./controller-viewport";
import type { InteractionState } from "../../../src/entries/root";
import { resultPlaybackStepForState } from "../results/result-playback";
import type { ViewportSlotId } from "../viewport/view";
import type { WorkbenchViewportSlot } from "../viewport/viewport-slots";
import { parseViewportBackground } from "../state/workbench-values";
import { applySectionPlane } from "../section-plane-actions";
import { sectionPlaneFor } from "../section-controls";

interface ControllerDisplayOwner extends WorkbenchViewportOwner {
  readonly activeViewport: () => FemViewport;
  readonly activeSlot: () => WorkbenchViewportSlot;
  readonly syncViewportPresentation: () => void;
  readonly publishSnapshot: () => void;
  readonly model: WorkbenchModel;
  readonly resultMode: ResultDisplayMode;
  readonly deformationScale: number;
  readonly vectorDisplay: VectorDisplayState;
  readonly presentation: WorkbenchPresentation;
  interaction: InteractionState;
  applyDisplayedInteraction(): void;
}

/** Applies result presentation state to the active viewport. */
export function applyControllerResultMode(owner: ControllerDisplayOwner, render: boolean): void {
  applyControllerResultModeForSlot(owner, owner.viewportSlots.activeSlot().id, render);
}

/** Applies one slot's authored result state without mutating another slot. */
export function applyControllerResultModeForSlot(
  owner: ControllerDisplayOwner,
  slotId: ViewportSlotId,
  render: boolean,
): void {
  const state = owner.showState(slotId);
  const slot = owner.viewportSlots.get(slotId);
  if (slot === undefined) return;
  applyResultState({
    viewport: slot.viewport,
    model: owner.model,
    mode: state.resultMode,
    scalar: scalarFieldForModel(owner.model, state.scalarFieldId),
    deformationScale: state.deformationScale,
    vector: vectorConfigForDisplay(owner.model, state.vectorDisplay),
    playback: resultPlaybackStepForState(owner.model, state),
    reflect:
      slotId === owner.viewportSlots.activeSlot().id
        ? owner.presentation.reflectResults.bind(owner.presentation)
        : () => undefined,
  });
  if (render) owner.render();
}

/** Applies visibility and interaction presentation state to the active viewport. */
export function applyControllerDisplayState(owner: ControllerDisplayOwner): void {
  applyControllerDisplayStateForSlot(owner, owner.viewportSlots.activeSlot().id);
}

/** Applies one slot's visibility/style state without broadcasting it. */
export function applyControllerDisplayStateForSlot(
  owner: ControllerDisplayOwner,
  slotId: ViewportSlotId,
): void {
  const state = owner.showState(slotId);
  const slot = owner.viewportSlots.get(slotId);
  if (slot === undefined) return;
  applyDisplayState({
    viewport: slot.viewport,
    model: owner.model,
    toggles: state.toggles,
    interaction: state.interaction,
    setInteraction: (interaction) => {
      state.interaction = interaction;
    },
    applyDisplayedInteraction: () => {
      if (slotId === owner.viewportSlots.activeSlot().id) owner.applyDisplayedInteraction();
      else slot.viewport.setInteraction(state.interaction);
    },
    reflect: () => {
      if (slotId === owner.viewportSlots.activeSlot().id) owner.presentation.reflectResults();
    },
  });
}

/** Changes continuous rendering for the active slot only. */
export function setContinuousForOwner(
  owner: ControllerDisplayOwner,
  enabled = !owner.continuousEnabled,
): void {
  if (owner.continuousEnabled === enabled) return;
  owner.continuousEnabled = enabled;
  owner.viewportSlots.setContinuous(
    owner.viewportSlots.activeSlot().id,
    enabled,
    performance.now(),
  );
  owner.syncViewportPresentation();
  owner.publishSnapshot();
}

/** Changes the active slot's background after the public viewport setter succeeds. */
export function setBackgroundForOwner(owner: ControllerDisplayOwner, value: string): void {
  const background = parseViewportBackground(value);
  if (background === undefined) return;
  try {
    owner.activeViewport().setBackground(background);
  } catch (error) {
    owner.presentation.setFeedback(
      `Background could not be changed: ${errorMessage(error)}`,
      "error",
    );
    return;
  }
  owner.background = background;
  owner.render();
}

/** Toggles diagnostics in the active slot's toolbar state. */
export function setDiagnosticsForOwner(owner: ControllerDisplayOwner): void {
  owner.toggles.diagnostics = !owner.toggles.diagnostics;
  owner.syncViewportPresentation();
  owner.publishSnapshot();
}

/** Applies the active slot's complete show state after focus or slot creation. */
export function applyActiveStateForOwner(owner: ControllerDisplayOwner): void {
  owner.applyResultMode(false);
  owner.applyCurrentDisplayState();
  applySectionPlane(owner, false);
  owner.activeSlot().viewport.setBackground(owner.background);
  owner.activeSlot().renderLoop.setEnabled(owner.continuousEnabled, performance.now());
}

/** Applies one slot's complete show state during model replacement. */
export function applyStateForOwner(owner: ControllerDisplayOwner, slotId: ViewportSlotId): void {
  const slot = owner.viewportSlots.get(slotId);
  if (slot === undefined) return;
  const state = owner.showState(slotId);
  applyControllerResultModeForSlot(owner, slotId, false);
  applyControllerDisplayStateForSlot(owner, slotId);
  const plane = sectionPlaneFor(state.sectionAxis, state.sectionOffset);
  if (plane === undefined) slot.viewport.clearSectionPlane();
  else slot.viewport.setSectionPlane(plane);
  slot.viewport.setBackground(state.background);
  slot.renderLoop.setEnabled(state.continuousEnabled, performance.now());
}
