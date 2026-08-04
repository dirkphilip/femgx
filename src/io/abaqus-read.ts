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
import { numbersOf, parseFloatToken, tokensOf } from "./numbers";
import type { AbaqusState, PendingSet } from "./abaqus";

/** Consumes one `*NODE` data line: an id plus 2 or 3 coordinates. */
export function readAbaqusNode(state: AbaqusState, tokens: readonly string[], line: number): void {
  const values: number[] = [];
  for (const token of tokens) {
    const value = parseFloatToken(token);
    if (value === undefined) {
      state.session.report(
        "bad-number",
        `Expected a node id and coordinates, got '${tokens.join(" ")}'`,
        { line },
      );
      return;
    }
    values.push(value);
  }
  const id = values[0] ?? -1;
  let x: number;
  let y: number;
  let z: number;
  if (values.length === 3) {
    x = values[1] ?? 0;
    y = values[2] ?? 0;
    z = 0;
  } else if (values.length === 4) {
    x = values[1] ?? 0;
    y = values[2] ?? 0;
    z = values[3] ?? 0;
  } else {
    state.session.report("bad-node-line", "Node line must hold an id plus 2 or 3 coordinates", {
      line,
    });
    return;
  }
  if (!Number.isInteger(id) || id < 0) {
    state.session.report(
      "bad-node-id",
      `Node id must be a non-negative integer, got '${String(values[0])}'`,
      { line },
    );
    return;
  }
  state.pendingNodeIds.push(id);
  state.pendingCoords.push(x, y, z);
  if (state.nodeSet !== undefined) {
    ensureSet(state, "node", state.nodeSet).ids.push(id);
  }
  if (state.pendingNodeIds.length >= 512) {
    flushAbaqusNodes(state);
  }
}

/** Consumes one `*ELEMENT` data line: an id plus the block's node count. */
export function readAbaqusElement(
  state: AbaqusState,
  tokens: readonly string[],
  line: number,
): void {
  const shape = state.elementShape;
  if (shape === undefined) {
    return;
  }
  const values: number[] = [];
  for (const token of tokens) {
    const value = parseFloatToken(token);
    if (value === undefined) {
      state.session.report(
        "bad-number",
        `Expected element connectivity, got '${tokens.join(" ")}'`,
        { line },
      );
      return;
    }
    values.push(value);
  }
  const nodeCount = topologyFor(shape).nodeCount;
  if (values.length !== nodeCount + 1) {
    state.session.report(
      "bad-element-line",
      `Element line must hold an id plus ${String(nodeCount)} nodes`,
      { line },
    );
    return;
  }
  const id = values[0] ?? -1;
  if (!Number.isInteger(id) || id < 0) {
    state.session.report(
      "bad-element-id",
      `Element id must be a non-negative integer, got '${String(values[0])}'`,
      { line },
    );
    return;
  }
  for (let index = 1; index < values.length; index += 1) {
    const nodeId = values[index] ?? -1;
    if (!Number.isInteger(nodeId) || nodeId < 0) {
      state.session.report("bad-node-id", `Element ${String(id)} references an invalid node id`, {
        line,
      });
      return;
    }
  }
  state.pendingElementIds.push(id);
  for (let index = 1; index < values.length; index += 1) {
    state.pendingElementConn.push(values[index] ?? 0);
  }
  if (state.elsetName !== undefined) {
    ensureSet(state, "element", state.elsetName).ids.push(id);
  }
  if (state.pendingElementIds.length >= 512) {
    flushAbaqusElements(state);
  }
}

/** Consumes one `*NSET`/`*ELSET` data line of set ids or a GENERATE range. */
export function readAbaqusSet(
  state: AbaqusState,
  name: string,
  kind: "node" | "element",
  data: string,
): void {
  const set = ensureSet(state, kind, name);
  if (state.generateMode) {
    const values = numbersOf(data);
    const start = values?.[0] ?? NaN;
    const end = values?.[1] ?? NaN;
    const step = values?.[2] ?? NaN;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      !Number.isInteger(step) ||
      step <= 0
    ) {
      state.session.report("bad-generate-line", "GENERATE set data must be 'start, end, step'");
      return;
    }
    for (let id = start; id <= end; id += step) {
      set.ids.push(id);
    }
    return;
  }
  const tokens = tokensOf(data);
  for (const token of tokens) {
    const value = parseFloatToken(token);
    if (value === undefined || !Number.isInteger(value) || value < 0) {
      state.session.report(
        "non-numeric-set-entry",
        `Set ${name} contains a non-numeric entry '${token}'`,
      );
      continue;
    }
    set.ids.push(value);
  }
}

/** Appends buffered nodes to the builder, clearing the buffers. */
export function flushAbaqusNodes(state: AbaqusState): void {
  if (state.pendingNodeIds.length > 0) {
    state.session.builder.appendNodes(state.pendingNodeIds, state.pendingCoords);
    state.pendingNodeIds = [];
    state.pendingCoords = [];
  }
}

/** Appends buffered elements to the builder, clearing the buffers. */
export function flushAbaqusElements(state: AbaqusState): void {
  if (state.pendingElementIds.length > 0) {
    state.session.builder.appendElements(state.pendingElementIds, state.pendingElementConn);
    state.pendingElementIds = [];
    state.pendingElementConn = [];
  }
}

/** Maps an Abaqus element type name to a supported shape, or `undefined`. */
export function shapeForAbaqusType(raw: string): ElementShape | undefined {
  const type = raw.toUpperCase();
  const c3d = /^C3D(\d+)/.exec(type);
  if (c3d !== null) {
    switch (Number(c3d[1])) {
      case 4:
        return TET4_SHAPE;
      case 10:
        return TET10_SHAPE;
      case 8:
        return HEX8_SHAPE;
      case 20:
        return HEX20_SHAPE;
      default:
        return undefined;
    }
  }
  switch (type) {
    case "MASS":
    case "ROTARYI":
      return POINT_SHAPE;
    case "T3D2":
    case "B31":
      return LINE_SHAPE;
    case "T3D3":
    case "B32":
      return LINE3_SHAPE;
    default:
      return undefined;
  }
}

/** Returns the set with `name`, creating a node/element set entry if needed. */
export function ensureSet(state: AbaqusState, kind: "node" | "element", name: string): PendingSet {
  let set = state.sets.get(name);
  if (set === undefined) {
    set = { kind, ids: [] };
    state.sets.set(name, set);
  }
  return set;
}
