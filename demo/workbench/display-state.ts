import {
  setPartOverride,
  type FemViewport,
  type InteractionState,
  type ViewportElementVectorConfig,
  type ViewportResultsConfig,
} from "../../src/index";
import { partStyleOverride, type WorkbenchModel } from "./model";
import type { DisplayToggles, ResultDisplayMode } from "./types";

interface ResultStateOptions {
  readonly viewports: readonly FemViewport[];
  readonly model: WorkbenchModel;
  readonly mode: ResultDisplayMode;
  readonly deformationScale: number;
  readonly vector: ViewportElementVectorConfig | undefined;
  readonly reflect: () => void;
}

/** Applies the authored result display state to every active viewport. */
export function applyResultState(options: ResultStateOptions): void {
  const config = options.model.results;
  for (const viewport of options.viewports) {
    const roles = resultRoles(config, options.mode, options.deformationScale, options.vector);
    if (roles === undefined) {
      viewport.clearResults();
    } else {
      viewport.setResults(roles);
    }
  }
  options.reflect();
}

function resultRoles(
  config: WorkbenchModel["results"],
  mode: ResultDisplayMode,
  deformationScale: number,
  vector: ViewportElementVectorConfig | undefined,
): ViewportResultsConfig | undefined {
  const scalar = mode === "base" ? undefined : config?.scalar;
  const deformation =
    mode !== "deformed" || config?.deformation === undefined
      ? undefined
      : { ...config.deformation, scale: deformationScale };
  if (scalar === undefined && deformation === undefined && vector === undefined) return undefined;
  return {
    ...(scalar === undefined ? {} : { scalar }),
    ...(deformation === undefined ? {} : { deformation }),
    ...(vector === undefined ? {} : { vectors: vector }),
  };
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
