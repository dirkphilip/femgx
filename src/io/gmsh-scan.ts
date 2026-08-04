import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
  topologyFor,
  type ElementShape,
} from "../elements/shapes";
import { numbersOf, tokensOf } from "./numbers";
import type { GmshState } from "./gmsh";

const GMSH_TYPES: ReadonlyMap<number, ElementShape> = new Map([
  [15, POINT_SHAPE],
  [1, LINE_SHAPE],
  [8, LINE3_SHAPE],
  [4, TET4_SHAPE],
  [11, TET10_SHAPE],
  [5, HEX8_SHAPE],
  [17, HEX20_SHAPE],
]);

/** Consumes one `$Nodes` line: the count header or an `id x y z` node. */
export function readNodesLine(state: GmshState, text: string, line: number): void {
  if (state.pendingNodeCount === -1) {
    const count = Number(text);
    if (!Number.isInteger(count) || count < 0) {
      state.session.report("bad-node-count", `Malformed node count '${text}'`, { line });
      state.section = "skip";
      return;
    }
    state.pendingNodeCount = count;
    return;
  }
  const values = numbersOf(text);
  if (values === undefined || values.length < 4) {
    state.session.report("bad-node-line", `Expected 'id x y z' but got '${text}'`, { line });
    return;
  }
  const id = values[0] ?? -1;
  if (!Number.isInteger(id) || id < 0) {
    state.session.report(
      "bad-node-id",
      `Node id must be a non-negative integer, got '${String(values[0])}'`,
      { line },
    );
    return;
  }
  state.pendingIds.push(id);
  state.pendingCoords.push(values[1] ?? 0, values[2] ?? 0, values[3] ?? 0);
  state.nodeRead += 1;
  if (state.pendingIds.length >= 512) {
    flushGmshNodes(state);
  }
}

/** Consumes one `$Elements` line: the count header or an element record. */
export function readElementsLine(state: GmshState, text: string, line: number): void {
  if (state.pendingElementCount === -1) {
    const count = Number(text);
    if (!Number.isInteger(count) || count < 0) {
      state.session.report("bad-element-count", `Malformed element count '${text}'`, { line });
      state.section = "skip";
      return;
    }
    state.pendingElementCount = count;
    return;
  }
  readElementLine(state, tokensOf(text), line);
}

function readElementLine(state: GmshState, tokens: readonly string[], line: number): void {
  const id = Number(tokens[0]);
  const type = Number(tokens[1]);
  const numTags = Number(tokens[2]);
  if (
    !Number.isInteger(id) ||
    id < 0 ||
    !Number.isInteger(type) ||
    !Number.isInteger(numTags) ||
    numTags < 0
  ) {
    state.session.report("bad-element-line", `Malformed element line '${tokens.join(" ")}'`, {
      line,
    });
    return;
  }
  const shape = GMSH_TYPES.get(type);
  if (shape === undefined) {
    state.unsupportedTypes.set(type, (state.unsupportedTypes.get(type) ?? 0) + 1);
    return;
  }
  const nodeCount = topologyFor(shape).nodeCount;
  if (tokens.length !== 3 + numTags + nodeCount) {
    state.session.report(
      "bad-element-line",
      `Element ${String(id)} has the wrong number of entries`,
      { line },
    );
    return;
  }
  const physicalIndex = Number(tokens[3]);
  if (numTags >= 1 && Number.isInteger(physicalIndex) && physicalIndex > 0) {
    addPhysicalMember(state, physicalIndex, id);
  }
  const nodeIds: number[] = [];
  for (let index = 0; index < nodeCount; index += 1) {
    const nodeId = Number(tokens[3 + numTags + index]);
    if (!Number.isInteger(nodeId) || nodeId < 0) {
      state.session.report("bad-node-id", `Element ${String(id)} references an invalid node id`, {
        line,
      });
      return;
    }
    nodeIds.push(nodeId);
  }
  if (state.pendingShape !== shape) {
    flushGmshElements(state);
    state.session.builder.openElementBlock(shape);
    state.pendingShape = shape;
  }
  state.pendingElementIds.push(id);
  for (const nodeId of nodeIds) {
    state.pendingElementConn.push(nodeId);
  }
  state.elementRead += 1;
  if (state.pendingElementIds.length >= 512) {
    flushGmshElements(state);
  }
}

function addPhysicalMember(state: GmshState, index: number, elementId: number): void {
  let members = state.physicalElements.get(index);
  if (members === undefined) {
    members = [];
    state.physicalElements.set(index, members);
  }
  members.push(elementId);
}

/** Appends buffered nodes to the builder, clearing the buffers. */
export function flushGmshNodes(state: GmshState): void {
  if (state.pendingIds.length > 0) {
    state.session.builder.appendNodes(state.pendingIds, state.pendingCoords);
    state.pendingIds = [];
    state.pendingCoords = [];
  }
}

/** Appends buffered elements to the builder, clearing the buffers. */
export function flushGmshElements(state: GmshState): void {
  if (state.pendingElementIds.length > 0) {
    state.session.builder.appendElements(state.pendingElementIds, state.pendingElementConn);
    state.pendingElementIds = [];
    state.pendingElementConn = [];
  }
}
