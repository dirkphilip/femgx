import { textLines, tokensOf } from "./numbers";
import { createParseSession, finishParse, type ParseOptions, type ParseResult } from "./session";
import type { ParseSession } from "./session";
import type { ElementShape } from "../elements/shapes";
import type { ModelSetKind } from "./model";
import {
  ensureSet,
  flushAbaqusElements,
  flushAbaqusNodes,
  readAbaqusElement,
  readAbaqusNode,
  readAbaqusSet,
  shapeForAbaqusType,
} from "./abaqus-read";

type AbaqusMode = "none" | "node" | "element" | "nset" | "elset";

/** A set being accumulated before it is added to the model. */
export interface PendingSet {
  readonly kind: ModelSetKind;
  readonly name: string;
  readonly ids: number[];
}

/** Mutable state shared by the Abaqus reader's helper modules. */
export interface AbaqusState {
  readonly session: ParseSession;
  mode: AbaqusMode;
  pendingData: string;
  pendingLine: number;
  elementShape: ElementShape | undefined;
  pendingNodeIds: number[];
  pendingCoords: number[];
  pendingElementIds: number[];
  pendingElementConn: number[];
  nodeSet: string | undefined;
  elsetName: string | undefined;
  sets: Map<string, PendingSet>;
  generateMode: boolean;
  currentSet: string | undefined;
}

/**
 * Reads an Abaqus input deck. `*NODE` and `*ELEMENT` blocks define the mesh,
 * `*NSET`/`*ELSET` blocks (and `NSET=`/`ELSET=` block attributes) define sets.
 * Unknown keywords and their data lines are skipped.
 */
export function parseAbaqus(source: string, options: ParseOptions = {}): ParseResult {
  const session = createParseSession(options);
  readAbaqus(session, source);
  return finishParse(session, options);
}

function readAbaqus(session: ParseSession, source: string): void {
  const state = createAbaqusState(session);
  for (const { text, line } of textLines(source)) {
    session.checkCancelled();
    stepAbaqus(state, text, line);
  }
  finalizeAbaqus(state);
}

/** Creates an empty reader state for an Abaqus input deck. */
export function createAbaqusState(session: ParseSession): AbaqusState {
  return {
    session,
    mode: "none",
    pendingData: "",
    pendingLine: 0,
    elementShape: undefined,
    pendingNodeIds: [],
    pendingCoords: [],
    pendingElementIds: [],
    pendingElementConn: [],
    nodeSet: undefined,
    elsetName: undefined,
    sets: new Map(),
    generateMode: false,
    currentSet: undefined,
  };
}

function stepAbaqus(state: AbaqusState, text: string, line: number): void {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.startsWith("**")) {
    return;
  }
  if (trimmed.startsWith("*")) {
    if (state.pendingData.length > 0) {
      state.session.report(
        "truncated-data-line",
        `Data line ${String(line)} ends in a continuation with nothing after it`,
      );
      state.pendingData = "";
    }
    handleAbaqusKeyword(state, trimmed, line);
    return;
  }
  state.pendingData = state.pendingData.length === 0 ? text : `${state.pendingData} ${text}`;
  state.pendingLine = line;
  if (!text.trimEnd().endsWith(",")) {
    processAbaqusData(state, state.pendingData, state.pendingLine);
    state.pendingData = "";
  }
}

function handleAbaqusKeyword(state: AbaqusState, line: string, lineNumber: number): void {
  const keyword = line.toUpperCase().split(/[\s,]+/)[0] ?? "";
  const attrs = parseAbaqusAttributes(line);
  switch (keyword) {
    case "*NODE":
      flushAbaqusNodes(state);
      state.nodeSet = attrs["NSET"];
      if (state.nodeSet !== undefined) {
        ensureSet(state, "node", state.nodeSet);
      }
      state.mode = "node";
      return;
    case "*ELEMENT": {
      const shape = shapeForAbaqusType(attrs["TYPE"] ?? "");
      if (shape === undefined) {
        state.session.report(
          "unsupported-element-type",
          `Element type '${attrs["TYPE"] ?? ""}' is not supported; its block is skipped`,
          { line: lineNumber },
        );
        state.mode = "none";
        state.elsetName = undefined;
        return;
      }
      flushAbaqusElements(state);
      state.session.builder.openElementBlock(shape);
      state.elementShape = shape;
      state.mode = "element";
      state.elsetName = attrs["ELSET"];
      if (state.elsetName !== undefined) {
        ensureSet(state, "element", state.elsetName);
      }
      return;
    }
    case "*NSET":
      beginSetBlock(state, attrs, "node");
      return;
    case "*ELSET":
      beginSetBlock(state, attrs, "element");
      return;
    default:
      state.mode = "none";
      state.elsetName = undefined;
  }
}

function beginSetBlock(
  state: AbaqusState,
  attrs: Readonly<Record<string, string>>,
  kind: ModelSetKind,
): void {
  const name = attrs["NSET"] ?? attrs["ELSET"];
  if (name === undefined || name.length === 0) {
    state.session.report(
      "missing-set-name",
      `A ${kind === "node" ? "NSET" : "ELSET"} block is missing its name`,
    );
    state.mode = "none";
    return;
  }
  state.currentSet = name;
  state.generateMode = attrs["GENERATE"] !== undefined;
  ensureSet(state, kind, name);
  state.mode = kind === "node" ? "nset" : "elset";
}

function parseAbaqusAttributes(line: string): Readonly<Record<string, string>> {
  const attrs: Record<string, string> = {};
  const parts = line.split(",");
  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index]?.trim() ?? "";
    if (part.length === 0) {
      continue;
    }
    const eq = part.indexOf("=");
    if (eq > 0) {
      const key = part.slice(0, eq).trim().toUpperCase();
      const value = part.slice(eq + 1).trim();
      if (key.length > 0) {
        attrs[key] = value;
      }
    } else {
      attrs[part.toUpperCase()] = "";
    }
  }
  return attrs;
}

function processAbaqusData(state: AbaqusState, data: string, line: number): void {
  const tokens = tokensOf(data);
  if (tokens.length === 0) {
    return;
  }
  switch (state.mode) {
    case "node":
      readAbaqusNode(state, tokens, line);
      return;
    case "element":
      readAbaqusElement(state, tokens, line);
      return;
    case "nset":
      readAbaqusSet(state, state.currentSet ?? "", "node", data);
      return;
    case "elset":
      readAbaqusSet(state, state.currentSet ?? "", "element", data);
      return;
    case "none":
      return;
  }
}

function finalizeAbaqus(state: AbaqusState): void {
  if (state.pendingData.length > 0) {
    state.session.report(
      "truncated-data-line",
      "The file ends with an incomplete continued data line",
    );
    state.pendingData = "";
  }
  flushAbaqusNodes(state);
  flushAbaqusElements(state);
  for (const set of state.sets.values()) {
    if (set.ids.length === 0) {
      continue;
    }
    state.session.builder.addSet(set.kind, set.name, set.ids);
  }
  state.session.progress(1, "Finished reading Abaqus");
}
