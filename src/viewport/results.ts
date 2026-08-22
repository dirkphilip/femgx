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
  transferViewportResultColors,
  type OccurrenceScalarBinding,
} from "./result-colors";
import { validateViewportDeformationCoverage } from "./results/deformation";
import {
  reconcilePartRevisionDeformation,
  reconcilePartRevisionRecords,
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

const orientationRecords = new WeakMap<ViewportResultsState, OrientationRecordMap | undefined>();
const orientationWidths = new WeakMap<ViewportResultsState, number>();
const sharedDeformations = new WeakMap<ViewportResultsState, DeformationState | undefined>();

export { viewportResultColors } from "./result-colors";

/** Returns internal resolved orientation records for the renderer handoff. */
export function viewportOrientationRecords(
  state: ViewportResultsState,
): OrientationRecordMap | undefined {
  return orientationRecords.get(state);
}

/** Returns the widest active authored glyph role for the renderer handoff. */
export function viewportOrientationWidth(state: ViewportResultsState): number {
  return orientationWidths.get(state) ?? 1;
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
): ViewportResultsState {
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
  const state = {
    config,
    scalar,
    deformation,
    orientation,
    loads: resolvedLoads?.config,
  };
  sharedDeformations.set(state, sharedDeformation);
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
  orientationRecords.set(state, mergeResultRecords(sharedRecords, occurrenceRecords.records));
  orientationWidths.set(
    state,
    Math.max(
      orientation?.widthPixels ?? 1,
      resolvedLoads?.config.widthPixels ?? 1,
      occurrenceRecords.widthPixels,
    ),
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
  const shared = reconcileSharedPartRevisionDeformation(
    sharedDeformations.get(partial),
    revisedPartIds,
    (partId) => resolveDeformation(config.deformation, scene, view, undefined, partId),
  );
  const reconciled = {
    ...partial,
    config,
    deformation: reconcilePartRevisionDeformation(
      replacePartRevisionDeformation(partial.deformation, shared, config, revisedPartIds),
      previous.deformation,
      view,
      revisedPartIds,
    ),
  };
  sharedDeformations.set(reconciled, shared);
  reconcileViewportResultColors(partial, previous, view, revisedPartIds);
  transferResultMetadata(partial, reconciled, previous, view, revisedPartIds);
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
          previous === undefined ? undefined : sharedDeformations.get(previous),
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

function transferResultMetadata(
  source: ViewportResultsState,
  target: ViewportResultsState,
  previous: ViewportResultsState,
  view: ResultResolutionView,
  revisedPartIds: ReadonlySet<PartId>,
): void {
  transferViewportResultColors(source, target);
  const records = reconcilePartRevisionRecords(
    orientationRecords.get(source),
    orientationRecords.get(previous),
    view,
    revisedPartIds,
  );
  orientationRecords.set(target, records);
  orientationWidths.set(target, orientationWidths.get(source) ?? 1);
}
