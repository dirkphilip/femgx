import type { ElementShape } from "../elements/shapes";
import { Float64Buffer, Uint32Buffer } from "./growable";
import { textLines, tokensOf } from "./numbers";
import { createParseSession, finishParse, type ParseOptions, type ParseResult } from "./session";
import type { ParseSession } from "./session";
import {
  beginData,
  readDataLine,
  readFieldLine,
  startArray,
  startField,
  type ArrayBlock,
} from "./vtk-data";
import {
  finalizeGeometry,
  readCellsLine,
  readCellTypesLine,
  readPointsLine,
  startCells,
  startCellTypes,
  startPoints,
} from "./vtk-cells";

const VTK_KEYWORDS = new Set([
  "DATASET",
  "POINTS",
  "CELLS",
  "CELL_TYPES",
  "POINT_DATA",
  "CELL_DATA",
  "SCALARS",
  "VECTORS",
  "NORMALS",
  "TENSORS",
  "FIELD",
  "LOOKUP_TABLE",
  "COLOR_SCALARS",
  "METADATA",
]);

type VtkMode = "top" | "points" | "cells" | "cell-types" | "data" | "field" | "skip";

/** Mutable state shared by the VTK legacy reader's helper modules. */
export interface VtkState {
  readonly session: ParseSession;
  mode: VtkMode;
  pointsRemaining: number;
  nodeIds: number[];
  coords: number[];
  nextNodeId: number;
  cellsRemaining: number;
  cellStarts: Uint32Buffer;
  cellConnectivity: Uint32Buffer;
  cellTypesRemaining: number;
  cellTypes: Uint32Buffer;
  cellCount: number;
  sectionCount: number;
  location: "node" | "element";
  arrayName: string;
  components: number;
  arrayValues: Float64Buffer;
  fieldRemaining: number;
  dataBlocks: ArrayBlock[];
  openShape: ElementShape | undefined;
}

/**
 * Reads an ASCII VTK legacy dataset. Only `DATASET UNSTRUCTURED_GRID` is
 * supported; nodes are implicitly numbered 0..n-1 and cells by their position.
 */
export function parseVtk(source: string, options: ParseOptions = {}): ParseResult {
  const session = createParseSession(options);
  readVtk(session, source);
  return finishParse(session, options);
}

function readVtk(session: ParseSession, source: string): void {
  const state = createVtkState(session);
  let headerLines = 0;
  for (const { text, line } of textLines(source)) {
    session.checkCancelled();
    if (headerLines < 3) {
      headerLines += 1;
      readVtkHeader(state, headerLines, text, line);
    } else {
      stepVtk(state, text, line);
    }
  }
  finalizeGeometry(state);
}

/** Creates an empty reader state for a VTK legacy file. */
export function createVtkState(session: ParseSession): VtkState {
  return {
    session,
    mode: "top",
    pointsRemaining: 0,
    nodeIds: [],
    coords: [],
    nextNodeId: 0,
    cellsRemaining: 0,
    cellStarts: new Uint32Buffer(),
    cellConnectivity: new Uint32Buffer(),
    cellTypesRemaining: 0,
    cellTypes: new Uint32Buffer(),
    cellCount: 0,
    sectionCount: 0,
    location: "node",
    arrayName: "",
    components: 0,
    arrayValues: new Float64Buffer(),
    fieldRemaining: 0,
    dataBlocks: [],
    openShape: undefined,
  };
}

function readVtkHeader(state: VtkState, index: number, text: string, line: number): void {
  const trimmed = text.trim();
  if (index === 1 && !trimmed.startsWith("# vtk DataFile")) {
    state.session.report("missing-vtk-header", "Expected '# vtk DataFile' on the first line", {
      line,
    });
    state.mode = "skip";
  }
  if (index === 3) {
    if (trimmed === "BINARY") {
      state.session.report(
        "binary-unsupported",
        "Binary VTK files are not supported; export as ASCII",
        { line },
      );
      state.mode = "skip";
    } else if (trimmed !== "ASCII") {
      state.session.report(
        "missing-ascii-declaration",
        `Expected 'ASCII' or 'BINARY' on the third line, got '${trimmed}'`,
        { line },
      );
      state.mode = "skip";
    }
  }
}

function stepVtk(state: VtkState, text: string, line: number): void {
  if (state.mode === "skip") {
    return;
  }
  const tokens = tokensOf(text);
  if (tokens.length === 0) {
    return;
  }
  const first = tokens[0] ?? "";
  if (state.mode === "field") {
    if (VTK_KEYWORDS.has(first)) {
      handleVtkKeyword(state, first, tokens, line);
    } else {
      readFieldLine(state, text, line);
    }
    return;
  }
  if (VTK_KEYWORDS.has(first)) {
    handleVtkKeyword(state, first, tokens, line);
    return;
  }
  switch (state.mode) {
    case "points":
      readPointsLine(state, text, line);
      return;
    case "cells":
      readCellsLine(state, text, line);
      return;
    case "cell-types":
      readCellTypesLine(state, text, line);
      return;
    case "data":
      readDataLine(state, text, line);
      return;
    case "top":
      state.session.report(
        "unexpected-line",
        `Unexpected line before any dataset section: ${text.trim()}`,
        { line },
      );
      return;
  }
}

function handleVtkKeyword(
  state: VtkState,
  keyword: string,
  tokens: readonly string[],
  line: number,
): void {
  switch (keyword) {
    case "DATASET":
      if (tokens[1] !== "UNSTRUCTURED_GRID") {
        state.session.report(
          "unsupported-dataset",
          `Only DATASET UNSTRUCTURED_GRID is supported, got '${tokens[1] ?? ""}'`,
          { line },
        );
        state.mode = "skip";
      }
      return;
    case "POINTS":
      startPoints(state, tokens, line);
      return;
    case "CELLS":
      startCells(state, tokens, line);
      return;
    case "CELL_TYPES":
      startCellTypes(state, tokens, line);
      return;
    case "POINT_DATA":
      beginData(state, "node", tokens, line);
      return;
    case "CELL_DATA":
      beginData(state, "element", tokens, line);
      return;
    case "SCALARS":
      startArray(state, scalarComponents(tokens), tokens[1] ?? "", line);
      return;
    case "VECTORS":
    case "NORMALS":
      startArray(state, 3, tokens[1] ?? "", line);
      return;
    case "TENSORS":
      startArray(state, 9, tokens[1] ?? "", line);
      return;
    case "FIELD":
      startField(state, tokens, line);
      return;
    case "LOOKUP_TABLE":
      return;
    default:
      state.mode = "skip";
  }
}

function scalarComponents(tokens: readonly string[]): number {
  const declared = Number(tokens[3]);
  return Number.isInteger(declared) && declared > 0 ? declared : 1;
}
