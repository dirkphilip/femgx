import {
  setPartOverride,
  type Viewport,
  type InteractionState,
  type ViewportElementFrameConfig,
  type ViewportElementVectorConfig,
  type ViewportResultsConfig,
} from "../../../src/entries/root";
import { partStyleOverride, type WorkbenchModel } from "../models/model";
import type { DisplayToggles, ResultDisplayMode } from "../types";
import type { WorkbenchScalarField } from "../results/result-controls";
import type { WorkbenchResultPlaybackStep } from "../results/result-playback";

interface ResultStateOptions {
  readonly viewport: Viewport;
  readonly model: WorkbenchModel;
  readonly mode: ResultDisplayMode;
  readonly scalar: WorkbenchScalarField | undefined;
  readonly deformationScale: number;
  readonly vector: ViewportElementVectorConfig | ViewportElementFrameConfig | undefined;
  readonly playback: WorkbenchResultPlaybackStep | undefined;
  readonly reflect: () => void;
}

/** Applies the authored result display state to the active viewport only. */
export function applyResultState(options: ResultStateOptions): void {
  const config = options.model.results;
  const roles = resultRoles({
    config,
    mode: options.mode,
    scalarField: options.scalar,
    deformationScale: options.deformationScale,
    vector: options.vector,
    playback: options.playback,
  });
  if (roles === undefined) {
    options.viewport.results.clear();
  } else {
    options.viewport.results.set(roles);
  }
  options.reflect();
}

interface ResultRolesOptions {
  readonly config: WorkbenchModel["results"];
  readonly mode: ResultDisplayMode;
  readonly scalarField: WorkbenchScalarField | undefined;
  readonly deformationScale: number;
  readonly vector: ViewportElementVectorConfig | ViewportElementFrameConfig | undefined;
  readonly playback: WorkbenchResultPlaybackStep | undefined;
}

function resultRoles(options: ResultRolesOptions): ViewportResultsConfig | undefined {
  const { config, mode, scalarField, deformationScale, vector, playback } = options;
  const playbackScalar =
    playback === undefined ? undefined : { field: playback.snapshot.scalar, range: playback.range };
  const playbackDeformation =
    playback === undefined
      ? undefined
      : { field: playback.snapshot.deformation, scale: deformationScale };
  const scalar =
    mode === "base"
      ? undefined
      : (playbackScalar ?? (scalarField === undefined ? config?.scalar : { field: scalarField }));
  const deformationConfig = config?.deformation;
  const deformation =
    mode !== "deformed"
      ? undefined
      : playbackDeformation !== undefined
        ? playbackDeformation
        : deformationConfig === undefined
          ? undefined
          : { field: deformationConfig.field, scale: deformationScale };
  if (scalar === undefined && deformation === undefined && vector === undefined) return undefined;
  return {
    ...(scalar === undefined ? {} : { scalar }),
    ...(deformation === undefined ? {} : { deformation }),
    ...(vector === undefined ? {} : { vectors: vector }),
  };
}

interface DisplayStateOptions {
  readonly viewport: Viewport;
  readonly model: WorkbenchModel;
  readonly toggles: DisplayToggles;
  readonly interaction: InteractionState;
  readonly setInteraction: (interaction: InteractionState) => void;
  readonly applyDisplayedInteraction: () => void;
  readonly reflect: () => void;
}

/** Applies part overrides, highlight state, and the active display controls. */
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
  options.viewport.presentation.setEdgeDepthTest(true);
  options.reflect();
}
