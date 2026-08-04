import { IoError } from "./diagnostics";
import type { MetadataValue } from "./model";
import { createParseSession, finishParse, type ParseOptions, type ParseResult } from "./session";
import type { ParseSession } from "./session";
import { asUint32, finalizeVtu, parseDataNumbers } from "./vtu-cells";
import { xmlTokens, type XmlToken } from "./xml";

/** A DataArray element being collected from the XML document. */
export interface VtuArray {
  readonly parent: string;
  readonly name: string;
  readonly components: number;
  readonly format: string;
  readonly metaType: string;
  raw: string;
}

/** A completed point or cell data result awaiting assembly. */
export interface VtuResult {
  readonly name: string;
  readonly components: number;
  readonly values: Float64Array;
}

/** Mutable state shared by the VTU reader's helper modules. */
export interface VtuState {
  readonly session: ParseSession;
  readonly stack: string[];
  activeArray: VtuArray | undefined;
  coordinates: Float64Array | undefined;
  connectivity: Uint32Array | undefined;
  offsets: Uint32Array | undefined;
  types: Uint32Array | undefined;
  pointResults: VtuResult[];
  cellResults: VtuResult[];
  metadata: Record<string, MetadataValue>;
  piecePoints: number;
  pieceCells: number;
}

/**
 * Reads a VTK XML UnstructuredGrid (`.vtu`). Data arrays are parsed from their
 * `ascii` content; binary and appended encodings are reported and skipped.
 */
export function parseVtu(source: string, options: ParseOptions = {}): ParseResult {
  const session = createParseSession(options);
  readVtu(session, source);
  return finishParse(session, options);
}

function readVtu(session: ParseSession, source: string): void {
  const state = createVtuState(session);
  try {
    for (const token of xmlTokens(source)) {
      session.checkCancelled();
      stepVtu(state, token);
    }
  } catch (error) {
    if (error instanceof IoError) {
      session.report("malformed-xml", error.message);
    } else {
      throw error;
    }
  }
  finalizeVtu(state);
}

/** Creates an empty reader state for a VTU document. */
export function createVtuState(session: ParseSession): VtuState {
  return {
    session,
    stack: [],
    activeArray: undefined,
    coordinates: undefined,
    connectivity: undefined,
    offsets: undefined,
    types: undefined,
    pointResults: [],
    cellResults: [],
    metadata: {},
    piecePoints: 0,
    pieceCells: 0,
  };
}

function stepVtu(state: VtuState, token: XmlToken): void {
  if (token.kind === "start") {
    state.stack.push(token.name);
    const attrs = token.attrs ?? {};
    if (token.name === "VTKFile") {
      if (attrs["type"] !== "UnstructuredGrid") {
        state.session.report(
          "unsupported-type",
          `Only VTKFile type 'UnstructuredGrid' is supported, got '${attrs["type"] ?? ""}'`,
        );
      }
    } else if (token.name === "Piece") {
      state.piecePoints = parseIntAttr(attrs["NumberOfPoints"]);
      state.pieceCells = parseIntAttr(attrs["NumberOfCells"]);
    } else if (token.name === "DataArray") {
      startDataArray(state, token);
    }
    return;
  }
  if (token.kind === "end") {
    const name = state.stack.pop();
    if (name === "DataArray") {
      endDataArray(state);
    }
    return;
  }
  if (
    state.stack.length > 0 &&
    state.stack[state.stack.length - 1] === "DataArray" &&
    state.activeArray !== undefined
  ) {
    state.activeArray.raw += token.text ?? "";
  }
}

function startDataArray(state: VtuState, token: XmlToken): void {
  const attrs = token.attrs ?? {};
  const parent = state.stack[state.stack.length - 2] ?? "";
  const name = attrs["Name"] ?? "";
  const components = parseIntAttr(attrs["NumberOfComponents"]) || 1;
  const format = attrs["format"] ?? "ascii";
  state.activeArray = {
    parent,
    name,
    components,
    format,
    metaType: attrs["femgx-type"] ?? "",
    raw: "",
  };
  if (format !== "ascii") {
    state.session.report(
      "unsupported-data-format",
      `DataArray ${name || parent} uses '${format}' encoding; only 'ascii' is supported`,
    );
  }
}

function endDataArray(state: VtuState): void {
  const array = state.activeArray;
  state.activeArray = undefined;
  if (array === undefined) {
    return;
  }
  if (array.parent === "FieldData") {
    state.metadata[array.name] = coerceMetadata(array.raw.trim(), array.metaType);
    return;
  }
  const values = parseDataNumbers(state, array);
  if (values === undefined) {
    return;
  }
  if (array.parent === "Points") {
    state.coordinates = values;
  } else if (array.parent === "Cells") {
    if (array.name === "connectivity") {
      state.connectivity = asUint32(state, array, values);
    } else if (array.name === "offsets") {
      state.offsets = asUint32(state, array, values);
    } else if (array.name === "types") {
      state.types = asUint32(state, array, values);
    }
  } else if (array.parent === "PointData") {
    state.pointResults.push({ name: array.name, components: array.components, values });
  } else if (array.parent === "CellData") {
    state.cellResults.push({ name: array.name, components: array.components, values });
  }
}

function coerceMetadata(raw: string, metaType: string): MetadataValue {
  if (metaType === "number") {
    const value = Number(raw);
    return Number.isFinite(value) ? value : raw;
  }
  if (metaType === "boolean") {
    return raw === "true";
  }
  return raw;
}

function parseIntAttr(raw: string | undefined): number {
  return Number(raw ?? "0");
}
