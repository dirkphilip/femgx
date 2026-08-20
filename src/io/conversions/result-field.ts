import {
  createResultField,
  registerElementalResultSource,
  type ScalarField,
  type VectorField,
} from "../../results/fields";
import { IoError, type Issue } from "../diagnostics";
import type { FemModel, ModelResultField } from "../fem-model";
import { validateFemModel } from "../model-validation";

/**
 * Options selecting the authored field shape for an interchange result.
 * @category Import and export
 */
export type ModelResultFieldConversionOptions =
  | {
      /** Stable field id for the converted result. */
      readonly id: string;
      /** Opaque display unit. */
      readonly unit: string;
      /** Scalar conversion role. */
      readonly shape: "scalar";
    }
  | {
      /** Stable field id for the converted result. */
      readonly id: string;
      /** Opaque display unit. */
      readonly unit: string;
      /** Nodal vector conversion role. */
      readonly shape: "vector";
    };

/**
 * Converts one interchange result into the dense field consumed by the
 * viewport.
 *
 * Node result ids map through the model's node table; elemental rows are packed
 * in stable model element order while their source-id mapping remains private
 * for the viewport boundary. Missing source rows become `NaN`, while duplicate
 * or unknown identities throw an {@link IoError}.
 * A scalar result can be nodal or elemental. A vector result is deliberately
 * limited to three-component nodal data so it can drive viewport deformation.
 * @example Convert a parsed nodal result.
 * ```ts
 * import { createResultFieldFromModelResult } from "femgx/io";
 *
 * const source = model.results[0];
 * if (source === undefined) throw new Error("Missing result");
 * const field = createResultFieldFromModelResult(model, source, {
 *   id: "temperature",
 *   unit: "degC",
 *   shape: "scalar",
 * });
 * viewport.results.set({ scalar: { field } });
 * ```
 * @category Import and export
 */
export function createResultFieldFromModelResult(
  model: FemModel,
  result: ModelResultField,
  options: Extract<ModelResultFieldConversionOptions, { readonly shape: "scalar" }>,
): ScalarField<"nodal"> | ScalarField<"elemental">;
/**
 * Converts one explicit three-component nodal interchange result into a
 * nodal vector field suitable for authored deformation.
 */
export function createResultFieldFromModelResult(
  model: FemModel,
  result: ModelResultField,
  options: Extract<ModelResultFieldConversionOptions, { readonly shape: "vector" }>,
): VectorField<"nodal">;
export function createResultFieldFromModelResult(
  model: FemModel,
  result: ModelResultField,
  options: ModelResultFieldConversionOptions,
): ScalarField<"nodal"> | ScalarField<"elemental"> | VectorField<"nodal"> {
  validateConversion(model, result, options.shape);
  const entityIndexes = entityIndex(model, result.location);
  const values = new Float32Array(entityIndexes.count * result.components).fill(Number.NaN);
  const seen = new Set<number>();
  for (let row = 0; row < result.ids.length; row += 1) {
    const sourceId = result.ids[row];
    if (sourceId === undefined) continue;
    if (seen.has(sourceId)) {
      throw conversionError(
        "duplicate-result-identity",
        `Result ${result.name} repeats id ${sourceId}`,
      );
    }
    seen.add(sourceId);
    const targetIndex = entityIndexes.byId.get(sourceId);
    if (targetIndex === undefined) {
      throw conversionError(
        "unknown-result-identity",
        `Result ${result.name} references unknown ${result.location} id ${sourceId}`,
      );
    }
    const sourceOffset = row * result.components;
    const targetOffset = targetIndex * result.components;
    for (let component = 0; component < result.components; component += 1) {
      values[targetOffset + component] = result.values[sourceOffset + component] ?? Number.NaN;
    }
  }
  const field = createConvertedField(result, options, entityIndexes.count, values);
  if (field.location === "elemental") {
    registerElementalResultSource(field, entityIndexes.ids);
  }
  return field;
}

function createConvertedField(
  result: ModelResultField,
  options: ModelResultFieldConversionOptions,
  count: number,
  values: Float32Array,
): ScalarField<"nodal"> | ScalarField<"elemental"> | VectorField<"nodal"> {
  if (options.shape === "scalar") {
    return result.location === "node"
      ? createResultField({
          id: options.id,
          name: result.name,
          location: "nodal",
          shape: "scalar",
          count,
          unit: options.unit,
          values,
        })
      : createResultField({
          id: options.id,
          name: result.name,
          location: "elemental",
          shape: "scalar",
          count,
          unit: options.unit,
          values,
        });
  }
  return createResultField({
    id: options.id,
    name: result.name,
    location: "nodal",
    shape: "vector",
    count,
    unit: options.unit,
    values,
  });
}

interface EntityIndex {
  readonly count: number;
  readonly byId: ReadonlyMap<number, number>;
  readonly ids: readonly number[];
}

function entityIndex(model: FemModel, location: ModelResultField["location"]): EntityIndex {
  if (location === "node") {
    const byId = new Map<number, number>();
    const ids: number[] = [];
    for (let row = 0; row < model.nodes.ids.length; row += 1) {
      const id = model.nodes.ids[row];
      if (id !== undefined) {
        byId.set(id, row);
        ids.push(id);
      }
    }
    return { count: model.nodes.count, byId, ids };
  }
  const ids: number[] = [];
  for (const block of model.elementShapeBlocks) {
    ids.push(...block.ids);
  }
  ids.sort((left, right) => left - right);
  return { count: ids.length, byId: new Map(ids.map((id, ordinal) => [id, ordinal])), ids };
}

function validateConversion(
  model: FemModel,
  result: ModelResultField,
  shape: "scalar" | "vector",
): void {
  const modelErrors = validateFemModel(model).filter((issue) => issue.severity === "error");
  if (modelErrors.length > 0) throw new IoError("Cannot convert ModelResultField", modelErrors);
  if (!Number.isInteger(result.components) || result.components < 1) {
    throw conversionError(
      "result-components",
      `Result ${result.name} has invalid component count ${result.components}`,
    );
  }
  if (result.values.length !== result.ids.length * result.components) {
    throw conversionError(
      "result-shape",
      `Result ${result.name} has ${result.values.length} values for ${result.ids.length} ids and ${result.components} components`,
    );
  }
  if (shape === "scalar" && result.components !== 1) {
    throw conversionError(
      "unsupported-result-shape",
      `Scalar result ${result.name} requires one component, got ${result.components}`,
    );
  }
  if (shape === "vector" && (result.location !== "node" || result.components !== 3)) {
    throw conversionError(
      "unsupported-result-shape",
      `Vector result ${result.name} requires three nodal components`,
    );
  }
}

function conversionError(code: string, message: string): IoError {
  const issue: Issue = { code, severity: "error", message };
  return new IoError(message, [issue]);
}
