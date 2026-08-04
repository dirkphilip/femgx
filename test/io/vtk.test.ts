import { describe, expect, it } from "vitest";
import { required } from "./helpers";
import { parseVtk, writeVtk } from "../../src/io/parse";
import { createModelBuilder } from "../../src/io/build";
import { TET4_SHAPE, HEX8_SHAPE } from "../../src/elements/shapes";

const TET_VTK = [
  "# vtk DataFile Version 5.0",
  "tet example",
  "ASCII",
  "DATASET UNSTRUCTURED_GRID",
  "POINTS 4 double",
  "0 0 0",
  "1 0 0",
  "0 1 0",
  "0 0 1",
  "CELLS 1 5",
  "4 0 1 2 3",
  "CELL_TYPES 1",
  "10",
  "",
].join("\n");

describe("parseVtk", () => {
  it("reads nodes and cells into typed blocks", () => {
    const result = parseVtk(TET_VTK);
    expect(result.issues).toEqual([]);
    expect(result.model.nodes.count).toBe(4);
    expect([...result.model.nodes.coordinates]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(result.model.elementBlocks).toHaveLength(1);
    const block = required(result.model.elementBlocks[0]);
    expect(block.shape.family).toBe("tet");
    expect([...block.ids]).toEqual([0]);
    expect([...block.connectivity]).toEqual([0, 1, 2, 3]);
  });

  it("reads scalar and vector point data as result fields", () => {
    const source = TET_VTK.replace(
      "CELL_TYPES 1",
      "CELL_TYPES 1\n10\nPOINT_DATA 4\nSCALARS temp double\nLOOKUP_TABLE default\n1\n2\n3\n4\n" +
        "VECTORS velocity double\n1 0 0\n0 1 0\n0 0 1\n0 0 0",
    );
    const result = parseVtk(source);
    expect(result.model.results.map((field) => field.name)).toEqual(["temp", "velocity"]);
    expect(result.model.results[0]?.components).toBe(1);
    expect([...required(result.model.results[0]).values]).toEqual([1, 2, 3, 4]);
    expect(result.model.results[1]?.components).toBe(3);
    expect([...required(result.model.results[1]).ids]).toEqual([0, 1, 2, 3]);
  });

  it("reads cell data as element results", () => {
    const source = TET_VTK.replace(
      "CELL_TYPES 1",
      "CELL_TYPES 1\n10\nCELL_DATA 1\nSCALARS stress double\nLOOKUP_TABLE default\n9.5",
    );
    const result = parseVtk(source);
    expect(result.model.results).toHaveLength(1);
    expect(result.model.results[0]?.location).toBe("element");
    expect([...required(result.model.results[0]).values]).toEqual([9.5]);
  });

  it("reads FIELD arrays as results", () => {
    const source = TET_VTK.replace(
      "CELL_TYPES 1",
      "CELL_TYPES 1\n10\nPOINT_DATA 4\nFIELD FieldData 1\nstrain 2 4 double\n0 0 0 0 0 0 0 0",
    );
    const result = parseVtk(source);
    expect(result.model.results).toHaveLength(1);
    expect(result.model.results[0]?.name).toBe("strain");
    expect(result.model.results[0]?.components).toBe(2);
  });

  it("groups cells by shape and skips unsupported cell types with a warning", () => {
    const source = [
      "# vtk DataFile Version 5.0",
      "mixed",
      "ASCII",
      "DATASET UNSTRUCTURED_GRID",
      "POINTS 6 double",
      "0 0 0",
      "1 0 0",
      "0 1 0",
      "0 0 1",
      "2 0 0",
      "3 0 0",
      "CELLS 3 11",
      "3 0 1 4",
      "4 0 1 2 3",
      "2 1 5",
      "CELL_TYPES 3",
      "5",
      "10",
      "3",
      "",
    ].join("\n");
    const result = parseVtk(source);
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("unsupported-cell-type");
    expect(result.model.elementBlocks.map((block) => block.shape.family)).toEqual(["tet", "line"]);
    expect([...required(result.model.elementBlocks[0]).ids]).toEqual([1]);
    expect([...required(result.model.elementBlocks[1]).ids]).toEqual([2]);
  });

  it("reports a missing VTK header", () => {
    const result = parseVtk("not a vtk file\n\nASCII\nDATASET UNSTRUCTURED_GRID\n");
    expect(result.issues.map((issue) => issue.code)).toContain("missing-vtk-header");
  });

  it("rejects binary files with an actionable diagnostic", () => {
    const source = TET_VTK.replace("ASCII", "BINARY");
    const result = parseVtk(source);
    expect(result.issues.map((issue) => issue.code)).toContain("binary-unsupported");
    expect(result.model.nodes.count).toBe(0);
  });

  it("rejects unsupported dataset types", () => {
    const source = TET_VTK.replace("UNSTRUCTURED_GRID", "STRUCTURED_GRID");
    const result = parseVtk(source);
    expect(result.issues.map((issue) => issue.code)).toContain("unsupported-dataset");
  });

  it("throws an IoError with issues in strict mode", () => {
    expect(() => parseVtk(TET_VTK.replace("ASCII", "BINARY"), { strict: true })).toThrow();
  });

  it("reports truncated attribute arrays", () => {
    const source = TET_VTK.replace(
      "CELL_TYPES 1",
      "CELL_TYPES 1\n10\nPOINT_DATA 4\nSCALARS temp double\nLOOKUP_TABLE default\n1\n2",
    );
    const result = parseVtk(source);
    expect(result.issues.map((issue) => issue.code)).toContain("array-shape");
  });
});

describe("writeVtk", () => {
  it("round-trips a model with scalar results", () => {
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
    const model = builder.build();

    const written = writeVtk(model);
    expect(written).toContain("DATASET UNSTRUCTURED_GRID");
    expect(written).toContain("CELL_TYPES 2");

    const parsed = parseVtk(written);
    expect(parsed.issues).toEqual([]);
    expect(parsed.model.nodes.count).toBe(4);
    expect([...parsed.model.nodes.coordinates]).toEqual([...model.nodes.coordinates]);
    expect(parsed.model.elementBlocks).toHaveLength(2);
    expect([...required(parsed.model.elementBlocks[0]).connectivity]).toEqual([0, 1, 2, 3]);
    expect(parsed.model.results).toHaveLength(1);
    expect([...required(parsed.model.results[0]).values]).toEqual([1, 2, 3, 4]);
  });

  it("is deterministic across repeated writes", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0], [0, 0, 0]);
    const model = builder.build();
    expect(writeVtk(model)).toBe(writeVtk(model));
  });

  it("skips results whose ids are not the contiguous entity sequence", () => {
    const builder = createModelBuilder();
    builder.appendNodes([10, 20], [0, 0, 0, 1, 0, 0]);
    builder.addResult({
      name: "temp",
      location: "node",
      components: 1,
      ids: new Uint32Array([10, 20]),
      values: new Float64Array([1, 2]),
    });
    const written = writeVtk(builder.build());
    expect(written).not.toContain("POINT_DATA");
  });

  it("writes vector results and skips other component counts", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 1], [0, 0, 0, 1, 0, 0]);
    builder.addResult({
      name: "velocity",
      location: "node",
      components: 3,
      ids: new Uint32Array([0, 1]),
      values: new Float64Array([1, 0, 0, 0, 1, 0]),
    });
    builder.addResult({
      name: "tensor",
      location: "node",
      components: 9,
      ids: new Uint32Array([0, 1]),
      values: new Float64Array(18),
    });
    const written = writeVtk(builder.build());
    expect(written).toContain("VECTORS velocity double");
    expect(written).not.toContain("tensor");
  });
});

describe("parseVtk cancellation", () => {
  it("stops when the token is cancelled", () => {
    const cancelled = { cancelled: true };
    expect(() => parseVtk(TET_VTK, { token: cancelled })).toThrow(/cancelled/i);
  });
});
