import { numbersOf } from "./numbers";
import type { GmshState } from "./gmsh";

type DataStage =
  "strings-count" | "strings" | "reals-count" | "reals" | "ints-count" | "ints" | "data";

/** Accumulates one `$NodeData` or `$ElementData` block. */
export interface GmshDataSection {
  readonly location: "node" | "element";
  stage: DataStage;
  remaining: number;
  stringTags: string[];
  intTags: number[];
  name: string;
  components: number;
  ids: number[];
  values: number[];
  /** Set when a malformed line makes the rest of the block unreadable. */
  dropped: boolean;
}

/** Starts collecting a data block, finalizing any previous one first. */
export function beginDataSection(state: GmshState, location: "node" | "element"): GmshDataSection {
  finalizeDataSections(state);
  return {
    location,
    stage: "strings-count",
    remaining: 0,
    stringTags: [],
    intTags: [],
    name: "",
    components: 1,
    ids: [],
    values: [],
    dropped: false,
  };
}

/** Feeds one line of a `$NodeData`/`$ElementData` block. */
export function readDataSectionLine(state: GmshState, text: string, line: number): void {
  const data = state.data;
  if (data === undefined || data.dropped) {
    return;
  }
  switch (data.stage) {
    case "strings-count":
      beginTagLines(data, state, text, "strings", line);
      return;
    case "strings":
      data.stringTags.push(stripQuotes(text));
      data.remaining -= 1;
      if (data.remaining <= 0) {
        data.stage = "reals-count";
      }
      return;
    case "reals-count":
      beginTagLines(data, state, text, "reals", line);
      return;
    case "reals":
      data.remaining -= 1;
      if (data.remaining <= 0) {
        data.stage = "ints-count";
      }
      return;
    case "ints-count":
      beginTagLines(data, state, text, "ints", line);
      data.intTags = [];
      return;
    case "ints":
      readIntTags(data, state, text, line);
      return;
    case "data":
      readDataValues(data, state, text, line);
      return;
  }
}

function beginTagLines(
  data: GmshDataSection,
  state: GmshState,
  text: string,
  stage: DataStage,
  line: number,
): void {
  const count = Number(text);
  if (!Number.isInteger(count) || count < 0) {
    state.session.report("bad-data-count", `Malformed ${tagCountLabel(stage)} count '${text}'`, {
      line,
    });
    data.dropped = true;
    return;
  }
  data.stage = stage;
  data.remaining = count;
}

function tagCountLabel(stage: DataStage): string {
  if (stage === "strings") {
    return "string tag";
  }
  if (stage === "reals") {
    return "real tag";
  }
  return "integer tag";
}

function readIntTags(data: GmshDataSection, state: GmshState, text: string, line: number): void {
  const values = numbersOf(text);
  if (values === undefined) {
    state.session.report("bad-data-line", `Expected integer tags, got '${text}'`, { line });
    data.dropped = true;
    return;
  }
  for (const value of values) {
    if (data.remaining <= 0) {
      state.session.report("bad-data-line", "More integer tags than declared", { line });
      data.dropped = true;
      return;
    }
    data.intTags.push(value);
    data.remaining -= 1;
  }
  if (data.remaining <= 0) {
    data.name = data.stringTags[0] ?? "";
    data.components = data.intTags[1] ?? 1;
    data.stage = "data";
  }
}

function readDataValues(data: GmshDataSection, state: GmshState, text: string, line: number): void {
  const values = numbersOf(text);
  if (values === undefined) {
    state.session.report("bad-data-line", `Expected data values, got '${text}'`, { line });
    data.dropped = true;
    return;
  }
  if (values.length === 0) {
    return;
  }
  const id = values[0] ?? -1;
  if (values.length < 2) {
    state.session.report("bad-data-line", `Expected 'id values' but got '${text}'`, { line });
    data.dropped = true;
    return;
  }
  if (!Number.isInteger(id) || id < 0) {
    state.session.report(
      "bad-data-line",
      `Data id must be a non-negative integer, got '${String(values[0])}'`,
      { line },
    );
    data.dropped = true;
    return;
  }
  if (values.length - 1 !== data.components) {
    state.session.report(
      "data-shape",
      `Expected ${String(data.components)} value(s) after the id but got ${String(values.length - 1)}`,
      { line },
    );
    data.dropped = true;
    return;
  }
  data.ids.push(id);
  for (let index = 1; index < values.length; index += 1) {
    data.values.push(values[index] ?? 0);
  }
}

/** Finalizes the current data block and adds it to the model as a result. */
export function finalizeDataSections(state: GmshState): void {
  const data = state.data;
  state.data = undefined;
  if (data === undefined) {
    return;
  }
  const section = data.location === "node" ? "$NodeData" : "$ElementData";
  if (data.dropped) {
    reportDroppedBlock(state, section);
    return;
  }
  if (data.name.length === 0) {
    state.session.report("missing-data-name", `The ${section} block is missing its name`);
    reportDroppedBlock(state, section);
    return;
  }
  const expected = data.ids.length * data.components;
  if (data.values.length !== expected) {
    state.session.report(
      "data-shape",
      `${section} '${data.name}' holds ${String(data.values.length)} values for ${String(data.ids.length)} ids with ${String(data.components)} components`,
    );
    reportDroppedBlock(state, section);
    return;
  }
  const ids = new Uint32Array(data.ids);
  const values = new Float64Array(data.values.length);
  values.set(data.values);
  state.session.builder.addResult({
    name: data.name,
    location: data.location,
    components: data.components,
    ids,
    values,
  });
}

function reportDroppedBlock(state: GmshState, section: string): void {
  state.session.report(
    "dropped-data-block",
    `Dropped the ${section} block because it is malformed`,
    undefined,
    "warning",
  );
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^"|"$/g, "");
}
