import { topologyFor, type ElementShape } from "../elements/shapes";
import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
} from "../elements/shapes";
import { parseFloatToken, tokenChunks } from "./numbers";
import type { VtuArray, VtuResult, VtuState } from "./vtu";

const VTK_TYPES: ReadonlyMap<number, ElementShape> = new Map([
  [1, POINT_SHAPE],
  [3, LINE_SHAPE],
  [21, LINE3_SHAPE],
  [10, TET4_SHAPE],
  [24, TET10_SHAPE],
  [12, HEX8_SHAPE],
  [25, HEX20_SHAPE],
]);

/** Parses an ASCII DataArray body into a typed float array. */
export function parseDataNumbers(state: VtuState, array: VtuArray): Float64Array | undefined {
  const values: number[] = [];
  for (const chunk of tokenChunks(array.raw, 1024)) {
    state.session.checkCancelled();
    for (const token of chunk) {
      const value = parseFloatToken(token);
      if (value === undefined) {
        state.session.report(
          "bad-number",
          `DataArray ${array.name || array.parent} contains a non-numeric token '${token}'`,
        );
        return undefined;
      }
      values.push(value);
    }
  }
  const result = new Float64Array(values.length);
  result.set(values);
  return result;
}

/** Casts a float array to a Uint32Array, rejecting non-integer values. */
export function asUint32(
  state: VtuState,
  array: VtuArray,
  values: Float64Array,
): Uint32Array | undefined {
  for (const value of values) {
    if (!Number.isInteger(value) || value < 0) {
      state.session.report(
        "bad-number",
        `DataArray ${array.name || array.parent} contains a non-integer value '${String(value)}'`,
      );
      return undefined;
    }
  }
  const result = new Uint32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    result[index] = values[index] ?? 0;
  }
  return result;
}

/** Finalizes a VTU parse: nodes, cells, results, and metadata. */
export function finalizeVtu(state: VtuState): void {
  appendVtuNodes(state);
  assembleVtuCells(state);
  addVtuResults(state);
  for (const [key, value] of Object.entries(state.metadata)) {
    state.session.builder.setMetadata(key, value);
  }
  state.session.progress(1, "Finished reading VTU");
}

function appendVtuNodes(state: VtuState): void {
  if (state.coordinates === undefined) {
    return;
  }
  const count = state.coordinates.length / 3;
  if (!Number.isInteger(count)) {
    state.session.report(
      "point-data-shape",
      "The points DataArray does not hold triples of coordinates",
    );
    return;
  }
  if (state.piecePoints > 0 && count !== state.piecePoints) {
    state.session.report(
      "point-data-shape",
      `Piece declares ${String(state.piecePoints)} points but the points DataArray holds ${String(count)}`,
    );
  }
  const ids = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) {
    ids[index] = index;
  }
  state.session.builder.appendNodes(ids, state.coordinates);
}

function assembleVtuCells(state: VtuState): void {
  if (
    state.connectivity === undefined ||
    state.offsets === undefined ||
    state.types === undefined
  ) {
    return;
  }
  if (state.pieceCells > 0 && state.offsets.length !== state.pieceCells) {
    state.session.report(
      "cell-data-shape",
      `Piece declares ${String(state.pieceCells)} cells but the types DataArray holds ${String(state.types.length)}`,
    );
  }
  const count = Math.min(state.types.length, state.offsets.length);
  let openShape: ElementShape | undefined;
  for (let cell = 0; cell < count; cell += 1) {
    const shape = VTK_TYPES.get(state.types[cell] ?? -1);
    if (shape === undefined) {
      state.session.report(
        "unsupported-cell-type",
        `Skipping cell ${String(cell)} with unsupported VTK type ${String(state.types[cell])}`,
      );
      continue;
    }
    const nodeCount = topologyFor(shape).nodeCount;
    const start = cell === 0 ? 0 : (state.offsets[cell - 1] ?? 0);
    const end = state.offsets[cell] ?? 0;
    if (end - start !== nodeCount) {
      state.session.report(
        "bad-cell-shape",
        `Cell ${String(cell)} does not match shape ${shape.family} order ${String(shape.order)}`,
      );
      continue;
    }
    if (openShape !== shape) {
      state.session.builder.openElementBlock(shape);
      openShape = shape;
    }
    state.session.builder.appendElements([cell], state.connectivity.subarray(start, end));
  }
}

function addVtuResults(state: VtuState): void {
  const nodeCount =
    state.coordinates === undefined ? state.piecePoints : state.coordinates.length / 3;
  const cellCount = state.types === undefined ? state.pieceCells : state.types.length;
  for (const result of state.pointResults) {
    addVtuResult(state, result, "node", nodeCount);
  }
  for (const result of state.cellResults) {
    addVtuResult(state, result, "element", cellCount);
  }
}

function addVtuResult(
  state: VtuState,
  result: VtuResult,
  location: "node" | "element",
  count: number,
): void {
  if (result.values.length !== count * result.components) {
    state.session.report(
      "result-shape",
      `Result ${result.name} has ${String(result.values.length)} values for ${String(count)} ${location}s`,
    );
    return;
  }
  const ids = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) {
    ids[index] = index;
  }
  state.session.builder.addResult({
    name: result.name,
    location,
    components: result.components,
    ids,
    values: result.values,
  });
}
