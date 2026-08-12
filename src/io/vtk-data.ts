import { Float64Buffer } from "./growable";
import { numbersOf, tokensOf } from "./numbers";
import type { ArrayBlock, VtkState } from "./vtk-state";

/** Starts a POINT_DATA or CELL_DATA section with a known entity count. */
export function beginData(
  state: VtkState,
  location: "node" | "element",
  tokens: readonly string[],
  line: number,
): void {
  const count = Number(tokens[1]);
  if (!Number.isInteger(count) || count < 0) {
    state.session.report(
      "bad-data-count",
      `${location === "node" ? "POINT_DATA" : "CELL_DATA"} must declare a non-negative count`,
      { line },
    );
    state.mode = "skip";
    return;
  }
  closeArray(state);
  state.location = location;
  state.sectionCount = count;
  state.mode = "data";
}

/** Starts a SCALARS/VECTORS/NORMALS/TENSORS attribute block. */
export function startArray(state: VtkState, components: number, name: string, line: number): void {
  closeArray(state);
  if (name.length === 0) {
    state.session.report("missing-array-name", "An attribute block is missing its name", { line });
  }
  state.arrayName = name;
  state.components = components;
  state.arrayValues = new Float64Buffer();
  state.mode = "data";
}

/** Starts a FIELD block; subsequent non-keyword lines are array headers. */
export function startField(state: VtkState, tokens: readonly string[], line: number): void {
  closeArray(state);
  state.mode = "field";
  state.fieldRemaining = Number(tokens[2]);
  if (!Number.isInteger(state.fieldRemaining) || state.fieldRemaining < 0) {
    state.session.report("bad-field-declaration", "FIELD must declare a non-negative array count", {
      line,
    });
    state.mode = "skip";
  }
}

/** Finalizes the current attribute array into `dataBlocks`. */
export function closeArray(state: VtkState): void {
  if (state.components === 0) {
    return;
  }
  const expected = state.sectionCount * state.components;
  if (state.arrayValues.size !== expected) {
    state.session.report(
      "array-shape",
      `Attribute ${state.arrayName} has ${String(state.arrayValues.size)} values but ${String(expected)} are expected`,
    );
  }
  const block: ArrayBlock = {
    location: state.location,
    name: state.arrayName,
    components: state.components,
    count: state.sectionCount,
    values: state.arrayValues.slice(0, expected),
  };
  state.dataBlocks.push(block);
  state.arrayName = "";
  state.components = 0;
  state.arrayValues = new Float64Buffer();
}

/** Consumes a numeric line while collecting a plain attribute array. */
export function readDataLine(state: VtkState, text: string, line: number): void {
  const values = numbersOf(text);
  if (values === undefined) {
    state.session.report("bad-number", `Expected attribute data, got '${text.trim()}'`, { line });
    return;
  }
  const expected = state.sectionCount * state.components;
  for (const value of values) {
    if (state.arrayValues.size >= expected) {
      state.session.report(
        "extra-array-data",
        `Attribute ${state.arrayName} has more values than expected`,
        { line },
      );
      return;
    }
    state.arrayValues.push(value);
  }
}

/** Consumes a line inside a FIELD block: an array header or array data. */
export function readFieldLine(state: VtkState, text: string, line: number): void {
  const values = numbersOf(text);
  if (values === undefined) {
    closeArray(state);
    if (state.fieldRemaining <= 0) {
      state.session.report("extra-field-array", "FIELD contains more arrays than declared", {
        line,
      });
      state.mode = "skip";
      return;
    }
    const tokens = tokensOf(text);
    const name = tokens[0] ?? "";
    const components = Number(tokens[1]);
    const tuples = Number(tokens[2]);
    if (
      name.length === 0 ||
      !Number.isInteger(components) ||
      components < 1 ||
      !Number.isInteger(tuples) ||
      tuples < 0
    ) {
      state.session.report("bad-field-array", `Malformed FIELD array header on line ${line}`, {
        line,
      });
      state.mode = "skip";
      return;
    }
    state.fieldRemaining -= 1;
    state.arrayName = name;
    state.components = components;
    state.sectionCount = tuples;
    state.arrayValues = new Float64Buffer();
    return;
  }
  const expected = state.sectionCount * state.components;
  for (const value of values) {
    if (state.arrayValues.size >= expected) {
      state.session.report(
        "extra-array-data",
        `Attribute ${state.arrayName} has more values than expected`,
        { line },
      );
      return;
    }
    state.arrayValues.push(value);
  }
}

/** Adds every collected attribute array to the model as a result field. */
export function addDataBlocks(state: VtkState): void {
  for (const block of state.dataBlocks) {
    if (block.values.length !== block.count * block.components) {
      continue;
    }
    const ids = new Uint32Array(block.count);
    for (let index = 0; index < block.count; index += 1) {
      ids[index] = index;
    }
    const values = new Float64Array(block.values.length);
    values.set(block.values);
    state.session.builder.addResult({
      name: block.name,
      location: block.location,
      components: block.components,
      ids,
      values,
    });
  }
}
