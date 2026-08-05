import { describe, expect, it } from "vitest";
import {
  canonicalElementCoordinates,
  canonicalElementModel,
  coordsOfModel,
  expectMidEdgePlacement,
  required,
} from "./helpers";
import { parseAbaqus, writeAbaqus } from "../../src/io/parse";
import { createModelBuilder } from "../../src/io/build";
import { TET4_SHAPE, HEX8_SHAPE, HEX20_SHAPE, TET10_SHAPE } from "../../src/elements/shapes";

const DECK = [
  "** Abaqus example",
  "*NODE, NSET=ALL",
  "1, 0, 0, 0",
  "2, 1, 0, 0",
  "3, 0, 1, 0",
  "4, 0, 0, 1",
  "5, 2, 0, 0",
  "6, 3, 0, 0",
  "*ELEMENT, TYPE=C3D4, ELSET=TETS",
  "1, 1, 2, 3, 4",
  "2, 2, 5, 6, 4",
  "*NSET, NSET=LEFT",
  "1, 2,",
  "3",
  "*NSET, NSET=RANGE, GENERATE",
  "1, 6, 1",
  "*ELSET, ELSET=BOUNDARY",
  "1",
  "",
].join("\n");

describe("parseAbaqus", () => {
  it("reads nodes, elements, and sets", () => {
    const result = parseAbaqus(DECK);
    expect(result.issues).toEqual([]);
    expect(result.model.nodes.count).toBe(6);
    expect([...result.model.nodes.ids]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.model.elementBlocks).toHaveLength(1);
    expect(result.model.elementBlocks[0]?.shape.family).toBe("tet");
    expect([...required(result.model.elementBlocks[0]).ids]).toEqual([1, 2]);
    const sets = Object.fromEntries(result.model.sets.map((set) => [set.name, [...set.ids]]));
    expect(sets["ALL"]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(sets["TETS"]).toEqual([1, 2]);
    expect(sets["LEFT"]).toEqual([1, 2, 3]);
    expect(sets["RANGE"]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(sets["BOUNDARY"]).toEqual([1]);
  });

  it("supports 2D node coordinates", () => {
    const result = parseAbaqus("*NODE\n1, 0, 0\n2, 1, 2\n");
    expect([...result.model.nodes.coordinates]).toEqual([0, 0, 0, 1, 2, 0]);
  });

  it("reads multi-line elements via continuation commas", () => {
    const deck = [
      "*NODE",
      ...Array.from({ length: 20 }, (_, index) => `${index + 1}, ${index}, 0, 0`),
      "*ELEMENT, TYPE=C3D20",
      `1, ${Array.from({ length: 15 }, (_, index) => index + 1).join(", ")},`,
      Array.from({ length: 5 }, (_, index) => index + 16).join(", "),
      "",
    ].join("\n");
    const result = parseAbaqus(deck);
    expect(result.issues).toEqual([]);
    expect(result.model.elementBlocks).toHaveLength(1);
    expect(result.model.elementBlocks[0]?.shape.family).toBe("hex");
    expect([...required(result.model.elementBlocks[0]).connectivity]).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
  });

  it("skips unsupported element types with a warning", () => {
    const deck = [
      "*NODE",
      "1, 0, 0, 0",
      "2, 1, 0, 0",
      "3, 0, 1, 0",
      "4, 0, 0, 1",
      "5, 0, 1, 1",
      "6, 1, 1, 1",
      "*ELEMENT, TYPE=C3D6",
      "1, 1, 2, 3, 4, 5, 6",
      "*ELEMENT, TYPE=C3D4",
      "2, 1, 2, 3, 4",
      "",
    ].join("\n");
    const result = parseAbaqus(deck);
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("unsupported-element-type");
    expect(result.model.elementBlocks).toHaveLength(1);
    expect([...required(result.model.elementBlocks[0]).ids]).toEqual([2]);
  });

  it("handles reduced-integration and modified type suffixes", () => {
    const deck = [
      "*NODE",
      ...Array.from({ length: 20 }, (_, index) => `${index + 1}, ${index}, 0, 0`),
      "*ELEMENT, TYPE=C3D20R",
      `1, ${Array.from({ length: 20 }, (_, index) => index + 1).join(", ")}`,
      "",
    ].join("\n");
    const result = parseAbaqus(deck);
    expect(result.model.elementBlocks[0]?.shape.order).toBe(2);
  });

  it("ignores unknown keywords and their data", () => {
    const deck = [
      "*HEADING",
      "some title",
      "*MATERIAL, NAME=STEEL",
      "2.1E5",
      "*NODE",
      "1, 0, 0, 0",
      "",
    ].join("\n");
    const result = parseAbaqus(deck);
    expect(result.issues).toEqual([]);
    expect(result.model.nodes.count).toBe(1);
  });

  it("keeps a node set and element set with the same name separate", () => {
    const deck = [
      "*NODE",
      "1, 0, 0, 0",
      "2, 1, 0, 0",
      "3, 0, 1, 0",
      "4, 0, 0, 1",
      "*ELEMENT, TYPE=C3D4",
      "1, 1, 2, 3, 4",
      "*NSET, NSET=ALL",
      "1, 2",
      "*ELSET, ELSET=ALL",
      "1",
      "",
    ].join("\n");
    const result = parseAbaqus(deck);
    expect(result.issues).toEqual([]);
    expect(result.model.sets).toHaveLength(2);
    const nodeSet = result.model.sets.find((set) => set.kind === "node");
    const elementSet = result.model.sets.find((set) => set.kind === "element");
    expect(nodeSet?.name).toBe("ALL");
    expect([...required(nodeSet).ids]).toEqual([1, 2]);
    expect(elementSet?.name).toBe("ALL");
    expect([...required(elementSet).ids]).toEqual([1]);
  });

  it("reports truncated continuation lines", () => {
    const deck = "*NODE\n1, 0, 0,\n";
    const result = parseAbaqus(deck);
    expect(result.issues.map((issue) => issue.code)).toContain("truncated-data-line");
  });
});

describe("writeAbaqus", () => {
  it("round-trips ids, connectivity, and sets", () => {
    const builder = createModelBuilder();
    builder.appendNodes([10, 11, 12, 13], [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    builder.openElementBlock(TET4_SHAPE);
    builder.appendElements([7], [10, 11, 12, 13]);
    builder.openElementBlock(HEX8_SHAPE);
    builder.appendElements([8], [10, 11, 12, 13, 10, 11, 12, 13]);
    builder.addSet("node", "all", [10, 11, 12, 13]);
    builder.addSet("element", "solids", [7, 8]);
    const model = builder.build();

    const written = writeAbaqus(model);
    expect(written).toContain("*ELEMENT, TYPE=C3D4");
    expect(written).toContain("*ELEMENT, TYPE=C3D8");
    expect(written).toContain("*NSET, NSET=all");
    expect(written).toContain("*ELSET, ELSET=solids");

    const parsed = parseAbaqus(written);
    expect(parsed.issues).toEqual([]);
    expect([...parsed.model.nodes.ids]).toEqual([10, 11, 12, 13]);
    expect(parsed.model.elementBlocks).toHaveLength(2);
    expect([...required(parsed.model.elementBlocks[0]).ids]).toEqual([7]);
    expect([...required(parsed.model.elementBlocks[1]).ids]).toEqual([8]);
    const sets = Object.fromEntries(parsed.model.sets.map((set) => [set.name, [...set.ids]]));
    expect(sets["all"]).toEqual([10, 11, 12, 13]);
    expect(sets["solids"]).toEqual([7, 8]);
  });

  it("wraps C3D20 element lines with continuation commas", () => {
    const builder = createModelBuilder();
    builder.appendNodes(
      Array.from({ length: 20 }, (_, index) => index + 1),
      new Float64Array(60),
    );
    builder.openElementBlock(HEX20_SHAPE);
    builder.appendElements(
      [1],
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    const written = writeAbaqus(builder.build());
    const lines = written.split("\n");
    const elementIndex = lines.findIndex((line) => line.startsWith("*ELEMENT, TYPE=C3D20"));
    expect(lines[elementIndex + 1]?.endsWith(",")).toBe(true);
    const parsed = parseAbaqus(written);
    expect(parsed.issues).toEqual([]);
    expect([...required(parsed.model.elementBlocks[0]).connectivity]).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
  });

  it("is deterministic", () => {
    const builder = createModelBuilder();
    builder.appendNodes([1], [0, 0, 0]);
    const model = builder.build();
    expect(writeAbaqus(model)).toBe(writeAbaqus(model));
  });

  it("writes and re-reads C3D10 mid-edge nodes on their canonical edges", () => {
    const { model, coordsOf } = canonicalElementModel(TET10_SHAPE);
    const parsed = parseAbaqus(writeAbaqus(model));
    expect(parsed.issues).toEqual([]);
    const block = required(parsed.model.elementBlocks[0]);
    expect([...block.connectivity]).toEqual([...required(model.elementBlocks[0]).connectivity]);
    expectMidEdgePlacement(block, coordsOf);
  });

  it("writes and re-reads C3D20 mid-edge nodes on their canonical edges", () => {
    const { model, coordsOf } = canonicalElementModel(HEX20_SHAPE);
    const parsed = parseAbaqus(writeAbaqus(model));
    expect(parsed.issues).toEqual([]);
    const block = required(parsed.model.elementBlocks[0]);
    expect([...block.connectivity]).toEqual([...required(model.elementBlocks[0]).connectivity]);
    expectMidEdgePlacement(block, coordsOf);
  });
});

describe("parseAbaqus quadratic ordering", () => {
  it("parses a native C3D20 deck into canonical node order", () => {
    const coords = canonicalElementCoordinates(HEX20_SHAPE);
    const lines = ["*NODE"];
    for (let node = 0; node < 20; node += 1) {
      lines.push(
        `${String(node)}, ${String(coords[3 * node])}, ${String(coords[3 * node + 1])}, ${String(
          coords[3 * node + 2],
        )}`,
      );
    }
    lines.push("*ELEMENT, TYPE=C3D20");
    lines.push(`1, ${Array.from({ length: 20 }, (_, index) => index).join(", ")}`);
    const parsed = parseAbaqus(lines.join("\n"));
    expect(parsed.issues).toEqual([]);
    const block = required(parsed.model.elementBlocks[0]);
    expect([...block.connectivity]).toEqual(Array.from({ length: 20 }, (_, index) => index));
    expectMidEdgePlacement(block, coordsOfModel(parsed.model));
  });
});
