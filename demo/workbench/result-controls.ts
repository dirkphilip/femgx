import type { ViewportResultsConfig } from "../../src/index";
import type { WorkbenchModel } from "./model";
import type { ResultDisplayMode } from "./types";

export const BASE_RESULT_VALUE = "__base__";
export const DEFORMATION_OFF_VALUE = "__off__";

/** Resolves the display mode represented by a scalar-field selection. */
export function resultModeForScalarSelection(
  value: string,
  config: ViewportResultsConfig | undefined,
  deformationValue: string,
): ResultDisplayMode | undefined {
  if (config === undefined) return undefined;
  if (value === BASE_RESULT_VALUE) return "base";
  if (value !== config.field.id) return undefined;
  return deformationValue === DEFORMATION_OFF_VALUE ? "colored" : "deformed";
}

/** Resolves the display mode represented by a deformation-field selection. */
export function resultModeForDeformationSelection(
  value: string,
  config: ViewportResultsConfig | undefined,
  currentMode: ResultDisplayMode,
): ResultDisplayMode | undefined {
  if (config?.deformation === undefined || currentMode === "base") return undefined;
  if (value === DEFORMATION_OFF_VALUE) return "colored";
  return value === config.deformation.field.id ? "deformed" : undefined;
}

/** Parses the bounded scale input used by the demo's deformation control. */
export function parseDeformationScale(value: string): number | undefined {
  const scale = Number(value);
  return Number.isFinite(scale) && scale >= 0 ? scale : undefined;
}

/** Returns the initial display mode for a model's authored result config. */
export function resultModeForModel(model: WorkbenchModel): ResultDisplayMode {
  if (model.results === undefined) return "base";
  return model.results.deformation === undefined ? "colored" : "deformed";
}
