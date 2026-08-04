import { describe, expect, it } from "vitest";
import { required } from "./helpers";
import { parseGmsh, writeGmsh } from "../../src/io/parse";
import { createModelBuilder } from "../../src/io/build";
import { createParseSession } from "../../src/io/session";
import { createGmshState } from "../../src/io/gmsh";
import { beginDataSection, finalizeDataSections } from "../../src/io/gmsh-data";
import { TET4_SHAPE, LINE_SHAPE, HEX8_SHAPE } from "../../src/elements/shapes";

const MSH = [
  "$MeshFormat",
  "2.2 0 8",
  "$EndMeshFormat",
  "$PhysicalNames",
  "2",
  '1 1 "beams"',
  '3 2 "solid"',
  "$EndPhysicalNames",
  "$Nodes",
  "7",
  "1 0 0 0",
  "2 1 0 0",
  "3 0 1 0",
  "4 0 0 1",
  "5 2 0 0",
  "6 3 0 0",
  "7 4 0 0",
  "$EndNodes",
  "$Elements",
  "3",
  "1 4 2 2 0 1 2 3 4",
  "2 1 2 1 0 1 2",
  "3 1 2 1 0 5 6",
  "$EndElements",
].join("\n");

const NODE_DATA_BLOCK = [
  "$NodeData",
  "1",
  '"temp"',
  "1",
  "0.0",
  "3",
  "0 1 4",
  "1 1.0",
  "2 2.0",
  "3 3.0",
  "4 4.0",
  "$EndNodeData",
].join("\n");

function sourceWithData(dataBlock: string): string {
  return MSH.replace("$EndElements", `$EndElements\n${dataBlock}`);
}

describe("parseGmsh", () => {
  it("reads nodes, elements, and physical-group sets", () => {
    const result = parseGmsh(MSH);
    expect(result.issues).toEqual([]);
    expect(result.model.nodes.count).toBe(7);
    expect([...result.model.nodes.ids]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(result.model.elementBlocks.map((block) => block.shape.family)).toEqual(["tet", "line"]);
    expect([...required(result.model.elementBlocks[0]).ids]).toEqual([1]);
    expect([...required(result.model.elementBlocks[1]).ids]).toEqual([2, 3]);
    const sets = result.model.sets.map((set) => [set.name, [...set.ids]]);
    expect(sets).toEqual([
      ["beams", [2, 3]],
      ["solid", [1]],
    ]);
  });

  it("reads $NodeData and $ElementData as results", () => {
    const source = MSH.replace(
      "$EndElements",
      "$EndElements\n" +
        '$NodeData\n1\n"temp"\n1\n0.0\n3\n0 1 4\n1 1.0\n2 2.0\n3 3.0\n4 4.0\n$EndNodeData\n' +
        '$ElementData\n1\n"stress"\n1\n0.0\n3\n0 1 1\n1 42.0\n$EndElementData',
    );
    const result = parseGmsh(source);
    expect(
      result.model.results.map((field) => [field.name, field.location, field.components]),
    ).toEqual([
      ["temp", "node", 1],
      ["stress", "element", 1],
    ]);
    expect([...required(result.model.results[0]).values]).toEqual([1, 2, 3, 4]);
    expect([...required(result.model.results[1]).ids]).toEqual([1]);
  });

  it("skips unsupported element types with a summary warning", () => {
    const source = MSH.replace("1 4 2 2 0 1 2 3 4", "1 2 2 2 0 1 2 3");
    const result = parseGmsh(source);
    expect(result.issues.map((issue) => issue.code)).toContain("unsupported-element-type");
    expect(result.model.elementBlocks.map((block) => block.shape.family)).toEqual(["line"]);
  });

  it("rejects unsupported mesh versions", () => {
    const source = MSH.replace("2.2 0 8", "4.1 0 8");
    const result = parseGmsh(source);
    expect(result.issues.map((issue) => issue.code)).toContain("unsupported-version");
    expect(result.model.nodes.count).toBe(0);
  });

  it("rejects binary files", () => {
    const source = MSH.replace("2.2 0 8", "2.2 1 8");
    const result = parseGmsh(source);
    expect(result.issues.map((issue) => issue.code)).toContain("binary-unsupported");
  });

  it("reports node and element count mismatches", () => {
    const source = MSH.replace("$Nodes\n7", "$Nodes\n8").replace("$Elements\n3", "$Elements\n4");
    const result = parseGmsh(source);
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("node-count-mismatch");
    expect(codes).toContain("element-count-mismatch");
  });

  it("reports malformed node lines", () => {
    const source = MSH.replace("1 0 0 0", "1 0 0");
    const result = parseGmsh(source);
    expect(result.issues.map((issue) => issue.code)).toContain("bad-node-line");
  });
});

describe("parseGmsh data blocks", () => {
  it("reports a non-numeric data line instead of silently dropping the block", () => {
    const result = parseGmsh(sourceWithData(NODE_DATA_BLOCK.replace("3 3.0", "3 oops 3.0")));
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("bad-data-line");
    expect(codes).toContain("dropped-data-block");
    expect(result.model.results).toHaveLength(0);
  });

  it("reports a data line with only an id", () => {
    const result = parseGmsh(sourceWithData(NODE_DATA_BLOCK.replace("3 3.0", "3")));
    expect(result.issues.map((issue) => issue.code)).toContain("bad-data-line");
    expect(result.model.results).toHaveLength(0);
  });

  it("reports a bad data id", () => {
    const result = parseGmsh(sourceWithData(NODE_DATA_BLOCK.replace("3 3.0", "-3 3.0")));
    expect(result.issues.map((issue) => issue.code)).toContain("bad-data-line");
    expect(result.model.results).toHaveLength(0);
  });

  it("reports a data row with the wrong number of values", () => {
    const result = parseGmsh(sourceWithData(NODE_DATA_BLOCK.replace("3 3.0", "3 3.0 3.5")));
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("data-shape");
    expect(codes).toContain("dropped-data-block");
    expect(result.model.results).toHaveLength(0);
  });

  it("reports a malformed tag count line", () => {
    const result = parseGmsh(
      sourceWithData(NODE_DATA_BLOCK.replace("$NodeData\n1", "$NodeData\nmany")),
    );
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("bad-data-count");
    expect(codes).toContain("dropped-data-block");
    expect(result.model.results).toHaveLength(0);
  });

  it("reports a malformed real tag count", () => {
    const result = parseGmsh(
      sourceWithData(NODE_DATA_BLOCK.replace('"temp"\n1\n0.0', '"temp"\nx\n0.0')),
    );
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("bad-data-count");
    expect(codes).toContain("dropped-data-block");
  });

  it("reports a malformed integer tag count", () => {
    const result = parseGmsh(sourceWithData(NODE_DATA_BLOCK.replace("0.0\n3", "0.0\nx")));
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("bad-data-count");
    expect(codes).toContain("dropped-data-block");
  });

  it("reports a non-numeric integer tag line", () => {
    const result = parseGmsh(sourceWithData(NODE_DATA_BLOCK.replace("0 1 4", "0 x 4")));
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("bad-data-line");
    expect(codes).toContain("dropped-data-block");
  });

  it("reports more integer tags than declared", () => {
    const result = parseGmsh(sourceWithData(NODE_DATA_BLOCK.replace("0 1 4", "0 1 4 5 6")));
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("bad-data-line");
    expect(codes).toContain("dropped-data-block");
  });

  it("reports a data block with no name", () => {
    const result = parseGmsh(sourceWithData(NODE_DATA_BLOCK.replace('"temp"', '""')));
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("missing-data-name");
    expect(codes).toContain("dropped-data-block");
    expect(result.model.results).toHaveLength(0);
  });

  it("ignores blank and comment lines inside a data block", () => {
    const result = parseGmsh(sourceWithData(NODE_DATA_BLOCK.replace("2 2.0", "# note\n2 2.0")));
    expect(result.issues).toEqual([]);
    expect(result.model.results).toHaveLength(1);
  });

  it("reports a dropped block as a warning", () => {
    const session = createParseSession();
    const state = createGmshState(session);
    state.data = beginDataSection(state, "node");
    state.data.name = "temp";
    state.data.components = 2;
    state.data.ids = [1, 2];
    state.data.values = [1, 2];
    finalizeDataSections(state);
    const codes = session.issues.map((issue) => issue.code);
    expect(codes).toContain("data-shape");
    const warning = session.issues.find((issue) => issue.code === "dropped-data-block");
    expect(warning?.severity).toBe("warning");
  });
});

describe("writeGmsh", () => {
  it("round-trips ids, connectivity, sets, and results", () => {
    const builder = createModelBuilder();
    builder.appendNodes([1, 2, 3, 4], [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    builder.openElementBlock(TET4_SHAPE);
    builder.appendElements([100], [1, 2, 3, 4]);
    builder.openElementBlock(HEX8_SHAPE);
    builder.appendElements([200], [1, 2, 3, 4, 1, 2, 3, 4]);
    builder.addSet("element", "solid", [100]);
    builder.addSet("element", "box", [200]);
    builder.addResult({
      name: "temp",
      location: "node",
      components: 1,
      ids: new Uint32Array([1, 2, 3, 4]),
      values: new Float64Array([10, 20, 30, 40]),
    });
    const model = builder.build();

    const written = writeGmsh(model);
    expect(written).toContain('3 1 "solid"');
    expect(written).toContain("100 4 2 1 0 1 2 3 4");

    const parsed = parseGmsh(written);
    expect(parsed.issues).toEqual([]);
    expect([...parsed.model.nodes.ids]).toEqual([1, 2, 3, 4]);
    expect([...required(parsed.model.elementBlocks[0]).ids]).toEqual([100]);
    expect([...required(parsed.model.elementBlocks[1]).ids]).toEqual([200]);
    expect(parsed.model.sets.map((set) => set.name)).toEqual(["solid", "box"]);
    expect(parsed.model.results).toHaveLength(1);
    expect([...required(parsed.model.results[0]).values]).toEqual([10, 20, 30, 40]);
  });

  it("is deterministic", () => {
    const builder = createModelBuilder();
    builder.appendNodes([1], [0, 0, 0]);
    const model = builder.build();
    expect(writeGmsh(model)).toBe(writeGmsh(model));
  });

  it("writes line elements with their physical groups", () => {
    const builder = createModelBuilder();
    builder.appendNodes([1, 2], [0, 0, 0, 1, 0, 0]);
    builder.openElementBlock(LINE_SHAPE);
    builder.appendElements([5], [1, 2]);
    builder.addSet("element", "beams", [5]);
    const written = writeGmsh(builder.build());
    expect(written).toContain('1 1 "beams"');
    expect(written).toContain("5 1 2 1 0 1 2");
  });
});
