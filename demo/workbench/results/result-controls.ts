import type {
  ElementFrameField,
  ScalarField,
  VectorField,
  ViewportElementFrameConfig,
  ViewportElementVectorConfig,
  ViewportResultsConfig,
} from "../../../src/entries/root";
import type { WorkbenchModel } from "../models/model";
import type { ResultDisplayMode } from "../types";

export const BASE_RESULT_VALUE = "__base__";
export const DEFORMATION_OFF_VALUE = "__off__";
export const VECTOR_OFF_VALUE = "__vectors_off__";

const DEFAULT_VECTOR_WIDTH_PIXELS = 2;
const MIN_VECTOR_WIDTH_PIXELS = 1;
const MAX_VECTOR_WIDTH_PIXELS = 8;

export type VectorGlyph = ViewportElementVectorConfig["glyph"] | "triad";
export type VectorTransform = ViewportElementVectorConfig["transform"];
export type OrientationField = VectorField<"elemental"> | ElementFrameField;
export type WorkbenchScalarField = ScalarField<"nodal"> | ScalarField<"elemental">;

export interface VectorDisplayState {
  readonly fieldId: string;
  readonly glyph: VectorGlyph;
  readonly transform: VectorTransform;
  readonly lengthScale: number;
  readonly widthPixels: number;
}

/** Returns the user-facing name for an orientation glyph presentation. */
export function vectorGlyphLabel(glyph: VectorGlyph): "Arrow" | "Axis" | "RGB triad" {
  return glyph === "arrow" ? "Arrow" : glyph === "axis" ? "Axis" : "RGB triad";
}

/** Returns the user-facing name for an occurrence transform presentation. */
export function vectorTransformLabel(
  transform: VectorTransform,
): "Spatial direction" | "Surface normal" {
  return transform === "direction" ? "Spatial direction" : "Surface normal";
}

const CANONICAL_VECTOR_PRESENTATIONS: ReadonlyMap<
  string,
  Pick<VectorDisplayState, "glyph" | "transform">
> = new Map([
  ["demo-normals", { glyph: "arrow", transform: "normal" }],
  ["demo-fibers", { glyph: "axis", transform: "direction" }],
  ["demo-element-frames", { glyph: "triad", transform: "direction" }],
]);

/** Resolves the display mode represented by a scalar-field selection. */
export function resultModeForScalarSelection(
  value: string,
  config: ViewportResultsConfig | undefined,
  deformationValue: string,
): ResultDisplayMode | undefined {
  const scalar = config?.scalar;
  if (scalar === undefined) return undefined;
  if (value === BASE_RESULT_VALUE) return "base";
  if (value !== scalar.field.id) return undefined;
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

/** Parses the positive length scale used by demo orientation glyphs. */
export function parseVectorLengthScale(value: string): number | undefined {
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? scale : undefined;
}

/** Parses the bounded CSS-pixel shaft width used by demo orientation glyphs. */
export function parseVectorWidthPixels(value: string): number | undefined {
  const width = Number(value);
  return Number.isFinite(width) &&
    width >= MIN_VECTOR_WIDTH_PIXELS &&
    width <= MAX_VECTOR_WIDTH_PIXELS
    ? width
    : undefined;
}

/** Returns the demo-owned elemental vector choices, including an active imported role. */
export function resultVectorFieldsForModel(model: WorkbenchModel): readonly OrientationField[] {
  const fields = [...(model.resultVectorFields ?? [])];
  const active = model.results?.vectors?.field;
  if (active !== undefined && !fields.some((field) => field.id === active.id)) fields.push(active);
  return fields;
}

/** Returns the demo-owned scalar choices, retaining the active field first. */
export function resultScalarFieldsForModel(model: WorkbenchModel): readonly WorkbenchScalarField[] {
  const fields = [...(model.resultScalarFields ?? [])];
  const active = model.results?.scalar?.field;
  if (active !== undefined && !fields.some((field) => field.id === active.id))
    fields.unshift(active);
  return fields;
}

/** Resolves one advertised scalar choice for the current model. */
export function scalarFieldForModel(
  model: WorkbenchModel,
  fieldId: string,
): WorkbenchScalarField | undefined {
  return resultScalarFieldsForModel(model).find((field) => field.id === fieldId);
}

/** Returns the active scalar id, or the explicit base-display sentinel. */
export function activeScalarFieldIdForModel(model: WorkbenchModel): string {
  return model.results?.scalar?.field.id ?? BASE_RESULT_VALUE;
}

/** Normalizes a result-mode/id pair for the scalar selector snapshot. */
export function displayedScalarFieldId(mode: ResultDisplayMode, fieldId: string): string {
  return mode === "base" || fieldId === BASE_RESULT_VALUE ? BASE_RESULT_VALUE : fieldId;
}

/** Returns the initial orientation controls for one model. */
export function vectorDisplayForModel(model: WorkbenchModel): VectorDisplayState {
  const active = model.results?.vectors;
  const first = resultVectorFieldsForModel(model)[0];
  return {
    fieldId: active?.field.id ?? first?.id ?? VECTOR_OFF_VALUE,
    glyph: active?.glyph ?? "arrow",
    transform: active?.glyph === "triad" ? "direction" : (active?.transform ?? "direction"),
    lengthScale: active?.lengthScale ?? 1,
    widthPixels: active?.widthPixels ?? DEFAULT_VECTOR_WIDTH_PIXELS,
  };
}

/** Applies a demo-owned canonical presentation when switching to a known vector role. */
export function vectorDisplayForField(
  model: WorkbenchModel,
  fieldId: string,
  current: VectorDisplayState,
): VectorDisplayState {
  if (
    fieldId !== VECTOR_OFF_VALUE &&
    !resultVectorFieldsForModel(model).some((field) => field.id === fieldId)
  ) {
    return current;
  }
  const preferred = CANONICAL_VECTOR_PRESENTATIONS.get(fieldId);
  return preferred === undefined ? { ...current, fieldId } : { ...current, fieldId, ...preferred };
}

/** Builds the demo's selected orientation role without mutating the model's authored config. */
export function vectorConfigForDisplay(
  model: WorkbenchModel,
  display: VectorDisplayState,
): ViewportElementVectorConfig | ViewportElementFrameConfig | undefined {
  if (display.fieldId === VECTOR_OFF_VALUE) return undefined;
  const field = resultVectorFieldsForModel(model).find(
    (candidate) => candidate.id === display.fieldId,
  );
  return field === undefined
    ? undefined
    : field.shape === "frame"
      ? {
          field,
          glyph: "triad",
          lengthScale: display.lengthScale,
          widthPixels: display.widthPixels,
        }
      : {
          field,
          glyph: display.glyph === "triad" ? "axis" : display.glyph,
          transform: display.transform,
          lengthScale: display.lengthScale,
          widthPixels: display.widthPixels,
        };
}

/** Accepts only the user-selectable single-vector glyph presentations. */
export function parseVectorGlyph(value: string): VectorGlyph | undefined {
  return value === "arrow" || value === "axis" ? value : undefined;
}

/** Accepts only occurrence direction or inverse-transpose normal transforms. */
export function parseVectorTransform(value: string): VectorTransform | undefined {
  return value === "direction" || value === "normal" ? value : undefined;
}

/** Returns the initial display mode for a model's authored result config. */
export function resultModeForModel(model: WorkbenchModel): ResultDisplayMode {
  if (model.results?.scalar === undefined) return "base";
  return model.results.deformation === undefined ? "colored" : "deformed";
}
