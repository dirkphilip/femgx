import { setPartOverride, type FemViewport, type InteractionState } from "../../src/index";
import { partStyleOverride, type WorkbenchModel } from "./model";
import type { DisplayToggles, ResultDisplayMode } from "./types";

interface ResultStateOptions {
  readonly viewports: readonly FemViewport[];
  readonly model: WorkbenchModel;
  readonly mode: ResultDisplayMode;
  readonly deformationScale: number;
  readonly reflect: () => void;
}

/** Applies the authored result display state to every active viewport. */
export function applyResultState(options: ResultStateOptions): void {
  const config = options.model.results;
  for (const viewport of options.viewports) {
    if (config === undefined || options.mode === "base") {
      viewport.clearResults();
    } else if (options.mode === "colored") {
      const { deformation: _, ...coloredConfig } = config;
      viewport.setResults(coloredConfig);
    } else {
      const deformation = config.deformation;
      viewport.setResults(
        deformation === undefined
          ? config
          : { ...config, deformation: { ...deformation, scale: options.deformationScale } },
      );
    }
  }
  options.reflect();
}

interface DisplayStateOptions {
  readonly viewports: readonly FemViewport[];
  readonly model: WorkbenchModel;
  readonly toggles: DisplayToggles;
  readonly interaction: InteractionState;
  readonly setInteraction: (interaction: InteractionState) => void;
  readonly applyDisplayedInteraction: () => void;
  readonly reflect: () => void;
}

/** Applies part overrides, highlight state, and the shared display controls. */
export function applyDisplayState(options: DisplayStateOptions): void {
  let state = options.interaction;
  for (const partId of options.model.scene.parts.keys()) {
    state = setPartOverride(
      state,
      partId,
      partStyleOverride(options.model, partId, options.toggles.edges, options.toggles.nodes),
    );
  }
  options.setInteraction(state);
  options.applyDisplayedInteraction();
  for (const viewport of options.viewports) viewport.setEdgeDepthTest(true);
  options.reflect();
}
