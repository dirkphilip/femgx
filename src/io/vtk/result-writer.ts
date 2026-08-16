import { VtkWriteError, type Issue } from "../diagnostics";
import type { ModelResultField } from "../fem-model";
import { VTK_KEYWORDS } from "./keywords";

/** A result field reordered into the deterministic VTK entity-row order. */
export interface PreparedResult {
  readonly result: ModelResultField;
  readonly values: Float64Array;
}

/** Prepares all result fields at one VTK data location. */
export function prepareResults(
  results: readonly ModelResultField[],
  location: "node" | "element",
  emittedIds: readonly number[],
): PreparedResult[] {
  validateResultLocations(results);
  return results
    .filter((result) => result.location === location)
    .map((result) => prepareResult(result, emittedIds));
}

/** Writes native VTK attributes and one FIELD block for custom component widths. */
export function writeAttributes(lines: string[], results: readonly PreparedResult[]): void {
  let fieldWritten = false;
  const fieldResults = results.filter((prepared) => !isNativeAttribute(prepared.result));
  for (const prepared of results) {
    if (isNativeAttribute(prepared.result)) {
      writeNativeAttribute(lines, prepared);
    } else if (!fieldWritten) {
      writeFieldAttributeBlock(lines, fieldResults);
      fieldWritten = true;
    }
  }
}

function prepareResult(result: ModelResultField, emittedIds: readonly number[]): PreparedResult {
  validateResultShape(result);
  const emittedRows = collectResultRows(result, emittedIds);
  return { result, values: reorderResultValues(result, emittedIds, emittedRows) };
}

function validateResultLocations(results: readonly ModelResultField[]): void {
  for (const result of results) {
    const locationValue: unknown = result.location;
    const location = String(locationValue);
    if (location !== "node" && location !== "element") {
      throw new VtkWriteError(
        "unsupported-writer-state",
        `VTK result ${result.name} has unsupported location ${location}`,
      );
    }
  }
}

function validateResultShape(result: ModelResultField): void {
  validateResultName(result.name);
  if (!Number.isInteger(result.components) || result.components < 1) {
    throw invalidModel(
      `Result ${result.name} has invalid component count ${String(result.components)}`,
    );
  }
  const expectedValueCount = result.ids.length * result.components;
  if (result.values.length !== expectedValueCount) {
    throw invalidModel(
      `Result ${result.name} holds ${result.values.length} values for ${result.ids.length} ids with ${result.components} components`,
    );
  }
}

function collectResultRows(
  result: ModelResultField,
  emittedIds: readonly number[],
): Map<number, number> {
  const emittedRows = new Map<number, number>();
  const expected = new Set(emittedIds);
  for (let row = 0; row < result.ids.length; row += 1) {
    const id = result.ids[row];
    if (id === undefined) {
      throw invalidModel(`Result ${result.name} is missing an id at row ${row}`);
    }
    if (emittedRows.has(id)) {
      throw new VtkWriteError(
        "duplicate-result-identity",
        `Result ${result.name} repeats ${result.location} id ${id}`,
      );
    }
    if (!expected.has(id)) {
      throw new VtkWriteError(
        "incomplete-result-coverage",
        `Result ${result.name} references unknown ${result.location} id ${id}`,
      );
    }
    emittedRows.set(id, row);
  }
  if (emittedRows.size !== emittedIds.length) {
    const missing = emittedIds.find((id) => !emittedRows.has(id));
    throw new VtkWriteError(
      "incomplete-result-coverage",
      `Result ${result.name} must cover every ${result.location} id; missing ${String(missing)}`,
    );
  }
  return emittedRows;
}

function reorderResultValues(
  result: ModelResultField,
  emittedIds: readonly number[],
  emittedRows: ReadonlyMap<number, number>,
): Float64Array {
  const values = new Float64Array(emittedIds.length * result.components);
  for (let emittedRow = 0; emittedRow < emittedIds.length; emittedRow += 1) {
    const emittedId = emittedIds[emittedRow];
    const sourceRow = emittedId === undefined ? undefined : emittedRows.get(emittedId);
    if (sourceRow === undefined) {
      throw new VtkWriteError(
        "incomplete-result-coverage",
        `Result ${result.name} has no row for emitted ${result.location} ${String(emittedId)}`,
      );
    }
    for (let component = 0; component < result.components; component += 1) {
      const value = result.values[sourceRow * result.components + component];
      if (value === undefined || !Number.isFinite(value)) {
        throw new VtkWriteError(
          "unsupported-writer-state",
          `Result ${result.name} contains a non-finite value at row ${sourceRow}, component ${component}`,
        );
      }
      values[emittedRow * result.components + component] = value;
    }
  }
  return values;
}

function writeNativeAttribute(lines: string[], prepared: PreparedResult): void {
  if (prepared.result.components === 1) {
    lines.push(`SCALARS ${prepared.result.name} double`, "LOOKUP_TABLE default");
  } else if (prepared.result.components === 3) {
    lines.push(`VECTORS ${prepared.result.name} double`);
  } else {
    lines.push(`TENSORS ${prepared.result.name} double`);
  }
  for (const value of prepared.values) lines.push(formatNumber(value));
}

function writeFieldAttributeBlock(lines: string[], results: readonly PreparedResult[]): void {
  lines.push(`FIELD FieldData ${String(results.length)}`);
  for (const prepared of results) {
    lines.push(
      `${prepared.result.name} ${String(prepared.result.components)} ${String(prepared.values.length / prepared.result.components)} double`,
    );
    for (const value of prepared.values) lines.push(formatNumber(value));
  }
}

function isNativeAttribute(result: ModelResultField): boolean {
  return result.components === 1 || result.components === 3 || result.components === 9;
}

function validateResultName(name: string): void {
  const numericToken = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u;
  if (
    name.length === 0 ||
    name.trim() !== name ||
    /[\s,#!]/u.test(name) ||
    VTK_KEYWORDS.has(name) ||
    numericToken.test(name)
  ) {
    throw new VtkWriteError(
      "unsupported-writer-state",
      `VTK result name '${name}' must be one non-keyword token without separators or comments`,
    );
  }
}

/** Formats one finite value for ASCII VTK output. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new VtkWriteError("unsupported-writer-state", "VTK cannot represent a non-finite number");
  }
  return String(value);
}

/** Creates the shared invalid-model writer error with optional diagnostics. */
export function invalidModel(message: string, issues?: readonly Issue[]): VtkWriteError {
  return new VtkWriteError("invalid-model", message, issues);
}
