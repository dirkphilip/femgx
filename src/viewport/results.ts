import { nodalDisplacements, type DeformationState } from "../results/deform";
import { scalarAt, type ScalarField } from "../results/fields";
import { createScalarColorMap, mapScalar, type ScalarColorMap } from "../results/mapping";
import { scalarRange, type ValueRange } from "../results/range";
import type { InteractionState, StyleOverride } from "../interaction/interaction";
import { createInteractionStateValue, readInteractionState } from "../interaction/state";
import type { Scene } from "../scene/scene";
import type { InstanceId } from "../scene/types";
import type { Part, PartId } from "../geometry/part";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import {
  renderedPartIds,
  resolveVectors,
  validateResultsConfig,
  type OrientationRecordMap,
} from "./results-roles";
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
  ViewportElementVectorConfig,
  ViewportElementVectorState,
  ViewportResultField,
  ViewportResultsConfig,
  ViewportResultsState,
  ViewportScalarConfig,
  ViewportScalarState,
} from "./results-types";

type ResultColorMap = ReadonlyMap<PartId, Float32Array>;
const nodalResultColors = new WeakMap<ViewportResultsState, ResultColorMap | undefined>();
const orientationRecords = new WeakMap<ViewportResultsState, OrientationRecordMap | undefined>();

/** Returns the internal GPU color data for a resolved nodal scalar field. */
export function viewportResultColors(state: ViewportResultsState): ResultColorMap | undefined {
  return nodalResultColors.get(state);
}

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
  const vectors = resolvedVectors?.state;
  const state = { config, scalar, deformation, vectors };
  const reusableColors =
    scalar === undefined ? undefined : reusableNodalResultColors(previous, scalar);
  nodalResultColors.set(
    state,
    scalar?.field.location === "nodal"
      ? (reusableColors ?? buildNodalResultColors(scalar.field, scalar.colorMap, scene, runtime))
      : undefined,
  );
  orientationRecords.set(state, resolvedVectors?.records);
  return state;
}

/** Re-applies only the result colors while preserving an already-built deformation state. */
export function applyViewportResultInteraction(
  baseInteraction: InteractionState,
  scalar: ViewportScalarState,
  scene: Scene,
  runtime: PackedSceneRuntime,
): InteractionState {
  const elementOverrides = new Map<InstanceId, ReadonlyMap<number, StyleOverride>>();
  const baseData = readInteractionState(baseInteraction);
  for (const [instanceId, overrides] of baseData.elementOverrides) {
    elementOverrides.set(instanceId, new Map(overrides));
  }

  let mappedParts = 0;
  for (let slot = 0; slot < runtime.instanceCount; slot++) {
    const partId = runtime.getPartId(slot);
    const instanceId = runtime.getInstanceId(slot);
    if (partId === undefined || instanceId === undefined) continue;
    const part = scene.parts.get(partId);
    const elements = part?.elements;
    if (elements === undefined || elements.length === 0) continue;
    mappedParts += 1;
    const overrides = new Map(elementOverrides.get(instanceId) ?? []);
    for (const element of elements) {
      const existing = overrides.get(element.id);
      overrides.set(element.id, {
        color: mapScalar(scalar.colorMap, scalarAt(scalar.field, element.id)),
        ...existing,
      });
    }
    elementOverrides.set(instanceId, overrides);
  }
  if (mappedParts === 0) {
    throw new Error(
      `Viewport results field ${scalar.field.id} has no element-bearing part in the scene`,
    );
  }
  return createInteractionStateValue({ ...baseData, elementOverrides });
}

/** Resolves base interaction through the currently installed result colors. */
export function resolveViewportInteraction(
  baseInteraction: InteractionState,
  results: ViewportResultsState | undefined,
  scene: Scene,
  runtime: PackedSceneRuntime,
): InteractionState {
  return results === undefined
    ? baseInteraction
    : results.scalar?.field.location === "elemental"
      ? applyViewportResultInteraction(baseInteraction, results.scalar, scene, runtime)
      : baseInteraction;
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
  validateResultCoverage(field, scene, runtime);
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

function reusableNodalResultColors(
  previous: ViewportResultsState | undefined,
  scalar: ViewportScalarState,
): ResultColorMap | undefined {
  const field = scalar.field;
  if (
    previous === undefined ||
    previous.scalar === undefined ||
    previous.scalar.field.location !== "nodal" ||
    field.location !== "nodal" ||
    previous.scalar.colorMap !== scalar.colorMap ||
    !sameFieldSource(previous.scalar.field, field)
  ) {
    return undefined;
  }
  return viewportResultColors(previous);
}

function sameFieldSource(left: ViewportResultField, right: ViewportResultField): boolean {
  return (
    left.location === right.location && left.count === right.count && left.values === right.values
  );
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

function validateElementId(
  field: ScalarField<"elemental">,
  partId: PartId,
  elementId: number,
): void {
  if (!Number.isInteger(elementId) || elementId < 0 || elementId >= field.count) {
    throw new Error(
      `Viewport results field ${field.id} (count ${field.count}) has no value for element ${elementId} in part ${partId}`,
    );
  }
}

function validateResultCoverage(
  scalarField: ViewportResultField,
  scene: Scene,
  runtime: PackedSceneRuntime,
): void {
  if (scalarField.location === "nodal") {
    validateNodalCoverage(scalarField, scene, runtime);
    return;
  }
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const partId = runtime.getPartId(slot);
    if (partId === undefined) continue;
    const elements = scene.parts.get(partId)?.elements ?? [];
    for (const element of elements) validateElementId(scalarField, partId, element.id);
  }
}

function validateNodalCoverage(
  field: ScalarField<"nodal">,
  scene: Scene,
  runtime: PackedSceneRuntime,
): void {
  for (const partId of renderedPartIds(runtime)) {
    const part = scene.parts.get(partId);
    const nodePickIds = part === undefined ? undefined : mergedNodePickIds(part);
    if (part === undefined || nodePickIds === undefined) {
      throw new Error(
        `Viewport nodal results field ${field.id} cannot map part ${partId}: geometry has no nodePickIds`,
      );
    }
    for (const pickId of nodePickIds) {
      if (!Number.isInteger(pickId) || pickId <= 0 || pickId > field.count) {
        throw new Error(
          `Viewport nodal results field ${field.id} (count ${field.count}) has no value for node pick id ${pickId} in part ${partId}`,
        );
      }
    }
  }
}

function buildNodalResultColors(
  field: ScalarField<"nodal">,
  colorMap: ScalarColorMap,
  scene: Scene,
  runtime: PackedSceneRuntime,
): ResultColorMap {
  const colors = new Map<PartId, Float32Array>();
  for (const partId of renderedPartIds(runtime)) {
    const part = scene.parts.get(partId);
    const nodePickIds = part === undefined ? undefined : mergedNodePickIds(part);
    if (nodePickIds === undefined) continue;
    const data = new Float32Array((maxNodePickId(nodePickIds) + 1) * 4);
    for (const pickId of nodePickIds) {
      const color = mapScalar(colorMap, scalarAt(field, pickId - 1));
      const offset = pickId * 4;
      data[offset] = color.r;
      data[offset + 1] = color.g;
      data[offset + 2] = color.b;
      data[offset + 3] = color.a;
    }
    colors.set(partId, data);
  }
  return colors;
}

function maxNodePickId(nodePickIds: Uint32Array): number {
  let max = 0;
  for (const pickId of nodePickIds) max = Math.max(max, pickId);
  return max;
}

function mergedNodePickIds(part: Part): Uint32Array | undefined {
  const ids = new Set<number>();
  let hasNodeIds = false;
  for (const geometry of part.geometries) {
    if (geometry.nodePickIds !== undefined) hasNodeIds = true;
    for (const pickId of geometry.nodePickIds ?? []) ids.add(pickId);
  }
  return hasNodeIds ? Uint32Array.from(ids) : undefined;
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
