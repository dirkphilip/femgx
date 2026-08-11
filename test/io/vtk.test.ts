import { describe, expect, it } from "vitest";
import { required } from "./helpers";
import { parseVtk, writeVtk } from "../../src/io/parse";
import { createModelBuilder } from "../../src/io/build";
import { Uint32Buffer } from "../../src/io/growable";
import { createParseSession } from "../../src/io/session";
import { createVtkState } from "../../src/io/vtk";
import { readCellsLine, readCellTypesLine } from "../../src/io/vtk-cells";
import { HEX8_SHAPE, QUAD_SHAPE, TET4_SHAPE, TRIANGLE_SHAPE } from "../../src/elements/shapes";
import { VtkWriteError } from "../../src/io/diagnostics";

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

  it("reads VTK linear triangle and quad cell types", () => {
    const source = [
      "# vtk DataFile Version 5.0",
      "surface example",
      "ASCII",
      "DATASET UNSTRUCTURED_GRID",
      "POINTS 5 double",
      "0 0 0",
      "1 0 0",
      "0 1 0",
      "2 0 0",
      "2 1 0",
      "CELLS 2 9",
      "3 0 1 2",
      "4 1 3 4 2",
      "CELL_TYPES 2",
      "5",
      "9",
      "",
    ].join("\n");
    const result = parseVtk(source, { strict: true });
    expect(result.issues).toEqual([]);
    expect(result.model.elementBlocks.map((block) => block.shape)).toEqual([
      TRIANGLE_SHAPE,
      QUAD_SHAPE,
    ]);
    expect(result.model.elementBlocks.map((block) => block.count)).toEqual([1, 1]);
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
      "7",
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

  it("reports a cell type count that outnumbers the declared cells", () => {
    const source = TET_VTK.replace("CELL_TYPES 1\n10", "CELL_TYPES 2\n10\n10");
    const result = parseVtk(source);
    expect(result.issues.map((issue) => issue.code)).toContain("cell-type-count-mismatch");
    expect(result.model.elementBlocks[0]?.count).toBe(1);
    expect([...required(result.model.elementBlocks[0]).connectivity]).toEqual([0, 1, 2, 3]);
  });

  it("reports a cell type count below the declared cells", () => {
    const source = [
      "# vtk DataFile Version 5.0",
      "tet example",
      "ASCII",
      "DATASET UNSTRUCTURED_GRID",
      "POINTS 4 double",
      "0 0 0",
      "1 0 0",
      "0 1 0",
      "0 0 1",
      "CELLS 2 10",
      "4 0 1 2 3",
      "4 0 1 2 3",
      "CELL_TYPES 1",
      "10",
      "",
    ].join("\n");
    const result = parseVtk(source);
    expect(result.issues.map((issue) => issue.code)).toContain("cell-type-count-mismatch");
    expect(result.model.elementBlocks[0]?.count).toBe(1);
  });

  it("skips cells with fractional or negative node ids and reports bad-cell-shape", () => {
    const source = [
      "# vtk DataFile Version 5.0",
      "tet example",
      "ASCII",
      "DATASET UNSTRUCTURED_GRID",
      "POINTS 4 double",
      "0 0 0",
      "1 0 0",
      "0 1 0",
      "0 0 1",
      "CELLS 3 15",
      "4 0 1 2.5 3",
      "4 0 1 2 3",
      "4 -1 1 2 3",
      "CELL_TYPES 3",
      "10",
      "10",
      "10",
      "",
    ].join("\n");
    const result = parseVtk(source);
    expect(result.issues.map((issue) => issue.code)).toContain("bad-cell-shape");
    expect(result.model.elementBlocks).toHaveLength(1);
    expect(result.model.elementBlocks[0]?.count).toBe(1);
    expect([...required(result.model.elementBlocks[0]).ids]).toEqual([1]);
    expect([...required(result.model.elementBlocks[0]).connectivity]).toEqual([0, 1, 2, 3]);
  });

  it("reports fractional and oversized cell types as unsupported instead of truncating", () => {
    const source = [
      "# vtk DataFile Version 5.0",
      "tet example",
      "ASCII",
      "DATASET UNSTRUCTURED_GRID",
      "POINTS 4 double",
      "0 0 0",
      "1 0 0",
      "0 1 0",
      "0 0 1",
      "CELLS 3 15",
      "4 0 1 2 3",
      "4 0 1 2 3",
      "4 0 1 2 3",
      "CELL_TYPES 3",
      "10.5",
      "4294967297",
      "10",
      "",
    ].join("\n");
    const result = parseVtk(source);
    expect(
      result.issues.map((issue) => issue.code).filter((code) => code === "unsupported-cell-type"),
    ).toHaveLength(2);
    expect(result.model.elementBlocks).toHaveLength(1);
    expect(result.model.elementBlocks[0]?.count).toBe(1);
    expect([...required(result.model.elementBlocks[0]).ids]).toEqual([2]);
  });
});

describe("parseVtk streaming memory", () => {
  it("accumulates a large cell table in compact typed-array buffers", () => {
    const cellCount = 2_000;
    const session = createParseSession();
    const state = createVtkState(session);
    state.cellsRemaining = cellCount;
    for (let cell = 0; cell < cellCount; cell += 1) {
      readCellsLine(state, "4 0 1 2 3", cell + 20);
    }
    expect(state.cellCount).toBe(cellCount);
    expect(state.cellStarts.size).toBe(cellCount);
    expect(state.cellConnectivity.size).toBe(cellCount * 4);
    expect(state.cellConnectivity.toArray()).toBeInstanceOf(Uint32Array);
    expect(state.cellStarts).toBeInstanceOf(Uint32Buffer);
    expect(state.cellConnectivity).toBeInstanceOf(Uint32Buffer);
    expect(state.cellStarts.byteLength).toBeLessThanOrEqual(cellCount * 8);
    expect(state.cellConnectivity.byteLength).toBeLessThanOrEqual(cellCount * 4 * 8);

    state.cellTypesRemaining = cellCount;
    for (let cell = 0; cell < cellCount; cell += 1) {
      readCellTypesLine(state, "10", cell + 20);
    }
    expect(state.cellTypes.size).toBe(cellCount);
    expect(state.cellTypes.toArray()).toBeInstanceOf(Uint32Array);
    expect(state.cellTypes).toBeInstanceOf(Uint32Buffer);
    expect(state.cellTypes.byteLength).toBeLessThanOrEqual(cellCount * 8);
  });

  it("parses a large mixed-shape fixture into typed element blocks", () => {
    const cellCount = 5_000;
    const hexCount = Math.floor(cellCount / 2);
    const tetCount = cellCount - hexCount;
    const lines: string[] = [
      "# vtk DataFile Version 5.0",
      "streaming memory",
      "ASCII",
      "DATASET UNSTRUCTURED_GRID",
      "POINTS 8 double",
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
    for (let cell = 0; cell < hexCount; cell += 1) {
      lines.push("8 0 1 2 3 4 5 6 7");
    }
    for (let cell = 0; cell < tetCount; cell += 1) {
      lines.push("4 0 1 2 3");
    }
    lines.push(`CELL_TYPES ${String(cellCount)}`);
    for (let cell = 0; cell < hexCount; cell += 1) {
      lines.push("12");
    }
    for (let cell = 0; cell < tetCount; cell += 1) {
      lines.push("10");
    }

    const result = parseVtk(lines.join("\n"));
    expect(result.issues).toEqual([]);
    expect(result.model.elementBlocks.map((block) => block.shape.family)).toEqual(["hex", "tet"]);
    expect(result.model.elementBlocks.map((block) => block.count)).toEqual([hexCount, tetCount]);
    for (const block of result.model.elementBlocks) {
      expect(block.ids).toBeInstanceOf(Uint32Array);
      expect(block.connectivity).toBeInstanceOf(Uint32Array);
    }
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

  it("remaps non-dense node ids and preserves complete result associations", () => {
    const builder = createModelBuilder();
    builder.appendNodes([10, 20], [0, 0, 0, 1, 0, 0]);
    builder.addResult({
      name: "temp",
      location: "node",
      components: 1,
      ids: new Uint32Array([20, 10]),
      values: new Float64Array([2, 1]),
    });
    const written = writeVtk(builder.build());
    expect(written).toContain("POINT_DATA 2");
    const parsed = parseVtk(written);
    expect(parsed.issues).toEqual([]);
    expect([...required(parsed.model.results[0]).values]).toEqual([1, 2]);
  });

  it("remaps non-dense connectivity without changing coordinate row order", () => {
    const builder = createModelBuilder();
    builder.appendNodes([20, 10, 30], [20, 0, 0, 10, 0, 0, 30, 0, 0]);
    builder.openElementBlock(TRIANGLE_SHAPE);
    builder.appendElements([40], [10, 20, 30]);

    const parsed = parseVtk(writeVtk(builder.build()));
    expect(parsed.issues).toEqual([]);
    expect([...parsed.model.nodes.coordinates]).toEqual([20, 0, 0, 10, 0, 0, 30, 0, 0]);
    expect([...required(parsed.model.elementBlocks[0]).connectivity]).toEqual([1, 0, 2]);
  });

  it("reorders element results to the authored block and row cell order", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    builder.openElementBlock(TRIANGLE_SHAPE);
    builder.appendElements([20], [0, 1, 2]);
    builder.openElementBlock(TRIANGLE_SHAPE);
    builder.appendElements([10], [0, 1, 2]);
    builder.addResult({
      name: "stress",
      location: "element",
      components: 1,
      ids: new Uint32Array([10, 20]),
      values: new Float64Array([10, 20]),
    });

    const parsed = parseVtk(writeVtk(builder.build()));
    expect(parsed.issues).toEqual([]);
    expect([...required(parsed.model.results[0]).values]).toEqual([20, 10]);
  });

  it("writes vector results and rejects unsupported component counts", () => {
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
    const model = builder.build();
    const vector = model.results[0];
    if (vector === undefined) throw new Error("expected vector result");
    const written = writeVtk({ ...model, results: [vector] });
    expect(written).toContain("VECTORS velocity double");
    expect(() => writeVtk(model)).toThrow(
      expect.objectContaining({
        name: "VtkWriteError",
        code: "unsupported-writer-state",
      }),
    );
  });

  it("rejects invalid models before producing output", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    builder.openElementBlock(TRIANGLE_SHAPE);
    builder.appendElements([1], [0, 1, 99]);
    expect(() => writeVtk(builder.build())).toThrow(
      expect.objectContaining({ name: "VtkWriteError", code: "invalid-model" }),
    );
  });

  it("reports duplicate authoritative node ids through the typed writer error", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 0, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    builder.openElementBlock(TRIANGLE_SHAPE);
    builder.appendElements([1], [0, 0, 2]);
    try {
      writeVtk(builder.build());
      throw new Error("expected VtkWriteError");
    } catch (error) {
      expect(error).toBeInstanceOf(VtkWriteError);
      expect((error as VtkWriteError).issues.map((issue) => issue.code)).toContain(
        "duplicate-node-id",
      );
    }
  });

  it.each([
    ["duplicate", new Uint32Array([0, 0]), "duplicate-result-identity"],
    ["partial", new Uint32Array([0]), "incomplete-result-coverage"],
    ["extra", new Uint32Array([0, 1, 2]), "incomplete-result-coverage"],
  ] as const)("rejects %s result identity coverage", (_name, ids, code) => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 1], [0, 0, 0, 1, 0, 0]);
    builder.addResult({
      name: "temp",
      location: "node",
      components: 1,
      ids,
      values: new Float64Array(ids.length),
    });
    expect(() => writeVtk(builder.build())).toThrow(
      expect.objectContaining({ name: "VtkWriteError", code }),
    );
  });

  it("rejects non-finite result values instead of writing zero", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0], [0, 0, 0]);
    builder.addResult({
      name: "temp",
      location: "node",
      components: 1,
      ids: new Uint32Array([0]),
      values: new Float64Array([NaN]),
    });
    expect(() => writeVtk(builder.build())).toThrow(
      expect.objectContaining({ name: "VtkWriteError", code: "unsupported-writer-state" }),
    );
  });
});
