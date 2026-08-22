import { createNodalDisplacementBuffer, type DeformationState } from "../results/deform";
import type { Scene } from "../scene/scene";
import type { PartId } from "../geometry/part";
import type { PartOccurrenceId } from "../scene/types";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import {
  resolveLoads,
  resolveOrientation,
  validateResultsConfig,
  type OrientationRecordMap,
} from "./results-roles";
import {
  mergedNodePickIds,
  reconcileViewportResultColors,
  resolveViewportResultColors,
  type OccurrenceScalarBinding,
} from "./result-colors";
import { validateViewportDeformationCoverage } from "./results/deformation";
import {
  reconcilePartRevisionDeformation,
  reconcilePartRevisionRecords,
  reconcileRenderedParts,
  reconcileSharedPartRevisionDeformation,
  replacePartRevisionDeformation,
  reusablePartDeformation,
} from "./results/revision";
import { mergeResultRecords } from "./result-records";
import {
  createPartRevisionResultResolutionView,
  createResultResolutionView,
  type ResultResolutionView,
} from "./results/resolution-view";
import { scopedPartRevisionConfig } from "./results/revision-scope";
import { resolveScalar } from "./results/scalar-resolution";
import {
  createResolvedViewportResults,
  resolvedViewportResultData,
  type ResolvedViewportResults,
} from "./results/resolved-owner";
import type {
  ViewportDeformationConfig,
  ViewportResultsConfig,
  ViewportResultsState,
  ViewportOccurrenceResultsConfig,
} from "./results-types";

export type {
  ViewportDeformationConfig,
  ViewportElementFrameConfig,
  ViewportElementVectorConfig,
  ViewportOrientationState,
  ViewportOccurrenceElementVectorConfig,
  ViewportOccurrenceResultsConfig,
  ViewportOccurrenceScalarConfig,
  ViewportLoadConfig,
  ViewportResultField,
  ViewportResultsConfig,
  ViewportResultsState,
  ViewportScalarConfig,
  ViewportScalarState,
} from "./results-types";

export { viewportResultColors } from "./result-colors";

/** Returns internal resolved orientation records for the renderer handoff. */
export function viewportOrientationRecords(
  state: ViewportResultsState,
): OrientationRecordMap | undefined {
  return resolvedViewportResultData(state)?.orientationRecords;
}

/** Returns the widest active authored glyph role for the renderer handoff. */
export function viewportOrientationWidth(state: ViewportResultsState): number {
  return resolvedViewportResultData(state)?.orientationWidth ?? 1;
}

/** Resolves a viewport result configuration against one scene/runtime pair. */
export function resolveViewportResults(
  config: ViewportResultsConfig,
  scene: Scene,
  runtime: PackedSceneRuntime,
  previous?: ViewportResultsState,
): ViewportResultsState {
  return resolveViewportResultsWithView(
    config,
    scene,
    createResultResolutionView(runtime),
    previous,
  );
}

function resolveViewportResultsWithView(
  config: ViewportResultsConfig,
  scene: Scene,
  view: ResultResolutionView,
  previous?: ViewportResultsState,
): ResolvedViewportResults {
  validateResultsConfig(config);
  const scalar = resolveScalar(config.scalar, scene, view, previous);
  const occurrenceTargets = resolveOccurrenceTargets(config.occurrences ?? [], view);
  const occurrenceScalars = resolveOccurrenceScalars(occurrenceTargets, scene, view);
  const sharedDeformation = resolveDeformation(config.deformation, scene, view, previous);
  const occurrenceDeformations = resolveOccurrenceDeformations(occurrenceTargets, scene, view);
  const deformation = mergeOccurrenceDeformations(sharedDeformation, occurrenceDeformations);
  const resolvedOrientation = resolveOrientation(config.orientation, scene, view, deformation);
  const resolvedLoads = resolveLoads(config.loads, scene, view, deformation);
  const orientation = resolvedOrientation?.state;
  const state = createResolvedViewportResults(
    {
      config,
      scalar,
      deformation,
      orientation,
      loads: resolvedLoads?.config,
    },
    {
      colors: undefined,
      renderedParts: undefined,
      sharedDeformation,
      orientationRecords: undefined,
      orientationWidth: 1,
    },
  );
  resolveViewportResultColors(state, scalar, scene, view, {
    previous,
    occurrences: occurrenceScalars,
  });
  const sharedRecords = mergeResultRecords(resolvedOrientation?.records, resolvedLoads?.records);
  const occurrenceRecords = resolveOccurrenceRecords(
    occurrenceTargets,
    config,
    scene,
    view,
    deformation,
  );
  const data = resolvedViewportResultData(state);
  if (data === undefined) throw new Error("Resolved result owner is missing renderer data");
  data.orientationRecords = mergeResultRecords(sharedRecords, occurrenceRecords.records);
  data.orientationWidth = Math.max(
    orientation?.widthPixels ?? 1,
    resolvedLoads?.config.widthPixels ?? 1,
    occurrenceRecords.widthPixels,
  );
  return state;
}

/** Resolves a retained snapshot while retaining untouched renderer-table identities. */
export function resolveViewportPartRevisionResults(
  config: ViewportResultsConfig,
  scene: Scene,
  runtime: PackedSceneRuntime,
  previous: ViewportResultsState,
  revisedPartIds: ReadonlySet<PartId>,
): ViewportResultsState {
  if (previous.config !== config) return resolveViewportResults(config, scene, runtime, previous);
  const view = createResultResolutionView(runtime);
  const revisedView = createPartRevisionResultResolutionView(view, revisedPartIds);
  const scoped = scopedPartRevisionConfig(config, view, revisedPartIds);
  if (scoped === undefined) return previous;
  const partial = resolveViewportResultsWithView(scoped, scene, revisedView, undefined);
  const partialData = resolvedViewportResultData(partial);
  if (partialData === undefined) throw new Error("Resolved result owner is missing renderer data");
  const previousData = resolvedViewportResultData(previous);
  const shared = reconcileSharedPartRevisionDeformation(
    partialData.sharedDeformation,
    revisedPartIds,
    (partId) => resolveDeformation(config.deformation, scene, view, undefined, partId),
  );
  const reconciled = createResolvedViewportResults(
    {
      config,
      scalar: partial.scalar,
      deformation: reconcilePartRevisionDeformation(
        replacePartRevisionDeformation(partial.deformation, shared, config, revisedPartIds),
        previous.deformation,
        view,
        revisedPartIds,
      ),
      orientation: partial.orientation,
      loads: partial.loads,
    },
    {
      ...partialData,
      sharedDeformation: shared,
      renderedParts: reconcileRenderedParts(
        previousData?.renderedParts,
        partialData.renderedParts,
        revisedPartIds,
      ),
    },
  );
  reconcileViewportResultColors(reconciled, previous, view, revisedPartIds);
  const reconciledData = resolvedViewportResultData(reconciled);
  if (reconciledData === undefined)
    throw new Error("Resolved result owner is missing renderer data");
  reconciledData.orientationRecords = reconcilePartRevisionRecords(
    partialData.orientationRecords,
    previousData?.orientationRecords,
    view,
    revisedPartIds,
  );
  reconciledData.orientationWidth = Math.max(
    partialData.orientationWidth,
    previousData?.orientationWidth ?? 1,
  );
  return reconciled;
}

interface OccurrenceTarget {
  readonly config: ViewportOccurrenceResultsConfig;
  readonly partOccurrenceId: PartOccurrenceId;
  readonly partId: PartId;
}

interface OccurrenceDeformation {
  readonly target: OccurrenceTarget;
  readonly state: DeformationState;
}

function resolveOccurrenceTargets(
  configs: readonly ViewportOccurrenceResultsConfig[],
  view: ResultResolutionView,
): readonly OccurrenceTarget[] {
  return configs.map((config) => {
    const partId = view.partIdForOccurrence(config.partOccurrenceId);
    if (partId === undefined) {
      throw new Error(
        `Viewport result occurrence ${config.partOccurrenceId} is not rendered by the current runtime`,
      );
    }
    validateOccurrencePartOwnership(config, partId);
    return { config, partOccurrenceId: config.partOccurrenceId, partId };
  });
}

function validateOccurrencePartOwnership(
  config: ViewportOccurrenceResultsConfig,
  partId: PartId,
): void {
  if (config.orientation?.glyph === "triad" && config.orientation.field.partId !== partId) {
    throw new Error(
      `Viewport occurrence ${config.partOccurrenceId} uses frame data for part ${config.orientation.field.partId}, expected part ${partId}`,
    );
  }
  if (config.loads !== undefined && config.loads.field.partId !== partId) {
    throw new Error(
      `Viewport occurrence ${config.partOccurrenceId} uses load data for part ${config.loads.field.partId}, expected part ${partId}`,
    );
  }
}

function resolveOccurrenceScalars(
  targets: readonly OccurrenceTarget[],
  scene: Scene,
  view: ResultResolutionView,
): readonly OccurrenceScalarBinding[] {
  return targets.flatMap((target) => {
    const config = target.config.scalar;
    if (config === undefined) return [];
    const scalar = resolveScalar({ ...config, partId: target.partId }, scene, view, undefined);
    return scalar === undefined ? [] : [{ ...target, scalar }];
  });
}

function resolveOccurrenceDeformations(
  targets: readonly OccurrenceTarget[],
  scene: Scene,
  view: ResultResolutionView,
): readonly OccurrenceDeformation[] {
  return targets.flatMap((target) => {
    const config = target.config.deformation;
    if (config === undefined) return [];
    const state = resolveDeformation(config, scene, view, undefined, target.partId);
    return state === undefined ? [] : [{ target, state }];
  });
}

function mergeOccurrenceDeformations(
  shared: DeformationState | undefined,
  occurrences: readonly OccurrenceDeformation[],
): DeformationState | undefined {
  if (occurrences.length === 0) return shared;
  const displacements = new Map(shared?.displacements);
  for (const [partId, values] of shared?.displacements ?? []) {
    displacements.set(partId, scaledValues(values, shared?.scale ?? 1));
  }
  for (const occurrence of occurrences) {
    const values = occurrence.state.displacements.get(occurrence.target.partId);
    if (values !== undefined) {
      displacements.set(
        occurrence.target.partOccurrenceId,
        scaledValues(values, occurrence.state.scale),
      );
    }
  }
  return { scale: 1, displacements };
}

function resolveOccurrenceRecords(
  targets: readonly OccurrenceTarget[],
  config: ViewportResultsConfig,
  scene: Scene,
  view: ResultResolutionView,
  deformation: DeformationState | undefined,
): { readonly records: OrientationRecordMap | undefined; readonly widthPixels: number } {
  let records: OrientationRecordMap | undefined;
  let widthPixels = 1;
  for (const target of targets) {
    const requiresOccurrenceRecords =
      target.config.orientation !== undefined ||
      target.config.loads !== undefined ||
      (target.config.deformation !== undefined &&
        (config.orientation !== undefined || config.loads !== undefined));
    if (!requiresOccurrenceRecords) continue;
    const binding = { partId: target.partId, bindingId: target.partOccurrenceId };
    const orientation = resolveOrientation(
      target.config.orientation ?? config.orientation,
      scene,
      view,
      deformation,
      binding,
    );
    const loads = resolveLoads(
      target.config.loads ?? config.loads,
      scene,
      view,
      deformation,
      binding,
    );
    records = mergeResultRecords(records, mergeResultRecords(orientation?.records, loads?.records));
    widthPixels = Math.max(
      widthPixels,
      orientation?.state.widthPixels ?? 1,
      loads?.config.widthPixels ?? 1,
    );
  }
  return { records, widthPixels };
}

function scaledValues(values: Float32Array, scale: number): Float32Array {
  if (scale === 1) return values;
  return Float32Array.from(values, (value) => value * scale);
}

function resolveDeformation(
  config: ViewportDeformationConfig | undefined,
  scene: Scene,
  view: ResultResolutionView,
  previous: ViewportResultsState | undefined,
  targetPartId?: PartId,
): DeformationState | undefined {
  if (config === undefined) return undefined;
  const scale = config.scale ?? 1;
  if (!Number.isFinite(scale)) {
    throw new Error(`Viewport deformation scale must be finite, got ${scale}`);
  }
  validateViewportDeformationCoverage(config, scene, view, targetPartId);
  const reusable =
    targetPartId === undefined
      ? reusablePartDeformation(
          previous,
          previous === undefined
            ? undefined
            : resolvedViewportResultData(previous)?.sharedDeformation,
          config,
        )
      : undefined;
  if (reusable !== undefined) return { scale, displacements: reusable };
  const displacements = new Map<PartId, Float32Array>();
  for (const partId of targetPartId === undefined ? view.renderedPartIds : [targetPartId]) {
    const part = scene.parts.get(partId);
    if (part === undefined) continue;
    const nodePickIds = mergedNodePickIds(part);
    if (nodePickIds === undefined) {
      throw new Error(
        `Viewport deformation field ${config.field.id} cannot drive part ${part.id}: geometry has no nodePickIds`,
      );
    }
    let maxNodeId = -1;
    for (const pickId of nodePickIds) {
      if (pickId === 0) continue;
      const nodeId = pickId - 1;
      if (nodeId >= config.field.count) {
        throw new Error(
          `Viewport deformation field ${config.field.id} (count ${config.field.count}) has no value for node ${nodeId} in part ${part.id}`,
        );
      }
      maxNodeId = Math.max(maxNodeId, nodeId);
    }
    displacements.set(part.id, createNodalDisplacementBuffer(maxNodeId + 1, config.field));
  }
  return { scale, displacements };
}
