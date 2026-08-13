import { nodalDisplacements, type DeformationState } from "../results/deform";
import { scalarAt, type ScalarField, type VectorField } from "../results/fields";
import { createScalarColorMap, mapScalar, type ScalarColorMap } from "../results/mapping";
import { scalarRange, type ValueRange } from "../results/range";
import type { InteractionState, StyleOverride } from "../interaction/interaction";
import { createInteractionStateValue, readInteractionState } from "../interaction/state";
import type { Scene } from "../scene/scene";
import type { InstanceId } from "../scene/types";
import type { PartId } from "../geometry/part";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";

/** An authored scalar field that can be displayed by the viewport results path. */
export type ViewportResultField = ScalarField<"nodal"> | ScalarField<"elemental">;

/** Optional one-load-case nodal deformation attached to a result view. */
export interface ViewportDeformationConfig {
  readonly field: VectorField<"nodal">;
  readonly scale?: number;
}

/** Configuration for one static scalar/deformation visualization. */
export interface ViewportResultsConfig {
  /** Authored nodal or elemental scalar values to visualize. */
  readonly field: ViewportResultField;
  /** Explicit map range; otherwise the finite field range is used. */
  readonly range?: ValueRange;
  /** Existing color map; its range must agree with `range` when both are set. */
  readonly colorMap?: ScalarColorMap;
  /** Optional static nodal displacement field and scale. */
  readonly deformation?: ViewportDeformationConfig;
}

/** Resolved result data currently installed on a {@link FemViewport}. */
export interface ViewportResultsState {
  readonly config: ViewportResultsConfig;
  readonly scalarField: ViewportResultField;
  readonly range: ValueRange;
  readonly colorMap: ScalarColorMap;
  readonly deformation: DeformationState | undefined;
}

type ResultColorMap = ReadonlyMap<PartId, Float32Array>;
const nodalResultColors = new WeakMap<ViewportResultsState, ResultColorMap | undefined>();

/** Returns the internal GPU color data for a resolved nodal scalar field. */
export function viewportResultColors(state: ViewportResultsState): ResultColorMap | undefined {
  return nodalResultColors.get(state);
}

/** Resolves a viewport result configuration against one scene/runtime pair. */
export function resolveViewportResults(
  config: ViewportResultsConfig,
  scene: Scene,
  runtime: PackedSceneRuntime,
): ViewportResultsState {
  const scalarField = config.field;
  const range = resolveRange(scalarField, config.range, config.colorMap);
  const colorMap = config.colorMap ?? createScalarColorMap(range);
  validateMapRange(range, colorMap);
  validateResultCoverage(scalarField, scene, runtime);
  const deformation = resolveDeformation(config.deformation, scene, runtime);
  const state = { config, scalarField, range, colorMap, deformation };
  nodalResultColors.set(
    state,
    scalarField.location === "nodal"
      ? buildNodalResultColors(scalarField, colorMap, scene, runtime)
      : undefined,
  );
  return state;
}

/** Re-applies only the result colors while preserving an already-built deformation state. */
export function applyViewportResultInteraction(
  baseInteraction: InteractionState,
  scalarField: ScalarField<"elemental">,
  colorMap: ScalarColorMap,
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
    const elements = part?.geometry.elements;
    if (elements === undefined || elements.length === 0) continue;
    mappedParts += 1;
    const overrides = new Map(elementOverrides.get(instanceId) ?? []);
    for (const element of elements) {
      const existing = overrides.get(element.id);
      overrides.set(element.id, {
        color: mapScalar(colorMap, scalarAt(scalarField, element.id)),
        ...existing,
      });
    }
    elementOverrides.set(instanceId, overrides);
  }
  if (mappedParts === 0) {
    throw new Error(
      `Viewport results field ${scalarField.id} has no element-bearing part in the scene`,
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
    : results.scalarField.location === "elemental"
      ? applyViewportResultInteraction(
          baseInteraction,
          results.scalarField,
          results.colorMap,
          scene,
          runtime,
        )
      : baseInteraction;
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
    const elements = scene.parts.get(partId)?.geometry.elements ?? [];
    for (const element of elements) validateElementId(scalarField, partId, element.id);
  }
}

function validateNodalCoverage(
  field: ScalarField<"nodal">,
  scene: Scene,
  runtime: PackedSceneRuntime,
): void {
  const renderedPartIds = new Set<PartId>();
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const partId = runtime.getPartId(slot);
    if (partId !== undefined) renderedPartIds.add(partId);
  }
  for (const partId of renderedPartIds) {
    const part = scene.parts.get(partId);
    const nodePickIds = part?.geometry.nodePickIds;
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
  const renderedPartIds = new Set<PartId>();
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const partId = runtime.getPartId(slot);
    if (partId !== undefined) renderedPartIds.add(partId);
  }
  for (const partId of renderedPartIds) {
    const nodePickIds = scene.parts.get(partId)?.geometry.nodePickIds;
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

function resolveDeformation(
  config: ViewportDeformationConfig | undefined,
  scene: Scene,
  runtime: PackedSceneRuntime,
): DeformationState | undefined {
  if (config === undefined) return undefined;
  const scale = config.scale ?? 1;
  if (!Number.isFinite(scale)) {
    throw new Error(`Viewport deformation scale must be finite, got ${scale}`);
  }
  const displacements = new Map<PartId, Float32Array>();
  const renderedPartIds = new Set<PartId>();
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const partId = runtime.getPartId(slot);
    if (partId !== undefined) renderedPartIds.add(partId);
  }
  for (const partId of renderedPartIds) {
    const part = scene.parts.get(partId);
    if (part === undefined) continue;
    const nodePickIds = part.geometry.nodePickIds;
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
