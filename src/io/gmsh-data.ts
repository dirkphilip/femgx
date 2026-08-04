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
  };
}

/** Feeds one line of a `$NodeData`/`$ElementData` block. */
export function readDataSectionLine(state: GmshState, text: string): void {
  const data = state.data;
  if (data === undefined) {
    return;
  }
  switch (data.stage) {
    case "strings-count":
      beginTagLines(data, text, "strings");
      return;
    case "strings":
      data.stringTags.push(stripQuotes(text));
      data.remaining -= 1;
      if (data.remaining <= 0) {
        data.stage = "reals-count";
      }
      return;
    case "reals-count":
      beginTagLines(data, text, "reals");
      return;
    case "reals":
      data.remaining -= 1;
      if (data.remaining <= 0) {
        data.stage = "ints-count";
      }
      return;
    case "ints-count":
      beginTagLines(data, text, "ints");
      data.intTags = [];
      return;
    case "ints":
      readIntTags(data, text);
      return;
    case "data":
      readDataValues(data, text);
      return;
  }
}

function beginTagLines(data: GmshDataSection, text: string, stage: DataStage): void {
  const count = Number(text);
  if (!Number.isInteger(count) || count < 0) {
    data.stage = "data";
    return;
  }
  data.stage = stage;
  data.remaining = count;
}

function readIntTags(data: GmshDataSection, text: string): void {
  const values = numbersOf(text);
  if (values === undefined) {
    data.stage = "data";
    return;
  }
  for (const value of values) {
    if (data.remaining <= 0) {
      data.stage = "data";
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

function readDataValues(data: GmshDataSection, text: string): void {
  const values = numbersOf(text);
  if (values === undefined || values.length < 2) {
    return;
  }
  const id = values[0] ?? -1;
  if (!Number.isInteger(id) || id < 0) {
    return;
  }
  if (values.length - 1 !== data.components) {
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
  if (data.name.length === 0) {
    return;
  }
  const expected = data.ids.length * data.components;
  if (data.values.length !== expected) {
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

function stripQuotes(value: string): string {
  return value.trim().replace(/^"|"$/g, "");
}
