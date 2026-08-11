import { describe, expect, it } from "vitest";
import { required } from "./helpers";
import { parse, write } from "../../src/io/parse";
import { createModelBuilder } from "../../src/io/build";
import {
  HEX20_SHAPE,
  LINE3_SHAPE,
  QUAD_SHAPE,
  TET10_SHAPE,
  TRIANGLE_SHAPE,
} from "../../src/elements/shapes";

function sampleModel() {
  const builder = createModelBuilder();
  builder.appendNodes([0, 1, 2, 3], [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  builder.openElementBlock(TET10_SHAPE);
  builder.appendElements([0], [0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
  builder.openElementBlock(HEX20_SHAPE);
  builder.appendElements([1], [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
  builder.openElementBlock(LINE3_SHAPE);
  builder.appendElements([2], [0, 1, 2]);
  builder.openElementBlock(TRIANGLE_SHAPE);
  builder.appendElements([3], [0, 1, 2]);
  builder.openElementBlock(QUAD_SHAPE);
  builder.appendElements([4], [0, 1, 2, 3]);
  return builder.build();
}

describe("VTK round-trips", () => {
  it("round-trips VTK legacy deterministically", () => {
    const model = sampleModel();
    const written = write(model);
    expect(write(model)).toBe(written);
    const parsed = parse(written);
    expect(parsed.issues).toEqual([]);
    expect(parsed.model.nodes.count).toBe(model.nodes.count);
    expect([...parsed.model.nodes.coordinates]).toEqual([...model.nodes.coordinates]);
    expect(parsed.model.elementBlocks).toHaveLength(model.elementBlocks.length);
    expect(parsed.model.elementBlocks.map((block) => block.shape.family)).toEqual([
      "tet",
      "hex",
      "line",
      "triangle",
      "quad",
    ]);
    expect([...required(parsed.model.elementBlocks[0]).connectivity]).toEqual([
      ...required(model.elementBlocks[0]).connectivity,
    ]);
    expect([...required(parsed.model.elementBlocks[1]).connectivity]).toEqual([
      ...required(model.elementBlocks[1]).connectivity,
    ]);
  });
});

describe("large VTK parse", () => {
  it("loads a large VTK model into typed-array storage", () => {
    const cellCount = 20_000;
    const nodeCount = 8;
    const lines: string[] = [
      "# vtk DataFile Version 5.0",
      "large model",
      "ASCII",
      "DATASET UNSTRUCTURED_GRID",
      `POINTS ${String(nodeCount)} double`,
      "0 0 0",
      "1 0 0",
      "1 1 0",
      "0 1 0",
      "0 0 1",
      "1 0 1",
      "1 1 1",
      "0 1 1",
      `CELLS ${String(cellCount)} ${String(cellCount * 9)}`,
    ];
    for (let cell = 0; cell < cellCount; cell += 1) {
      lines.push("8 0 1 2 3 4 5 6 7");
    }
    lines.push(`CELL_TYPES ${String(cellCount)}`, "12\n".repeat(cellCount));

    const result = parse(lines.join("\n"));
    expect(result.issues).toEqual([]);
    expect(result.model.elementBlocks).toHaveLength(1);
    expect(result.model.elementBlocks[0]?.count).toBe(cellCount);
    expect(result.model.nodes.coordinates).toBeInstanceOf(Float64Array);
    expect(result.model.elementBlocks[0]?.connectivity).toBeInstanceOf(Uint32Array);
    expect(result.model.elementBlocks[0]?.connectivity.length).toBe(cellCount * 8);
  });
});
