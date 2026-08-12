import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  QUAD8_SHAPE,
  QUAD_SHAPE,
  TRI6_SHAPE,
  TRIANGLE_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
  topologyFor,
  type ElementShape,
} from "../elements/shapes";
import { numbersOf } from "./numbers";
import { addDataBlocks, closeArray } from "./vtk-data";
import type { VtkState } from "./vtk-state";

const VTK_TYPES: ReadonlyMap<number, ElementShape> = new Map([
  [1, POINT_SHAPE],
  [3, LINE_SHAPE],
  [5, TRIANGLE_SHAPE],
  [22, TRI6_SHAPE],
  [9, QUAD_SHAPE],
  [23, QUAD8_SHAPE],
  [21, LINE3_SHAPE],
  [10, TET4_SHAPE],
  [24, TET10_SHAPE],
  [12, HEX8_SHAPE],
  [25, HEX20_SHAPE],
]);

/** Sentinel `cellStarts` entry marking a cell whose node ids were not valid integers. */
const MISSING_START = 0xffffffff;

/** Sentinel `cellTypes` entry marking a type that is not a non-negative 32-bit integer. */
const INVALID_TYPE = 0xffffffff;

/** Starts collecting a POINTS block; `tokens[1]` is the node count. */
export function startPoints(state: VtkState, tokens: readonly string[], line: number): void {
  const count = Number(tokens[1]);
  if (!Number.isInteger(count) || count < 0) {
    state.session.report(
      "bad-points-declaration",
      `POINTS must declare a non-negative count, got '${tokens[1] ?? ""}'`,
      { line },
    );
    state.mode = "skip";
    return;
  }
  flushPoints(state);
  state.pointsRemaining = count * 3;
  state.mode = "points";
}

/** Starts collecting a CELLS block; `tokens[1]` is the cell count. */
export function startCells(state: VtkState, tokens: readonly string[], line: number): void {
  const count = Number(tokens[1]);
  if (!Number.isInteger(count) || count < 0) {
    state.session.report(
      "bad-cells-declaration",
      `CELLS must declare a non-negative count, got '${tokens[1] ?? ""}'`,
      { line },
    );
    state.mode = "skip";
    return;
  }
  state.cellsRemaining = count;
  state.mode = "cells";
}

/** Starts collecting a CELL_TYPES block; `tokens[1]` is the type count. */
export function startCellTypes(state: VtkState, tokens: readonly string[], line: number): void {
  const count = Number(tokens[1]);
  if (!Number.isInteger(count) || count < 0) {
    state.session.report(
      "bad-cell-types-declaration",
      `CELL_TYPES must declare a non-negative count, got '${tokens[1] ?? ""}'`,
      { line },
    );
    state.mode = "skip";
    return;
  }
  state.cellTypesRemaining = count;
  state.mode = "cell-types";
}

/** Consumes one line of point coordinates while in POINTS mode. */
export function readPointsLine(state: VtkState, text: string, line: number): void {
  const values = numbersOf(text);
  if (values === undefined) {
    state.session.report("bad-number", `Expected point coordinates, got '${text.trim()}'`, {
      line,
    });
    return;
  }
  for (let index = 0; index + 2 < values.length; index += 3) {
    if (state.pointsRemaining <= 0) {
      state.session.report("extra-point-data", "More point data than declared in POINTS", { line });
      return;
    }
    const x = values[index];
    const y = values[index + 1];
    const z = values[index + 2];
    if (x === undefined || y === undefined || z === undefined) {
      continue;
    }
    collectPoint(state, x, y, z);
    state.pointsRemaining -= 3;
  }
}

function collectPoint(state: VtkState, x: number, y: number, z: number): void {
  state.nodeIds.push(state.nextNodeId);
  state.coords.push(x, y, z);
  state.nextNodeId += 1;
  if (state.nodeIds.length >= 1024) {
    flushPoints(state);
  }
}

/** Appends buffered points to the builder, clearing the buffers. */
export function flushPoints(state: VtkState): void {
  if (state.nodeIds.length > 0) {
    state.session.builder.appendNodes(state.nodeIds, state.coords);
    state.nodeIds = [];
    state.coords = [];
  }
}

/** Consumes one cell connectivity line while in CELLS mode. */
export function readCellsLine(state: VtkState, text: string, line: number): void {
  const values = numbersOf(text);
  if (values === undefined || values.length === 0) {
    state.session.report("bad-number", `Expected cell connectivity, got '${text.trim()}'`, {
      line,
    });
    return;
  }
  const nodeCount = values[0] ?? 0;
  if (!Number.isInteger(nodeCount) || values.length !== nodeCount + 1) {
    state.session.report(
      "bad-cell-line",
      `Cell on line ${String(line)} declares ${String(nodeCount)} nodes but lists ${String(values.length - 1)}`,
      { line },
    );
    return;
  }
  if (state.cellsRemaining <= 0) {
    state.session.report("extra-cell-data", "More cells than declared in CELLS", { line });
    return;
  }
  const ids = values.slice(1);
  state.cellStarts.push(
    ids.every((id) => Number.isInteger(id) && id >= 0)
      ? state.cellConnectivity.size
      : MISSING_START,
  );
  state.cellConnectivity.append(ids);
  state.cellCount += 1;
  state.cellsRemaining -= 1;
}

/** Consumes one cell type line while in CELL_TYPES mode. */
export function readCellTypesLine(state: VtkState, text: string, line: number): void {
  const values = numbersOf(text);
  if (values === undefined) {
    state.session.report("bad-number", `Expected a cell type, got '${text.trim()}'`, { line });
    return;
  }
  for (const value of values) {
    if (state.cellTypesRemaining <= 0) {
      state.session.report("extra-cell-types", "More cell types than declared in CELL_TYPES", {
        line,
      });
      return;
    }
    const validType = Number.isInteger(value) && value >= 0 && value <= INVALID_TYPE;
    state.cellTypes.push(validType ? value : INVALID_TYPE);
    state.cellTypesRemaining -= 1;
  }
}

/** Finalizes geometry: assembles element blocks and appends attribute results. */
export function finalizeGeometry(state: VtkState): void {
  flushPoints(state);
  if (state.pointsRemaining > 0) {
    state.session.report(
      "point-count-mismatch",
      `POINTS is missing ${String(state.pointsRemaining / 3)} declared point(s)`,
    );
  }
  if (state.cellsRemaining > 0) {
    state.session.report(
      "cell-count-mismatch",
      `CELLS is missing ${String(state.cellsRemaining)} declared cell(s)`,
    );
  }
  if (state.cellTypesRemaining > 0) {
    state.session.report(
      "cell-type-count-mismatch",
      `CELL_TYPES is missing ${String(state.cellTypesRemaining)} declared entry or entries`,
    );
  }
  if (state.fieldRemaining > 0) {
    state.session.report(
      "field-array-count-mismatch",
      `FIELD is missing ${String(state.fieldRemaining)} declared array(s)`,
    );
  }
  if (state.cellTypes.size !== state.cellCount) {
    state.session.report(
      "cell-type-count-mismatch",
      `CELLS declares ${String(state.cellCount)} cells but CELL_TYPES holds ${String(state.cellTypes.size)} entries`,
    );
  }
  assembleVtkElements(state);
  closeArray(state);
  addDataBlocks(state);
}

function assembleVtkElements(state: VtkState): void {
  for (let cell = 0; cell < state.cellTypes.size; cell += 1) {
    const shape = VTK_TYPES.get(state.cellTypes.at(cell) ?? -1);
    if (shape === undefined) {
      state.session.report(
        "unsupported-cell-type",
        `Skipping cell ${String(cell)} with unsupported VTK type ${String(state.cellTypes.at(cell))}`,
      );
      continue;
    }
    const nodeCount = topologyFor(shape).nodeCount;
    const start = state.cellStarts.at(cell);
    if (start === MISSING_START) {
      state.session.report(
        "bad-cell-shape",
        `Cell ${String(cell)} does not match shape ${shape.family} order ${String(shape.order)}`,
      );
      continue;
    }
    if (start === undefined) {
      state.session.report(
        "missing-cell-connectivity",
        `Cell ${String(cell)} has no connectivity entry in CELLS`,
      );
      continue;
    }
    const connectivity = state.cellConnectivity.slice(start, start + nodeCount);
    if (connectivity.length !== nodeCount) {
      state.session.report(
        "bad-cell-shape",
        `Cell ${String(cell)} does not match shape ${shape.family} order ${String(shape.order)}`,
      );
      continue;
    }
    if (state.openShape !== shape) {
      state.session.builder.openElementBlock(shape);
      state.openShape = shape;
    }
    state.session.builder.appendElements([cell], connectivity);
  }
}
