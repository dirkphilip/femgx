import { describe, expect, it } from "vitest";
import { required } from "./helpers";
import { parseVtu, writeVtu } from "../../src/io/parse";
import { createModelBuilder } from "../../src/io/build";
import { TET4_SHAPE, HEX8_SHAPE } from "../../src/elements/shapes";

const TET_VTU = [
  '<?xml version="1.0"?>',
  '<VTKFile type="UnstructuredGrid" version="1.0" byte_order="LittleEndian">',
  "  <UnstructuredGrid>",
  '    <Piece NumberOfPoints="4" NumberOfCells="1">',
  "      <Points>",
  '        <DataArray type="Float64" NumberOfComponents="3" format="ascii">',
  "0 0 0",
  "1 0 0",
  "0 1 0",
  "0 0 1",
  "        </DataArray>",
  "      </Points>",
  "      <Cells>",
  '        <DataArray type="Int64" Name="connectivity" format="ascii">0 1 2 3</DataArray>',
  '        <DataArray type="Int64" Name="offsets" format="ascii">4</DataArray>',
  '        <DataArray type="Int64" Name="types" format="ascii">10</DataArray>',
  "      </Cells>",
  "      <PointData>",
  '        <DataArray type="Float64" Name="temp" NumberOfComponents="1" format="ascii">1 2 3 4</DataArray>',
  "      </PointData>",
  "      <CellData>",
  '        <DataArray type="Float64" Name="stress" NumberOfComponents="1" format="ascii">9.5</DataArray>',
  "      </CellData>",
  "    </Piece>",
  "  </UnstructuredGrid>",
  "</VTKFile>",
].join("\n");

describe("parseVtu", () => {
  it("reads points, cells, and data arrays", () => {
    const result = parseVtu(TET_VTU);
    expect(result.issues).toEqual([]);
    expect(result.model.nodes.count).toBe(4);
    expect([...result.model.nodes.coordinates]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const block = required(result.model.elementBlocks[0]);
    expect(block.shape.family).toBe("tet");
    expect([...block.ids]).toEqual([0]);
    expect([...block.connectivity]).toEqual([0, 1, 2, 3]);
    expect(result.model.results.map((field) => field.name)).toEqual(["temp", "stress"]);
    expect(result.model.results[0]?.location).toBe("node");
    expect(result.model.results[1]?.location).toBe("element");
    expect([...required(result.model.results[1]).values]).toEqual([9.5]);
  });

  it("reads FieldData entries as metadata", () => {
    const source = TET_VTU.replace(
      "    </Piece>",
      '      <FieldData>\n        <DataArray type="String" Name="units" NumberOfTuples="1" femgx-type="string">mm</DataArray>\n      </FieldData>\n    </Piece>',
    );
    const result = parseVtu(source);
    expect(result.model.metadata).toEqual({ units: "mm" });
  });

  it("handles multi-block cells via offsets", () => {
    const source = TET_VTU.replace(
      '    <Piece NumberOfPoints="4" NumberOfCells="1">',
      '    <Piece NumberOfPoints="8" NumberOfCells="2">',
    )
      .replace(
        "0 0 0\n1 0 0\n0 1 0\n0 0 1",
        "0 0 0\n1 0 0\n0 1 0\n0 0 1\n2 0 0\n3 0 0\n2 1 0\n2 0 1",
      )
      .replace(
        '<DataArray type="Int64" Name="connectivity" format="ascii">0 1 2 3</DataArray>',
        '<DataArray type="Int64" Name="connectivity" format="ascii">0 1 2 3 4 5 6 7 0 1 2 3</DataArray>',
      )
      .replace(
        '<DataArray type="Int64" Name="offsets" format="ascii">4</DataArray>',
        '<DataArray type="Int64" Name="offsets" format="ascii">4 12</DataArray>',
      )
      .replace(
        '<DataArray type="Int64" Name="types" format="ascii">10</DataArray>',
        '<DataArray type="Int64" Name="types" format="ascii">10 12</DataArray>',
      );
    const result = parseVtu(source);
    expect(result.model.elementBlocks.map((block) => block.shape.family)).toEqual(["tet", "hex"]);
    expect([...required(result.model.elementBlocks[1]).connectivity]).toEqual([
      4, 5, 6, 7, 0, 1, 2, 3,
    ]);
  });

  it("reports unsupported binary data encodings", () => {
    const source = TET_VTU.replace(
      'format="ascii">0 1 2 3</DataArray>',
      'format="binary">AAAA</DataArray>',
    );
    const result = parseVtu(source);
    expect(result.issues.map((issue) => issue.code)).toContain("unsupported-data-format");
  });

  it("reports a malformed XML document", () => {
    const result = parseVtu('<VTKFile type="UnstructuredGrid"');
    expect(result.issues.map((issue) => issue.code)).toContain("malformed-xml");
  });

  it("reports unsupported VTKFile types", () => {
    const source = TET_VTU.replace('type="UnstructuredGrid"', 'type="StructuredGrid"');
    const result = parseVtu(source);
    expect(result.issues.map((issue) => issue.code)).toContain("unsupported-type");
  });

  it("reports non-numeric DataArray content", () => {
    const source = TET_VTU.replace(
      'format="ascii">1 2 3 4</DataArray>',
      'format="ascii">1 2 x 4</DataArray>',
    );
    const result = parseVtu(source);
    expect(result.issues.map((issue) => issue.code)).toContain("bad-number");
  });
});

describe("writeVtu", () => {
  it("round-trips a model with results and metadata", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 1, 2, 3], [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    builder.openElementBlock(TET4_SHAPE);
    builder.appendElements([0], [0, 1, 2, 3]);
    builder.openElementBlock(HEX8_SHAPE);
    builder.appendElements([1], [0, 1, 2, 3, 0, 1, 2, 3]);
    builder.addResult({
      name: "temp",
      location: "node",
      components: 1,
      ids: new Uint32Array([0, 1, 2, 3]),
      values: new Float64Array([1, 2, 3, 4]),
    });
    builder.setMetadata("units", "mm");
    builder.setMetadata("version", 3);
    const model = builder.build();

    const written = writeVtu(model);
    const parsed = parseVtu(written);
    expect(parsed.issues).toEqual([]);
    expect(parsed.model.nodes.count).toBe(4);
    expect([...parsed.model.nodes.coordinates]).toEqual([...model.nodes.coordinates]);
    expect(parsed.model.elementBlocks).toHaveLength(2);
    expect([...required(parsed.model.elementBlocks[1]).connectivity]).toEqual([
      ...required(model.elementBlocks[1]).connectivity,
    ]);
    expect(parsed.model.results).toHaveLength(1);
    expect([...required(parsed.model.results[0]).values]).toEqual([1, 2, 3, 4]);
    expect(parsed.model.metadata["units"]).toBe("mm");
    expect(parsed.model.metadata["version"]).toBe(3);
  });

  it("is deterministic", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 1], [0, 0, 0, 1, 0, 0]);
    const model = builder.build();
    expect(writeVtu(model)).toBe(writeVtu(model));
  });

  it("skips results whose ids are not the contiguous entity sequence", () => {
    const builder = createModelBuilder();
    builder.appendNodes([5, 9], [0, 0, 0, 1, 0, 0]);
    builder.addResult({
      name: "temp",
      location: "node",
      components: 1,
      ids: new Uint32Array([5, 9]),
      values: new Float64Array([1, 2]),
    });
    expect(writeVtu(builder.build())).not.toContain("PointData");
  });
});
