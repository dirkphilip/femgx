import { applyDisplayState, applyResultState } from "../state/display-state";
import type { FemViewport } from "../../../src/index";
import type { WorkbenchModel } from "../models/model";
import type { DisplayToggles, ResultDisplayMode } from "../types";
import {
  scalarFieldForModel,
  vectorConfigForDisplay,
  type VectorDisplayState,
} from "../results/result-controls";
import type { WorkbenchPresentation } from "../viewport/presentation";
import type { WorkbenchViewportOwner } from "./controller-viewport";
import type { InteractionState } from "../../../src/index";
import type { WorkbenchResultPlaybackActions } from "../results/result-playback";

interface ControllerDisplayOwner extends WorkbenchViewportOwner {
  readonly viewports: () => readonly FemViewport[];
  readonly model: WorkbenchModel;
  readonly resultMode: ResultDisplayMode;
  readonly deformationScale: number;
  readonly vectorDisplay: VectorDisplayState;
  readonly presentation: WorkbenchPresentation;
  readonly toggles: DisplayToggles;
  interaction: InteractionState;
  applyDisplayedInteraction(): void;
  readonly resultPlaybackActions: Pick<WorkbenchResultPlaybackActions, "currentStep">;
}

/** Applies result presentation state to every active viewport. */
export function applyControllerResultMode(owner: ControllerDisplayOwner, render: boolean): void {
  applyResultState({
    viewports: owner.viewports(),
    model: owner.model,
    mode: owner.resultMode,
    scalar: scalarFieldForModel(owner.model, owner.scalarFieldId),
    deformationScale: owner.deformationScale,
    vector: vectorConfigForDisplay(owner.model, owner.vectorDisplay),
    playback: owner.resultPlaybackActions.currentStep(),
    reflect: owner.presentation.reflectResults.bind(owner.presentation),
  });
  if (render) owner.render();
}

/** Applies visibility and interaction presentation state to every viewport. */
export function applyControllerDisplayState(owner: ControllerDisplayOwner): void {
  applyDisplayState({
    viewports: owner.viewports(),
    model: owner.model,
    toggles: owner.toggles,
    interaction: owner.interaction,
    setInteraction: (interaction) => {
      owner.interaction = interaction;
    },
    applyDisplayedInteraction: () => {
      owner.applyDisplayedInteraction();
    },
    reflect: () => {
      owner.presentation.reflectResults();
    },
  });
}
