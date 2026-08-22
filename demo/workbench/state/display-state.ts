import {
  type Viewport,
  type ViewportElementFrameConfig,
  type ViewportElementVectorConfig,
  type PartId,
  type ViewportResultsConfig,
} from "@/entries/root";
import { setPartOverrides, type InteractionState } from "@/entries/interaction";
import { modelPartStyleOverrides, type WorkbenchModel } from "../models/model";
import type { DisplayToggles, ResultDisplayMode } from "../types";
import type { WorkbenchScalarField } from "../results/result-controls";
import type { WorkbenchResultPlaybackStep } from "../results/result-playback";

interface ResultStateOptions {
  readonly viewport: Viewport;
  readonly model: WorkbenchModel;
  readonly mode: ResultDisplayMode;
  readonly scalar: WorkbenchScalarField | undefined;
  readonly scalarPartId: PartId | undefined;
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
    scalarPartId: options.scalarPartId,
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
  readonly scalarPartId: PartId | undefined;
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
      : (playbackScalar ??
        (scalarField === undefined
          ? config?.scalar
          : {
              field: scalarField,
              ...(options.scalarPartId === undefined ? {} : { partId: options.scalarPartId }),
            }));
  const deformationConfig = config?.deformation;
  const loads = config?.loads;
  const deformation =
    mode !== "deformed"
      ? undefined
      : playbackDeformation !== undefined
        ? playbackDeformation
        : deformationConfig === undefined
          ? undefined
          : { field: deformationConfig.field, scale: deformationScale };
  if (scalar !== undefined)
    return {
      scalar,
      ...(deformation === undefined ? {} : { deformation }),
      ...(vector === undefined ? {} : { orientation: vector }),
      ...(loads === undefined ? {} : { loads }),
    };
  if (deformation !== undefined)
    return {
      deformation,
      ...(vector === undefined ? {} : { orientation: vector }),
      ...(loads === undefined ? {} : { loads }),
    };
  if (vector !== undefined)
    return { orientation: vector, ...(loads === undefined ? {} : { loads }) };
  if (loads !== undefined) return { loads };
  return undefined;
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
  const state = setPartOverrides(
    options.interaction,
    modelPartStyleOverrides(options.model, false, false),
  );
  options.setInteraction(state);
  options.applyDisplayedInteraction();
  options.viewport.presentation.setEdgeDepthTest(true);
  options.viewport.presentation.setEdgesVisible(options.toggles.edges);
  options.viewport.presentation.setNodesVisible(options.toggles.nodes);
  options.reflect();
}
