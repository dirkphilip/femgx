import { describe, expect, it } from "vitest";
import { required } from "./helpers";
import { parse, write, type IoFormat } from "../../src/io/parse";
import { createModelBuilder } from "../../src/io/build";
import { createCancellationToken } from "../../src/io/progress";
import { TET10_SHAPE, HEX20_SHAPE, LINE3_SHAPE } from "../../src/elements/shapes";

function sampleModel() {
  const builder = createModelBuilder();
  builder.appendNodes([0, 1, 2, 3], [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  builder.openElementBlock(TET10_SHAPE);
  builder.appendElements([0], [0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
  builder.openElementBlock(HEX20_SHAPE);
  builder.appendElements([1], [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
  builder.openElementBlock(LINE3_SHAPE);
  builder.appendElements([2], [0, 1, 2]);
  return builder.build();
}

const FORMATS: readonly IoFormat[] = ["vtk", "vtu", "gmsh", "abaqus"];

describe("dispatch round-trips", () => {
  it.each(FORMATS)("round-trips the %s format deterministically", (format) => {
    const model = sampleModel();
    const written = write(model, format);
    expect(write(model, format)).toBe(written);
    const parsed = parse(written, format);
    expect(parsed.issues).toEqual([]);
    expect(parsed.model.nodes.count).toBe(model.nodes.count);
    expect([...parsed.model.nodes.coordinates]).toEqual([...model.nodes.coordinates]);
    expect(parsed.model.elementBlocks).toHaveLength(model.elementBlocks.length);
    expect([...required(parsed.model.elementBlocks[0]).connectivity]).toEqual([
      ...required(model.elementBlocks[0]).connectivity,
    ]);
    expect([...required(parsed.model.elementBlocks[1]).connectivity]).toEqual([
      ...required(model.elementBlocks[1]).connectivity,
    ]);
  });

  it("preserves ids and connectivity across the gmsh and abaqus formats", () => {
    const builder = createModelBuilder();
    builder.appendNodes([5, 6, 7, 8], [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    builder.openElementBlock(TET10_SHAPE);
    builder.appendElements([50], [5, 6, 7, 8, 5, 6, 7, 8, 5, 6]);
    builder.addSet("element", "solid", [50]);
    builder.addSet("node", "corner", [5, 6, 7]);
    const model = builder.build();
    for (const format of ["gmsh", "abaqus"] as const) {
      const parsed = parse(write(model, format), format);
      expect([...parsed.model.nodes.ids]).toEqual([5, 6, 7, 8]);
      expect([...required(parsed.model.elementBlocks[0]).ids]).toEqual([50]);
      const setNames = parsed.model.sets.map((set) => set.name);
      expect(setNames).toContain("solid");
    }
  });
});

describe("parse options", () => {
  it("reports progress and honors cancellation across formats", () => {
    const source = write(sampleModel(), "vtu");
    const fractions: number[] = [];
    const parsed = parse(source, "vtu", {
      onProgress: (update) => fractions.push(update.fraction),
    });
    expect(parsed.model.nodes.count).toBe(4);
    expect(fractions.at(-1)).toBe(1);

    const cancelled = createCancellationToken();
    cancelled.cancel();
    expect(() => parse(source, "vtu", { token: cancelled.token })).toThrow(/cancelled/i);
  });
});

describe("large streaming parse", () => {
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

    const result = parse(lines.join("\n"), "vtk");
    expect(result.issues).toEqual([]);
    expect(result.model.elementBlocks).toHaveLength(1);
    expect(result.model.elementBlocks[0]?.count).toBe(cellCount);
    expect(result.model.nodes.coordinates).toBeInstanceOf(Float64Array);
    expect(result.model.elementBlocks[0]?.connectivity).toBeInstanceOf(Uint32Array);
    expect(result.model.elementBlocks[0]?.connectivity.length).toBe(cellCount * 8);
  });
});
