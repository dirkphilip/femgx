import { createScalarColorMap, type ScalarColorMap } from "../../results/mapping";
import { scalarRange, type ValueRange } from "../../results/range";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { Scene } from "../../scene/scene";
import { sameFieldSource, validateResultCoverage } from "../result-colors";
import type {
  ViewportResultField,
  ViewportResultsState,
  ViewportScalarConfig,
  ViewportScalarState,
} from "../results-types";

/** Resolves and validates one scalar role against the rendered runtime. */
export function resolveScalar(
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
