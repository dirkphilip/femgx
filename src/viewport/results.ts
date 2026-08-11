import { nodalDisplacements, type DeformationState } from "../results/deform";
import { magnitudeField, maxPrincipalField, vonMisesField } from "../results/derived";
import { scalarAt, type ScalarField, type TensorField, type VectorField } from "../results/fields";
import { createScalarColorMap, mapScalar, type ScalarColorMap } from "../results/mapping";
import { scalarRange, type ValueRange } from "../results/range";
import type { InteractionState, StyleOverride } from "../interaction/interaction";
import type { Scene } from "../scene/scene";
import type { InstanceId } from "../scene/types";
import type { PartId } from "../geometry/part";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";

/** An elemental field that can be displayed by the viewport results path. */
export type ViewportResultField =
  ScalarField<"elemental"> | VectorField<"elemental"> | TensorField<"elemental">;

/** Scalar quantities supported by the static viewport results workflow. */
export type ViewportResultDerivation = "magnitude" | "vonMises" | "maxPrincipal";

/** Optional one-load-case nodal deformation attached to a result view. */
export interface ViewportDeformationConfig {
  readonly field: VectorField<"nodal">;
  readonly scale?: number;
}

/** Configuration for one static scalar/deformation visualization. */
export interface ViewportResultsConfig {
  /** Elemental scalar, vector, or symmetric tensor values to visualize. */
  readonly field: ViewportResultField;
  /** Required for vector/tensor fields; invalid combinations produce diagnostics. */
  readonly derive?: ViewportResultDerivation;
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
  readonly scalarField: ScalarField<"elemental">;
  readonly range: ValueRange;
  readonly colorMap: ScalarColorMap;
  readonly deformation: DeformationState | undefined;
  readonly interaction: InteractionState;
}

/** Resolves a viewport result configuration against one scene/runtime pair. */
export function resolveViewportResults(
  config: ViewportResultsConfig,
  scene: Scene,
  runtime: PackedSceneRuntime,
  baseInteraction: InteractionState,
): ViewportResultsState {
  const scalarField = deriveScalarField(config.field, config.derive);
  const range = resolveRange(scalarField, config.range, config.colorMap);
  const colorMap = config.colorMap ?? createScalarColorMap(range);
  validateMapRange(range, colorMap);
  const interaction = applyViewportResultInteraction(
    baseInteraction,
    scalarField,
    colorMap,
    scene,
    runtime,
  );
  const deformation = resolveDeformation(config.deformation, scene);
  return { config, scalarField, range, colorMap, deformation, interaction };
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
  for (const [instanceId, overrides] of baseInteraction.elementOverrides) {
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
      validateElementId(scalarField, partId, element.id);
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
  return { ...baseInteraction, elementOverrides };
}

function deriveScalarField(
  field: ViewportResultField,
  derivation: ViewportResultDerivation | undefined,
): ScalarField<"elemental"> {
  if (field.shape === "scalar") {
    if (derivation !== undefined) {
      throw new Error(
        `Viewport results field ${field.id} is scalar; remove derivation "${derivation}"`,
      );
    }
    return field;
  }
  if (derivation === undefined) {
    throw new Error(
      `Viewport results field ${field.id} is ${field.shape}; choose a supported derivation`,
    );
  }
  if (field.shape === "vector") {
    if (derivation !== "magnitude") {
      throw new Error(`Vector field ${field.id} only supports the "magnitude" derivation`);
    }
    return magnitudeField(`${field.id}:magnitude`, `${field.name} magnitude`, field);
  }
  switch (derivation) {
    case "magnitude":
      return magnitudeField(`${field.id}:magnitude`, `${field.name} magnitude`, field);
    case "vonMises":
      return vonMisesField(`${field.id}:vonMises`, `${field.name} von Mises`, field);
    case "maxPrincipal":
      return maxPrincipalField(
        `${field.id}:maxPrincipal`,
        `${field.name} maximum principal`,
        field,
      );
  }
}

function resolveRange(
  field: ScalarField<"elemental">,
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

function resolveDeformation(
  config: ViewportDeformationConfig | undefined,
  scene: Scene,
): DeformationState | undefined {
  if (config === undefined) return undefined;
  const scale = config.scale ?? 1;
  if (!Number.isFinite(scale)) {
    throw new Error(`Viewport deformation scale must be finite, got ${scale}`);
  }
  const displacements = new Map<PartId, Float32Array>();
  for (const part of scene.parts.values()) {
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
    displacements.set(part.id, nodalDisplacements(maxNodeId + 1, [config.field]));
  }
  return { scale, loadCase: 0, loadCaseCount: 1, displacements };
}
