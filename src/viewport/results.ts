import { nodalDisplacements, type DeformationState } from "../results/deform";
import { createScalarColorMap, type ScalarColorMap } from "../results/mapping";
import { scalarRange, type ValueRange } from "../results/range";
import type { Scene } from "../scene/scene";
import type { PartId } from "../geometry/part";
import type { PartOccurrenceId } from "../scene/types";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import {
  renderedPartIds,
  resolveLoads,
  resolveOrientation,
  validateResultsConfig,
  type OrientationRecordMap,
} from "./results-roles";
import {
  mergedNodePickIds,
  resolveViewportResultColors,
  sameFieldSource,
  validateResultCoverage,
  type OccurrenceScalarBinding,
} from "./result-colors";
import { mergeResultRecords } from "./result-records";
import type {
  ViewportDeformationConfig,
  ViewportResultField,
  ViewportResultsConfig,
  ViewportResultsState,
  ViewportScalarConfig,
  ViewportScalarState,
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
  validateResultsConfig(config);
  const scalar = resolveScalar(config.scalar, scene, runtime, previous);
  const occurrenceTargets = resolveOccurrenceTargets(config.occurrences ?? [], runtime);
  const occurrenceScalars = resolveOccurrenceScalars(occurrenceTargets, scene, runtime);
  const sharedDeformation = resolveDeformation(config.deformation, scene, runtime, previous);
  const occurrenceDeformations = resolveOccurrenceDeformations(occurrenceTargets, scene, runtime);
  const deformation = mergeOccurrenceDeformations(sharedDeformation, occurrenceDeformations);
  const resolvedOrientation = resolveOrientation(config.orientation, scene, runtime, deformation);
  const resolvedLoads = resolveLoads(config.loads, scene, runtime, deformation);
  const orientation = resolvedOrientation?.state;
  const state = {
    config,
    scalar,
    deformation,
    orientation,
    loads: resolvedLoads?.config,
  };
  sharedDeformations.set(state, sharedDeformation);
  resolveViewportResultColors(state, scalar, scene, runtime, {
    previous,
    occurrences: occurrenceScalars,
  });
  const sharedRecords = mergeResultRecords(resolvedOrientation?.records, resolvedLoads?.records);
  const occurrenceRecords = resolveOccurrenceRecords(
    occurrenceTargets,
    config,
    scene,
    runtime,
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
  runtime: PackedSceneRuntime,
): readonly OccurrenceTarget[] {
  return configs.map((config) => {
    const slot = runtime.getInstanceSlot(config.partOccurrenceId);
    const partId = slot === undefined ? undefined : runtime.getPartId(slot);
    if (slot === undefined || partId === undefined) {
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
  runtime: PackedSceneRuntime,
): readonly OccurrenceScalarBinding[] {
  return targets.flatMap((target) => {
    const config = target.config.scalar;
    if (config === undefined) return [];
    const scalar = resolveScalar({ ...config, partId: target.partId }, scene, runtime, undefined);
    return scalar === undefined ? [] : [{ ...target, scalar }];
  });
}

function resolveOccurrenceDeformations(
  targets: readonly OccurrenceTarget[],
  scene: Scene,
  runtime: PackedSceneRuntime,
): readonly OccurrenceDeformation[] {
  return targets.flatMap((target) => {
    const config = target.config.deformation;
    if (config === undefined) return [];
    const state = resolveDeformation(config, scene, runtime, undefined, target.partId);
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
  runtime: PackedSceneRuntime,
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
      runtime,
      deformation,
      binding,
    );
    const loads = resolveLoads(
      target.config.loads ?? config.loads,
      scene,
      runtime,
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

function resolveScalar(
  config: ViewportScalarConfig | undefined,
  scene: Scene,
  runtime: PackedSceneRuntime,
  previous: ViewportResultsState | undefined,
): ViewportScalarState | undefined {
  if (config === undefined) return undefined;
  const field = config.field;
  const range = resolveRange(field, config.range, config.colorMap);
  const colorMap = resolveColorMap(config, field, range, previous);
  validateMapRange(range, colorMap);
  validateResultCoverage(field, scene, runtime, config.partId);
  return { config, field, range, colorMap };
}

function resolveRange(
  field: ViewportResultField,
  requested: ValueRange | undefined,
  colorMap: ScalarColorMap | undefined,
): ValueRange {
  if (requested !== undefined) return requested;
  if (colorMap !== undefined) return { min: colorMap.min, max: colorMap.max };
  const observed = scalarRange(field);
  if (observed === undefined) {
    throw new Error(
      `Viewport results field ${field.id} has no finite values for an automatic range`,
    );
  }
  return observed.min === observed.max ? expandConstantRange(observed.min) : observed;
}

function resolveColorMap(
  config: ViewportScalarConfig,
  field: ViewportResultField,
  range: ValueRange,
  previous: ViewportResultsState | undefined,
): ScalarColorMap {
  if (config.colorMap !== undefined) return config.colorMap;
  if (
    previous !== undefined &&
    previous.scalar !== undefined &&
    previous.scalar.config.colorMap === undefined &&
    sameFieldSource(previous.scalar.field, field) &&
    previous.scalar.range.min === range.min &&
    previous.scalar.range.max === range.max
  ) {
    return previous.scalar.colorMap;
  }
  return createScalarColorMap(range);
}

function expandConstantRange(value: number): ValueRange {
  const delta = Math.max(0.5, Math.abs(value) * 0.01);
  return { min: value - delta, max: value + delta };
}

function validateMapRange(range: ValueRange, colorMap: ScalarColorMap): void {
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min >= range.max) {
    throw new Error(
      `Viewport results range must be finite with min < max, got [${range.min}, ${range.max}]`,
    );
  }
  if (range.min !== colorMap.min || range.max !== colorMap.max) {
    throw new Error(
      `Viewport results range [${range.min}, ${range.max}] does not match color map range [${colorMap.min}, ${colorMap.max}]`,
    );
  }
}

function resolveDeformation(
  config: ViewportDeformationConfig | undefined,
  scene: Scene,
  runtime: PackedSceneRuntime,
  previous: ViewportResultsState | undefined,
  targetPartId?: PartId,
): DeformationState | undefined {
  if (config === undefined) return undefined;
  const scale = config.scale ?? 1;
  if (!Number.isFinite(scale)) {
    throw new Error(`Viewport deformation scale must be finite, got ${scale}`);
  }
  const reusable = targetPartId === undefined ? reusableDeformation(previous, config) : undefined;
  if (reusable !== undefined) return { scale, displacements: reusable };
  const displacements = new Map<PartId, Float32Array>();
  for (const partId of targetPartId === undefined ? renderedPartIds(runtime) : [targetPartId]) {
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
    displacements.set(part.id, nodalDisplacements(maxNodeId + 1, config.field));
  }
  return { scale, displacements };
}

function reusableDeformation(
  previous: ViewportResultsState | undefined,
  config: ViewportDeformationConfig,
): ReadonlyMap<PartId, Float32Array> | undefined {
  const previousConfig = previous?.config.deformation;
  const previousState = previous === undefined ? undefined : sharedDeformations.get(previous);
  if (
    previousConfig === undefined ||
    previousState === undefined ||
    previousConfig.field.count !== config.field.count ||
    previousConfig.field.values !== config.field.values
  ) {
    return undefined;
  }
  return new Map(
    [...previousState.displacements].filter(
      (entry): entry is [PartId, Float32Array] => typeof entry[0] === "number",
    ),
  );
}
