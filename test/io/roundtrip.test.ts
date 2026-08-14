import { describe, expect, it } from "vitest";
import { required } from "./helpers";
import { parseVtk } from "../../src/io/vtk";
import { writeVtk } from "../../src/io/vtk-write";
import { createModelBuilder } from "../../src/io/build";
import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE_SHAPE,
  LINE3_SHAPE,
  POINT_SHAPE,
  PYRAMID5_SHAPE,
  QUAD8_SHAPE,
  QUAD_SHAPE,
  TRI6_SHAPE,
  TET4_SHAPE,
  TET10_SHAPE,
  WEDGE6_SHAPE,
  TRIANGLE_SHAPE,
  topologyFor,
} from "../../src/elements/shapes";

describe("VTK round-trips", () => {
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
      TRI6_SHAPE,
      QUAD_SHAPE,
      QUAD8_SHAPE,
      TET4_SHAPE,
      TET10_SHAPE,
      WEDGE6_SHAPE,
      PYRAMID5_SHAPE,
      HEX8_SHAPE,
      HEX20_SHAPE,
    ] as const;
    const elementIds = shapes.map((_shape, index) => 1000 + index);
    for (const [index, shape] of shapes.entries()) {
      const nodeCount = topologyFor(shape).nodeCount;
      builder.openElementShapeBlock(shape);
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

    const written = writeVtk(model);
    expect(writeVtk(model)).toBe(written);
    expect(written).toContain("CELL_TYPES 13\n1\n3\n21\n5\n22\n9\n23\n10\n24\n13\n14\n12\n25");
    const parsed = parseVtk(written);
    expect(parsed.issues).toEqual([]);
    expect(parsed.model.elementShapeBlocks.map((block) => block.shape)).toEqual([...shapes]);
    for (const [index, shape] of shapes.entries()) {
      expect([...required(parsed.model.elementShapeBlocks[index]).connectivity]).toEqual(
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
