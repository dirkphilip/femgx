import { describe, expect, it } from "vitest";
import { required } from "./helpers";
import { parse, write } from "../../src/io/parse";
import { createModelBuilder } from "../../src/io/build";
import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE_SHAPE,
  LINE3_SHAPE,
  POINT_SHAPE,
  QUAD_SHAPE,
  TET4_SHAPE,
  TET10_SHAPE,
  TRIANGLE_SHAPE,
  topologyFor,
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

  it("round-trips every supported shape and reorders node and element results", () => {
    const builder = createModelBuilder();
    const nodeIds = [
      105, 101, 119, 104, 110, 102, 118, 107, 113, 100, 116, 108, 114, 103, 111, 117, 106, 115, 109,
      112,
    ];
    const coordinates = new Array<number>();
    for (let row = 0; row < nodeIds.length; row += 1) coordinates.push(row, row + 0.5, -row);
    builder.appendNodes(nodeIds, coordinates);

    const shapes = [
      POINT_SHAPE,
      LINE_SHAPE,
      LINE3_SHAPE,
      TRIANGLE_SHAPE,
      QUAD_SHAPE,
      TET4_SHAPE,
      TET10_SHAPE,
      HEX8_SHAPE,
      HEX20_SHAPE,
    ] as const;
    const elementIds = shapes.map((_shape, index) => 1000 + index);
    for (const [index, shape] of shapes.entries()) {
      const nodeCount = topologyFor(shape).nodeCount;
      builder.openElementBlock(shape);
      builder.appendElements([elementIds[index] as number], nodeIds.slice(0, nodeCount));
    }
    const shuffledNodeIds = [...nodeIds].reverse();
    builder.addResult({
      name: "node-value",
      location: "node",
      components: 1,
      ids: new Uint32Array(shuffledNodeIds),
      values: new Float64Array(shuffledNodeIds.map((id) => 1000 + nodeIds.indexOf(id))),
    });
    const shuffledElementIds = [...elementIds].reverse();
    builder.addResult({
      name: "element-value",
      location: "element",
      components: 1,
      ids: new Uint32Array(shuffledElementIds),
      values: new Float64Array(shuffledElementIds.map((id) => 2000 + elementIds.indexOf(id))),
    });
    const model = builder.build();

    const written = write(model);
    expect(write(model)).toBe(written);
    const parsed = parse(written);
    expect(parsed.issues).toEqual([]);
    expect(parsed.model.elementBlocks.map((block) => block.shape)).toEqual([...shapes]);
    for (const [index, shape] of shapes.entries()) {
      expect([...required(parsed.model.elementBlocks[index]).connectivity]).toEqual(
        Array.from({ length: topologyFor(shape).nodeCount }, (_value, row) => row),
      );
    }
    expect([...required(parsed.model.results[0]).values]).toEqual(
      Array.from({ length: nodeIds.length }, (_value, row) => 1000 + row),
    );
    expect([...required(parsed.model.results[1]).values]).toEqual(
      Array.from({ length: elementIds.length }, (_value, row) => 2000 + row),
    );
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
