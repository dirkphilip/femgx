import { nodalDisplacements, type DeformationState } from "../results/deform";
import type { ElementalOrientationRecords } from "../results/orientation-records";
import { createScalarColorMap, type ScalarColorMap } from "../results/mapping";
import { scalarRange, type ValueRange } from "../results/range";
import type { Scene } from "../scene/scene";
import type { PartId } from "../geometry/part";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import {
  renderedPartIds,
  resolveLoads,
  resolveVectors,
  validateResultsConfig,
  type OrientationRecordMap,
} from "./results-roles";
import {
  mergedNodePickIds,
  resolveViewportResultColors,
  sameFieldSource,
  validateResultCoverage,
} from "./result-colors";
import type {
  ViewportDeformationConfig,
  ViewportResultField,
  ViewportResultsConfig,
  ViewportResultsState,
  ViewportScalarConfig,
  ViewportScalarState,
} from "./results-types";

export type {
  ViewportDeformationConfig,
  ViewportElementFrameConfig,
  ViewportElementVectorConfig,
  ViewportElementVectorState,
  ViewportLoadConfig,
  ViewportResultField,
  ViewportResultsConfig,
  ViewportResultsState,
  ViewportScalarConfig,
  ViewportScalarState,
} from "./results-types";

const orientationRecords = new WeakMap<ViewportResultsState, OrientationRecordMap | undefined>();

export { viewportResultColors } from "./result-colors";

/** Returns internal resolved orientation records for the renderer handoff. */
export function viewportOrientationRecords(
  state: ViewportResultsState,
): OrientationRecordMap | undefined {
  return orientationRecords.get(state);
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
  const deformation = resolveDeformation(config.deformation, scene, runtime, previous);
  const resolvedVectors = resolveVectors(config.vectors, scene, runtime, deformation);
  const resolvedLoads = resolveLoads(config.loads, scene, runtime, deformation);
  const vectors = resolvedVectors?.state;
  const state = {
    config,
    scalar,
    deformation,
    vectors,
    ...(resolvedLoads === undefined ? {} : { loads: resolvedLoads.config }),
  };
  resolveViewportResultColors(state, scalar, scene, runtime, previous);
  orientationRecords.set(state, mergeRecords(resolvedVectors?.records, resolvedLoads?.records));
  return state;
}

function mergeRecords(
  vectors: OrientationRecordMap | undefined,
  loads: OrientationRecordMap | undefined,
): OrientationRecordMap | undefined {
  if (vectors === undefined && loads === undefined) return undefined;
  const merged = new Map(vectors);
  for (const [partId, loadRecords] of loads ?? []) {
    const vectorRecords = merged.get(partId);
    merged.set(
      partId,
      vectorRecords === undefined ? loadRecords : appendRecords(vectorRecords, loadRecords),
    );
  }
  return merged;
}

function appendRecords(
  first: ElementalOrientationRecords,
  second: ElementalOrientationRecords,
): ElementalOrientationRecords {
  const count = first.elementIds.length + second.elementIds.length;
  const records = {
    elementIds: new Uint32Array(count),
    bodyIds: new Uint32Array(count),
    anchors: new Float32Array(count * 3),
    referenceLengths: new Float32Array(count),
    directions: new Float32Array(count * 3),
    glyphModes: new Uint32Array(count),
    transformModes: new Uint32Array(count),
    lengthScales: new Float32Array(count),
    axisIndices: new Uint32Array(count),
    anchorDeltas:
      first.anchorDeltas === undefined && second.anchorDeltas === undefined
        ? undefined
        : new Float32Array(count * 3),
  };
  copyRecords(records, first, 0);
  copyRecords(records, second, first.elementIds.length);
  return records;
}

function copyRecords(
  target: ElementalOrientationRecords,
  source: ElementalOrientationRecords,
  offset: number,
): void {
  target.elementIds.set(source.elementIds, offset);
  target.bodyIds.set(source.bodyIds, offset);
  target.anchors.set(source.anchors, offset * 3);
  target.referenceLengths.set(source.referenceLengths, offset);
  target.directions.set(source.directions, offset * 3);
  target.glyphModes?.set(
    source.glyphModes ?? new Uint32Array(source.elementIds.length).fill(0),
    offset,
  );
  target.transformModes?.set(
    source.transformModes ?? new Uint32Array(source.elementIds.length),
    offset,
  );
  target.lengthScales?.set(
    source.lengthScales ?? new Float32Array(source.elementIds.length).fill(1),
    offset,
  );
  target.axisIndices?.set(source.axisIndices ?? new Uint32Array(source.elementIds.length), offset);
  target.anchorDeltas?.set(
    source.anchorDeltas ?? new Float32Array(source.elementIds.length * 3),
    offset * 3,
  );
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
): DeformationState | undefined {
  if (config === undefined) return undefined;
  const scale = config.scale ?? 1;
  if (!Number.isFinite(scale)) {
    throw new Error(`Viewport deformation scale must be finite, got ${scale}`);
  }
  const reusable = reusableDeformation(previous, config);
  if (reusable !== undefined) return { scale, displacements: reusable };
  const displacements = new Map<PartId, Float32Array>();
  for (const partId of renderedPartIds(runtime)) {
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
  const previousState = previous?.deformation;
  if (
    previousConfig === undefined ||
    previousState === undefined ||
    previousConfig.field.count !== config.field.count ||
    previousConfig.field.values !== config.field.values
  ) {
    return undefined;
  }
  return previousState.displacements;
}
