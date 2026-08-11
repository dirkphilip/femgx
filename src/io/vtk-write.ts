import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  QUAD_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
  TRIANGLE_SHAPE,
  topologyFor,
  type ElementShape,
} from "../elements/shapes";
import { VtkWriteError, type Issue } from "./diagnostics";
import type { FemModel, ModelElementBlock, ModelResultField } from "./model";
import { validateModel } from "./validate";

const VTK_TYPES: ReadonlyMap<string, number> = new Map([
  [shapeKey(POINT_SHAPE), 1],
  [shapeKey(LINE_SHAPE), 3],
  [shapeKey(TRIANGLE_SHAPE), 5],
  [shapeKey(QUAD_SHAPE), 9],
  [shapeKey(LINE3_SHAPE), 21],
  [shapeKey(TET4_SHAPE), 10],
  [shapeKey(TET10_SHAPE), 24],
  [shapeKey(HEX8_SHAPE), 12],
  [shapeKey(HEX20_SHAPE), 25],
]);

interface EmittedCell {
  readonly id: number;
  readonly shape: ElementShape;
  readonly vtkType: number;
  readonly connectivity: readonly number[];
}

interface PreparedResult {
  readonly result: ModelResultField;
  readonly values: Float64Array;
}

interface WritePlan {
  readonly nodeIds: readonly number[];
  readonly cells: readonly EmittedCell[];
  readonly pointResults: readonly PreparedResult[];
  readonly cellResults: readonly PreparedResult[];
}

/**
 * Writes an ASCII VTK legacy unstructured grid. VTK rows use implicit ids, so
 * authoritative model identities are remapped to deterministic point and cell
 * rows before any output is constructed.
 */
export function writeVtk(model: FemModel): string {
  const plan = prepareWrite(model);
  const lines: string[] = [];
  lines.push("# vtk DataFile Version 5.0", "femgx export", "ASCII", "DATASET UNSTRUCTURED_GRID");
  lines.push(`POINTS ${String(plan.nodeIds.length)} double`);
  writeCoordinates(model, lines);
  writeCells(plan.cells, lines);
  writePointData(plan.pointResults, lines, plan.nodeIds.length);
  writeCellData(plan.cellResults, lines, plan.cells.length);
  return lines.join("\n") + "\n";
}

function prepareWrite(model: FemModel): WritePlan {
  validateForWrite(model);
  const nodeRows = createNodeRows(model);
  const nodeIds = [...model.nodes.ids];
  const cells = createCells(model, nodeRows);
  const cellIds = cells.map((cell) => cell.id);
  const pointResults = prepareResults(model.results, "node", nodeIds);
  const cellResults = prepareResults(model.results, "element", cellIds);
  return { nodeIds, cells, pointResults, cellResults };
}

function validateForWrite(model: FemModel): void {
  let issues: readonly Issue[];
  try {
    issues = validateModel(model);
  } catch (error) {
    throw invalidModel(`Model validation failed: ${errorMessage(error)}`);
  }
  const errors = issues.filter(
    (issue) =>
      issue.severity === "error" &&
      issue.code !== "missing-result-id" &&
      issue.code !== "result-shape",
  );
  if (errors.length > 0) {
    throw new VtkWriteError(
      "invalid-model",
      `Cannot write VTK model: ${errors.map((issue) => issue.message).join("; ")}`,
      errors,
    );
  }
  if (model.formatVersion !== 1) {
    throw new VtkWriteError(
      "unsupported-writer-state",
      `VTK writer supports FemModel format version 1, got ${String(model.formatVersion)}`,
    );
  }
}

function createNodeRows(model: FemModel): Map<number, number> {
  const rows = new Map<number, number>();
  for (let row = 0; row < model.nodes.count; row += 1) {
    const id = requiredValue(model.nodes.ids[row], `Node table is missing id at row ${row}`);
    if (rows.has(id)) {
      throw invalidModel(`Node table repeats authoritative id ${id}`);
    }
    const coordinates = [
      model.nodes.coordinates[row * 3],
      model.nodes.coordinates[row * 3 + 1],
      model.nodes.coordinates[row * 3 + 2],
    ];
    if (coordinates.some((value) => value === undefined || !Number.isFinite(value))) {
      throw invalidModel(`Node ${id} has a missing or non-finite coordinate`);
    }
    rows.set(id, row);
  }
  return rows;
}

function createCells(model: FemModel, nodeRows: ReadonlyMap<number, number>): EmittedCell[] {
  const cells: EmittedCell[] = [];
  for (const block of model.elementBlocks) {
    const vtkType = VTK_TYPES.get(shapeKey(block.shape));
    if (vtkType === undefined) {
      throw new VtkWriteError(
        "unsupported-writer-state",
        `VTK writer has no cell type for ${block.shape.family} order ${block.shape.order}`,
      );
    }
    appendBlockCells(cells, block, vtkType, nodeRows);
  }
  return cells;
}

function appendBlockCells(
  cells: EmittedCell[],
  block: ModelElementBlock,
  vtkType: number,
  nodeRows: ReadonlyMap<number, number>,
): void {
  const nodeCount = topologyFor(block.shape).nodeCount;
  for (let row = 0; row < block.count; row += 1) {
    const id = requiredValue(block.ids[row], `Element block is missing id at row ${row}`);
    const connectivity: number[] = [];
    for (let node = 0; node < nodeCount; node += 1) {
      const sourceId = requiredValue(
        block.connectivity[row * nodeCount + node],
        `Element ${id} is missing connectivity at position ${node}`,
      );
      const emittedRow = nodeRows.get(sourceId);
      if (emittedRow === undefined) {
        throw invalidModel(`Element ${id} references unknown node ${sourceId}`);
      }
      connectivity.push(emittedRow);
    }
    cells.push({ id, shape: block.shape, vtkType, connectivity });
  }
}

function prepareResults(
  results: readonly ModelResultField[],
  location: "node" | "element",
  emittedIds: readonly number[],
): PreparedResult[] {
  validateResultLocations(results);
  return results
    .filter((result) => result.location === location)
    .map((result) => prepareResult(result, emittedIds));
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
  if (result.components !== 1 && result.components !== 3) {
    throw new VtkWriteError(
      "unsupported-writer-state",
      `VTK result ${result.name} has ${result.components} components; only scalar and vector fields are supported`,
    );
  }
  if (result.name.length === 0) {
    throw new VtkWriteError("unsupported-writer-state", "VTK result names must not be empty");
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
    const id = requiredValue(
      result.ids[row],
      `Result ${result.name} is missing an id at row ${row}`,
    );
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

function writeCoordinates(model: FemModel, lines: string[]): void {
  for (let row = 0; row < model.nodes.count; row += 1) {
    const offset = row * 3;
    const x = requiredValue(model.nodes.coordinates[offset], `Node row ${row} is missing x`);
    const y = requiredValue(model.nodes.coordinates[offset + 1], `Node row ${row} is missing y`);
    const z = requiredValue(model.nodes.coordinates[offset + 2], `Node row ${row} is missing z`);
    lines.push(`${formatNumber(x)} ${formatNumber(y)} ${formatNumber(z)}`);
  }
}

function writeCells(cells: readonly EmittedCell[], lines: string[]): void {
  const connectivitySize = cells.reduce((size, cell) => size + cell.connectivity.length + 1, 0);
  lines.push(`CELLS ${String(cells.length)} ${String(connectivitySize)}`);
  for (const cell of cells) {
    lines.push(
      `${String(cell.connectivity.length)} ${cell.connectivity.map(formatNumber).join(" ")}`,
    );
  }
  lines.push(`CELL_TYPES ${String(cells.length)}`);
  for (const cell of cells) lines.push(formatNumber(cell.vtkType));
}

function writePointData(
  results: readonly PreparedResult[],
  lines: string[],
  nodeCount: number,
): void {
  if (results.length === 0) return;
  lines.push(`POINT_DATA ${String(nodeCount)}`);
  writeAttributes(lines, results);
}

function writeCellData(
  results: readonly PreparedResult[],
  lines: string[],
  cellCount: number,
): void {
  if (results.length === 0) return;
  lines.push(`CELL_DATA ${String(cellCount)}`);
  writeAttributes(lines, results);
}

function writeAttributes(lines: string[], results: readonly PreparedResult[]): void {
  for (const prepared of results) {
    if (prepared.result.components === 1) {
      lines.push(`SCALARS ${prepared.result.name} double`, "LOOKUP_TABLE default");
    } else {
      lines.push(`VECTORS ${prepared.result.name} double`);
    }
    for (const value of prepared.values) lines.push(formatNumber(value));
  }
}

function shapeKey(shape: ElementShape): string {
  return `${shape.family}:${shape.order}`;
}

function requiredValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw invalidModel(message);
  return value;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new VtkWriteError("unsupported-writer-state", "VTK cannot represent a non-finite number");
  }
  return String(value);
}

function invalidModel(message: string, issues?: readonly Issue[]): VtkWriteError {
  return new VtkWriteError("invalid-model", message, issues);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
