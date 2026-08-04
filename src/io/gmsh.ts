import type { ElementShape } from "../elements/shapes";
import { numbersOf, textLines } from "./numbers";
import { createParseSession, finishParse, type ParseOptions, type ParseResult } from "./session";
import type { ParseSession } from "./session";
import { beginDataSection, finalizeDataSections, readDataSectionLine } from "./gmsh-data";
import type { GmshDataSection } from "./gmsh-data";
import { flushGmshElements, flushGmshNodes, readElementsLine, readNodesLine } from "./gmsh-scan";

interface PhysicalName {
  readonly dim: number;
  readonly index: number;
  readonly name: string;
}

/** Mutable state shared by the Gmsh reader's helper modules. */
export interface GmshState {
  readonly session: ParseSession;
  section: string | undefined;
  stopped: boolean;
  pendingNodeCount: number;
  pendingElementCount: number;
  nodeRead: number;
  elementRead: number;
  pendingIds: number[];
  pendingCoords: number[];
  pendingElementIds: number[];
  pendingElementConn: number[];
  pendingShape: ElementShape | undefined;
  physicals: PhysicalName[];
  pendingPhysicalCount: number;
  physicalElements: Map<number, number[]>;
  unsupportedTypes: Map<number, number>;
  data: GmshDataSection | undefined;
}

/**
 * Reads an ASCII Gmsh MSH 2.2 file. Node and element ids are preserved,
 * physical groups become element sets, and `$NodeData`/`$ElementData` blocks
 * become result fields.
 */
export function parseGmsh(source: string, options: ParseOptions = {}): ParseResult {
  const session = createParseSession(options);
  readGmsh(session, source);
  return finishParse(session, options);
}

function readGmsh(session: ParseSession, source: string): void {
  const state = createGmshState(session);
  for (const { text, line } of textLines(source)) {
    session.checkCancelled();
    if (state.stopped) {
      return;
    }
    const trimmed = text.trim();
    if (trimmed.startsWith("$")) {
      beginGmshSection(state, trimmed);
    } else if (state.section !== undefined) {
      gmshSectionLine(state, trimmed, line);
    }
  }
  finalizeGmsh(state);
}

/** Creates an empty reader state for a Gmsh file. */
export function createGmshState(session: ParseSession): GmshState {
  return {
    session,
    section: undefined,
    stopped: false,
    pendingNodeCount: -1,
    pendingElementCount: -1,
    nodeRead: 0,
    elementRead: 0,
    pendingIds: [],
    pendingCoords: [],
    pendingElementIds: [],
    pendingElementConn: [],
    pendingShape: undefined,
    physicals: [],
    pendingPhysicalCount: -1,
    physicalElements: new Map(),
    unsupportedTypes: new Map(),
    data: undefined,
  };
}

function beginGmshSection(state: GmshState, trimmed: string): void {
  if (trimmed.startsWith("$End")) {
    if (trimmed === "$EndNodeData" || trimmed === "$EndElementData") {
      finalizeDataSections(state);
    }
    state.section = undefined;
    return;
  }
  switch (trimmed) {
    case "$MeshFormat":
      state.section = "mesh-format";
      return;
    case "$PhysicalNames":
      state.section = "physical-names";
      state.pendingPhysicalCount = -1;
      return;
    case "$Nodes":
      state.section = "nodes";
      state.pendingNodeCount = -1;
      return;
    case "$Elements":
      state.section = "elements";
      state.pendingElementCount = -1;
      return;
    case "$NodeData":
      state.section = "node-data";
      state.data = beginDataSection(state, "node");
      return;
    case "$ElementData":
      state.section = "element-data";
      state.data = beginDataSection(state, "element");
      return;
    default:
      state.section = "skip";
  }
}

function gmshSectionLine(state: GmshState, text: string, line: number): void {
  switch (state.section) {
    case "mesh-format":
      readMeshFormat(state, text, line);
      return;
    case "physical-names":
      readPhysicalNamesLine(state, text, line);
      return;
    case "nodes":
      readNodesLine(state, text, line);
      return;
    case "elements":
      readElementsLine(state, text, line);
      return;
    case "node-data":
    case "element-data":
      readDataSectionLine(state, text, line);
      return;
    default:
      return;
  }
}

function readMeshFormat(state: GmshState, text: string, line: number): void {
  const values = numbersOf(text);
  if (values === undefined || values.length < 2) {
    state.session.report("bad-mesh-format", `Malformed $MeshFormat line '${text}'`, { line });
    state.stopped = true;
    return;
  }
  const fileType = values[1] ?? 0;
  const version = values[0] ?? 0;
  if (fileType !== 0) {
    state.session.report(
      "binary-unsupported",
      "Only ASCII Gmsh files are supported (file type 0)",
      { line },
    );
    state.stopped = true;
    return;
  }
  if (version !== 2.2) {
    state.session.report(
      "unsupported-version",
      `Only MSH 2.2 is supported, got version ${String(version)}`,
      { line },
    );
    state.stopped = true;
    return;
  }
  state.section = undefined;
}

function readPhysicalNamesLine(state: GmshState, text: string, line: number): void {
  if (state.pendingPhysicalCount === -1) {
    const count = Number(text);
    if (!Number.isInteger(count) || count < 0) {
      state.session.report("bad-physical-count", `Malformed physical name count '${text}'`, {
        line,
      });
      state.section = "skip";
      return;
    }
    state.pendingPhysicalCount = count;
    return;
  }
  const match = /^(\d+)\s+(\d+)\s+"([^"]*)"/.exec(text);
  if (match === null) {
    state.session.report("bad-physical-name", `Malformed physical name line '${text}'`, { line });
    return;
  }
  state.physicals.push({ dim: Number(match[1]), index: Number(match[2]), name: match[3] ?? "" });
  state.pendingPhysicalCount -= 1;
}

function finalizeGmsh(state: GmshState): void {
  flushGmshNodes(state);
  flushGmshElements(state);
  if (state.pendingNodeCount !== -1 && state.nodeRead !== state.pendingNodeCount) {
    state.session.report(
      "node-count-mismatch",
      `$Nodes declares ${String(state.pendingNodeCount)} nodes but ${String(state.nodeRead)} were read`,
    );
  }
  if (state.pendingElementCount !== -1 && state.elementRead !== state.pendingElementCount) {
    state.session.report(
      "element-count-mismatch",
      `$Elements declares ${String(state.pendingElementCount)} elements but ${String(state.elementRead)} were read`,
    );
  }
  addPhysicalSets(state);
  for (const [type, count] of state.unsupportedTypes) {
    state.session.report(
      "unsupported-element-type",
      `Skipped ${String(count)} elements of unsupported Gmsh type ${String(type)}`,
    );
  }
  finalizeDataSections(state);
  state.session.progress(1, "Finished reading Gmsh");
}

function addPhysicalSets(state: GmshState): void {
  for (const physical of state.physicals) {
    const members = state.physicalElements.get(physical.index);
    if (members === undefined || members.length === 0) {
      continue;
    }
    if (physical.name.length === 0) {
      state.session.report("empty-set-name", "A physical group has an empty name");
      continue;
    }
    state.session.builder.addSet("element", physical.name, members);
  }
}
